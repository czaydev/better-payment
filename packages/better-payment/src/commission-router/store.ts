// Where the router remembers which provider handled a payment, so refunds,
// cancels and status calls reach the same provider. The default is a bounded,
// TTL in-memory store; production deployments with more than one instance must
// inject a shared store (Redis, SQL, KV), otherwise a refund handled by another
// instance cannot be routed.
import { TtlCache } from './cache';

/** A provider id (or nullish) for a payment id */
export interface RoutingStore {
  get(paymentId: string): string | null | undefined | Promise<string | null | undefined>;
  set(paymentId: string, provider: string): void | Promise<void>;
  delete?(paymentId: string): void | Promise<void>;
}

export interface MemoryRoutingStoreOptions {
  /** Hard upper bound. Default: 10 000 payments */
  maxEntries?: number;
  /** Entry lifetime. Default: 90 days (refunds can come months later) */
  ttlMs?: number;
  /** Clock seam for deterministic tests. Default: `Date.now` */
  now?: () => number;
}

const DAY_MS = 86_400_000;

/**
 * In-process routing store. It is bounded (oldest payments are forgotten) and
 * every entry expires, so a plugin cannot grow memory with payment volume.
 *
 * Per-process and restart-forgetting: fine for a single instance and for
 * tests, not for a multi-instance deployment. Pass a shared `RoutingStore`
 * there.
 */
export class MemoryRoutingStore implements RoutingStore {
  private readonly cache: TtlCache<string>;

  constructor(options: MemoryRoutingStoreOptions = {}) {
    this.cache = new TtlCache<string>({
      maxEntries: options.maxEntries ?? 10_000,
      ttlMs: options.ttlMs ?? 90 * DAY_MS,
      now: options.now,
    });
  }

  get(paymentId: string): string | undefined {
    return this.cache.get(paymentId);
  }

  set(paymentId: string, provider: string): void {
    this.cache.set(paymentId, provider);
  }

  delete(paymentId: string): void {
    this.cache.delete(paymentId);
  }

  /** Number of remembered payments */
  get size(): number {
    return this.cache.size;
  }
}
