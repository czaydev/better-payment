import { describe, it, expect, vi, afterEach } from 'vitest';
import { BetterPaymentHandler } from '../../../src/core/BetterPaymentHandler';
import { MemoryIdempotencyStore, fingerprint } from '../../../src/core/idempotency';
import { fakePayment } from '../../helpers/fake-payment';

function setup(providerOverrides: Record<string, any> = {}) {
  const provider: Record<string, any> = {
    completeThreeDSPayment: vi.fn().mockResolvedValue({ status: 'success', paymentId: 'O1' }),
    createPayment: vi.fn().mockResolvedValue({ status: 'success', paymentId: 'P1' }),
    installmentInfo: vi.fn().mockResolvedValue({ status: 'success', installmentDetails: [] }),
    ...providerOverrides,
  };
  const payment = fakePayment(provider, { enabled: true });
  return { payment, provider };
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  url,
  headers: { 'content-type': 'application/json', ...headers },
  body,
});

const notification = { merchant_oid: 'O1', status: 'success', total_amount: '100', hash: 'h' };

afterEach(() => vi.useRealTimers());

describe('callback deduplication', () => {
  it('a repeated PayTR notification calls onCallback once and answers OK both times', async () => {
    const { payment, provider } = setup();
    const onCallback = vi.fn();
    const handler = new BetterPaymentHandler(payment, { onCallback });

    const first = await handler.handle(post('/api/pay/paytr/callback', notification));
    const second = await handler.handle(post('/api/pay/paytr/callback', { ...notification }));

    expect(first).toMatchObject({ status: 200, body: 'OK' });
    expect(second).toMatchObject({ status: 200, body: 'OK' });
    expect(onCallback).toHaveBeenCalledTimes(1);
    expect(provider.completeThreeDSPayment).toHaveBeenCalledTimes(1);
  });

  it('replays browser callbacks (redirect) without finalizing the payment twice', async () => {
    const { payment, provider } = setup();
    const handler = new BetterPaymentHandler(payment, {
      callbackRedirect: (r) => `/orders/${r.paymentId}`,
    });
    const body = { orderId: 'O1', mdStatus: '1', islemGUID: 'g' };

    const first = await handler.handle(post('/api/pay/parampos/payment/complete-3ds', body));
    const second = await handler.handle(post('/api/pay/parampos/payment/complete-3ds', body));

    expect(first).toEqual(second);
    expect(second).toMatchObject({ status: 303, headers: { Location: '/orders/O1' } });
    expect(provider.completeThreeDSPayment).toHaveBeenCalledTimes(1);
  });

  it('processes different callbacks separately', async () => {
    const { payment } = setup();
    const onCallback = vi.fn();
    const handler = new BetterPaymentHandler(payment, { onCallback });

    await handler.handle(post('/api/pay/paytr/callback', notification));
    await handler.handle(post('/api/pay/paytr/callback', { ...notification, merchant_oid: 'O2' }));

    expect(onCallback).toHaveBeenCalledTimes(2);
  });

  it('retries onCallback after a failure without calling the provider again', async () => {
    const { payment, provider } = setup();
    const onCallback = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(undefined);
    const handler = new BetterPaymentHandler(payment, { onCallback });

    const first = await handler.handle(post('/api/pay/paytr/callback', notification));
    const retry = await handler.handle(post('/api/pay/paytr/callback', notification));
    const again = await handler.handle(post('/api/pay/paytr/callback', notification));

    expect(first.status).toBe(500);
    expect(retry).toMatchObject({ status: 200, body: 'OK' });
    expect(again).toMatchObject({ status: 200, body: 'OK' });
    expect(onCallback).toHaveBeenCalledTimes(2);
    expect(provider.completeThreeDSPayment).toHaveBeenCalledTimes(1);
  });

  it('does not remember forged callbacks or unknown outcomes', async () => {
    for (const errorCode of ['INVALID_HASH', 'NETWORK_ERROR']) {
      const { payment, provider } = setup({
        completeThreeDSPayment: vi.fn().mockResolvedValue({ status: 'failure', errorCode }),
      });
      const handler = new BetterPaymentHandler(payment);
      await handler.handle(post('/api/pay/iyzico/payment/complete-3ds', notification));
      await handler.handle(post('/api/pay/iyzico/payment/complete-3ds', notification));
      expect(provider.completeThreeDSPayment).toHaveBeenCalledTimes(2);
    }
  });

  it('answers 409 to a duplicate that arrives while the first is in flight', async () => {
    let release!: () => void;
    let entered!: () => void;
    // Resolves once the first request reaches the provider (it holds the key by then)
    const inFlight = new Promise<void>((resolve) => (entered = resolve));
    const { payment } = setup({
      completeThreeDSPayment: vi.fn(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ status: 'success', paymentId: 'O1' });
            entered();
          })
      ),
    });
    const handler = new BetterPaymentHandler(payment);

    const first = handler.handle(post('/api/pay/paytr/callback', notification));
    await inFlight;
    const duplicate = await handler.handle(post('/api/pay/paytr/callback', notification));
    release();

    expect(duplicate.status).toBe(409);
    expect((await first).body).toBe('OK');
  });

  it('can be turned off', async () => {
    const { payment, provider } = setup();
    const handler = new BetterPaymentHandler(payment, { idempotency: false });
    await handler.handle(post('/api/pay/paytr/callback', notification));
    await handler.handle(post('/api/pay/paytr/callback', notification));
    expect(provider.completeThreeDSPayment).toHaveBeenCalledTimes(2);
  });

  it('uses a custom store', async () => {
    const store = new MemoryIdempotencyStore();
    const setIfAbsent = vi.spyOn(store, 'setIfAbsent');
    const { payment } = setup();
    await new BetterPaymentHandler(payment, { idempotency: { store } }).handle(
      post('/api/pay/paytr/callback', notification)
    );
    expect(setIfAbsent).toHaveBeenCalledWith(
      expect.stringMatching(/^bp:callback:paytr:callback:[0-9a-f]{64}$/),
      expect.any(String),
      60
    );
  });
});

describe('Idempotency-Key requests', () => {
  const options = { allowedActions: 'all' as const, authorize: () => true };
  const order = { price: '1', paidPrice: '1' };

  it('replays the first response for a repeated key', async () => {
    const { payment, provider } = setup();
    const handler = new BetterPaymentHandler(payment, options);
    const headers = { 'Idempotency-Key': 'order-42' };

    const first = await handler.handle(post('/api/pay/iyzico/payment', order, headers));
    const second = await handler.handle(post('/api/pay/iyzico/payment', order, headers));

    expect(provider.createPayment).toHaveBeenCalledTimes(1);
    expect(second.body).toEqual(first.body);
    expect(second.headers['Idempotent-Replayed']).toBe('true');
    expect(first.headers['Idempotent-Replayed']).toBeUndefined();
  });

  it('rejects a reused key with a different body', async () => {
    const { payment } = setup();
    const handler = new BetterPaymentHandler(payment, options);
    const headers = { 'Idempotency-Key': 'order-42' };

    await handler.handle(post('/api/pay/iyzico/payment', order, headers));
    const res = await handler.handle(
      post('/api/pay/iyzico/payment', { ...order, price: '2' }, headers)
    );

    expect(res.status).toBe(422);
  });

  it('releases the key when the request fails before a result', async () => {
    const { payment, provider } = setup({
      createPayment: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({ status: 'success', paymentId: 'P1' }),
    });
    const handler = new BetterPaymentHandler(payment, options);
    const headers = { 'Idempotency-Key': 'order-42' };

    expect((await handler.handle(post('/api/pay/iyzico/payment', order, headers))).status).toBe(
      500
    );
    expect((await handler.handle(post('/api/pay/iyzico/payment', order, headers))).status).toBe(
      200
    );
    expect(provider.createPayment).toHaveBeenCalledTimes(2);
  });

  it('is ignored without a header and on read-only actions', async () => {
    const { payment, provider } = setup();
    const handler = new BetterPaymentHandler(payment, options);
    await handler.handle(post('/api/pay/iyzico/payment', order));
    await handler.handle(post('/api/pay/iyzico/payment', order));
    const q = { binNumber: '454360', price: '1' };
    const h = { 'Idempotency-Key': 'k' };
    await handler.handle(post('/api/pay/iyzico/installment', q, h));
    await handler.handle(post('/api/pay/iyzico/installment', q, h));
    expect(provider.createPayment).toHaveBeenCalledTimes(2);
    expect(provider.installmentInfo).toHaveBeenCalledTimes(2);
  });
});

describe('MemoryIdempotencyStore', () => {
  it('expires entries', async () => {
    vi.useFakeTimers();
    const store = new MemoryIdempotencyStore();
    store.set('k', 'v', 1);
    expect(store.get('k')).toBe('v');
    vi.advanceTimersByTime(1001);
    expect(store.get('k')).toBeUndefined();
    expect(store.setIfAbsent('k', 'w', 1)).toBe(true);
    expect(store.setIfAbsent('k', 'x', 1)).toBe(false);
  });

  it('evicts the oldest entries beyond maxEntries', async () => {
    const store = new MemoryIdempotencyStore(2);
    store.set('a', '1', 60);
    store.set('b', '2', 60);
    store.set('c', '3', 60);
    expect(store.get('a')).toBeUndefined();
    expect(store.get('c')).toBe('3');
  });
});

describe('fingerprint', () => {
  it('ignores object key order', async () => {
    expect(await fingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(await fingerprint({ b: { d: 3, c: 2 }, a: 1 }));
    expect(await fingerprint({ a: 1 })).not.toBe(await fingerprint({ a: 2 }));
  });
});
