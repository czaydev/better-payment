import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  betterPayment,
  PaymentStatus,
  PaymentErrorCode,
  type PaymentEvent,
  type PaymentResponse,
} from 'better-payment';
import { MockProvider, MOCK_CARDS } from 'better-payment/testing';
import { pendingResolver, type PendingPayment, type PendingStore } from 'better-payment/plugins';
import { mockPaymentRequest } from '../../fixtures/payment-data';

describe('pendingResolver plugin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records pending payment with NETWORK_ERROR and resolves to succeeded', async () => {
    const mock = new MockProvider();
    const createPaymentSpy = vi.spyOn(mock, 'createPayment');
    const getPaymentSpy = vi.spyOn(mock, 'getPayment');

    const succeededEvents: PaymentEvent[] = [];

    const payment = betterPayment({
      providers: { mock },
      plugins: [
        pendingResolver({
          schedule: ['10s', '1m'],
          giveUpAfter: '1h',
        }),
      ],
    });

    payment.on('payment.succeeded', (event) => {
      succeededEvents.push(event);
    });

    // Simulate network error on createPayment: payment processed by bank, but response lost
    mock.networkErrorNext('payment');
    const initResult = await payment.createPayment({
      ...mockPaymentRequest,
      conversationId: 'ORDER-101',
    });

    expect(initResult.status).toBe(PaymentStatus.PENDING);
    expect(initResult.code).toBe(PaymentErrorCode.NETWORK_ERROR);

    // Verify it was saved to pending store
    const listBefore = await payment.pending.list();
    expect(listBefore.length).toBe(1);
    expect(listBefore[0].id).toBe(initResult.paymentId);
    expect(listBefore[0].conversationId).toBe('ORDER-101');

    // Trying resolve immediately before schedule should skip it
    const earlySummary = await payment.pending.resolve();
    expect(earlySummary.checked).toBe(0);

    // Advance time past first schedule (10s)
    vi.advanceTimersByTime(11_000);

    // Now resolve
    const summary = await payment.pending.resolve();
    expect(summary.checked).toBe(1);
    expect(summary.succeeded).toBe(1);

    // Payment should be removed from store
    const listAfter = await payment.pending.list();
    expect(listAfter.length).toBe(0);

    // Verify event was emitted with resolvedFrom: 'pending'
    expect(succeededEvents.length).toBe(1);
    expect(succeededEvents[0].resolvedFrom).toBe('pending');
    expect(succeededEvents[0].paymentId).toBe(initResult.paymentId);

    // Verify createPayment was NOT called again (read-only query)
    expect(createPaymentSpy).toHaveBeenCalledTimes(1);
    expect(getPaymentSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves pending payment to failed when getPayment reports failure', async () => {
    const mock = new MockProvider();
    const failedEvents: PaymentEvent[] = [];

    const payment = betterPayment({
      providers: { mock },
      plugins: [
        pendingResolver({
          schedule: ['10s'],
          giveUpAfter: '1h',
        }),
      ],
    });

    payment.on('payment.failed', (event) => {
      failedEvents.push(event);
    });

    mock.networkErrorNext('payment');
    const initResult = await payment.createPayment({
      ...mockPaymentRequest,
      conversationId: 'ORDER-102',
    });

    // Next getPayment call returns failure
    vi.spyOn(mock, 'getPayment').mockResolvedValueOnce({
      status: PaymentStatus.FAILURE,
      code: PaymentErrorCode.CARD_DECLINED,
      errorMessage: 'Declined by bank',
      paymentId: initResult.paymentId,
      conversationId: 'ORDER-102',
    });

    vi.advanceTimersByTime(11_000);
    const summary = await payment.pending.resolve();

    expect(summary.failed).toBe(1);
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].resolvedFrom).toBe('pending');
    expect(failedEvents[0].code).toBe(PaymentErrorCode.CARD_DECLINED);

    const remaining = await payment.pending.list();
    expect(remaining.length).toBe(0);
  });

  it('gives up after giveUpAfter and emits payment.unresolved event', async () => {
    const mock = new MockProvider();
    const unresolvedEvents: PaymentEvent[] = [];

    const payment = betterPayment({
      providers: { mock },
      plugins: [
        pendingResolver({
          schedule: ['1m'],
          giveUpAfter: '30m',
        }),
      ],
    });

    payment.on('payment.unresolved', (event) => {
      unresolvedEvents.push(event);
    });

    mock.networkErrorNext('payment');
    const initResult = await payment.createPayment({
      ...mockPaymentRequest,
      conversationId: 'ORDER-103',
    });

    // Advance beyond giveUpAfter (31 minutes)
    vi.advanceTimersByTime(31 * 60 * 1000);

    const summary = await payment.pending.resolve();
    expect(summary.unresolved).toBe(1);
    expect(unresolvedEvents.length).toBe(1);
    expect(unresolvedEvents[0].paymentId).toBe(initResult.paymentId);

    const remaining = await payment.pending.list();
    expect(remaining.length).toBe(0);
  });

  it('supports manual inspection and deletion through pending methods', async () => {
    const mock = new MockProvider();
    const payment = betterPayment({
      providers: { mock },
      plugins: [
        pendingResolver({
          schedule: ['10s'],
        }),
      ],
    });

    mock.networkErrorNext('payment');
    const res = await payment.createPayment(mockPaymentRequest);

    const item = await payment.pending.get(res.paymentId!);
    expect(item).toBeDefined();
    expect(item?.id).toBe(res.paymentId);

    await payment.pending.delete(res.paymentId!);
    const deleted = await payment.pending.get(res.paymentId!);
    expect(deleted).toBeUndefined();
  });

  it('resolves a payment exactly once when two resolvers run concurrently', async () => {
    const mock = new MockProvider();
    const succeededEvents: PaymentEvent[] = [];

    const payment = betterPayment({
      providers: { mock },
      plugins: [
        pendingResolver({
          schedule: ['10s'],
          giveUpAfter: '1h',
        }),
      ],
    });

    payment.on('payment.succeeded', (event) => {
      succeededEvents.push(event);
    });

    mock.networkErrorNext('payment');
    await payment.createPayment({ ...mockPaymentRequest, conversationId: 'ORDER-201' });

    vi.advanceTimersByTime(11_000);
    const [first, second] = await Promise.all([
      payment.pending.resolve(),
      payment.pending.resolve(),
    ]);

    expect(first.checked + second.checked).toBe(1);
    expect(first.succeeded + second.succeeded).toBe(1);
    expect(succeededEvents.length).toBe(1);
    expect((await payment.pending.list()).length).toBe(0);
  });

  it('guards concurrent resolvers even when the store cannot claim', async () => {
    const items = new Map<string, PendingPayment>();
    const store: PendingStore = {
      save: (payment) => {
        items.set(payment.id, { ...payment });
      },
      get: (id) => items.get(id),
      list: () => Array.from(items.values()).map((p) => ({ ...p })),
      delete: (id) => {
        items.delete(id);
      },
    };
    expect(store.claim).toBeUndefined();

    const mock = new MockProvider();
    const succeededEvents: PaymentEvent[] = [];
    const payment = betterPayment({
      providers: { mock },
      plugins: [pendingResolver({ store, schedule: ['10s'], giveUpAfter: '1h' })],
    });
    payment.on('payment.succeeded', (event) => {
      succeededEvents.push(event);
    });

    mock.networkErrorNext('payment');
    await payment.createPayment({ ...mockPaymentRequest, conversationId: 'ORDER-202' });

    vi.advanceTimersByTime(11_000);
    const [first, second] = await Promise.all([
      payment.pending.resolve(),
      payment.pending.resolve(),
    ]);

    expect(first.succeeded + second.succeeded).toBe(1);
    expect(succeededEvents.length).toBe(1);
    expect(items.size).toBe(0);
  });

  it('keeps the payment pending when the status query times out', async () => {
    const mock = new MockProvider();
    const succeededEvents: PaymentEvent[] = [];
    const failedEvents: PaymentEvent[] = [];

    const payment = betterPayment({
      providers: { mock },
      plugins: [pendingResolver({ schedule: ['10s', '1m'], giveUpAfter: '1h' })],
    });
    payment.on('payment.succeeded', (event) => {
      succeededEvents.push(event);
    });
    payment.on('payment.failed', (event) => {
      failedEvents.push(event);
    });

    mock.networkErrorNext('payment');
    const initResult = await payment.createPayment({
      ...mockPaymentRequest,
      conversationId: 'ORDER-203',
    });

    const getPaymentSpy = vi.spyOn(mock, 'getPayment');
    getPaymentSpy.mockRejectedValueOnce(new Error('request timed out'));

    vi.advanceTimersByTime(11_000);
    const summary = await payment.pending.resolve();

    expect(summary.succeeded).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.stillPending).toBe(1);
    expect(succeededEvents.length).toBe(0);
    expect(failedEvents.length).toBe(0);

    const remaining = await payment.pending.list();
    expect(remaining.length).toBe(1);
    expect(remaining[0].attempts).toBe(1);
    expect(remaining[0].lastError).toBe('request timed out');

    // The retry is a read-only status query, never a new payment
    vi.advanceTimersByTime(61_000);
    const retry = await payment.pending.resolve();
    expect(retry.succeeded).toBe(1);
    expect(getPaymentSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps amounts as strings when the provider confirms success', async () => {
    const mock = new MockProvider();
    const succeededEvents: PaymentEvent[] = [];

    const payment = betterPayment({
      providers: { mock },
      plugins: [pendingResolver({ schedule: ['10s'], giveUpAfter: '1h' })],
    });
    payment.on('payment.succeeded', (event) => {
      succeededEvents.push(event);
    });

    mock.networkErrorNext('payment');
    const initResult = await payment.createPayment({
      ...mockPaymentRequest,
      conversationId: 'ORDER-204',
    });

    // paidPrice as a number is not an authoritative amount: fall back to the
    // string stored at capture time; a string currency is taken from the result
    vi.spyOn(mock, 'getPayment').mockResolvedValueOnce({
      status: PaymentStatus.SUCCESS,
      paymentId: initResult.paymentId,
      paidPrice: 1.2,
      currency: 'TRY',
    } as unknown as PaymentResponse);

    vi.advanceTimersByTime(11_000);
    const summary = await payment.pending.resolve();

    expect(summary.succeeded).toBe(1);
    expect(succeededEvents.length).toBe(1);
    expect(succeededEvents[0].amount).toBe('1.2');
    expect(typeof succeededEvents[0].amount).toBe('string');
    expect(succeededEvents[0].currency).toBe('TRY');
  });
});
