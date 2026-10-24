import {
  ConfigurationError,
  definePlugin,
  type BetterPaymentLogger,
  type BetterPaymentPlugin,
  type BetterPaymentRequest,
  type BetterPaymentResponse,
  type RequestContext,
} from 'better-payment';

/**
 * Storage backend interface for rate limiting counters.
 */
export interface RateLimitStore {
  /**
   * Increments the hit count for a key within a window in milliseconds.
   * Returns the updated count and the epoch timestamp (ms) when the window resets.
   */
  increment(
    key: string,
    windowMs: number
  ): Promise<{ count: number; resetAt: number }> | { count: number; resetAt: number };

  /** Optional method to clear or reset a key (or all keys if omitted) */
  reset?(key?: string): Promise<void> | void;
}

/**
 * In-memory sliding-window counter store for rate limiting.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly maxEntries = 10_000) {}

  increment(key: string, windowMs: number): { count: number; resetAt: number } {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      const resetAt = now + windowMs;
      const newEntry = { count: 1, resetAt };
      this.entries.set(key, newEntry);
      while (this.entries.size > this.maxEntries) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.entries.delete(oldest);
      }
      return newEntry;
    }

    entry.count += 1;
    return entry;
  }

  reset(key?: string): void {
    if (key) {
      this.entries.delete(key);
    } else {
      this.entries.clear();
    }
  }
}

export interface RateLimitRule {
  /** Window duration string (e.g. '1m', '30s', '1h') or milliseconds */
  window?: string | number;
  /** Maximum number of requests allowed within the window */
  max?: number;
}

export interface RateLimitOptions {
  /** Default window duration string (e.g. '1m', '30s', '1h') or milliseconds. Default: '1m' (60s) */
  window?: string | number;
  /** Default maximum requests per window. Default: 60 */
  max?: number;
  /**
   * Per-route rate limiting rules or exclusions.
   * Set a rule to `false` to completely exclude that route from rate limiting.
   */
  rules?: Record<string, RateLimitRule | false>;
  /**
   * Key function to identify the client (e.g. by IP address or API key).
   * Required unless `trustProxy` is enabled: without one of the two the plugin
   * cannot derive a client identity that the request sender cannot forge.
   */
  key?: (req: BetterPaymentRequest) => string | Promise<string>;
  /**
   * Trust proxy-set headers (`X-Forwarded-For`, `X-Real-IP`, `CF-Connecting-IP`)
   * for the default key extraction. `true` means one trusted proxy hop, a number
   * means that many hops; the right-most `X-Forwarded-For` entry(s) are used, so
   * values the client prepends are ignored. Disabled by default, because
   * unprotected runtimes let any client set these headers freely.
   */
  trustProxy?: boolean | number;
  /** Storage backend for rate limiting counters. Default: in-memory store */
  store?: RateLimitStore;
  /** Whether to exclude payment provider callbacks by default. Default: true */
  excludeCallbacks?: boolean;
  /**
   * Let requests through, unlimited, while the store fails (a Redis outage), and
   * log the error. Default: false: the handler answers 503 until the store is back.
   */
  passOnStoreError?: boolean;
}

/**
 * Parses a window duration string (e.g. '1m', '30s', '1h', '1d', '500ms') or number to milliseconds.
 */
export function parseDuration(val: string | number): number {
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0) {
      throw new ConfigurationError(`rateLimit: window must be a positive number, got ${val}`);
    }
    return val;
  }
  if (typeof val !== 'string' || !val.trim()) {
    throw new ConfigurationError(`rateLimit: invalid window duration '${val}'`);
  }
  const match = val.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i);
  if (!match) {
    throw new ConfigurationError(`rateLimit: invalid window duration format '${val}'`);
  }
  const num = parseFloat(match[1]);
  const unit = (match[2] ?? 'ms').toLowerCase();
  switch (unit) {
    case 'd':
      return Math.round(num * 86_400_000);
    case 'h':
      return Math.round(num * 3_600_000);
    case 'm':
      return Math.round(num * 60_000);
    case 's':
      return Math.round(num * 1_000);
    case 'ms':
    default:
      return Math.round(num);
  }
}

function getHeader(request: BetterPaymentRequest, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

/**
 * Default key for `trustProxy` setups. A client can forge every `X-Forwarded-For`
 * entry except the ones appended by the proxies it cannot control, so the chain is
 * counted from the right: with N trusted hops the entry at `length - N` is the
 * identity the closest proxy actually observed. Reading the first entry instead is
 * only safe with proxies that overwrite the header rather than append to it.
 */
function forwardedKeyExtractor(hops: number): (req: BetterPaymentRequest) => string {
  return (req) => {
    const forwarded = getHeader(req, 'x-forwarded-for');
    if (forwarded) {
      const chain = forwarded
        .split(',')
        .map((ip) => ip.trim())
        .filter(Boolean);
      if (chain.length > 0) return chain[Math.max(0, chain.length - hops)];
    }
    const realIp = getHeader(req, 'x-real-ip');
    if (realIp?.trim()) return realIp.trim();
    const cfIp = getHeader(req, 'cf-connecting-ip');
    if (cfIp?.trim()) return cfIp.trim();
    return 'unknown';
  };
}

function isCallbackPath(path: string): boolean {
  const normalized = path.replace(/\/+$/, '');
  return (
    normalized.endsWith('/callback') ||
    normalized.includes('/callback/') ||
    normalized.endsWith('/complete-3ds') ||
    normalized === '/callback'
  );
}

function matchesRule(pattern: string, path: string): boolean {
  const normPattern = pattern.replace(/\/+$/, '');
  const normPath = path.replace(/\/+$/, '');

  if (normPattern === normPath) return true;

  // Wildcard matching (e.g. '/callback/*', '*/payment')
  if (normPattern.includes('*')) {
    const regexSource = normPattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    const regex = new RegExp(`^${regexSource}$`, 'i');
    const prefixedRegex = new RegExp(`^/[^/]+${regexSource}$`, 'i');
    return regex.test(normPath) || prefixedRegex.test(normPath);
  }

  // Exact suffix / action match (e.g. '/payment' matches '/iyzico/payment')
  const actionPattern = normPattern.startsWith('/') ? normPattern : `/${normPattern}`;
  if (normPath === actionPattern || normPath.endsWith(actionPattern)) {
    return true;
  }

  return false;
}

/**
 * General HTTP request rate limiter for better-payment handler endpoints.
 *
 * Protects against bot floods and brute-force testing on payment, 3D Secure,
 * and query endpoints while excluding provider callbacks by default.
 *
 * @example
 * ```ts
 * import { rateLimit } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { ... },
 *   plugins: [
 *     rateLimit({
 *       window: '1m',
 *       max: 30,
 *       // Only when a reverse proxy you control sets X-Forwarded-For:
 *       trustProxy: true,
 *       rules: {
 *         '/payment': { window: '1m', max: 5 },
 *         '/callback/*': false, // never limit callbacks
 *       },
 *     }),
 *   ],
 * });
 * ```
 *
 * @example Without a trusted proxy, define the bucket from data the app controls:
 * ```ts
 * rateLimit({
 *   key: (req) => req.headers['x-api-key'] ?? 'anonymous',
 * });
 * ```
 */
export function rateLimit(options: RateLimitOptions = {}): BetterPaymentPlugin {
  const defaultWindowMs = parseDuration(options.window ?? '1m');
  const defaultMax = options.max ?? 60;
  if (defaultMax <= 0) {
    throw new ConfigurationError(`rateLimit: max must be a positive integer, got ${defaultMax}`);
  }

  const trustProxy = options.trustProxy ?? false;
  if (typeof trustProxy === 'number' && (!Number.isInteger(trustProxy) || trustProxy < 1)) {
    throw new ConfigurationError(
      `rateLimit: trustProxy must be true, false or a positive hop count, got ${trustProxy}`
    );
  }
  // Proxy headers are attacker-controlled on any runtime without a trusted proxy in
  // front, so there is no safe default key in that mode: fail at construction
  // instead of silently shipping a limit every client can bypass per request.
  if (!options.key && !trustProxy) {
    throw new ConfigurationError(
      'rateLimit: no trustworthy client identity. Set "trustProxy" when the app runs behind a ' +
        'reverse proxy that sets X-Forwarded-For, or pass an explicit "key" function.'
    );
  }

  const store = options.store ?? new MemoryRateLimitStore();
  const keyFn =
    options.key ?? forwardedKeyExtractor(typeof trustProxy === 'number' ? trustProxy : 1);
  const excludeCallbacks = options.excludeCallbacks !== false;
  const passOnStoreError = options.passOnStoreError === true;
  let logger: BetterPaymentLogger | undefined;
  const rules = options.rules ?? {};

  return definePlugin({
    id: 'rate-limit',
    options,
    init: (ctx) => {
      logger = ctx.logger;
    },
    $ERROR_CODES: {
      RATE_LIMITED: 'Too many requests, please try again later',
    },
    methods: () => ({
      rateLimit: {
        /** Resets rate limit for a key, or all keys if omitted */
        reset: (key?: string) => store.reset?.(key),
        /** Store instance */
        store,
      },
    }),
    onRequest: async (
      request: BetterPaymentRequest,
      ctx: RequestContext
    ): Promise<BetterPaymentResponse | void> => {
      const path = ctx.path;

      // 1. Check user-defined rules
      let matchedRule: RateLimitRule | false | undefined;
      let matchedPattern: string | undefined;

      for (const [pattern, rule] of Object.entries(rules)) {
        if (matchesRule(pattern, path)) {
          matchedRule = rule;
          matchedPattern = pattern;
          break;
        }
      }

      // If rule is explicitly set to false, route is excluded
      if (matchedRule === false) {
        return;
      }

      // Exclude provider callbacks by default unless matched by an explicit rule
      if (excludeCallbacks && matchedRule === undefined && isCallbackPath(path)) {
        return;
      }

      const windowMs = matchedRule?.window ? parseDuration(matchedRule.window) : defaultWindowMs;
      const limit = matchedRule?.max ?? defaultMax;

      // User key functions may call `req.headers.get(name)` in WHATWG style; the plain
      // header bag has no such method, so attach one before handing the request over.
      const headers = request.headers as Record<string, unknown>;
      if (headers && typeof headers.get !== 'function') {
        headers.get = (name: string) => getHeader(request, name);
      }

      const clientKey = await keyFn(request);
      const ruleKey = matchedPattern ? `rule:${matchedPattern}` : 'global';
      const storageKey = `${ruleKey}:${clientKey}`;

      let counter: { count: number; resetAt: number };
      try {
        counter = await store.increment(storageKey, windowMs);
      } catch (error) {
        if (!passOnStoreError) throw error;
        logger?.error(
          'rateLimit: store failed, request let through (passOnStoreError)',
          error instanceof Error ? error : new Error(String(error))
        );
        return;
      }
      const { count, resetAt } = counter;

      if (count > limit) {
        const now = Date.now();
        const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));

        return {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': String(retryAfterSeconds),
            'x-ratelimit-limit': String(limit),
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Math.ceil(resetAt / 1000)),
          },
          body: {
            status: 'error',
            code: 'RATE_LIMITED',
            errorCode: 'RATE_LIMITED',
            errorMessage: 'Too many requests, please try again later',
          },
        };
      }
    },
  });
}
