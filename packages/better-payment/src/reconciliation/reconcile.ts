import { ValidationError } from 'better-payment';
import {
  addAmounts,
  currencyDecimals,
  decimalToMinor,
  minorToDecimal,
  normalizeCurrency,
} from './utils';
import type {
  ReconcileOptions,
  ReconcilableOrder,
  ReconciledTransaction,
  ReconciliationAmbiguous,
  ReconciliationMatch,
  ReconciliationMismatch,
  ReconciliationReport,
  ReconciliationQuery,
  ReconciliationTotals,
} from '../types/reconciliation';

/** Types that represent money movement against an order. */
const ORDER_TYPES: ReadonlySet<string> = new Set(['sale', 'refund', 'void']);

interface DedupedTransactions {
  transactions: ReconciledTransaction[];
  duplicateTransactionIds: string[];
}

/**
 * Drop rows the provider delivered more than once (page overlap, redelivery of
 * the same daily file, day-window overlap). The first delivery wins, the id is
 * recorded, and a never double-counted.
 */
export function dedupeTransactions(
  transactions: readonly ReconciledTransaction[]
): DedupedTransactions {
  const seen = new Map<string, ReconciledTransaction>();
  const duplicates: string[] = [];
  const deduped: ReconciledTransaction[] = [];
  for (const tx of transactions) {
    const key = `${tx.provider}|${tx.transactionId}`;
    const previous = seen.get(key);
    if (previous) {
      if (!duplicates.includes(tx.transactionId)) duplicates.push(tx.transactionId);
      continue;
    }
    seen.set(key, tx);
    deduped.push(tx);
  }
  return { transactions: deduped, duplicateTransactionIds: duplicates };
}

function classifyOrder(
  order: ReconcilableOrder,
  txs: ReconciledTransaction[],
  options: ReconcileOptions,
  out: {
    matched: ReconciliationMatch[];
    mismatched: ReconciliationMismatch[];
    missing: ReconcilableOrder[];
    ambiguous: ReconciliationAmbiguous[];
  }
): void {
  const currency = normalizeCurrency(order.currency);
  const decimals = currencyDecimals(currency, options.currencyDecimals);
  const orderMinor = decimalToMinor(order.amount, decimals);
  const saleRows = txs.filter((t) => t.type === 'sale');
  const successSales = saleRows.filter((t) => t.status === 'success');
  const unknownSales = saleRows.filter((t) => t.status === 'unknown');
  const refundRows = txs.filter((t) => t.type === 'refund' && t.status === 'success');
  const voidRows = txs.filter((t) => t.type === 'void' && t.status === 'success');
  const ids = txs.map((t) => t.transactionId);

  const mismatch = (reasons: string[], providerAmount?: string): void => {
    out.mismatched.push({
      orderId: order.orderId,
      reasons,
      orderStatus: order.status,
      orderAmount: order.amount,
      providerAmount,
      currency,
      providerTransactionIds: ids,
    });
  };

  const match = (
    providerTx: ReconciledTransaction | undefined,
    providerStatus: 'confirmed' | 'unknown'
  ): void => {
    out.matched.push({
      orderId: order.orderId,
      providerTransactionIds: ids,
      orderAmount: order.amount,
      providerAmount: providerTx?.amount ?? '0',
      currency,
      providerStatus,
    });
  };

  const sameMoney = (row: ReconciledTransaction): boolean =>
    row.currency === currency &&
    orderMinor !== undefined &&
    orderMinor ===
      decimalToMinor(row.amount, currencyDecimals(row.currency, options.currencyDecimals));

  if (successSales.length > 1 || (successSales.length === 0 && unknownSales.length > 1)) {
    // Several candidate sales for one order id: a possible double charge or a
    // redelivered row that lost its id. Never pick one: report for a human.
    out.ambiguous.push({
      orderId: order.orderId,
      reason: 'multiple-sale-candidates',
      transactions: txs,
    });
    return;
  }

  const primary = successSales[0] ?? unknownSales[0];
  const primaryIsConfirmed = successSales.length > 0;

  switch (order.status) {
    case 'success':
    case 'refunded': {
      if (!primary) {
        if (saleRows.length > 0) mismatch(['status'], saleRows[0].amount);
        else out.missing.push(order);
        return;
      }
      if (primary.currency !== currency) {
        mismatch(['currency'], primary.amount);
        return;
      }
      if (!sameMoney(primary)) {
        mismatch(['amount'], primary.amount);
        return;
      }
      if (order.status === 'refunded') {
        const refundMinor = refundRows.reduce(
          (sum, t) =>
            sum +
            (decimalToMinor(t.amount, currencyDecimals(t.currency, options.currencyDecimals)) ??
              0n),
          0n
        );
        if ((orderMinor ?? 0n) > refundMinor) {
          mismatch(['refund'], primary.amount);
          return;
        }
      }
      match(primary, primaryIsConfirmed ? 'confirmed' : 'unknown');
      return;
    }
    case 'cancelled': {
      if (!primary) {
        // Nothing was charged: the order was cancelled before payment. Consistent.
        match(voidRows[0], 'confirmed');
        return;
      }
      if (!primaryIsConfirmed) {
        mismatch(['provider-not-final'], primary.amount);
        return;
      }
      if (voidRows.length === 0 && refundRows.length === 0) {
        // Charged at the provider but only cancelled in the merchant's books.
        mismatch(['status'], primary.amount);
        return;
      }
      match(primary, 'confirmed');
      return;
    }
    case 'pending':
    case 'failed': {
      if (primaryIsConfirmed) {
        // The provider settled a payment the merchant still marks pending/failed
        // (the lost-callback case from the issue): report, change nothing.
        mismatch(['order-not-marked-success'], primary.amount);
        return;
      }
      const inFlight = saleRows.find((t) => t.status === 'pending' || t.status === 'unknown');
      if (inFlight) {
        mismatch(['provider-not-final'], inFlight.amount);
        return;
      }
      // No confirmed charge: a failed order with only failed rows (or no rows
      // at all) is consistent.
      match(saleRows[0], 'confirmed');
      return;
    }
    default: {
      const _never: never = order.status;
      throw new ValidationError(`Unknown order status: ${String(_never)}`);
    }
  }
}

/**
 * Match a local order list against provider transaction rows. Read-only and
 * pure: inputs are never mutated, statuses are never changed, ambiguous cases
 * are reported instead of auto-resolved. Amounts are compared as decimal
 * strings in the currency's minor units, so 0-decimal currencies (JPY) are
 * exact.
 */
export function reconcile(
  orders: readonly ReconcilableOrder[],
  transactions: readonly ReconciledTransaction[],
  query: ReconciliationQuery,
  options: ReconcileOptions = {}
): ReconciliationReport {
  const orderIndex = new Map<string, ReconcilableOrder>();
  for (const order of orders) {
    if (!order.orderId) {
      throw new ValidationError('reconcile: every order needs a non-empty orderId');
    }
    if (orderIndex.has(order.orderId)) {
      throw new ValidationError(
        `reconcile: duplicate order id '${order.orderId}' in the order list`
      );
    }
    orderIndex.set(order.orderId, order);
  }

  const { transactions: unique, duplicateTransactionIds } = dedupeTransactions(transactions);

  const txsByOrder = new Map<string, ReconciledTransaction[]>();
  const unknownInMerchant: ReconciledTransaction[] = [];
  for (const tx of unique) {
    if (tx.orderId && orderIndex.has(tx.orderId)) {
      const list = txsByOrder.get(tx.orderId) ?? [];
      list.push(tx);
      txsByOrder.set(tx.orderId, list);
    } else if (ORDER_TYPES.has(tx.type)) {
      // No order id, or an order id this merchant does not know: a refund made
      // in the provider panel, a payment whose callback was lost, an unattributed row.
      unknownInMerchant.push(tx);
    }
  }

  const out = {
    matched: [] as ReconciliationMatch[],
    mismatched: [] as ReconciliationMismatch[],
    missing: [] as ReconcilableOrder[],
    ambiguous: [] as ReconciliationAmbiguous[],
  };
  for (const order of orderIndex.values()) {
    classifyOrder(order, txsByOrder.get(order.orderId) ?? [], options, out);
  }

  const totals: Record<string, ReconciliationTotals> = {};
  for (const tx of unique) {
    const currency = tx.currency;
    const entry = (totals[currency] ??= {
      sales: '0',
      refunds: '0',
      fees: '0',
      transactionCount: 0,
    });
    entry.transactionCount += 1;
    if (tx.type === 'sale')
      entry.sales = addAmounts(entry.sales, tx.amount, currency, options.currencyDecimals);
    if (tx.type === 'refund')
      entry.refunds = addAmounts(entry.refunds, tx.amount, currency, options.currencyDecimals);
    if (tx.fee !== undefined)
      entry.fees = addAmounts(entry.fees, tx.fee, currency, options.currencyDecimals);
  }
  for (const [currency, entry] of Object.entries(totals)) {
    const decimals = currencyDecimals(currency, options.currencyDecimals);
    entry.sales = minorToDecimal(decimalToMinor(entry.sales, decimals) ?? 0n, decimals);
    entry.refunds = minorToDecimal(decimalToMinor(entry.refunds, decimals) ?? 0n, decimals);
    entry.fees = minorToDecimal(decimalToMinor(entry.fees, decimals) ?? 0n, decimals);
  }

  return {
    period: { from: query.from, to: query.to },
    matched: out.matched,
    mismatched: out.mismatched,
    missingInProvider: out.missing,
    unknownInMerchant,
    ambiguous: out.ambiguous,
    duplicateTransactionIds,
    totals,
  };
}
