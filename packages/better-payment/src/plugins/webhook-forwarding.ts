import {
  ConfigurationError,
  definePlugin,
  type BetterPaymentLogger,
  type BetterPaymentPlugin,
  type PaymentEvent,
  type PaymentEventType,
  type PaymentOperation,
} from 'better-payment';
import { hmac, safeEqual, toHex } from '../core/crypto';

export interface WebhookEndpoint {
  /** Target webhook URL to deliver the event to */
  url: string;
  /** Secret key used to sign the webhook payload with HMAC-SHA256 */
  secret: string;
  /**
   * Event types forwarded to this endpoint. Use `['*']` for all events.
   * Default: `['*']`
   */
  events?: (PaymentEventType | '*')[];
  /** Optional custom headers to send with the HTTP POST request */
  headers?: Record<string, string>;
  /** Optional custom retry config for this endpoint */
  retry?: {
    attempts?: number;
    delay?: number;
  };
}

export interface ForwardedWebhookPayload<T = unknown> {
  /** The emitted payment event type (e.g. 'payment.succeeded') */
  event: PaymentEventType;
  /** Unix timestamp in milliseconds when the event was forwarded */
  timestamp: number;
  /** The payment provider ID that handled the transaction */
  provider: string;
  /** The payment operation (e.g. 'createPayment', 'refund') */
  operation: PaymentOperation;
  /** The provider's payment ID, when available */
  paymentId?: string;
  /** The merchant's conversation / order ID, when available */
  conversationId?: string;
  /** Transaction amount, when available */
  amount?: string;
  /** Currency code (e.g. 'TRY', 'USD') */
  currency?: string;
  /** Sanitized operation result, stripped of sensitive cardholder details */
  result: T;
}

export interface WebhookForwardingOptions {
  /** List of webhook endpoints to deliver events to */
  endpoints: WebhookEndpoint[];
  /** Default retry options for failed deliveries. Default: 3 attempts with exponential backoff */
  retry?: {
    attempts?: number;
    delay?: number;
  };
  /** Request timeout in milliseconds. Default: 10000 */
  timeout?: number;
  /** Custom fetch implementation (defaults to globalThis.fetch) */
  fetch?: typeof fetch;
  /** Optional error callback called when an endpoint delivery fails */
  onError?: (error: unknown, endpoint: WebhookEndpoint, payload: ForwardedWebhookPayload) => void;
  /**
   * Keeps serverless runtimes alive until deliveries finish
   * (e.g. Vercel `waitUntil` or Cloudflare `ctx.waitUntil`).
   */
  waitUntil?: (promise: Promise<unknown>) => void;
}

const SENSITIVE_CARD_KEYS = new Set([
  'card',
  'cardNumber',
  'cvv',
  'securityCode',
  'expireMonth',
  'expireYear',
  'cardHolderName',
]);

/**
 * Recursively strips sensitive payment card details from objects and arrays.
 */
function sanitizeResult<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeResult(item)) as unknown as T;
  }
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_CARD_KEYS.has(key)) {
      continue;
    }
    clean[key] = sanitizeResult(val);
  }
  return clean as T;
}

/**
 * Verifies a forwarded webhook HMAC-SHA256 signature against the raw payload and secret.
 *
 * @param payload - Raw request body string, bytes, or parsed payload object
 * @param signature - The signature hex string from the `x-signature` header (optional `sha256=` prefix supported)
 * @param secret - The shared webhook signing secret
 * @returns True if the signature matches, false otherwise
 */
export async function verifyForwardedWebhook(
  payload: string | Uint8Array | Record<string, unknown>,
  signature: string,
  secret: string
): Promise<boolean> {
  if (!signature || !secret) {
    return false;
  }
  const cleanSignature = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  const raw =
    typeof payload === 'string' || payload instanceof Uint8Array
      ? payload
      : JSON.stringify(payload);
  const expectedBytes = await hmac('SHA-256', secret, raw);
  const expectedHex = toHex(expectedBytes);
  return safeEqual(cleanSignature.toLowerCase(), expectedHex.toLowerCase());
}

/**
 * Webhook forwarding plugin for better-payment.
 *
 * Forwards typed payment events to external HTTP endpoints as signed JSON webhooks
 * with HMAC-SHA256 signatures, automatic retry with backoff, and sensitive card data sanitization.
 * Slow or failing endpoints run in the background and never block or fail the primary payment.
 *
 * @example
 * ```ts
 * import { webhookForwarding } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { ... },
 *   plugins: [
 *     webhookForwarding({
 *       endpoints: [
 *         {
 *           url: 'https://api.myapp.com/webhooks/payments',
 *           secret: process.env.PAYMENT_WEBHOOK_SECRET!,
 *           events: ['payment.succeeded', 'refund.succeeded'],
 *         },
 *       ],
 *     }),
 *   ],
 * });
 * ```
 */
export function webhookForwarding(options: WebhookForwardingOptions): BetterPaymentPlugin {
  if (!Array.isArray(options.endpoints) || options.endpoints.length === 0) {
    throw new ConfigurationError('webhookForwarding: endpoints must be a non-empty array');
  }

  for (const ep of options.endpoints) {
    if (!ep.url || typeof ep.url !== 'string') {
      throw new ConfigurationError('webhookForwarding: each endpoint must have a valid url string');
    }
    if (!ep.secret || typeof ep.secret !== 'string') {
      throw new ConfigurationError('webhookForwarding: each endpoint must have a secret string');
    }
  }

  const timeout = options.timeout ?? 10_000;
  const defaultAttempts = options.retry?.attempts ?? 3;
  const defaultDelay = options.retry?.delay ?? 1000;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const pending = new Set<Promise<void>>();
  let logger: BetterPaymentLogger | undefined;

  const deliverToEndpoint = async (
    endpoint: WebhookEndpoint,
    payload: ForwardedWebhookPayload
  ): Promise<void> => {
    const bodyString = JSON.stringify(payload);
    const sigBytes = await hmac('SHA-256', endpoint.secret, bodyString);
    const signature = toHex(sigBytes);

    const attempts = endpoint.retry?.attempts ?? defaultAttempts;
    const baseDelay = endpoint.retry?.delay ?? defaultDelay;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetchImpl(endpoint.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-signature': signature,
            'x-better-payment-signature': signature,
            'x-signature-timestamp': String(payload.timestamp),
            ...(endpoint.headers ?? {}),
          },
          body: bodyString,
          signal: AbortSignal.timeout(timeout),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        return;
      } catch (error) {
        if (attempt >= attempts) {
          throw error;
        }
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  };

  const reportError = (
    error: unknown,
    endpoint: WebhookEndpoint,
    payload: ForwardedWebhookPayload
  ) => {
    try {
      if (options.onError) {
        options.onError(error, endpoint, payload);
      } else {
        logger?.error(
          `webhookForwarding: delivery to ${endpoint.url} failed`,
          error instanceof Error ? error : new Error(String(error)),
          { event: payload.event, paymentId: payload.paymentId }
        );
      }
    } catch {
      // Receiver error callback failure must not affect the main runtime
    }
  };

  const forwardEvent = async (event: PaymentEvent) => {
    const matchingEndpoints = options.endpoints.filter(({ events = ['*'] }) =>
      events.some((t) => t === '*' || t === event.type)
    );

    if (matchingEndpoints.length === 0) {
      return;
    }

    const payload: ForwardedWebhookPayload = {
      event: event.type,
      timestamp: Date.now(),
      provider: event.provider,
      operation: event.operation,
      paymentId: event.paymentId,
      conversationId: event.conversationId,
      amount: event.amount,
      currency: event.currency,
      result: sanitizeResult(event.result),
    };

    await Promise.all(
      matchingEndpoints.map(async (endpoint) => {
        try {
          await deliverToEndpoint(endpoint, payload);
        } catch (error) {
          reportError(error, endpoint, payload);
        }
      })
    );
  };

  return definePlugin({
    id: 'webhook-forwarding',
    options,
    init(ctx) {
      logger = ctx.logger;
    },
    events: {
      '*': (event: PaymentEvent) => {
        const task: Promise<void> = forwardEvent(event)
          .catch((err) => {
            logger?.error('webhookForwarding: unexpected event handler error', err as Error);
          })
          .finally(() => {
            pending.delete(task);
          });
        pending.add(task);
        options.waitUntil?.(task);
      },
    },
    methods: () => ({
      webhooks: {
        /** Flushes all pending webhook delivery requests */
        flush: async (): Promise<void> => {
          await Promise.all(pending);
        },
      },
    }),
  });
}
