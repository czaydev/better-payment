/**
 * Which providers have a normalized transaction source in
 * `better-payment/reconciliation`, and why the others do not.
 *
 * A provider is only listed as supported when its own public documentation
 * describes a transaction/report API that a source is built on. The rest answer
 * NOT_SUPPORTED from the plugin (and from `PaymentProvider.listTransactions`).
 * Their entries are kept here so the docs table and the runtime error cannot
 * drift apart.
 */
export interface ReconciliationSupportEntry {
  status: 'supported' | 'not-supported';
  /** Source factory exported by better-payment/reconciliation */
  source?: string;
  /** Why no source exists (only for `not-supported`) */
  reason?: string;
}

const NOT_DOCUMENTED =
  "the provider's public documentation does not describe a date-range transaction report (checked 2026-10)";

export const RECONCILIATION_SUPPORT: Readonly<Record<string, ReconciliationSupportEntry>> = {
  paytr: { status: 'supported', source: 'paytrReconciliation' },
  iyzico: { status: 'supported', source: 'iyzicoReconciliation' },
  akbank: { status: 'supported', source: 'akbankReconciliation' },
  parampos: { status: 'supported', source: 'paramposReconciliation' },

  sipay: { status: 'not-supported', reason: NOT_DOCUMENTED },
  qnbpay: { status: 'not-supported', reason: NOT_DOCUMENTED },
  est: { status: 'not-supported', reason: NOT_DOCUMENTED },
  isbank: { status: 'not-supported', reason: NOT_DOCUMENTED },
  ziraat: { status: 'not-supported', reason: NOT_DOCUMENTED },
  halkbank: { status: 'not-supported', reason: NOT_DOCUMENTED },
  teb: { status: 'not-supported', reason: NOT_DOCUMENTED },
  sekerbank: { status: 'not-supported', reason: NOT_DOCUMENTED },
  akbankest: { status: 'not-supported', reason: NOT_DOCUMENTED },
  halkbankmkd: { status: 'not-supported', reason: NOT_DOCUMENTED },
  denizbank: { status: 'not-supported', reason: NOT_DOCUMENTED },
  vakifbank: { status: 'not-supported', reason: NOT_DOCUMENTED },
  yapikredi: { status: 'not-supported', reason: NOT_DOCUMENTED },
  qnb: { status: 'not-supported', reason: NOT_DOCUMENTED },
  kuveytturk: { status: 'not-supported', reason: NOT_DOCUMENTED },
  albaraka: { status: 'not-supported', reason: NOT_DOCUMENTED },
  mock: { status: 'not-supported', reason: 'the mock provider has no transaction report' },
};

/** The providers with a source, in the order of the support table. */
export const SUPPORTED_RECONCILIATION_PROVIDERS: readonly string[] = Object.freeze(
  Object.entries(RECONCILIATION_SUPPORT)
    .filter(([, entry]) => entry.status === 'supported')
    .map(([provider]) => provider)
);

export function reconciliationSupport(provider: string): ReconciliationSupportEntry | undefined {
  return RECONCILIATION_SUPPORT[provider];
}
