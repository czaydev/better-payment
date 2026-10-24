import {
  ConfigurationError,
  definePlugin,
  PaymentStatus,
  type BetterPaymentPlugin,
  type PluginContext,
} from 'better-payment';

export interface PendingPayment {
  id: string;
  provider: string;
  amount?: string;
  currency?: string;
  conversationId?: string;
  orderId?: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
}

export interface PendingStore {
  save(payment: PendingPayment): Promise<void> | void;
  get(id: string): Promise<PendingPayment | undefined> | PendingPayment | undefined;
  list(): Promise<PendingPayment[]> | PendingPayment[];
  delete(id: string): Promise<void> | void;
  /**
   * Optional atomic ownership transfer, for stores shared by several resolvers
   * (multiple server instances running the same cron). Returns true only for the
   * resolver that took the payment; resolvers that get false skip it. Resolving
   * without a claim risks emitting two terminal events for one payment. Stores
   * without it stay usable: the plugin then only guards resolvers in its own
   * process.
   */
  claim?(id: string): Promise<boolean> | boolean;
}

export class MemoryPendingStore implements PendingStore {
  private readonly items = new Map<string, PendingPayment>();

  save(payment: PendingPayment): void {
    this.items.set(payment.id, { ...payment });
  }

  get(id: string): PendingPayment | undefined {
    const item = this.items.get(id);
    return item ? { ...item } : undefined;
  }

  list(): PendingPayment[] {
    return Array.from(this.items.values()).map((p) => ({ ...p }));
  }

  delete(id: string): void {
    this.items.delete(id);
  }

  claim(id: string): boolean {
    if (!this.items.has(id)) return false;
    this.items.delete(id);
    return true;
  }
}

/**
 * Per-store claim set, shared by every plugin instance using that store, so two
 * overlapping `resolve()` calls in one process never handle the same payment.
 */
const localClaims = new WeakMap<PendingStore, Set<string>>();

function claimsOf(store: PendingStore): Set<string> {
  let claims = localClaims.get(store);
  if (!claims) {
    claims = new Set<string>();
    localClaims.set(store, claims);
  }
  return claims;
}

function fieldsOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** Amounts must stay strings end to end; a provider sending a number is ignored. */
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export interface PendingResolverOptions {
  /** Where pending payments are stored. Default: in-memory store */
  store?: PendingStore;
  /** When to query: array of durations (e.g. ['30s', '2m', '10m', '1h']). Default: ['30s', '2m', '10m', '1h'] */
  schedule?: (string | number)[];
  /** Maximum time before giving up on an unresolved payment. Default: '24h' */
  giveUpAfter?: string | number;
  /** Whether to register HTTP endpoint `POST /pending/resolve`. Default: false */
  endpoint?: boolean;
}

export interface ResolveSummary {
  checked: number;
  succeeded: number;
  failed: number;
  unresolved: number;
  stillPending: number;
}

function parseDuration(val: string | number): number {
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0) {
      throw new ConfigurationError(
        `pendingResolver: duration must be a positive number, got ${val}`
      );
    }
    return val;
  }
  const match = val.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i);
  if (!match) {
    throw new ConfigurationError(`pendingResolver: invalid duration '${val}'`);
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

/**
 * Automatically tracks payments that timed out (`NETWORK_ERROR` / `status: 'pending'`),
 * queries the provider on a configurable schedule, and emits final outcome events.
 *
 * @example
 * ```ts
 * import { pendingResolver } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { ... },
 *   plugins: [
 *     pendingResolver({
 *       schedule: ['30s', '2m', '10m', '1h'],
 *       giveUpAfter: '24h',
 *     }),
 *   ],
 * });
 *
 * // In a cron job / scheduled function:
 * await payment.pending.resolve();
 * ```
 */
export function pendingResolver(options: PendingResolverOptions = {}): BetterPaymentPlugin {
  const store = options.store ?? new MemoryPendingStore();
  const scheduleMs = (options.schedule ?? ['30s', '2m', '10m', '1h']).map(parseDuration);
  if (scheduleMs.length === 0) {
    throw new ConfigurationError('pendingResolver: schedule must contain at least one interval');
  }
  const giveUpAfterMs = parseDuration(options.giveUpAfter ?? '24h');

  let pluginCtx: PluginContext;

  const resolve = async (): Promise<ResolveSummary> => {
    const all = await store.list();
    const now = Date.now();
    const summary: ResolveSummary = {
      checked: 0,
      succeeded: 0,
      failed: 0,
      unresolved: 0,
      stillPending: 0,
    };

    const claims = claimsOf(store);

    for (const item of all) {
      if (item.nextAttemptAt > now) {
        continue;
      }
      if (claims.has(item.id)) {
        continue;
      }

      claims.add(item.id);
      try {
        if (store.claim && !(await store.claim(item.id))) {
          continue;
        }
        summary.checked++;

        if (now - item.createdAt >= giveUpAfterMs) {
          summary.unresolved++;
          await store.delete(item.id);
          await pluginCtx.emit({
            type: 'payment.unresolved',
            provider: item.provider,
            operation: 'createPayment',
            paymentId: item.id,
            conversationId: item.conversationId,
            amount: item.amount,
            currency: item.currency,
            result: {
              status: 'unresolved',
              message: 'Payment resolution timed out after giveUpAfter threshold',
            },
            request: { paymentId: item.id, conversationId: item.conversationId },
          });
          continue;
        }

        try {
          const provider = pluginCtx.use(item.provider);
          const result = await provider.getPayment(item.id);

          if (result.status === PaymentStatus.SUCCESS) {
            const fields = fieldsOf(result);
            summary.succeeded++;
            await store.delete(item.id);
            await pluginCtx.emit({
              type: 'payment.succeeded',
              provider: item.provider,
              operation: 'createPayment',
              paymentId: result.paymentId ?? item.id,
              conversationId: result.conversationId ?? item.conversationId,
              amount:
                optionalString(fields.paidPrice) ?? optionalString(fields.price) ?? item.amount,
              currency: optionalString(fields.currency) ?? item.currency,
              result,
              request: { paymentId: item.id, conversationId: item.conversationId },
              resolvedFrom: 'pending',
            });
          } else if (result.status === PaymentStatus.FAILURE) {
            summary.failed++;
            await store.delete(item.id);
            await pluginCtx.emit({
              type: 'payment.failed',
              provider: item.provider,
              operation: 'createPayment',
              paymentId: result.paymentId ?? item.id,
              conversationId: result.conversationId ?? item.conversationId,
              amount: item.amount,
              currency: item.currency,
              code: result.code,
              result,
              request: { paymentId: item.id, conversationId: item.conversationId },
              resolvedFrom: 'pending',
            });
          } else {
            summary.stillPending++;
            item.attempts += 1;
            const delay = scheduleMs[item.attempts] ?? scheduleMs[scheduleMs.length - 1];
            item.nextAttemptAt = now + delay;
            await store.save(item);
          }
        } catch (err) {
          summary.stillPending++;
          item.attempts += 1;
          item.lastError = err instanceof Error ? err.message : String(err);
          const delay = scheduleMs[item.attempts] ?? scheduleMs[scheduleMs.length - 1];
          item.nextAttemptAt = now + delay;
          await store.save(item);
        }
      } finally {
        claims.delete(item.id);
      }
    }

    return summary;
  };

  return definePlugin({
    id: 'pending-resolver',
    options,
    init: (ctx) => {
      pluginCtx = ctx;
    },
    hooks: {
      after: [
        {
          matcher: (ctx) => {
            const res = fieldsOf(ctx.result);
            return (
              res.status === PaymentStatus.PENDING &&
              (res.code === 'NETWORK_ERROR' || res.errorCode === 'NETWORK_ERROR')
            );
          },
          handler: async (ctx) => {
            const res = fieldsOf(ctx.result);
            const req = fieldsOf(ctx.request);
            const id =
              optionalString(res.paymentId) ||
              optionalString(req.conversationId) ||
              optionalString(req.orderId) ||
              optionalString(res.conversationId);
            if (!id) return;

            const now = Date.now();
            const firstInterval = scheduleMs[0] ?? 30_000;
            await store.save({
              id,
              provider: ctx.provider,
              amount:
                optionalString(req.paidPrice) ??
                optionalString(req.price) ??
                optionalString(req.amount) ??
                optionalString(res.amount),
              currency: optionalString(req.currency) ?? optionalString(res.currency),
              conversationId:
                optionalString(req.conversationId) ?? optionalString(res.conversationId),
              orderId: optionalString(req.orderId),
              createdAt: now,
              attempts: 0,
              nextAttemptAt: now + firstInterval,
            });
          },
        },
      ],
    },
    methods: (ctx) => {
      pluginCtx = ctx;
      return {
        pending: {
          /** Resolves due pending payments by querying the provider */
          resolve,
          /** Lists all pending payments currently stored */
          list: () => store.list(),
          /** Retrieves a specific pending payment by id */
          get: (id: string) => store.get(id),
          /** Manually removes a pending payment from storage */
          delete: (id: string) => store.delete(id),
          /** The storage backend */
          store,
        },
      };
    },
    endpoints: options.endpoint
      ? {
          resolve: {
            method: 'POST',
            path: '/pending/resolve',
            privileged: true,
            handler: async (ctx) => {
              pluginCtx = ctx;
              return await resolve();
            },
          },
        }
      : undefined,
  });
}
