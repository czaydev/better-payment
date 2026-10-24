import { describe, it, expect, vi } from 'vitest';
import {
  betterPayment,
  BetterPaymentError,
  ValidationError,
  type PaymentEvent,
} from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import {
  reconciliationPlugin,
  type ReconciledTransaction,
  type ReconciliationSource,
} from 'better-payment/reconciliation';

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

function stubSource(provider: string, rows: ReconciledTransaction[]): ReconciliationSource {
  return { provider, listTransactions: vi.fn(async () => rows) };
}

function paymentWith(sources: ReconciliationSource[]) {
  return betterPayment({
    providers: { mock: new MockProvider() },
    defaultProvider: 'mock',
    plugins: [reconciliationPlugin({ sources })],
  });
}

describe('reconciliationPlugin', () => {
  it('answers listTransactions from every configured source, merged and sorted', async () => {
    const paytr = stubSource('paytr', [
      tx({ transactionId: 'T-2', date: '2026-10-19T12:00:00' }),
      tx({ transactionId: 'T-2', date: '2026-10-19T12:00:00' }),
    ]);
    const iyzico = stubSource('iyzico', [
      tx({ provider: 'iyzico', transactionId: 'T-1', date: '2026-10-19T09:00:00' }),
    ]);
    const payment = paymentWith([paytr, iyzico]);

    const rows = await payment.listTransactions(QUERY);

    expect(rows.map((row) => [row.provider, row.transactionId])).toEqual([
      ['iyzico', 'T-1'],
      ['paytr', 'T-2'],
    ]);
    expect(paytr.listTransactions).toHaveBeenCalledWith(QUERY);
    expect(iyzico.listTransactions).toHaveBeenCalledWith(QUERY);
    expect((payment.mock as MockProvider).payments).toEqual([]);
  });

  it('selects one source explicitly, including a custom provider id', async () => {
    const paytr = stubSource('paytr', [tx()]);
    const custom = stubSource('acme-pos', [tx({ provider: 'acme-pos', transactionId: 'A-1' })]);
    const payment = paymentWith([paytr, custom]);

    const explicit = await payment.listTransactions({ ...QUERY, provider: 'paytr' });
    expect(explicit.map((row) => row.provider)).toEqual(['paytr']);
    expect(custom.listTransactions).not.toHaveBeenCalled();

    const fromCustom = await payment.listTransactions({ ...QUERY, provider: 'acme-pos' });
    expect(fromCustom.map((row) => row.transactionId)).toEqual(['A-1']);
  });

  it('answers calls made on a provider with the source of the same id', async () => {
    const source = stubSource('mock', [tx({ provider: 'mock' })]);
    const payment = paymentWith([source]);
    const rows = await payment.mock.listTransactions(QUERY);
    expect(rows).toEqual([tx({ provider: 'mock' })]);
  });

  it('returns NOT_SUPPORTED for a provider without a configured source', async () => {
    const payment = paymentWith([stubSource('paytr', [tx()])]);
    const error = await payment.mock.listTransactions(QUERY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BetterPaymentError);
    expect((error as BetterPaymentError).code).toBe('NOT_SUPPORTED');
    expect((error as Error).message).toContain("'mock'");
    expect((error as Error).message).toContain('no transaction report');

    const known = await payment
      .listTransactions({ ...QUERY, provider: 'sipay' })
      .catch((e: unknown) => e);
    expect((known as BetterPaymentError).code).toBe('NOT_SUPPORTED');
    expect((known as Error).message).toContain('public documentation');
  });

  it('reports NOT_SUPPORTED from the provider base class when the plugin is absent', async () => {
    const payment = betterPayment({ providers: { mock: new MockProvider() } });
    const error = await payment.mock.listTransactions(QUERY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BetterPaymentError);
    expect((error as BetterPaymentError).code).toBe('NOT_SUPPORTED');
  });

  it('emits reconciliation.completed for both operations, without touching a payment', async () => {
    const payment = paymentWith([stubSource('paytr', [tx()])]);
    const events: PaymentEvent[] = [];
    payment.on('reconciliation.completed', (event) => void events.push(event));

    const rows = await payment.listTransactions(QUERY);
    const report = await payment.reconcile({ ...QUERY, orders: [] });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'reconciliation.completed',
      operation: 'listTransactions',
      provider: 'mock',
    });
    expect(events[0].result).toEqual(rows);
    expect(events[1]).toMatchObject({
      type: 'reconciliation.completed',
      operation: 'reconcile',
      provider: 'mock',
    });
    expect(events[1].result).toEqual(report);
    expect((payment.mock as MockProvider).payments).toEqual([]);
  });

  it('reconciles local orders and passes the options through', async () => {
    const payment = paymentWith([stubSource('paytr', [tx({ amount: '1500', currency: 'JPY' })])]);
    const rows = [
      { orderId: 'ORD-1', amount: '1500', currency: 'JPY', status: 'success' as const },
      { orderId: 'ORD-2', amount: '500', currency: 'JPY', status: 'success' as const },
    ];

    const report = await payment.reconcile({
      ...QUERY,
      orders: rows,
      options: { currencyDecimals: { JPY: 0 } },
    });

    expect(report.matched.map((match) => match.orderId)).toEqual(['ORD-1']);
    expect(report.missingInProvider.map((order) => order.orderId)).toEqual(['ORD-2']);
    expect(report.period).toEqual(QUERY);
  });

  it('rejects an empty or duplicate source list at construction', () => {
    expect(() => reconciliationPlugin({ sources: [] })).toThrow(ValidationError);
    expect(() =>
      reconciliationPlugin({
        sources: [stubSource('paytr', []), stubSource('paytr', [])],
      })
    ).toThrow(/duplicate source/);
  });
});
