import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  betterPayment,
  Parampos,
  PaymentStatus,
  ProviderType,
  type BetterPaymentRequest,
  type CheckoutRequest,
  type PaymentEvent,
} from '../../../src';
import { MockProvider, MOCK_CARDS } from '../../../src/testing';
import { mockBasketItems, mockBuyer, mockShippingAddress } from '../../fixtures/payment-data';

const order: CheckoutRequest = {
  price: '100.00',
  paidPrice: '100.00',
  currency: 'TRY',
  basketId: 'B1',
  buyer: mockBuyer,
  shippingAddress: mockShippingAddress,
  billingAddress: mockShippingAddress,
  basketItems: [{ ...mockBasketItems[0], price: '100.00' }],
  conversationId: 'ORDER-1',
  // A successful-looking return URL must never be treated as a payment result
  returnUrl: 'https://shop.example/orders/ORDER-1?status=success',
};

const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => {
    throw new Error('network access in a checkout test');
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function setup() {
  const mock = new MockProvider();
  const events: PaymentEvent[] = [];
  const payment = betterPayment({
    providers: { [ProviderType.MOCK]: mock },
    handler: { allowedActions: 'all', authorize: () => true, exposeRawResponse: true },
  });
  payment.on('*', (event) => {
    events.push(event);
  });
  const call = (method: string, path: string, body?: unknown) =>
    payment.handler.handle({
      method,
      url: `/api/pay/mock/${path}`,
      headers: { 'content-type': 'application/json' },
      body,
    } as BetterPaymentRequest);
  return { mock, payment, events, call };
}

describe('createCheckout()', () => {
  it('returns a hosted page with a token and no card data', async () => {
    const { payment } = setup();
    const checkout = await payment.createCheckout(order);

    expect(checkout.status).toBe(PaymentStatus.PENDING);
    expect(checkout.token).toBe(checkout.paymentId);
    expect(checkout.redirectUrl).toContain(checkout.token);
    expect(checkout.iframeUrl).toBe(checkout.redirectUrl);
    const json = JSON.stringify(checkout);
    expect(json).not.toMatch(/4242424242424242|cardNumber|cvv|cvc/i);
  });

  it('stays pending until a verified callback, whatever the return URL says', async () => {
    const { payment, events } = setup();
    const checkout = await payment.createCheckout(order);

    const before = await payment.getCheckoutResult(checkout.token!);
    expect(before.status).toBe(PaymentStatus.PENDING);
    expect(events.some((event) => event.type === 'payment.succeeded')).toBe(false);
  });

  it('is confirmed by the signed callback through the handler', async () => {
    const { mock, payment, events, call } = setup();
    const checkout = await payment.createCheckout(order);

    const callback = await mock.completeCheckoutPage(checkout.token!, {
      cardNumber: MOCK_CARDS.SUCCESS,
    });
    const res = await call('POST', 'callback', callback);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'success', conversationId: 'ORDER-1' });
    expect(events.map((event) => event.type)).toContain('payment.succeeded');
    expect((await payment.getCheckoutResult(checkout.token!)).status).toBe(PaymentStatus.SUCCESS);
  });

  it('ignores a forged callback', async () => {
    const { mock, payment, events, call } = setup();
    const checkout = await payment.createCheckout(order);
    const callback = await mock.completeCheckoutPage(checkout.token!, {
      cardNumber: MOCK_CARDS.SUCCESS,
    });

    const res = await call('POST', 'callback', { ...callback, signature: 'forged' });

    expect(res.body).toMatchObject({ status: 'failure', errorCode: 'INVALID_HASH' });
    expect(events.some((event) => event.type === 'payment.succeeded')).toBe(false);
    expect((await payment.getCheckoutResult(checkout.token!)).status).toBe(PaymentStatus.PENDING);
  });

  it('never exposes card data in results or events', async () => {
    const { mock, payment, events, call } = setup();
    const checkout = await payment.createCheckout(order);
    const callback = await mock.completeCheckoutPage(checkout.token!, {
      cardNumber: MOCK_CARDS.THREDS_REQUIRED,
    });

    await call('POST', 'callback', callback);
    const result = await payment.getCheckoutResult(checkout.token!);

    const serialized = JSON.stringify({ result, events });
    expect(serialized).not.toContain(MOCK_CARDS.THREDS_REQUIRED);
    expect(serialized).not.toMatch(/cardNumber|cardHolderName|"cvc"/i);
    expect(result.status).toBe(PaymentStatus.SUCCESS);
  });

  it('reports NOT_SUPPORTED for a provider without a hosted page', async () => {
    const payment = betterPayment({
      providers: {
        parampos: new Parampos({
          clientCode: '1',
          clientUsername: 'user',
          clientPassword: 'pass',
          guid: 'guid',
          baseUrl: 'https://pos.example',
        }),
      },
    });

    await expect(payment.createCheckout(order)).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    });
  });

  it('registers createCheckout and getCheckoutResult as plugin operations', async () => {
    const seen: string[] = [];
    const payment = betterPayment({
      providers: { [ProviderType.MOCK]: new MockProvider() },
      plugins: [
        {
          id: 'spy',
          hooks: {
            before: [
              {
                handler: (ctx) => {
                  seen.push(ctx.operation);
                },
              },
            ],
          },
        },
      ],
    });
    const checkout = await payment.createCheckout(order);
    await payment.getCheckoutResult(checkout.token!);

    expect(seen).toEqual(['createCheckout', 'getCheckoutResult']);
  });
});
