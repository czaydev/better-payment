/**
 * better-payment/commission-router: routes each payment to the cheapest
 * eligible provider from merchant-defined commission rate tables.
 *
 * Shipped as its own tree-shakable subpath (like better-payment/invoicing) so
 * importing better-payment/plugins never pulls the router code.
 *
 * Classes and enums come from the main entry point (kept external in the
 * build), like in better-payment/plugins, so that instanceof checks see the
 * same classes.
 */
export { commissionRouter } from './router';
export { MemoryRoutingStore } from './store';
export type { RoutingStore, MemoryRoutingStoreOptions } from './store';
export type { BinLookup, CommissionRate, RouterBinInfo } from './rates';
export type {
  CandidateReason,
  CommissionRouterMethods,
  CommissionRouterOptions,
  ExcludedProvider,
  ExclusionReason,
  RouterCacheOptions,
  RouterCandidate,
  RouterOperation,
  RouterOverride,
  RouterOverrideContext,
  RouterPolicy,
  RouterQuote,
  RouterQuoteCard,
  RouterQuoteInput,
  RouterShareCapOptions,
  RouterStatus,
  RouterStrategy,
  RoutedResult,
  SelectionReason,
} from './types';
