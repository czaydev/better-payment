import {
  ConfigurationError,
  definePlugin,
  PaymentErrorCode,
  PaymentStatus,
  type OperationContext,
  type OperationResultContext,
  type PaymentOperation,
  type PluginContext,
} from 'better-payment';

/** Time units for converting delay strings to milliseconds */
const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

function toMs(duration: number | string | undefined, defaultValue: number): number {
  if (duration === undefined) return defaultValue;
  if (typeof duration === 'number') return duration;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/.exec(duration.trim());
  if (!match) {
    throw new ConfigurationError(
      `failover: invalid duration '${duration}'. Use milliseconds or '500ms', '30s', '1m', '5m'.`
    );
  }
  return Number(match[1]) * UNITS[match[2]];
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /**
   * Number of failures within `window` before the circuit trips and opens.
   * Default: 5
   */
  failures?: number;
  /**
   * Time window in which failures accumulate: milliseconds or '1m', '30s'.
   * Default: '1m'
   */
  window?: number | string;
  /**
   * Cooldown period before trying an open provider again: milliseconds or '5m', '1m'.
   * Default: '5m'
   */
  cooldown?: number | string;
}

export interface FailoverEvent {
  /** Provider that experienced the failure */
  from: string;
  /** Backup provider the payment is switching to */
  to: string;
  /** The operation being retried ('createPayment' or 'authorize') */
  operation: PaymentOperation;
  /** Failure details that triggered the switch */
  error: {
    code?: PaymentErrorCode | string;
    errorCode?: string;
    errorMessage?: string;
  };
  /** 1-indexed attempt number */
  attempt: number;
}

export interface FailoverOptions {
  /**
   * Priority list of provider IDs to try in order, or a dynamic selector function.
   * e.g. `['iyzico', 'paytr', 'parampos']`
   */
  order?: string[] | ((ctx: OperationContext) => string[]);
  /**
   * Error codes that trigger failover to a backup provider.
   * Defaults to provider/infrastructure errors where the transaction definitely did not charge:
   * `['PROVIDER_ERROR', 'PROVIDER_UNAVAILABLE', 'TIMEOUT_BEFORE_SEND', 'SYSTEM_ERROR', '503']`.
   * A failure built from an HTTP 500, 502 or 504 answer never fails over: the
   * provider may have charged the card before the error.
   */
  on?: (PaymentErrorCode | string)[];
  /**
   * Operations that failover applies to.
   * Default: `['createPayment', 'authorize']`.
   * (3D Secure flows where the customer is redirected are intentionally excluded to prevent duplicate redirects).
   */
  operations?: PaymentOperation[];
  /**
   * Circuit breaker configuration to skip unresponsive providers.
   */
  circuitBreaker?: CircuitBreakerOptions;
  /**
   * Callback fired whenever failover switches from one provider to another.
   */
  onSwitch?: (event: FailoverEvent) => void | Promise<void>;
}

export interface ProviderCircuitStatus {
  state: CircuitState;
  failures: number;
  openUntil: Date | null;
}

class CircuitBreaker {
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;

  private readonly failureTimestamps = new Map<string, number[]>();
  private readonly openUntilTimestamps = new Map<string, number>();

  constructor(options?: CircuitBreakerOptions) {
    this.maxFailures = options?.failures ?? 5;
    this.windowMs = toMs(options?.window, 60_000);
    this.cooldownMs = toMs(options?.cooldown, 300_000);
  }

  isOpen(providerId: string, now = Date.now()): boolean {
    const openUntil = this.openUntilTimestamps.get(providerId);
    if (!openUntil) return false;

    if (now >= openUntil) {
      // Cooldown expired: half-open probe allowed
      return false;
    }
    return true;
  }

  getState(providerId: string, now = Date.now()): CircuitState {
    const openUntil = this.openUntilTimestamps.get(providerId);
    if (!openUntil) return 'closed';
    if (now >= openUntil) return 'half-open';
    return 'open';
  }

  recordFailure(providerId: string, now = Date.now()): void {
    const list = (this.failureTimestamps.get(providerId) ?? []).filter(
      (ts) => ts >= now - this.windowMs
    );
    list.push(now);
    this.failureTimestamps.set(providerId, list);

    if (list.length >= this.maxFailures) {
      this.openUntilTimestamps.set(providerId, now + this.cooldownMs);
    }
  }

  recordSuccess(providerId: string): void {
    this.failureTimestamps.delete(providerId);
    this.openUntilTimestamps.delete(providerId);
  }

  reset(providerId?: string): void {
    if (providerId) {
      this.failureTimestamps.delete(providerId);
      this.openUntilTimestamps.delete(providerId);
    } else {
      this.failureTimestamps.clear();
      this.openUntilTimestamps.clear();
    }
  }

  trip(providerId: string, duration?: number | string): void {
    const cooldown = duration ? toMs(duration, this.cooldownMs) : this.cooldownMs;
    this.openUntilTimestamps.set(providerId, Date.now() + cooldown);
  }

  status(
    providerIds: readonly string[] = [],
    now = Date.now()
  ): Record<string, ProviderCircuitStatus> {
    const allIds = new Set<string>([
      ...providerIds,
      ...this.failureTimestamps.keys(),
      ...this.openUntilTimestamps.keys(),
    ]);
    const result: Record<string, ProviderCircuitStatus> = {};
    for (const id of allIds) {
      const state = this.getState(id, now);
      const openUntil = this.openUntilTimestamps.get(id);
      const failures = (this.failureTimestamps.get(id) ?? []).filter(
        (ts) => ts >= now - this.windowMs
      ).length;

      result[id] = {
        state,
        failures,
        openUntil: openUntil && state === 'open' ? new Date(openUntil) : null,
      };
    }
    return result;
  }
}

const DEFAULT_ON_CODES: (PaymentErrorCode | string)[] = [
  PaymentErrorCode.PROVIDER_ERROR,
  'PROVIDER_UNAVAILABLE',
  'TIMEOUT_BEFORE_SEND',
  'SYSTEM_ERROR',
  '503',
];

/**
 * HTTP statuses after which the provider may have charged the card: a 500 can come
 * after the payment was written, and 502/504 come from a gateway that lost the
 * answer of a backend still processing it. Moving the payment to another provider
 * then could charge the customer twice, so these never fail over, whatever `on` says.
 */
const UNKNOWN_OUTCOME_STATUSES = new Set([500, 502, 504]);

const DEFAULT_ALLOWED_OPERATIONS: PaymentOperation[] = ['createPayment', 'authorize'];

/** Provider dispatch by operation name, like the core runs it in `run()` */
type OperationFn = (request: unknown) => Promise<unknown>;

/**
 * Result types of the operations failover can route. BIN and installment lookups
 * carry no charge outcome, so they are excluded.
 */
type FailoverResult = Extract<OperationResultContext['result'], { status: PaymentStatus }>;

const isFailoverResult = (result: unknown): result is FailoverResult =>
  typeof result === 'object' && result !== null && 'status' in result;

/**
 * Automatically fails over to backup payment providers when the active provider
 * encounters a transient failure or downtime, guarded by a circuit breaker to avoid
 * repeated timeouts.
 *
 * Guaranteed zero double-charge: never retries unknown results (NETWORK_ERROR / pending).
 *
 * @example
 * ```ts
 * import { failover } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { iyzico: ..., paytr: ..., parampos: ... },
 *   plugins: [
 *     failover({
 *       order: ['iyzico', 'paytr', 'parampos'],
 *       on: ['PROVIDER_UNAVAILABLE', 'TIMEOUT_BEFORE_SEND'],
 *       circuitBreaker: { failures: 5, window: '1m', cooldown: '5m' },
 *     }),
 *   ],
 * });
 * ```
 */
export const failover = (options: FailoverOptions = {}) => {
  const allowedOps = new Set<PaymentOperation>(options.operations ?? DEFAULT_ALLOWED_OPERATIONS);
  const onCodes = new Set<string>((options.on ?? DEFAULT_ON_CODES).map(String));
  const circuitBreaker = new CircuitBreaker(options.circuitBreaker);

  let pluginCtx: PluginContext;

  const resolveOrder = (ctx: OperationContext): string[] => {
    if (typeof options.order === 'function') {
      return options.order(ctx);
    }
    if (Array.isArray(options.order) && options.order.length > 0) {
      return options.order;
    }
    // Default to configured providers in declaration order
    return [...pluginCtx.providerIds];
  };

  const isTransientFailure = (result: FailoverResult): boolean => {
    // CRITICAL: NEVER retry on pending status or NETWORK_ERROR (prevents double charges)
    if (result.status === PaymentStatus.PENDING) return false;
    if (result.code === PaymentErrorCode.NETWORK_ERROR) return false;
    if (result.status !== PaymentStatus.FAILURE) return false;
    const { httpStatus } = result as { httpStatus?: unknown };
    if (typeof httpStatus === 'number' && UNKNOWN_OUTCOME_STATUSES.has(httpStatus)) return false;

    // Check code or raw errorCode against the allowed retry error list
    const code = result.code ? String(result.code) : '';
    const rawCode = result.errorCode ? String(result.errorCode) : '';
    return onCodes.has(code) || onCodes.has(rawCode);
  };

  return definePlugin({
    id: 'failover',
    options,
    init: (ctx) => {
      pluginCtx = ctx;
    },
    hooks: {
      before: [
        {
          matcher: (ctx) => allowedOps.has(ctx.operation) && ctx.routable,
          handler: (ctx) => {
            const current = ctx.provider;
            const fullOrder = resolveOrder(ctx);

            // If the requested or default provider is currently tripped open by the circuit breaker,
            // immediately route to the first healthy provider in the order list before calling it.
            if (current && circuitBreaker.isOpen(current)) {
              const healthy = fullOrder.find(
                (p) => pluginCtx.providerIds.includes(p) && !circuitBreaker.isOpen(p)
              );
              if (healthy && healthy !== current) {
                pluginCtx.logger?.info(
                  `[failover] Provider '${current}' circuit is open. Routing to healthy provider '${healthy}'.`
                );
                return { provider: healthy };
              }
            }
            return undefined;
          },
        },
      ],
      after: [
        {
          matcher: (ctx) => allowedOps.has(ctx.operation) && ctx.routable,
          handler: async (ctx: OperationResultContext) => {
            const currentProvider = ctx.provider;
            const res = isFailoverResult(ctx.result) ? ctx.result : undefined;

            if (!res || !isTransientFailure(res)) {
              if (res?.status === PaymentStatus.SUCCESS) {
                circuitBreaker.recordSuccess(currentProvider);
              }
              return undefined;
            }

            // Current provider failed with a transient error
            circuitBreaker.recordFailure(currentProvider);

            const fullOrder = resolveOrder(ctx);
            // Backup candidates: must be configured, not the failed one, and circuit not open
            const tried = new Set<string>([currentProvider]);
            const backups = fullOrder.filter(
              (p) => pluginCtx.providerIds.includes(p) && !tried.has(p) && !circuitBreaker.isOpen(p)
            );

            let lastResult: unknown = res;
            let attempt = 1;

            for (const backupProvider of backups) {
              tried.add(backupProvider);
              attempt++;

              pluginCtx.logger?.info(
                `[failover] Switching payment operation '${ctx.operation}' from '${currentProvider}' to '${backupProvider}' (attempt ${attempt}).`
              );

              if (options.onSwitch) {
                try {
                  await options.onSwitch({
                    from: currentProvider,
                    to: backupProvider,
                    operation: ctx.operation,
                    error: {
                      code: res.code,
                      errorCode: res.errorCode,
                      errorMessage: res.errorMessage,
                    },
                    attempt,
                  });
                } catch (e) {
                  pluginCtx.logger?.error('[failover] onSwitch handler threw an error', e as Error);
                }
              }

              try {
                const backupInstance = pluginCtx.use(backupProvider);
                const nextResult = await (backupInstance[ctx.operation] as OperationFn).call(
                  backupInstance,
                  ctx.request
                );
                const outcome = isFailoverResult(nextResult) ? nextResult : undefined;

                if (outcome?.status === PaymentStatus.SUCCESS) {
                  circuitBreaker.recordSuccess(backupProvider);
                  return { result: nextResult };
                }

                // If non-transient or pending/unknown, do not retry further to avoid double-charging
                if (!outcome || !isTransientFailure(outcome)) {
                  return { result: nextResult };
                }

                // Backup also failed with a transient error
                circuitBreaker.recordFailure(backupProvider);
                lastResult = outcome;
              } catch (err) {
                pluginCtx.logger?.error(
                  `[failover] Backup provider '${backupProvider}' call failed`,
                  err as Error
                );
                circuitBreaker.recordFailure(backupProvider);
              }
            }

            return { result: lastResult };
          },
        },
      ],
    },
    methods: (ctx) => {
      pluginCtx = ctx;
      return {
        failover: {
          /**
           * Returns the current circuit breaker status for all configured providers.
           */
          status: (): Record<string, ProviderCircuitStatus> => {
            return circuitBreaker.status(pluginCtx?.providerIds ?? []);
          },
          /**
           * Manually resets the circuit breaker for a single provider or all providers.
           */
          reset: (providerId?: string): void => {
            circuitBreaker.reset(providerId);
          },
          /**
           * Manually trips the circuit breaker for a provider for testing or incident containment.
           */
          trip: (providerId: string, duration?: number | string): void => {
            circuitBreaker.trip(providerId, duration);
          },
        },
      };
    },
  });
};
