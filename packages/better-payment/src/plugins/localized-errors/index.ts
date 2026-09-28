import {
  ConfigurationError,
  definePlugin,
  type BetterPaymentRequest,
  type PaymentErrorCode,
} from 'better-payment';
import { en } from './en';
import { tr } from './tr';
import { de } from './de';
import { ru } from './ru';

/** Messages of one language by error code: normalized codes and plugin codes */
export type ErrorMessageDictionary = Partial<Record<PaymentErrorCode, string>> &
  Record<string, string | undefined>;

/**
 * The built-in languages. Each one has a message for every normalized error code;
 * a language that misses one does not compile.
 */
export const errorMessages = { en, tr, de, ru } satisfies Record<
  string,
  Record<PaymentErrorCode, string>
>;

export interface LocalizedErrorsOptions {
  /** Default language. Default: 'en' */
  locale?: string;
  /** Used for codes missing in a language. Default: 'en' */
  fallbackLocale?: string;
  /**
   * More languages, or overrides of the built-in messages, by language:
   * `{ tr: { INSUFFICIENT_FUNDS: '...' }, de: { ... } }`. Keys are normalized
   * error codes, or codes declared by plugins in `$ERROR_CODES`.
   */
  messages?: Record<string, ErrorMessageDictionary>;
  /**
   * Choose the language of each HTTP handler response from the request.
   * `true` (default) uses the `Accept-Language` header; a function returns a
   * language (or undefined for the default); `false` always uses `locale`.
   */
  detectLocale?: boolean | ((request: BetterPaymentRequest) => string | undefined);
}

interface Localizable {
  code?: unknown;
  errorCode?: unknown;
  errorMessage?: unknown;
  providerMessage?: unknown;
}

function isLocalizable(value: unknown): value is Localizable {
  return !!value && typeof value === 'object' && typeof (value as Localizable).code === 'string';
}

/** Languages of an `Accept-Language` header, most preferred first */
export function parseAcceptLanguage(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter(({ tag, q }) => tag && tag !== '*' && q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map(({ tag }) => tag);
}

/**
 * Replaces the `errorMessage` of failed results with a message for the customer,
 * in their language, chosen by the result's normalized `code` (or by a plugin's
 * error code in `errorCode`). The provider's message stays in `providerMessage`.
 *
 * @example
 * ```ts
 * import { localizedErrors } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { ... },
 *   plugins: [localizedErrors({ locale: 'tr' })],
 * });
 * ```
 */
export const localizedErrors = (options: LocalizedErrorsOptions = {}) => {
  const dictionaries: Record<string, ErrorMessageDictionary> = {};
  for (const source of [errorMessages, options.messages ?? {}]) {
    for (const [locale, messages] of Object.entries(source)) {
      const key = locale.toLowerCase();
      dictionaries[key] = { ...dictionaries[key], ...messages };
    }
  }
  const locale = (options.locale ?? 'en').toLowerCase();
  const fallbackLocale = (options.fallbackLocale ?? 'en').toLowerCase();
  for (const required of [locale, fallbackLocale]) {
    if (!dictionaries[required]) {
      throw new ConfigurationError(
        `localizedErrors: no messages for '${required}'. Pass them in messages.${required}.`
      );
    }
  }
  const locales = Object.keys(dictionaries);
  let pluginMessages: Readonly<Record<string, string>> = {};

  /** The supported language for a language tag (`tr-TR` → `tr`), if any */
  const supported = (tag: string | undefined): string | undefined => {
    if (!tag) return undefined;
    const lower = tag.toLowerCase();
    return dictionaries[lower]
      ? lower
      : dictionaries[lower.split('-')[0]]
        ? lower.split('-')[0]
        : undefined;
  };

  const message = (code: string, language: string = locale): string | undefined => {
    const lang = supported(language) ?? locale;
    return dictionaries[lang][code] ?? dictionaries[fallbackLocale][code] ?? pluginMessages[code];
  };

  const translate = <T>(result: T, language: string = locale): T => {
    if (!isLocalizable(result)) return result;
    const text =
      (typeof result.errorCode === 'string' ? message(result.errorCode, language) : undefined) ??
      message(result.code as string, language);
    if (!text) return result;
    const original =
      typeof result.providerMessage === 'string'
        ? result.providerMessage
        : typeof result.errorMessage === 'string'
          ? result.errorMessage
          : undefined;
    return {
      ...result,
      errorMessage: text,
      ...(original !== undefined ? { providerMessage: original } : {}),
    };
  };

  const detect = (request: BetterPaymentRequest): string | undefined => {
    if (options.detectLocale === false) return undefined;
    if (typeof options.detectLocale === 'function') return supported(options.detectLocale(request));
    const header = Object.entries(request.headers ?? {}).find(
      ([name]) => name.toLowerCase() === 'accept-language'
    )?.[1];
    return parseAcceptLanguage(header).map(supported).find(Boolean);
  };

  return definePlugin({
    id: 'localized-errors',
    options,
    hooks: {
      after: [
        {
          matcher: (ctx) => isLocalizable(ctx.result),
          handler: (ctx) => ({ result: translate(ctx.result) }),
        },
      ],
    },
    onResponse: (response, { request }) => {
      if (!isLocalizable(response.body)) return;
      return { ...response, body: translate(response.body, detect(request) ?? locale) };
    },
    methods: (ctx) => {
      // The live map of $ERROR_CODES: English defaults for codes declared by plugins
      pluginMessages = ctx.errorCodes;
      return {
        errors: {
          /** The message for an error code, in a language (default: `locale`) */
          message,
          /** A result with its `errorMessage` translated (for results of provider-specific methods) */
          translate,
          /** The languages that have messages */
          locales,
        },
      };
    },
  });
};
