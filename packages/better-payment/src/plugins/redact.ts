import {
  definePlugin,
  type BetterPaymentLogger,
  type OperationResultContext,
} from 'better-payment';

export type CardMaskingStyle = 'first6last4' | 'last4' | 'none' | ((pan: string) => string);

/**
 * A logger we can wrap in place: the public {@link BetterPaymentLogger} surface
 * with a marker flag that keeps `init` and `methods` from wrapping it twice.
 */
interface RedactableLogger extends BetterPaymentLogger {
  __redactWrapped?: boolean;
}

export interface RedactOptions {
  /**
   * More field names to mask when encountered as object keys. They are added to
   * the defaults (card details, CVV/CVC, expiration dates, cardholder name,
   * identity number, phone and secrets), which always stay masked.
   */
  fields?: string[];
  /**
   * Style for masking card numbers (PAN).
   * - `'first6last4'`: e.g. `545454******5454` (default)
   * - `'last4'`: e.g. `************5454`
   * - `'none'`: e.g. `<redacted>`
   * - `(pan) => string`: custom masking function
   */
  card?: CardMaskingStyle;
  /**
   * More regular expression patterns to match and mask anywhere in string values,
   * added to the built-in Turkish ID (TCKN) pattern.
   */
  custom?: RegExp[];
  /**
   * Placeholder string used for generic redacted values.
   * Default: `'<redacted>'`
   */
  maskString?: string;
  /**
   * Whether to wrap the configured logger so all logged messages and metadata are masked.
   * Default: `true`
   */
  redactLogger?: boolean;
  /**
   * Whether to mask event payloads before event listeners and other plugins see them.
   * Default: `true`
   */
  redactEvents?: boolean;
}

const DEFAULT_FIELDS: string[] = [
  'cardNumber',
  'cardHolderName',
  'cvc',
  'cvv',
  'securityCode',
  'expireMonth',
  'expireYear',
  'identityNumber',
  'gsmNumber',
  'phoneNumber',
  'phone',
  'secretKey',
  'apiKey',
  'merchantKey',
  'merchantSalt',
  'password',
  'clientPassword',
  'storeKey',
  'hashKey',
  'apiSecret',
  'clientSecret',
  'terminalProvPassword',
];

/**
 * Result fields kept as the provider sent them, because the masked result is also
 * what the caller gets back: identifiers, the 3D Secure and checkout form pages
 * (their markup can hold long digit runs that look like card numbers) and the
 * stored card tokens. Events see them unmasked too.
 */
const RESULT_PASSTHROUGH = [
  'paymentId',
  'conversationId',
  'threeDSHtmlContent',
  'redirectUrl',
  'checkoutFormContent',
  'paymentPageUrl',
  'token',
  'storedCard',
];

/** Matches credit/debit card numbers from 13 to 19 digits, also when glued to a word character */
const PAN_REGEX = /(?<!\d)(?:\d[ -]*?){13,19}(?!\d)/g;

/** Matches 11-digit Turkish Identity Numbers (TCKN) */
const TCKN_REGEX = /\b\d{11}\b/g;

function formatPan(pan: string, style: CardMaskingStyle = 'first6last4'): string {
  const digits = pan.replace(/\D/g, '');
  if (digits.length < 10) return '<redacted>';

  if (typeof style === 'function') {
    return style(digits);
  }

  switch (style) {
    case 'last4':
      return '*'.repeat(digits.length - 4) + digits.slice(-4);
    case 'none':
      return '<redacted>';
    case 'first6last4':
    default: {
      const first6 = digits.slice(0, 6);
      const last4 = digits.slice(-4);
      const middleStars = '*'.repeat(Math.max(digits.length - 10, 6));
      return `${first6}${middleStars}${last4}`;
    }
  }
}

/**
 * Creates a redaction transformer based on the provided options.
 */
export function createRedactor(options: RedactOptions = {}) {
  // Options add to the defaults: listing one extra field must not unmask the CVC
  const fields = new Set(
    [...DEFAULT_FIELDS, ...(options.fields ?? [])].map((f) => f.toLowerCase())
  );
  const cardStyle = options.card ?? 'first6last4';
  const customPatterns = [TCKN_REGEX, ...(options.custom ?? [])];
  const maskStr = options.maskString ?? '<redacted>';

  const maskStringValue = (str: string): string => {
    // 1. Mask card numbers in text
    let result = str.replace(PAN_REGEX, (match) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length >= 13 && digits.length <= 19) {
        return formatPan(digits, cardStyle);
      }
      return match;
    });

    // 2. Mask custom patterns (such as 11-digit TCKN)
    for (const pattern of customPatterns) {
      result = result.replace(pattern, maskStr);
    }

    return result;
  };

  const maskValue = (value: unknown, key = '', ancestors?: Set<object>): unknown => {
    if (value === null || value === undefined) return value;

    const lowerKey = key.toLowerCase();

    // Check if the key itself is explicitly in the redaction fields list
    if (key && fields.has(lowerKey)) {
      if (lowerKey === 'cardnumber') {
        return typeof value === 'string' ? formatPan(value, cardStyle) : maskStr;
      }
      if (lowerKey === 'cvc' || lowerKey === 'cvv') {
        return '***';
      }
      return maskStr;
    }

    if (typeof value === 'string') {
      return maskStringValue(value);
    }

    if (typeof value !== 'object') {
      return value;
    }

    // Break reference cycles: a value already on the current path is replaced
    // with the mask instead of recursing into itself forever.
    const seen = ancestors ?? new Set<object>();
    if (seen.has(value)) return maskStr;
    seen.add(value);

    let masked: unknown;
    if (Array.isArray(value)) {
      masked = value.map((item) => maskValue(item, key, seen));
    } else if (value instanceof Error) {
      const copy = new Error(maskStringValue(value.message));
      copy.name = value.name;
      if (value.stack) copy.stack = maskStringValue(value.stack);
      masked = copy;
    } else {
      masked = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, maskValue(v, k, seen)])
      );
    }

    seen.delete(value);
    return masked;
  };

  return {
    mask: maskValue,
    maskString: maskStringValue,
    maskCard: (pan: string) => formatPan(pan, cardStyle),
  };
}

/**
 * Masks cardholder data and personal data from logs, events, and audit trails
 * to guarantee PCI DSS and Turkish KVKK compliance.
 *
 * Never alters the original request payload sent to the payment provider.
 *
 * @example
 * ```ts
 * import { redact } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { ... },
 *   plugins: [
 *     redact({
 *       fields: ['cardNumber', 'cvc', 'expireMonth', 'expireYear', 'identityNumber', 'gsmNumber'],
 *       card: 'first6last4', // 545454******5454
 *       custom: [/\b\d{11}\b/g], // TCKN
 *     }),
 *   ],
 * });
 * ```
 */
/** The masked result, with the fields the caller needs put back as they were */
function keepPassthrough(masked: unknown, original: unknown): unknown {
  if (!masked || typeof masked !== 'object' || !original || typeof original !== 'object') {
    return masked;
  }
  const source = original as Record<string, unknown>;
  const copy = { ...(masked as Record<string, unknown>) };
  for (const key of RESULT_PASSTHROUGH) {
    if (key in source) copy[key] = source[key];
  }
  return copy;
}

export const redact = (options: RedactOptions = {}) => {
  const redactor = createRedactor(options);
  const redactLogger = options.redactLogger ?? true;
  const redactEvents = options.redactEvents ?? true;

  const wrapLogger = (logger: RedactableLogger) => {
    if (logger.__redactWrapped) return;
    logger.__redactWrapped = true;

    const origDebug = logger.debug.bind(logger);
    const origInfo = logger.info.bind(logger);
    const origError = logger.error.bind(logger);

    logger.debug = (message: string, meta?: Record<string, unknown>) => {
      origDebug(
        redactor.maskString(message),
        meta ? (redactor.mask(meta) as Record<string, unknown>) : undefined
      );
    };

    logger.info = (message: string, meta?: Record<string, unknown>) => {
      origInfo(
        redactor.maskString(message),
        meta ? (redactor.mask(meta) as Record<string, unknown>) : undefined
      );
    };

    logger.error = (message: string, error?: Error, meta?: Record<string, unknown>) => {
      const maskedError = error ? (redactor.mask(error) as Error) : undefined;
      origError(
        redactor.maskString(message),
        maskedError,
        meta ? (redactor.mask(meta) as Record<string, unknown>) : undefined
      );
    };
  };

  return definePlugin({
    id: 'redact',
    options,
    init: (ctx) => {
      if (redactLogger && ctx.logger) {
        wrapLogger(ctx.logger);
      }
    },
    hooks: {
      after: [
        {
          matcher: () => redactEvents,
          handler: (ctx: OperationResultContext) => {
            // Mask request and result copies passed to payment events and listeners.
            // The provider has already completed execution with the real request payload.
            const maskedRequest = redactor.mask(ctx.request);
            const maskedResult = keepPassthrough(redactor.mask(ctx.result), ctx.result);

            return {
              request: maskedRequest,
              result: maskedResult,
            };
          },
        },
      ],
    },
    methods: (ctx) => {
      if (redactLogger && ctx.logger) {
        wrapLogger(ctx.logger);
      }
      return {
        redact: {
          /**
           * Masks an object, array, or string according to the configured redaction rules.
           */
          mask: (value: unknown): unknown => redactor.mask(value),
          /**
           * Masks a card number (PAN) according to the configured card masking style.
           */
          maskCard: (pan: string): string => redactor.maskCard(pan),
        },
      };
    },
  });
};
