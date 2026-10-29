/**
 * better-payment/reconciliation: daily provider transaction lists and local
 * order matching (issue #41).
 *
 * Shipped as its own tree-shakable subpath, like better-payment/plugins, so
 * importing better-payment stays free of it. Classes and errors come from the
 * main entry point (external in the build), so instanceof checks see the same
 * classes.
 *
 * Everything here is read-only: listing a day's transactions and reconciling
 * them against local orders never changes a payment, never marks anything
 * successful and never re-executes a payment. Ambiguous matches are reported,
 * not resolved.
 */
export { createReconciliation } from './create';
export type { Reconciliation, CreateReconciliationOptions } from './create';
export { reconcile } from './reconcile';
export { ReconciliationError } from './utils';
export { reconciliationPlugin } from './plugin';
export type { ReconciliationPluginOptions } from './plugin';
export {
  RECONCILIATION_SUPPORT,
  SUPPORTED_RECONCILIATION_PROVIDERS,
  reconciliationSupport,
} from './support';
export type { ReconciliationSupportEntry } from './support';
export {
  normalizeAmountString,
  normalizeCurrency,
  normalizeDate,
  parseDecimalLike,
  decimalToMinor,
  minorToDecimal,
  addAmounts,
  currencyDecimals,
  DEFAULT_CURRENCY_DECIMALS,
} from './utils';
export { paytrReconciliation } from './sources/paytr';
export type { PayTRReconciliationConfig } from './sources/paytr';
export { iyzicoReconciliation } from './sources/iyzico';
export type { IyzicoReconciliationConfig } from './sources/iyzico';
export { akbankReconciliation } from './sources/akbank';
export type { AkbankReconciliationConfig } from './sources/akbank';
export { paramposReconciliation } from './sources/parampos';
export type { ParamposReconciliationConfig } from './sources/parampos';
export type {
  ReconcileOptions,
  ReconcilableOrder,
  ReconciledTransaction,
  ReconciliationAmbiguous,
  ReconciliationFieldCandidates,
  ReconciliationListRequest,
  ReconciliationMatch,
  ReconciliationMismatch,
  ReconciliationOrderStatus,
  ReconciliationQuery,
  ReconciliationReport,
  ReconciliationRunRequest,
  ReconciliationSource,
  ReconciliationSourceOptions,
  ReconciliationTotals,
  ReconciliationTransactionStatus,
  ReconciliationTransactionType,
} from '../types/reconciliation';
