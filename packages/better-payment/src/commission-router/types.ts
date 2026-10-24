// Public types of the commission router: the quote API, the policies and the
// injection points. Rate-table types live in `rates.ts`.
import type { PaymentErrorCode } from 'better-payment';
import type { BinLookup, CommissionRate } from './rates';
import type { RoutingStore } from './store';

/** The only routing strategy: cheapest eligible provider first */
export type RouterStrategy = 'lowest-cost';

/** Operations that create a charge and can therefore be routed by cost */
export type RouterOperation =
  'createPayment' | 'authorize' | 'initThreeDSPayment' | 'initThreeDSAuthorize';

/** What the router is asked to price */
export interface RouterQuoteInput {
  /**
   * BIN prefix: the first 6 to 8 digits of the card. Never a full card
   * number; longer values are rejected.
   */
  binNumber?: string;
  /** Amount the customer pays, decimal string with at most 2 decimals */
  price: string | number;
  /** Installment count, 1 for a single payment. Default: 1 */
  installment?: number;
  /** ISO 4217 code, e.g. `TRY`. Default: `TRY` */
  currency?: string;
  /**
   * Whether the payment goes through 3D Secure. Default: derived from
   * `operation` (`initThreeDSPayment` / `initThreeDSAuthorize` are 3DS).
   */
  threeDS?: boolean;
  /** Operation being quoted. Default: `createPayment` */
  operation?: RouterOperation;
  /** Order id, so a per-order `policy.override` can apply to this quote */
  conversationId?: string;
}

/**
 * Why a configured provider is not in the ranking. Codes are stable; `detail`
 * is a human-readable explanation (it never contains card data).
 */
export type ExclusionReason =
  | 'provider-unhealthy'
  | 'no-rate-line'
  | 'rate-not-yet-valid'
  | 'rate-expired'
  | 'amount-below-min'
  | 'amount-above-max'
  | 'currency-not-supported'
  | 'installment-not-supported'
  | 'threeds-not-supported'
  | 'card-unknown'
  | 'card-mismatch'
  | 'share-cap';

export interface ExcludedProvider {
  provider: string;
  reason: ExclusionReason;
  /** Human-readable explanation, e.g. "installment 3 is not in [1]" */
  detail: string;
  /** Index in the configured rate table of the closest line, when known */
  rateIndex?: number;
}

export type CandidateReason =
  'lowest-cost' | 'preferred-on-tie' | 'override' | 'fallback' | 'higher-cost' | 'ranked-lower';

export interface RouterCandidate {
  provider: string;
  /** Commission for this payment, formatted with 2 decimals; null for a fallback without a rate line */
  cost: string | null;
  /** The same commission in minor units, the value the ranking compares */
  costMinor: number | null;
  /** Applied percentage, as configured; null for a fallback without a rate line */
  rate: string | null;
  /** Applied fixed fee, formatted with 2 decimals; null for a fallback without a rate line */
  fixed: string | null;
  /** Index in the configured rate table of the applied line */
  rateIndex: number | null;
  /** True for the provider the payment (or the quote) would go to */
  chosen: boolean;
  reason: CandidateReason;
  /** Human-readable explanation of the position */
  detail: string;
}

export type SelectionReason = 'lowest-cost' | 'preferred-on-tie' | 'override' | 'fallback';

/** The card classification used for a quote. Never contains the PAN or the BIN. */
export interface RouterQuoteCard {
  bankName?: string;
  cardFamily?: string;
  cardType?: string;
  cardAssociation?: string;
  commercial?: boolean;
}

export interface RouterQuote {
  strategy: RouterStrategy;
  amount: {
    price: string;
    priceMinor: number;
    currency: string;
    installment: number;
    threeDS: boolean;
  };
  /** BIN classification, or null when it is unknown */
  card: RouterQuoteCard | null;
  /** The provider the router would use, or null when nothing is eligible */
  selected: string | null;
  selectionReason: SelectionReason | null;
  /** Eligible providers, cheapest first (fallback providers last when they were used) */
  candidates: RouterCandidate[];
  /** Configured providers that were not eligible, with the reason */
  excluded: ExcludedProvider[];
  /** Policy and lookup problems worth surfacing (never card data) */
  notes: string[];
}

export interface RouterCacheOptions {
  /** Hard upper bound on remembered BIN classifications. Default: 1024 */
  maxEntries?: number;
  /** Entry lifetime in milliseconds. Default: 24 hours */
  ttlMs?: number;
}

export interface RouterShareCapOptions {
  /**
   * Maximum share of the last `window` routed payments for one provider,
   * between 0 (exclusive) and 1 (inclusive).
   */
  maxShare: number;
  /** Number of recent routing decisions the cap looks at. Default: 100 */
  window?: number;
}

/** What `policy.override` sees. It never receives the payment request or card data. */
export interface RouterOverrideContext {
  operation: RouterOperation;
  /** `conversationId` of the payment or quote, the natural key for a per-order override */
  conversationId?: string;
  amount: RouterQuote['amount'];
  /** Eligible providers, cheapest first */
  candidates: string[];
  card: RouterQuoteCard | null;
}

export type RouterOverride = (
  context: RouterOverrideContext
) => string | null | undefined | Promise<string | null | undefined>;

export interface RouterPolicy {
  /** Providers to prefer when total costs are equal (earlier wins) */
  prefer?: string[];
  /** Cap the share of one provider over a sliding window of recent payments */
  shareCap?: RouterShareCapOptions;
  /** Per-order override: return a provider id to route this payment there */
  override?: RouterOverride;
}

export interface CommissionRouterOptions {
  /** Routing strategy. Only `'lowest-cost'` is supported. */
  strategy?: RouterStrategy;
  /** The merchant's contract lines. Never guessed or estimated by the plugin. */
  rates: CommissionRate[];
  /**
   * Provider ids to use when no rate line is eligible (for example a provider
   * whose contract is still being negotiated). Tried in order, and also the
   * retry order if the selected provider is one of them.
   */
  fallback?: string[];
  /**
   * BIN classification, e.g. `lookupBin` from `better-payment/bin` (PR #252).
   * Receives the 6-8 digit BIN prefix only. Without it, rate lines that filter
   * on card family/bank/type/commercial cannot match.
   */
  binLookup?: BinLookup;
  /** Bounds of the BIN cache. The cache is always bounded and has a TTL. */
  cache?: RouterCacheOptions;
  /** Routing policies: ties, share cap, per-order override */
  policy?: RouterPolicy;
  /**
   * Where the provider of each payment is remembered, so refunds, cancels and
   * status calls reach the same provider. Default: `MemoryRoutingStore`
   * (per-process, bounded). Production multi-instance setups should pass a
   * shared store (Redis, SQL, KV).
   */
  store?: RoutingStore;
  /** Provider health for new payments. Unhealthy providers are not selected. */
  isHealthy?: (providerId: string) => boolean | undefined | Promise<boolean | undefined>;
  /**
   * Error codes that allow a fallback to the next candidate. Only errors that
   * prove no charge happened may be listed. Default:
   * `['INVALID_REQUEST', 'PROVIDER_ERROR']`.
   *
   * `NETWORK_ERROR`, declines and unknown outcomes are always refused, even
   * when they appear here: a configuration error is thrown at construction.
   */
  fallbackOn?: (PaymentErrorCode | string)[];
  /** Clock seam for rate validity, the BIN cache and the share window. Default: `Date.now` */
  now?: () => number;
}

export interface RouterStatus {
  /** Routing decisions per provider in the current share window */
  routed: Record<string, number>;
  total: number;
  shareWindow: number;
  binCache: { entries: number; maxEntries: number; ttlMs: number };
}

/** The members the plugin adds to the payment object */
export interface CommissionRouterMethods {
  router: {
    /** Ranked candidates with the cost and the reason of each */
    quote(input: RouterQuoteInput): Promise<RouterQuote>;
    /** Routing counters and BIN-cache usage */
    status(): RouterStatus;
    /** Forgets the share window and the BIN cache; routing history is kept */
    reset(): void;
  };
}

/** A provider result with the provider that actually handled it */
export type RoutedResult<T> = T & { provider?: string };
