import { describe, it, expect, vi } from 'vitest';
import { betterPayment, definePlugin } from '../../src';
import { MockProvider, MOCK_CARDS } from '../../src/testing';
import { Garanti } from '../../src/providers/garanti';
import { PayTR } from '../../src/providers/paytr';
import { PaymentErrorCode } from '../../src/core/error-codes';
import { PaymentStatus } from '../../src/types';
import type {
  PaymentEvent,
  PaymentProviderConfig,
  VerifyCardInitResponse,
  VerifyCardRequest,
  VerifyCardResult,
} from '../../src';
import { mockBuyer } from '../fixtures/payment-data';

const card = {
  cardHolderName: 'John Doe',
  cardNumber: MOCK_CARDS.SUCCESS,
  expireMonth: '12',
  expireYear: '2030',
  cvc: '123',
};

const request: VerifyCardRequest = {
  paymentCard: card,
  buyer: mockBuyer,
  callbackUrl: 'https://example.com/verify',
};

function setup(options: { verifyCard?: PaymentProviderConfig['verifyCard'] } = {}) {
  // MockProvider is passed as an instance, so its own config carries verifyCard;
  // the library-level option is what built-in provider factories merge in.
  const mock = new MockProvider(options.verifyCard ? { verifyCard: options.verifyCard } : {});
  const payment = betterPayment({ providers: { mock } });
  const voidSpy = vi.spyOn(mock, 'voidAuthorization');
  const events: PaymentEvent[] = [];
  payment.on('*', (event) => {
    events.push(event);
  });
  return { mock, payment, voidSpy, events };
}

function types(events: PaymentEvent[]): string[] {
  return events.map((event) => event.type);
}

function post(url: string, body: unknown) {
  return {
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json' },
    body,
  };
}

function callbackRequest(callback: Record<string, string>) {
  return {
    method: 'POST',
    url: '/api/pay/mock/payment/complete-3ds',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(callback).toString(),
  };
}

describe('verifyCard', () => {
  it('starts a 3D Secure pre-authorization for the configured amount', async () => {
    const { mock, payment } = setup();

    const init = await payment.verifyCard(request);

    expect(init).toMatchObject({
      status: PaymentStatus.PENDING,
      verification: 'card',
      amount: '1.00',
      currency: 'TRY',
    });
    expect(init.threeDSHtmlContent).toContain('<form');
    expect(mock.getRecord(init.paymentId!)).toMatchObject({
      state: 'pending_3ds',
      amount: 100,
      currency: 'TRY',
      preAuth: true,
    });
  });

  it('uses the configured amount and currency', async () => {
    const { mock, payment } = setup({ verifyCard: { amount: '0.50', currency: 'USD' } });

    const init = await payment.verifyCard(request);

    expect(init).toMatchObject({ amount: '0.50', currency: 'USD' });
    expect(mock.getRecord(init.paymentId!)).toMatchObject({ amount: 50, currency: 'USD' });
  });

  it('rejects an invalid configured amount or currency with INVALID_REQUEST', async () => {
    for (const verifyCard of [
      { amount: '0' },
      { amount: '1.234' },
      { amount: 'abc' },
      { currency: 'XYZ' },
    ]) {
      const { mock, payment } = setup({ verifyCard });
      const init = await payment.verifyCard(request);
      expect(init).toMatchObject({
        status: PaymentStatus.FAILURE,
        verification: 'card',
        code: PaymentErrorCode.INVALID_REQUEST,
      });
      expect(mock.payments).toHaveLength(0);
    }
  });

  it('rejects a request without a card or callbackUrl before calling the provider', async () => {
    const { mock, payment } = setup();

    const withoutCallback = await payment.verifyCard({ ...request, callbackUrl: '' });
    const withoutCard = await payment.verifyCard({ ...request, paymentCard: undefined } as never);

    expect(withoutCallback.code).toBe(PaymentErrorCode.INVALID_REQUEST);
    expect(withoutCard.code).toBe(PaymentErrorCode.INVALID_REQUEST);
    expect(mock.payments).toHaveLength(0);
  });

  it('auto-voids the hold after the handler callback and reports success once', async () => {
    const { mock, payment, voidSpy, events } = setup();
    const init = await payment.verifyCard(request);

    const callback = await mock.threeDSCallback(init.paymentId!);
    const res = await payment.handler.handle(callbackRequest(callback));
    const result = res.body as VerifyCardResult;

    expect(res.status).toBe(200);
    expect(result).toMatchObject({
      status: PaymentStatus.SUCCESS,
      verification: 'card',
      voided: true,
      amount: '1.00',
      currency: 'TRY',
    });
    expect(mock.getRecord(init.paymentId!)?.state).toBe('voided');
    expect(voidSpy).toHaveBeenCalledTimes(1);
    expect(voidSpy).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: init.paymentId, ip: mockBuyer.ip })
    );
    expect(types(events)).toContain('verification.succeeded');
    // A verification must not look like a completed payment
    expect(types(events)).not.toContain('payment.succeeded');
    const succeeded = events.find((event) => event.type === 'verification.succeeded');
    expect(succeeded).toMatchObject({ amount: '1.00', currency: 'TRY' });

    // A repeated delivery is answered from the handler's idempotency store
    const replay = await payment.handler.handle(callbackRequest(callback));
    expect((replay.body as VerifyCardResult).voided).toBe(true);
    expect(voidSpy).toHaveBeenCalledTimes(1);
  });

  it('auto-voids when completeThreeDSPayment() is called directly', async () => {
    const { mock, payment, voidSpy } = setup();
    const init = await payment.verifyCard(request);

    const result = (await payment.completeThreeDSPayment(
      await mock.threeDSCallback(init.paymentId!)
    )) as VerifyCardResult;

    expect(result).toMatchObject({ status: PaymentStatus.SUCCESS, voided: true });
    expect(voidSpy).toHaveBeenCalledTimes(1);
    expect(mock.getRecord(init.paymentId!)?.state).toBe('voided');
  });

  it('does not void a failed verification (no hold exists)', async () => {
    const { mock, payment, voidSpy, events } = setup();
    const init = await payment.verifyCard(request);

    const callback = await mock.threeDSCallback(init.paymentId!, { approve: false });
    const result = (await payment.completeThreeDSPayment(callback)) as VerifyCardResult;

    expect(result).toMatchObject({ status: PaymentStatus.FAILURE, verification: 'card' });
    expect(voidSpy).not.toHaveBeenCalled();
    expect(mock.getRecord(init.paymentId!)?.state).toBe('failed');
    expect(types(events)).toContain('verification.failed');
    expect(types(events)).not.toContain('verification.succeeded');
  });

  it('surfaces a failed void as voided: false plus an event', async () => {
    const { mock, payment, voidSpy, events } = setup();
    const init = await payment.verifyCard(request);
    mock.failNext('void', PaymentErrorCode.PROVIDER_ERROR);

    const result = (await payment.completeThreeDSPayment(
      await mock.threeDSCallback(init.paymentId!)
    )) as VerifyCardResult;

    // The card was verified; only the release failed
    expect(result).toMatchObject({
      status: PaymentStatus.SUCCESS,
      verification: 'card',
      voided: false,
      voidError: { status: PaymentStatus.FAILURE, code: PaymentErrorCode.PROVIDER_ERROR },
    });
    expect(voidSpy).toHaveBeenCalledTimes(1);
    expect(mock.getRecord(init.paymentId!)?.state).toBe('authorized');

    const failedVoid = events.find((event) => event.type === 'verification.void_failed');
    expect(failedVoid).toMatchObject({
      operation: 'completeThreeDSPayment',
      provider: 'mock',
      paymentId: init.paymentId,
      amount: '1.00',
      currency: 'TRY',
      code: PaymentErrorCode.PROVIDER_ERROR,
    });
    expect(types(events)).toContain('verification.succeeded');
  });

  it('returns card tokens only when saveCard is set and the provider stores the card', async () => {
    const { mock, payment, events } = setup();
    const init = await payment.verifyCard({ ...request, saveCard: true });

    const result = (await payment.completeThreeDSPayment(
      await mock.threeDSCallback(init.paymentId!)
    )) as VerifyCardResult;

    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(typeof result.cardToken).toBe('string');
    expect(typeof result.customerToken).toBe('string');
    const cards = await mock.listCards({ customerToken: result.customerToken! });
    expect(cards.cards).toHaveLength(1);
    expect(cards.cards[0].lastFourDigits).toBe('4242');

    // Never leak the PAN into results or events
    const serialized = JSON.stringify({ result, events });
    expect(serialized).not.toContain(MOCK_CARDS.SUCCESS);
  });

  it('omits cardToken when saveCard is not set', async () => {
    const { mock, payment } = setup();
    const init = await payment.verifyCard(request);
    const result = (await payment.completeThreeDSPayment(
      await mock.threeDSCallback(init.paymentId!)
    )) as VerifyCardResult;
    expect(result.cardToken).toBeUndefined();
    expect(result.customerToken).toBeUndefined();
  });

  it('runs the handler route and the plugin hooks/events', async () => {
    const mock = new MockProvider();
    const calls: string[] = [];
    const plugin = definePlugin({
      id: 'verify-spy',
      hooks: {
        before: [
          {
            handler: (ctx) => {
              calls.push(ctx.operation);
            },
          },
        ],
        after: [
          {
            handler: (ctx) => {
              calls.push(`after:${ctx.operation}`);
            },
          },
        ],
      },
      events: {
        'verification.succeeded': () => {
          calls.push('verification.succeeded');
        },
      },
    });
    const payment = betterPayment({
      providers: { mock },
      plugins: [plugin],
      verifyCard: { amount: '1.00', currency: 'TRY' },
      handler: { allowedActions: ['verify-card/init-3ds', 'payment/complete-3ds'] },
    });

    const initRes = await payment.handler.handle(post('/api/pay/mock/verify-card/init-3ds', request));
    expect(initRes.status).toBe(200);
    const init = initRes.body as VerifyCardInitResponse;
    expect(init).toMatchObject({ status: PaymentStatus.PENDING, verification: 'card' });

    const callback = await mock.threeDSCallback(init.paymentId!);
    const res = await payment.handler.handle(post('/api/pay/mock/payment/complete-3ds', callback));
    expect((res.body as VerifyCardResult).voided).toBe(true);

    expect(calls).toEqual([
      'verifyCard',
      'after:verifyCard',
      'completeThreeDSPayment',
      'after:completeThreeDSPayment',
      'voidAuthorization',
      'after:voidAuthorization',
      'verification.succeeded',
    ]);
  });

  it('throws NOT_SUPPORTED on providers without pre-authorization', async () => {
    const garanti = new Garanti({
      merchantId: '1',
      terminalId: '1',
      password: 'p',
      storeKey: 'k',
      baseUrl: 'https://sanalposprovtest.garantibbva.com.tr',
    });
    const garantiPayment = betterPayment({ providers: { garanti } });
    await expect(garantiPayment.verifyCard(request)).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
      message: expect.stringContaining('pre-authorization'),
    });

    const paytr = new PayTR({
      merchantId: '1',
      merchantKey: 'k',
      merchantSalt: 's',
      baseUrl: 'https://www.paytr.com',
    });
    const paytrPayment = betterPayment({ providers: { paytr } });
    await expect(paytrPayment.verifyCard(request)).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    });
  });

  it('reports NOT_SUPPORTED through the handler as 400', async () => {
    const paytr = new PayTR({
      merchantId: '1',
      merchantKey: 'k',
      merchantSalt: 's',
      baseUrl: 'https://www.paytr.com',
    });
    const payment = betterPayment({
      providers: { paytr },
      handler: { allowedActions: ['verify-card/init-3ds'] },
    });
    const res = await payment.handler.handle(post('/api/pay/paytr/verify-card/init-3ds', request));
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain('not supported');
  });
});
