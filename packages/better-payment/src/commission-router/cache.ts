// A small bounded FIFO cache with TTL, shared by the BIN cache and the
// provider-routing table. It is deliberately not unbounded: a payment plugin
// that grows with card-bin diversity or order count must not grow memory
// without limit. When the cache is full the oldest entry is dropped, and every
// entry expires after `ttlMs`.
export interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export interface TtlCacheOptions {
  /** Hard upper bound on retained entries. Required: there is no unbounded mode. */
  maxEntries: number;
  /** Entry lifetime in milliseconds. Required. */
  ttlMs: number;
  /** Clock seam, for deterministic tests. Default: `Date.now` */
  now?: () => number;
}

export class TtlCache<V> {
  private readonly map = new Map<string, CacheEntry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: TtlCacheOptions) {
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new TypeError('cache: maxEntries must be an integer >= 1');
    }
    if (!(options.ttlMs > 0)) {
      throw new TypeError('cache: ttlMs must be greater than 0');
    }
    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  set(key: string, value: V): void {
    // Re-inserting refreshes the entry's position; new keys evict the oldest first
    this.map.delete(key);
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
