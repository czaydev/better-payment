import { describe, it, expect } from 'vitest';
import { ValidationError } from 'better-payment';
import { reconcile } from 'better-payment/reconciliation';
import type { ReconcilableOrder, ReconciledTransaction } from 'better-payment/reconciliation';

const QUERY = { from: '2026-10-19', to: '2026-10-19' };

function tx(overrides: Partial<ReconciledTransaction> = {}): ReconciledTransaction {
  return {
    provider: 'paytr',
    transactionId: 'T-1',
    orderId: 'ORD-1',
    type: 'sale',
    amount: '100.00',
    currency: 'TRY',
    status: 'success',
    date: '2026-10-19T10:00:00',
    ...overrides,
  };
}

function order(overrides: Partial<ReconcilableOrder> = {}): ReconcilableOrder {
  return {
    orderId: 'ORD-1',
    amount: '100.00',
    currency: 'TRY',
    status: 'success',
    ...overrides,
  };
}

describe('reconcile: matched and mismatched orders', () => {
  it('matches a paid order against the provider sale', () => {
    const report = reconcile([order()], [tx()], QUERY);

    expect(report.period).toEqual(QUERY);
    expect(report.matched).toEqual([
      {
        orderId: 'ORD-1',
        providerTransactionIds: ['T-1'],
        orderAmount: '100.00',
        providerAmount: '100.00',
        currency: 'TRY',
        providerStatus: 'confirmed',
      },
    ]);
    expect(report.mismatched).toEqual([]);
    expect(report.totals).toEqual({
      TRY: { sales: '100.00', refunds: '0.00', fees: '0.00', transactionCount: 1 },
    });
  });

  it('marks a match as unconfirmed when the provider row has no status', () => {
    const report = reconcile([order()], [tx({ status: 'unknown' })], QUERY);
    expect(report.matched[0].providerStatus).toBe('unknown');
  });

  it('reports amount and currency disagreements instead of matching', () => {
    const amount = reconcile([order()], [tx({ amount: '99.99' })], QUERY);
    expect(amount.matched).toEqual([]);
    expect(amount.mismatched[0]).toMatchObject({
      orderId: 'ORD-1',
      reasons: ['amount'],
      orderStatus: 'success',
      orderAmount: '100.00',
      providerAmount: '99.99',
      currency: 'TRY',
      providerTransactionIds: ['T-1'],
    });

    const currency = reconcile([order()], [tx({ currency: 'USD' })], QUERY);
    expect(currency.mismatched[0].reasons).toEqual(['currency']);
    expect(currency.mismatched[0].currency).toBe('TRY');
  });

  it('lists orders the provider has no transaction for', () => {
    const report = reconcile([order(), order({ orderId: 'ORD-2' })], [], QUERY);
    expect(report.missingInProvider.map((o) => o.orderId)).toEqual(['ORD-1', 'ORD-2']);
    expect(report.matched).toEqual([]);
  });

  it('treats a failed order with no provider charge as consistent', () => {
    const report = reconcile([order({ status: 'failed' })], [], QUERY);
    expect(report.matched).toEqual([
      expect.objectContaining({
        orderId: 'ORD-1',
        providerTransactionIds: [],
        providerAmount: '0',
      }),
    ]);
    expect(report.mismatched).toEqual([]);
  });

  it('flags a settled payment the merchant still marks pending or failed', () => {
    for (const status of ['pending', 'failed'] as const) {
      const report = reconcile([order({ status })], [tx()], QUERY);
      expect(report.mismatched[0].reasons).toEqual(['order-not-marked-success']);
      expect(report.matched).toEqual([]);
    }
  });

  it('flags an order with nothing final at the provider', () => {
    const report = reconcile([order({ status: 'pending' })], [tx({ status: 'pending' })], QUERY);
    expect(report.mismatched[0].reasons).toEqual(['provider-not-final']);
  });
});

describe('reconcile: refunds, voids and cancellations', () => {
  it('matches a refunded order only when the refunds cover it', () => {
    const sale = tx();
    const full = reconcile(
      [order({ status: 'refunded' })],
      [sale, tx({ transactionId: 'T-2', type: 'refund', amount: '100.00' })],
      QUERY
    );
    expect(full.matched).toHaveLength(1);
    expect(full.totals.TRY).toEqual({
      sales: '100.00',
      refunds: '100.00',
      fees: '0.00',
      transactionCount: 2,
    });

    const partial = reconcile(
      [order({ status: 'refunded' })],
      [sale, tx({ transactionId: 'T-2', type: 'refund', amount: '50.00' })],
      QUERY
    );
    expect(partial.matched).toEqual([]);
    expect(partial.mismatched[0].reasons).toEqual(['refund']);
  });

  it('flags a cancellation that was actually charged, unless a void exists', () => {
    const charged = reconcile([order({ status: 'cancelled' })], [tx()], QUERY);
    expect(charged.mismatched[0].reasons).toEqual(['status']);

    const voided = reconcile(
      [order({ status: 'cancelled' })],
      [tx(), tx({ transactionId: 'T-2', type: 'void', amount: '100.00' })],
      QUERY
    );
    expect(voided.matched).toHaveLength(1);
    expect(voided.mismatched).toEqual([]);

    const neverCharged = reconcile([order({ status: 'cancelled' })], [], QUERY);
    expect(neverCharged.matched).toHaveLength(1);
  });
});

describe('reconcile: ambiguous and unknown rows', () => {
  it('reports several successful sales for one order id instead of picking one', () => {
    const report = reconcile(
      [order()],
      [tx(), tx({ transactionId: 'T-2', amount: '100.00' })],
      QUERY
    );
    expect(report.matched).toEqual([]);
    expect(report.ambiguous).toEqual([
      expect.objectContaining({ orderId: 'ORD-1', reason: 'multiple-sale-candidates' }),
    ]);
    expect(report.ambiguous[0].transactions.map((t) => t.transactionId)).toEqual(['T-1', 'T-2']);
    expect(report.totals.TRY.sales).toBe('200.00');
  });

  it('lists provider transactions the merchant has no order for', () => {
    const report = reconcile(
      [order()],
      [
        tx(),
        tx({ transactionId: 'T-2', orderId: 'ORD-PANEL' }),
        tx({ transactionId: 'T-3', orderId: undefined }),
        // settlements are payouts of already-reconciled sales, never new orders
        tx({ transactionId: 'T-4', orderId: 'ORD-PANEL', type: 'settlement' }),
      ],
      QUERY
    );
    expect(report.unknownInMerchant.map((t) => t.transactionId)).toEqual(['T-2', 'T-3']);
  });
});

describe('reconcile: duplicates, currencies and validation', () => {
  it('counts a redelivered transaction once and records the duplicate id', () => {
    const report = reconcile([order()], [tx(), tx()], QUERY);
    expect(report.matched).toHaveLength(1);
    expect(report.matched[0].providerTransactionIds).toEqual(['T-1']);
    expect(report.duplicateTransactionIds).toEqual(['T-1']);
    expect(report.totals.TRY).toMatchObject({ sales: '100.00', transactionCount: 1 });
  });

  it('keeps totals per currency and compares 0-decimal currencies exactly', () => {
    const report = reconcile(
      [
        order(),
        order({ orderId: 'ORD-JPY', amount: '1500', currency: 'JPY' }),
        order({ orderId: 'ORD-USD', amount: '50.00', currency: 'USD' }),
      ],
      [
        tx(),
        tx({ transactionId: 'T-2', orderId: 'ORD-JPY', amount: '1501', currency: 'JPY' }),
        tx({ transactionId: 'T-3', orderId: 'ORD-USD', amount: '50.00', currency: 'USD' }),
      ],
      QUERY
    );
    expect(report.matched.map((m) => m.orderId)).toEqual(['ORD-1', 'ORD-USD']);
    expect(report.mismatched.map((m) => [m.orderId, m.reasons])).toEqual([['ORD-JPY', ['amount']]]);
    expect(report.totals.JPY).toEqual({
      sales: '1501',
      refunds: '0',
      fees: '0',
      transactionCount: 1,
    });
    expect(report.totals.USD.sales).toBe('50.00');
  });

  it('rejects duplicate or empty order ids', () => {
    expect(() => reconcile([order(), order()], [], QUERY)).toThrow(ValidationError);
    expect(() => reconcile([order(), order()], [], QUERY)).toThrow(/duplicate order id/);
    expect(() => reconcile([order({ orderId: '' })], [], QUERY)).toThrow(/non-empty orderId/);
  });

  it('never mutates the order or transaction inputs', () => {
    const orderInput = order();
    const txInput = tx();
    reconcile([orderInput], [txInput], QUERY);
    expect(orderInput).toEqual(order());
    expect(txInput).toEqual(tx());
  });
});
