import { ProviderNotEnabledError, ValidationError } from 'better-payment';
import { dedupeTransactions, reconcile } from './reconcile';
import type {
  ReconcileOptions,
  ReconcilableOrder,
  ReconciledTransaction,
  ReconciliationListRequest,
  ReconciliationReport,
  ReconciliationSource,
} from '../types/reconciliation';

/**
 * The facade over a set of configured sources: one `listTransactions` for all
 * providers, deduplicated, and `reconcile` that compares local orders against
 * it. Both are read-only: this API never mutates orders, never marks anything
 * successful and never re-executes a payment — it only reports.
 */
export interface Reconciliation {
  readonly sources: readonly ReconciliationSource[];
  listTransactions(query: ReconciliationListRequest): Promise<ReconciledTransaction[]>;
  reconcile(
    orders: readonly ReconcilableOrder[],
    query: ReconciliationListRequest,
    options?: ReconcileOptions
  ): Promise<ReconciliationReport>;
}

export interface CreateReconciliationOptions {
  /** Provider sources built with paytrReconciliation(), iyzicoReconciliation(), ... */
  sources: readonly ReconciliationSource[];
}

export function createReconciliation(options: CreateReconciliationOptions): Reconciliation {
  const sources = [...(options.sources ?? [])];
  if (sources.length === 0) {
    throw new ValidationError('createReconciliation: at least one source is required');
  }
  const byId = new Map<string, ReconciliationSource>();
  for (const source of sources) {
    if (byId.has(source.provider)) {
      throw new ValidationError(`createReconciliation: duplicate source '${source.provider}'`);
    }
    byId.set(source.provider, source);
  }

  const listTransactions = async (
    query: ReconciliationListRequest
  ): Promise<ReconciledTransaction[]> => {
    const selected = query.provider ? [byId.get(query.provider)] : sources;
    if (selected.some((source) => !source)) {
      throw new ProviderNotEnabledError(query.provider ?? 'unknown');
    }
    const responses = await Promise.all(
      (selected as ReconciliationSource[]).map((source) =>
        source.listTransactions({ from: query.from, to: query.to })
      )
    );
    const merged = responses.flat();
    // Day-window and page overlaps are collapsed here, so a transaction
    // delivered twice counts once across the whole result.
    const { transactions } = dedupeTransactions(merged);
    return transactions.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.provider.localeCompare(b.provider) ||
        a.transactionId.localeCompare(b.transactionId)
    );
  };

  return {
    sources,
    listTransactions,
    reconcile: async (orders, query, reconcileOptions) => {
      const transactions = await listTransactions(query);
      return reconcile(orders, transactions, { from: query.from, to: query.to }, reconcileOptions);
    },
  };
}
