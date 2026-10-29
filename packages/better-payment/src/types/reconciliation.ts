import type { RetryConfig } from '../core/retry';

/**
 * A transaction as the provider's daily list reports it, normalized into one
 * stable row shape. Amounts are decimal strings (never floats); `fee` and
 * `orderId` are absent when the provider does not report them.
 *
 * The row is intentionally minimal: it never carries card data, customer names
 * or any other PII from the provider response.
 */
export interface ReconciledTransaction {
  /** Id of the source that produced the row, e.g. `paytr` */
  provider: string;
  /** Provider transaction id; stable across pages and redeliveries */
  transactionId: string;
  /** Merchant order id when the provider reports one */
  orderId?: string;
  type: ReconciliationTransactionType;
  /** Decimal string with the currency's minor units, e.g. "10.50" (TRY), "1500" (JPY) */
  amount: string;
  /** Provider commission/fee as a decimal string, when reported */
  fee?: string;
  /** ISO currency code, e.g. `TRY` */
  currency: string;
  status: ReconciliationTransactionStatus;
  /** Transaction time as `YYYY-MM-DDTHH:mm:ss` (provider local time), or `YYYY-MM-DD` */
  date: string;
}

/**
 * `settlement` is a payout of already-reconciled sales (iyzico `Payout`), not a
 * new payment; it never participates in order matching.
 */
export type ReconciliationTransactionType = 'sale' | 'refund' | 'void' | 'settlement' | 'other';

/**
 * - `success`: the provider confirms the transaction went through
 * - `failure`: the provider records it as failed
 * - `pending`: the provider has not finalized it yet
 * - `unknown`: the provider's report does not distinguish (see each source's docs)
 */
export type ReconciliationTransactionStatus = 'success' | 'failure' | 'pending' | 'unknown';

/** Inclusive UTC-date range, `YYYY-MM-DD`. */
export interface ReconciliationQuery {
  from: string;
  to: string;
}

/** Request of `listTransactions()` / `payment.listTransactions()`. */
export interface ReconciliationListRequest extends ReconciliationQuery {
  /**
   * Only ask this source. When omitted, a call on the payment object asks every
   * configured source and a call on a provider asks only that provider.
   */
  provider?: string;
}

/** Request of `reconcile()` / `payment.reconcile()`. */
export interface ReconciliationRunRequest extends ReconciliationListRequest {
  /** The merchant's own orders for the period */
  orders: readonly ReconcilableOrder[];
  /** Minor units per currency, merged over the built-in table */
  options?: ReconcileOptions;
}

/** Options of `reconcile`. */
export interface ReconcileOptions {
  /** Minor units per currency, merged over the built-in table. */
  currencyDecimals?: Record<string, number>;
}

/** A provider's daily transaction list, normalized. Read-only by contract. */
export interface ReconciliationSource {
  readonly provider: string;
  listTransactions(query: ReconciliationQuery): Promise<ReconciledTransaction[]>;
}

/** Options every source accepts. */
export interface ReconciliationSourceOptions {
  /** Custom fetch implementation. Default: globalThis.fetch. */
  fetch?: typeof fetch;
  /** Retry policy for the (read-only) list requests. */
  retry?: RetryConfig;
  /** Request timeout in ms. Default: 30000. */
  timeoutMs?: number;
  /**
   * Replace the default candidate field names a source reads a row field from
   * (the provider's JSON/SOAP keys). Use it when your account's report uses
   * different keys than the documented ones.
   */
  fields?: Partial<ReconciliationFieldCandidates>;
  /**
   * Minor units per currency, merged over the built-in table (TRY/USD/EUR: 2,
   * JPY: 0, ...). Currencies missing from both default to 2.
   */
  currencyDecimals?: Record<string, number>;
  /** Longest range a single provider request may cover; sources split larger ranges. */
  maxDaysPerRequest?: number;
}

export interface ReconciliationFieldCandidates {
  transactionId: readonly string[];
  orderId: readonly string[];
  amount: readonly string[];
  fee: readonly string[];
  currency: readonly string[];
  date: readonly string[];
  type: readonly string[];
  status: readonly string[];
}

/** A local order as the merchant application supplies it to `reconcile`. */
export interface ReconcilableOrder {
  orderId: string;
  /** Decimal string in the order's currency */
  amount: string;
  currency: string;
  status: ReconciliationOrderStatus;
}

export type ReconciliationOrderStatus = 'success' | 'refunded' | 'cancelled' | 'pending' | 'failed';

export interface ReconciliationMatch {
  orderId: string;
  providerTransactionIds: string[];
  orderAmount: string;
  providerAmount: string;
  currency: string;
  /**
   * `confirmed`: the provider marks the matched row as succeeded. `unknown`:
   * the provider's daily feed reports no status for it, so the match is on
   * order id and amount only — verify before treating the money as settled.
   */
  providerStatus: 'confirmed' | 'unknown';
}

export interface ReconciliationMismatch {
  orderId: string;
  /** Why the order and the provider disagree: amount | currency | status | refund */
  reasons: string[];
  orderStatus: ReconciliationOrderStatus;
  orderAmount?: string;
  providerAmount?: string;
  currency: string;
  providerTransactionIds: string[];
}

export interface ReconciliationAmbiguous {
  orderId: string;
  /** Why the match cannot be decided safely, e.g. `multiple-successful-sales` */
  reason: string;
  transactions: ReconciledTransaction[];
}

export interface ReconciliationTotals {
  sales: string;
  refunds: string;
  fees: string;
  transactionCount: number;
}

/**
 * Result of `reconcile`. The report is purely descriptive: reconcile never
 * changes an order or a transaction, it only classifies them.
 */
export interface ReconciliationReport {
  period: ReconciliationQuery;
  matched: ReconciliationMatch[];
  mismatched: ReconciliationMismatch[];
  /** Orders the merchant marks as paid/refunded that no provider transaction covers */
  missingInProvider: ReconcilableOrder[];
  /** Provider transactions with no local order (refunds from the provider panel, lost callbacks) */
  unknownInMerchant: ReconciledTransaction[];
  ambiguous: ReconciliationAmbiguous[];
  /** Transaction ids delivered more than once (page overlap / redelivery); each counted once */
  duplicateTransactionIds: string[];
  /** Sum of provider amounts per currency, decimal strings */
  totals: Record<string, ReconciliationTotals>;
}
