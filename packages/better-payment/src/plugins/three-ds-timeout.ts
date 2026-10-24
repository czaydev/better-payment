import {
  ConfigurationError,
  definePlugin,
  PaymentStatus,
  type OperationResultContext,
  type PluginContext,
} from 'better-payment';

/**
 * A started 3D Secure payment flow tracked by the plugin.
 */
export interface StartedThreeDSFlow {
  /** The paymentId returned by provider init, or conversationId/requestId */
  paymentId: string;
  /** Merchant order / conversation id */
  conversationId?: string;
  /** Id of the provider that started the 3DS flow */
  provider: string;
  /** Operation that started the flow */
  operation: 'initThreeDSPayment' | 'initThreeDSAuthorize';
  /** Timestamp when the flow was started (Date.now()) */
  startedAt: number;
  /** Amount charged, if known */
  amount?: string;
  /** Currency of the payment, if known */
  currency?: string;
  /** Original init request data */
  request?: unknown;
}

/**
 * Storage backend for tracking active 3DS flows.
 */
export interface ThreeDSFlowStore {
  /** Saves or updates an active 3DS flow */
  save(flow: StartedThreeDSFlow): Promise<void> | void;
  /** Retrieves a flow by paymentId */
  get(paymentId: string): Promise<StartedThreeDSFlow | undefined> | StartedThreeDSFlow | undefined;
  /** Deletes a flow by paymentId */
  delete(paymentId: string): Promise<void> | void;
  /** Lists all active tracked flows */
  list(): Promise<StartedThreeDSFlow[]> | StartedThreeDSFlow[];
}

/**
 * In-memory store suitable for a single process, development and unit tests.
 */
export class MemoryThreeDSFlowStore implements ThreeDSFlowStore {
  private readonly flows = new Map<string, StartedThreeDSFlow>();

  save(flow: StartedThreeDSFlow): void {
    this.flows.set(flow.paymentId, flow);
  }

  get(paymentId: string): StartedThreeDSFlow | undefined {
    return this.flows.get(paymentId);
  }

  delete(paymentId: string): void {
    this.flows.delete(paymentId);
  }

  list(): StartedThreeDSFlow[] {
    return Array.from(this.flows.values());
  }
}

export interface ExpireStaleResult {
  /** Total flows checked */
  checked: number;
  /** Flows confirmed resolved at provider (e.g. late successful payment) */
  resolved: number;
  /** Stale flows that were expired */
  expired: StartedThreeDSFlow[];
}

export interface ThreeDSTimeoutOptions {
  /**
   * Duration after which an uncompleted 3D Secure flow is considered abandoned.
   * Accepts milliseconds or string e.g. '15m', '30m', '1h', '900s'.
   * Default: '15m' (15 minutes).
   */
  after?: number | string;
  /**
   * Storage backend for tracking active flows.
   * Default: in-memory store.
   */
  store?: ThreeDSFlowStore;
  /**
   * Callback fired when a stale payment is expired (e.g. release reserved inventory).
   */
  onExpire?: (payment: StartedThreeDSFlow) => Promise<void> | void;
  /**
   * Whether to query the payment provider before marking a flow expired.
   * If provider confirms payment is already SUCCESS, the flow is cleared
   * without calling onExpire.
   * Default: true.
   */
  checkProvider?: boolean;
}

const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function parseDuration(after: number | string): number {
  if (typeof after === 'number') {
    if (after <= 0) throw new ConfigurationError('threeDSTimeout: after must be greater than 0');
    return after;
  }
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/.exec(after.trim());
  if (!match) {
    throw new ConfigurationError(
      `threeDSTimeout: invalid duration '${after}'. Use milliseconds or '15m', '30m', '1h'.`
    );
  }
  return Number(match[1]) * UNITS[match[2]];
}

function extractPaymentId(result: unknown, request: unknown): string | undefined {
  if (result && typeof result === 'object') {
    const res = result as Record<string, unknown>;
    if (typeof res.paymentId === 'string' && res.paymentId) return res.paymentId;
    if (res.rawResponse && typeof res.rawResponse === 'object') {
      const raw = res.rawResponse as Record<string, unknown>;
      if (typeof raw.paymentId === 'string' && raw.paymentId) return raw.paymentId;
    }
  }
  if (request && typeof request === 'object') {
    const req = request as Record<string, unknown>;
    if (typeof req.paymentId === 'string' && req.paymentId) return req.paymentId;
    if (typeof req.conversationId === 'string' && req.conversationId) return req.conversationId;
  }
  return undefined;
}

/**
 * Tracks started 3D Secure flows and expires abandoned ones that never returned.
 *
 * @example
 * ```ts
 * import { threeDSTimeout } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { ... },
 *   plugins: [
 *     threeDSTimeout({
 *       after: '15m',
 *       onExpire: async (flow) => {
 *         await releaseInventory(flow.conversationId);
 *       },
 *     }),
 *   ],
 * });
 *
 * // Run from a cron job or scheduled worker
 * await payment.threeDS.expireStale();
 * ```
 */
export function threeDSTimeout({
  after = '15m',
  store = new MemoryThreeDSFlowStore(),
  onExpire,
  checkProvider = true,
}: ThreeDSTimeoutOptions = {}) {
  const ttlMs = parseDuration(after);

  return definePlugin({
    id: 'three-ds-timeout',
    options: { after, checkProvider },
    hooks: {
      after: [
        {
          matcher: (ctx: OperationResultContext) =>
            ctx.operation === 'initThreeDSPayment' || ctx.operation === 'initThreeDSAuthorize',
          handler: async (ctx) => {
            const res = ctx.result as unknown as Record<string, unknown> | undefined;
            // Record if pending or htmlContent returned
            const status = res?.status;
            if (status === PaymentStatus.FAILURE) return;

            const paymentId = extractPaymentId(ctx.result, ctx.request);
            if (!paymentId) return;

            const req = ctx.request as Record<string, unknown> | undefined;
            await store.save({
              paymentId,
              conversationId: (req?.conversationId as string) ?? (res?.conversationId as string),
              provider: ctx.provider,
              operation: ctx.operation as 'initThreeDSPayment' | 'initThreeDSAuthorize',
              startedAt: Date.now(),
              amount: (req?.paidPrice as string) ?? (req?.price as string),
              currency: req?.currency as string,
              request: ctx.request,
            });
          },
        },
        {
          matcher: (ctx: OperationResultContext) => ctx.operation === 'completeThreeDSPayment',
          handler: async (ctx) => {
            const paymentId = extractPaymentId(ctx.result, ctx.request);
            if (paymentId) {
              await store.delete(paymentId);
            }
            const convId =
              (ctx.result as unknown as Record<string, unknown> | undefined)?.conversationId ??
              (ctx.request as Record<string, unknown> | undefined)?.conversationId;
            if (typeof convId === 'string' && convId) {
              await store.delete(convId);
            }
          },
        },
      ],
    },
    methods: (ctx: PluginContext) => {
      return {
        threeDS: {
          /**
           * Checks all tracked 3D Secure flows and expires those that exceeded the timeout.
           * Stale flows are checked against the provider first to avoid expiring late successes.
           */
          expireStale: async (now = Date.now()): Promise<ExpireStaleResult> => {
            const allFlows = await store.list();
            const staleFlows = allFlows.filter((flow) => now - flow.startedAt >= ttlMs);
            const expired: StartedThreeDSFlow[] = [];
            let resolved = 0;

            for (const flow of staleFlows) {
              if (checkProvider) {
                try {
                  const provider = ctx.use(flow.provider);
                  if (typeof provider.getPayment === 'function') {
                    const status = await provider.getPayment(flow.paymentId);
                    if (status.status === PaymentStatus.SUCCESS) {
                      // Confirmed success at provider, remove flow without expiring
                      await store.delete(flow.paymentId);
                      resolved++;
                      continue;
                    }
                    if (status.status === PaymentStatus.FAILURE) {
                      // Already failed at provider
                      await store.delete(flow.paymentId);
                      continue;
                    }
                  }
                } catch {
                  // If provider lookup fails, continue to expire flow
                }
              }

              // Expire flow
              await store.delete(flow.paymentId);
              expired.push(flow);

              if (onExpire) {
                try {
                  await onExpire(flow);
                } catch (err) {
                  ctx.logger?.error(
                    `threeDSTimeout onExpire failed for ${flow.paymentId}`,
                    err instanceof Error ? err : new Error(String(err))
                  );
                }
              }
            }

            return {
              checked: staleFlows.length,
              resolved,
              expired,
            };
          },

          /**
           * Returns all currently tracked active 3D Secure flows.
           */
          getTrackedFlows: async (): Promise<StartedThreeDSFlow[]> => {
            return store.list();
          },

          /**
           * The underlying store used for tracking.
           */
          store,
        },
      };
    },
  });
}
