// Where the routing plugin remembers payment -> provider. The default is
// bounded and expires; a multi-instance deployment must inject a shared store
// (the same Redis/SQL adapter used for idempotency), otherwise a refund handled
// by another instance cannot be routed to the provider that took the payment.
import type { RoutingStore } from './types';

const DAY_SECONDS = 86_400;
/** Refunds can arrive months later; keep the mapping long enough */
export const ROUTING_TTL_SECONDS = 90 * DAY_SECONDS;

export interface MemoryRoutingStoreOptions {
  /** Hard upper bound. Default: 10 000 keys */
  maxEntries?: number;
  /** Entry lifetime. Default: 90 days */
  ttlSeconds?: number;
  /** Clock seam for tests. Default: `Date.now` */
  now?: () => number;
}

/**
 * In-process store with expiry and a size bound, so payment volume cannot grow
 * memory without limit. Restart- and process-scoped: fine for one instance and
 * for tests, not for several instances.
 */
export class MemoryRoutingStore implements RoutingStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly options: MemoryRoutingStoreOptions = {}) {}

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= (this.options.now ?? Date.now)()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(
    key: string,
    value: string,
    ttlSeconds = this.options.ttlSeconds ?? ROUTING_TTL_SECONDS
  ): void {
    const now = (this.options.now ?? Date.now)();
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
    const maxEntries = this.options.maxEntries ?? 10_000;
    while (this.entries.size > maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Number of remembered keys */
  get size(): number {
    return this.entries.size;
  }
}
