import {
  ConfigurationError,
  definePlugin,
  PaymentErrorCode,
  PaymentStatus,
  type OperationContext,
  type PaymentOperation,
} from 'better-payment';

/** One way to break operations. Every field is optional. */
export interface ChaosRule {
  /** Operations it applies to. Default: all */
  operation?: PaymentOperation | PaymentOperation[];
  /** Providers it applies to. Default: all */
  provider?: string | string[];
  /** Chance that the rule fires on a matching call, from 0 to 1. Default: 1 */
  probability?: number;
  /**
   * Return a failure with this code instead of calling the provider.
   * `NETWORK_ERROR` returns a `pending` result, like a lost response.
   */
  fail?: PaymentErrorCode | `${PaymentErrorCode}`;
  /** Wait before the call: milliseconds, or `'500ms'`, `'3s'`, `'1m'` */
  delay?: number | string;
  /** The `errorMessage` of injected failures */
  message?: string;
}

export interface ChaosOptions {
  /** Default: true. Turn it on with an environment variable: `process.env.CHAOS === '1'` */
  enabled?: boolean;
  /** Rules are checked in order; the first matching rule that fires is applied */
  rules: ChaosRule[];
  /** Makes runs reproducible: the same seed fires the same rules in the same order */
  seed?: number;
  /** Allow the plugin in `production` mode. Default: false (it throws) */
  allowProduction?: boolean;
}

const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000 };

function toMs(delay: number | string): number {
  if (typeof delay === 'number') return delay;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m)$/.exec(delay.trim());
  if (!match) {
    throw new ConfigurationError(
      `chaos: invalid delay '${delay}'. Use milliseconds or '500ms', '3s', '1m'.`
    );
  }
  return Number(match[1]) * UNITS[match[2]];
}

/** mulberry32: a small seeded random number generator */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const list = <T>(value: T | T[] | undefined): T[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

const codes = new Set<string>(Object.values(PaymentErrorCode));

/**
 * Injects failures and delays into operations, so that you can test how your
 * application handles declines, lost responses (`NETWORK_ERROR`) and slow
 * providers. Failed calls never reach the provider. Throws in `production` mode
 * unless `allowProduction` is set.
 *
 * @example
 * ```ts
 * import { chaos } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { ... },
 *   plugins: [
 *     chaos({
 *       enabled: process.env.CHAOS === '1',
 *       seed: 42,
 *       rules: [
 *         { operation: 'createPayment', probability: 0.2, fail: 'NETWORK_ERROR' },
 *         { operation: 'refund', delay: '3s' },
 *       ],
 *     }),
 *   ],
 * });
 * ```
 */
export const chaos = (options: ChaosOptions) => {
  const rules = options.rules.map((rule) => {
    const probability = rule.probability ?? 1;
    if (!(probability >= 0 && probability <= 1)) {
      throw new ConfigurationError(
        `chaos: probability must be between 0 and 1, got ${rule.probability}.`
      );
    }
    if (rule.fail !== undefined && !codes.has(rule.fail)) {
      throw new ConfigurationError(`chaos: unknown error code '${rule.fail}'.`);
    }
    return {
      operations: list(rule.operation),
      providers: list(rule.provider),
      probability,
      fail: rule.fail as PaymentErrorCode | undefined,
      delay: rule.delay === undefined ? 0 : toMs(rule.delay),
      message: rule.message,
    };
  });
  const random = options.seed === undefined ? Math.random : seeded(options.seed);
  let enabled = options.enabled ?? true;

  const matches = (rule: (typeof rules)[number], ctx: OperationContext) =>
    (!rule.operations || rule.operations.includes(ctx.operation)) &&
    (!rule.providers || (ctx.provider !== undefined && rule.providers.includes(ctx.provider)));

  const guard = (mode: 'sandbox' | 'production') => {
    if (mode === 'production' && !options.allowProduction) {
      throw new ConfigurationError(
        'chaos: refusing to run in production mode. Disable the plugin, or set allowProduction.'
      );
    }
  };

  return definePlugin({
    id: 'chaos',
    options,
    init: (ctx) => {
      if (enabled) guard(ctx.mode);
    },
    hooks: {
      before: [
        {
          matcher: () => enabled,
          handler: async (ctx) => {
            const rule = rules.find((r) => matches(r, ctx) && random() < r.probability);
            if (!rule) return;
            if (rule.delay > 0) await new Promise((resolve) => setTimeout(resolve, rule.delay));
            if (!rule.fail) return;
            const pending = rule.fail === PaymentErrorCode.NETWORK_ERROR;
            return {
              result: {
                status: pending ? PaymentStatus.PENDING : PaymentStatus.FAILURE,
                code: rule.fail,
                errorCode: rule.fail,
                errorMessage: rule.message ?? `Injected by the chaos plugin (${rule.fail})`,
              },
            };
          },
        },
      ],
    },
    methods: (ctx) => ({
      chaos: {
        /** Start injecting failures. Throws in production mode unless `allowProduction` is set. */
        enable: () => {
          guard(ctx.mode);
          enabled = true;
        },
        /** Stop injecting failures; operations run normally */
        disable: () => {
          enabled = false;
        },
        /** Whether failures are being injected */
        get enabled() {
          return enabled;
        },
      },
    }),
  });
};
