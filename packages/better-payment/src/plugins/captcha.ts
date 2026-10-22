import {
  ConfigurationError,
  definePlugin,
  PaymentStatus,
  type OperationContext,
  type PaymentOperation,
} from 'better-payment';

export type CaptchaProvider = 'cloudflare-turnstile' | 'hcaptcha' | 'google-recaptcha';

export interface CaptchaOptions {
  /**
   * The captcha service to verify tokens with.
   */
  provider: CaptchaProvider;
  /**
   * Secret key provided by Cloudflare Turnstile, hCaptcha, or Google reCAPTCHA.
   */
  secretKey: string;
  /**
   * Minimum score required for Google reCAPTCHA v3 (from 0.0 to 1.0).
   * Ignored for Cloudflare Turnstile and hCaptcha.
   * Default: 0.5.
   */
  minScore?: number;
  /**
   * Which operations require captcha verification.
   * Callbacks (3DS completion, webhooks) are never verified.
   * Default: ['createPayment', 'initThreeDSPayment', 'authorize', 'initThreeDSAuthorize'].
   */
  operations?: PaymentOperation[];
  /**
   * Custom token extractor function if your frontend passes the captcha token in a custom location.
   */
  getToken?: (request: unknown) => string | undefined;
  /**
   * Custom fetch function, useful for unit tests or proxied corporate networks.
   */
  fetch?: typeof fetch;
}

const DEFAULT_OPERATIONS: PaymentOperation[] = [
  'createPayment',
  'initThreeDSPayment',
  'authorize',
  'initThreeDSAuthorize',
];

const SITEVERIFY_URLS: Record<CaptchaProvider, string> = {
  'cloudflare-turnstile': 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  'google-recaptcha': 'https://www.google.com/recaptcha/api/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
};

function extractToken(
  request: unknown,
  customExtractor?: (req: unknown) => string | undefined
): string | undefined {
  if (customExtractor) {
    const custom = customExtractor(request);
    if (custom) return custom;
  }

  if (!request || typeof request !== 'object') return undefined;
  const req = request as Record<string, unknown>;

  // Check direct properties on the request body
  const candidates = [
    req.captchaToken,
    req.captcha,
    req['cf-turnstile-response'],
    req['g-recaptcha-response'],
    req['h-captcha-response'],
    req['x-captcha-response'],
  ];

  for (const val of candidates) {
    if (typeof val === 'string' && val.trim()) return val.trim();
  }

  // Check headers if request has a headers object
  if (req.headers && typeof req.headers === 'object') {
    const headers = req.headers as Record<string, unknown>;
    const headerCandidates = [
      headers['x-captcha-response'],
      headers['cf-turnstile-response'],
      headers['g-recaptcha-response'],
      headers['h-captcha-response'],
    ];
    for (const val of headerCandidates) {
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
  }

  return undefined;
}

interface SiteverifyResponse {
  success?: boolean;
  score?: number;
  'error-codes'?: string[];
}

/**
 * Captcha verification plugin for Cloudflare Turnstile, Google reCAPTCHA, and hCaptcha.
 * Verifies tokens before processing payment operations, protecting against automated card testing.
 *
 * @example
 * ```ts
 * import { captcha } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { ... },
 *   plugins: [
 *     captcha({
 *       provider: 'cloudflare-turnstile',
 *       secretKey: process.env.TURNSTILE_SECRET!,
 *     }),
 *   ],
 * });
 * ```
 */
export function captcha(options: CaptchaOptions) {
  if (!options?.provider || !SITEVERIFY_URLS[options.provider]) {
    throw new ConfigurationError(
      `captcha: invalid or missing provider '${options?.provider}'. Use 'cloudflare-turnstile', 'google-recaptcha', or 'hcaptcha'.`
    );
  }
  if (!options.secretKey) {
    throw new ConfigurationError('captcha: secretKey is required');
  }

  const {
    provider,
    secretKey,
    minScore = 0.5,
    operations = DEFAULT_OPERATIONS,
    getToken,
    fetch: customFetch = globalThis.fetch,
  } = options;

  const targetOps = new Set(operations);
  const siteverifyUrl = SITEVERIFY_URLS[provider];

  async function verifySiteToken(
    token: string,
    remoteIp?: string
  ): Promise<{ valid: boolean; reason?: string }> {
    try {
      const form = new URLSearchParams({
        secret: secretKey,
        response: token,
      });
      if (remoteIp) form.append('remoteip', remoteIp);

      const res = await customFetch(siteverifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });

      if (!res.ok) {
        return { valid: false, reason: `HTTP ${res.status}` };
      }

      const data = (await res.json()) as SiteverifyResponse;
      if (!data.success) {
        return { valid: false, reason: data['error-codes']?.join(', ') };
      }

      // Check reCAPTCHA v3 score if present
      if (provider === 'google-recaptcha' && typeof data.score === 'number') {
        if (data.score < minScore) {
          return { valid: false, reason: `Score ${data.score} below threshold ${minScore}` };
        }
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  return definePlugin({
    id: 'captcha',
    options: { provider, minScore },
    $ERROR_CODES: {
      CAPTCHA_MISSING: 'Captcha token is required',
      CAPTCHA_INVALID: 'Captcha verification failed',
    },
    hooks: {
      before: [
        {
          matcher: (ctx: OperationContext) => targetOps.has(ctx.operation),
          handler: async (ctx) => {
            const token = extractToken(ctx.request, getToken);

            if (!token) {
              return {
                result: {
                  status: PaymentStatus.FAILURE,
                  errorCode: 'CAPTCHA_MISSING',
                  errorMessage: 'Captcha token is required',
                },
              };
            }

            const ip = (ctx.request as Record<string, unknown>)?.ip as string | undefined;
            const verification = await verifySiteToken(token, ip);

            if (!verification.valid) {
              return {
                result: {
                  status: PaymentStatus.FAILURE,
                  errorCode: 'CAPTCHA_INVALID',
                  errorMessage: 'Captcha verification failed',
                },
              };
            }

            return undefined;
          },
        },
      ],
    },
  });
}
