// Public types of the routing plugin: the rules, the targets, the injected
// health/store/BIN hooks and the explainable decision. See
// apps/web/content/docs/plugins/routing.mdx for the guide.
import type { BetterPaymentLogger, PaymentOperation } from 'better-payment';

/** Credit or debit. Only set by an explicit request field or a BIN resolver. */
export type RoutingCardType = 'credit' | 'debit';
/** Domestic (issued in the merchant's country) or foreign */
export type RoutingCardOrigin = 'domestic' | 'foreign';

/** Operations that start a charge and can be routed by a rule */
export type RoutingChargeOperation =
  'createPayment' | 'authorize' | 'initThreeDSPayment' | 'initThreeDSAuthorize';

/** Operations that must reach the provider that handled the payment */
export type RoutingFollowUpOperation =
  'completeThreeDSPayment' | 'refund' | 'cancel' | 'capture' | 'voidAuthorization' | 'getPayment';

/**
 * Where a rule (or the default) sends a payment:
 * - a provider id,
 * - an ordered list of provider ids: the first eligible one is used,
 * - `{ weights }`: a deterministic weighted split.
 */
export type RoutingTarget =
  string | readonly string[] | { readonly weights: Readonly<Record<string, number>> };

/**
 * Card classification injected by `binResolver` or carried by the request.
 * Never fetch this from the network inside the plugin.
 */
export interface RoutingBinInfo {
  /** Issuing bank, e.g. `'Garanti BBVA'` */
  bank?: string;
  /** Alias of `bank`, for resolvers built on provider BIN responses */
  bankName?: string;
  /** Card family/program, e.g. `'Bonus'` or `'World'` */
  cardFamily?: string;
  cardType?: RoutingCardType | string;
  cardOrigin?: RoutingCardOrigin | string;
}

/**
 * The parts of a payment request routing reads. Extra fields are allowed; a
 * `PaymentRequest` is assignable to it.
 */
export interface RoutingRequest {
  price?: string;
  paidPrice?: string;
  currency?: string;
  installment?: number;
  /** Explicit flag for non-3DS operations; 3DS operations are detected by name */
  threeDS?: boolean;
  conversationId?: string;
  basketId?: string;
  paymentId?: string;
  /** BIN prefix, 6 to 8 digits. A full card number is reduced to 8 digits. */
  binNumber?: string;
  /** Alias of `binNumber` */
  bin?: string;
  bank?: string;
  bankName?: string;
  cardFamily?: string;
  cardType?: string;
  cardOrigin?: string;
  /** BIN fields may also be grouped */
  card?: RoutingBinInfo & { bin?: string };
  paymentCard?: { cardNumber?: string };
}

/** What a rule predicate gets. Never log this object: `request` has card data. */
export interface RoutingContext {
  operation: PaymentOperation;
  /** The operation's request, for custom conditions (`Number(ctx.request.price)`) */
  request: RoutingRequest;
  amount?: string;
  currency?: string;
  installment: number;
  threeDS: boolean;
  /** BIN prefix, when known */
  bin?: string;
  bank?: string;
  cardFamily?: string;
  cardType?: string;
  cardOrigin?: string;
}

/**
 * Conditions of a rule. Every field that is set must match (AND). A field that
 * is not set does not restrict the rule.
 */
export interface RoutingWhen {
  /** BIN prefix(es): `'454671'` matches every BIN starting with it */
  bin?: string | readonly string[];
  bank?: string | readonly string[];
  cardFamily?: string | readonly string[];
  cardType?: RoutingCardType | readonly RoutingCardType[];
  cardOrigin?: RoutingCardOrigin | readonly RoutingCardOrigin[];
  threeDS?: boolean;
  operation?: PaymentOperation | readonly PaymentOperation[];
  currency?: string | readonly string[];
  /** Exact count, or an inclusive range: `{ min: 2 }` means 2 and above */
  installment?: number | { readonly min?: number; readonly max?: number };
  /** Inclusive bounds on `request.price`, decimal strings */
  amount?: { readonly min?: string; readonly max?: string };
  /** Your own condition; a throw fails the operation before any charge */
  predicate?: (ctx: RoutingContext) => boolean;
}

/** What a custom strategy chooses from */
export interface RoutingStrategyContext {
  operation: PaymentOperation;
  /** The operation's request; never log it */
  request: RoutingRequest;
  /** Eligible provider ids, in target (or provider configuration) order */
  candidates: readonly string[];
}

/**
 * Picks one of `candidates`. Return `null`/`undefined` to let the next rule (or
 * the default) decide. This is the seam the commission router (#51) plugs into:
 * `strategy: commissionRouter({ ... })` needs a `choose()` adapter, no engine
 * change.
 */
export interface RoutingStrategy {
  id?: string;
  choose: (
    ctx: RoutingStrategyContext
  ) => string | null | undefined | Promise<string | null | undefined>;
}

/** One routing rule */
export interface RoutingRule {
  /** Name shown in `explain()` and in decision events. Default: `rule[0]` */
  name?: string;
  when?: RoutingWhen;
  /** Target. Optional when `strategy` is set: then every enabled provider is a candidate */
  use?: RoutingTarget;
  /** A strategy object, or the name of one in `strategies` */
  strategy?: string | RoutingStrategy;
}

/** Health is injected: the plugin never measures providers itself */
export interface RoutingHealth {
  /**
   * Return `false` to exclude a provider from new payments. A throw counts as
   * `false`. Refunds and cancels still go to the provider that took the payment.
   */
  isAvailable?: (providerId: string) => boolean | Promise<boolean>;
}

/**
 * Where the plugin remembers which provider handled a payment, so refunds,
 * cancels, captures, voids and status calls reach that provider, and retries of
 * the same order never move. Same shape as the library's `IdempotencyStore`, so
 * the same Redis/SQL adapter can be passed.
 */
export interface RoutingStore {
  get(key: string): string | null | undefined | Promise<string | null | undefined>;
  set(key: string, value: string, ttlSeconds: number): void | Promise<void>;
  delete?(key: string): void | Promise<void>;
}

export interface RoutingOptions {
  /** Rules are checked in order; the first matching rule with an eligible target wins */
  rules?: readonly RoutingRule[];
  /** Target when no rule matched. Default: the library's `defaultProvider` */
  default?: RoutingTarget;
  health?: RoutingHealth;
  store?: RoutingStore;
  /**
   * BIN classifier. Receives the 6-8 digit BIN prefix; never fetches the network
   * from the plugin (#153/#252 will plug in here).
   */
  binResolver?: (bin: string) => RoutingBinInfo | Promise<RoutingBinInfo>;
  /** Named strategies for `rules[].strategy` */
  strategies?: Readonly<Record<string, RoutingStrategy>>;
}

/** Why a provider was not used */
export type RoutingSkipReason = 'not-enabled' | 'unhealthy';

export interface RoutingSkip {
  provider: string;
  reason: RoutingSkipReason;
}

/** What selected the provider */
export type RoutingReason =
  | 'rule'
  | 'strategy'
  | 'default'
  /** A retry of an order that was already routed: the provider never moves */
  | 'pinned'
  /** The provider that handled the payment (refunds, cancels, capture, void, status) */
  | 'follow-up'
  /** A follow-up of a payment the plugin does not know: fell back to the default */
  | 'unknown-payment'
  /** Nothing was eligible; the plugin does not override the library default */
  | 'none';

/** The result of a routing decision. Never contains card data or the BIN. */
export interface RoutingDecision {
  provider: string | null;
  /** `rule.name` or `rule[index]`, null for a default/pinned/follow-up decision */
  rule: string | null;
  ruleIndex: number | null;
  reason: RoutingReason;
  operation: PaymentOperation;
  skipped: RoutingSkip[];
  /** Human-readable explanation, safe for logs and dashboards */
  detail: string;
}

/** Counts of routed charges per provider, in this process */
export interface RoutingStatus {
  counts: Record<string, number>;
  total: number;
}

/** Options of `payment.routing.explain()` */
export interface RoutingExplainOptions {
  /** Operation to explain. Default: `'createPayment'` */
  operation?: PaymentOperation;
}

/** Audit listener, called for every routing decision before the provider call */
export type RoutingDecisionListener = (decision: RoutingDecision) => void | Promise<void>;

/** @internal Everything the engine needs besides the rule options */
export interface RoutingEngineContext {
  providerIds: readonly string[];
  defaultProvider?: string;
  logger?: BetterPaymentLogger;
}
