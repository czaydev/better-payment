import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import { addBillingMonths, billingOrderId, betterPayment } from '../../src';
import { Iyzico } from '../../src/providers/iyzico';
import { PayTR } from '../../src/providers/paytr';
import { Parampos } from '../../src/providers/parampos';
import { BetterPaymentHandler } from '../../src/core/BetterPaymentHandler';
import { PaymentErrorCode } from '../../src/core/error-codes';
import { PaymentStatus, type PaymentEvent, type RecurringPaymentRequest } from '../../src/types';
import { MockProvider } from '../../src/testing';
import { fakePayment } from '../helpers/fake-payment';
import { mockPaymentRequest } from '../fixtures/payment-data';

const storedCard = { customerToken: 'USERKEY', cardToken: 'CARDTOKEN' };
const { paymentCard: _card, ...order } = mockPaymentRequest;
// PayTR's merchant_oid allows letters and digits only
const conversationId = 'sub42202602';

const recurringRequest = (
  overrides: Partial<RecurringPaymentRequest> = {}
): RecurringPaymentRequest =>
  ({
    ...order,
    storedCard,
    recurring: true,
    conversationId,
    ...overrides,
  }) as RecurringPaymentRequest;

function iyzico(data: Record<string, unknown> = { status: 'success', paymentId: '42' }) {
  const provider = new Iyzico({
    apiKey: 'k',
    secretKey: 's',
    baseUrl: 'https://sandbox-api.iyzipay.com',
  });
  const request = vi.fn().mockResolvedValue({ data });
  (provider as unknown as { client: { request: typeof request } }).client.request = request;
  return {
    provider,
    request,
    sent: (i = 0) => ({
      url: request.mock.calls[i][0].url as string,
      method: request.mock.calls[i][0].method as string,
      body: JSON.parse(request.mock.calls[i][0].data) as Record<string, any>,
    }),
  };
}

const PAYTR = { merchantId: '123456', merchantKey: 'KEY', merchantSalt: 'SALT' };
const sign = (value: string) =>
  crypto.createHmac('sha256', PAYTR.merchantKey).update(value).digest('base64');

function paytr(data: unknown = { status: 'success' }) {
  const provider = new PayTR({ ...PAYTR, baseUrl: 'https://www.paytr.com', testMode: true });
  const post = vi.fn().mockResolvedValue({ data });
  (provider as unknown as { client: { post: typeof post } }).client.post = post;
  return {
    provider,
    post,
    form: (i = 0) =>
      Object.fromEntries(new URLSearchParams(post.mock.calls[i][1] as string)) as Record<
        string,
        string
      >,
  };
}

const parampos = () =>
  new Parampos({
    clientCode: '1',
    clientUsername: 'u',
    clientPassword: 'p',
    guid: 'g',
    baseUrl: 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx',
  });

describe('chargeStoredCard on iyzico', () => {
  it('sends the stored card tokens with paymentGroup SUBSCRIPTION and no card data', async () => {
    const { provider, request, sent } = iyzico();
    const payment = betterPayment({ providers: { iyzico: provider }, defaultProvider: 'iyzico' });

    const result = await payment.chargeStoredCard(recurringRequest());

    expect(result).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: '42' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(sent()).toMatchObject({
      url: '/payment/auth',
      method: 'POST',
      body: {
        paymentGroup: 'SUBSCRIPTION',
        paymentCard: { cardUserKey: 'USERKEY', cardToken: 'CARDTOKEN' },
        conversationId,
      },
    });
    const body = sent().body;
    expect(body.paymentCard.cardNumber).toBeUndefined();
    expect(body.paymentCard.cvc).toBeUndefined();
  });

  it('keeps a stored-card payment without `recurring` cardholder-initiated', async () => {
    const { provider, sent } = iyzico();
    const result = await provider.createPayment({ ...order, storedCard });
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(sent().body.paymentGroup).toBe('PRODUCT');
  });

  it('rejects a created recurring plan without a stable conversationId, without calling iyzico', async () => {
    const { provider, request } = iyzico();
    const payment = betterPayment({ providers: { iyzico: provider }, defaultProvider: 'iyzico' });
    const { conversationId: _omit, ...withoutId } = recurringRequest() as any;

    await expect(payment.chargeStoredCard(withoutId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects card data in a recurring request', async () => {
    const { provider, request } = iyzico();
    const payment = betterPayment({ providers: { iyzico: provider }, defaultProvider: 'iyzico' });
    const withCard = {
      ...(recurringRequest() as any),
      paymentCard: mockPaymentRequest.paymentCard,
    };

    await expect(payment.chargeStoredCard(withCard)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('leaves a timeout pending with NETWORK_ERROR and never charges twice', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const provider = new Iyzico({
      apiKey: 'k',
      secretKey: 's',
      baseUrl: 'https://sandbox-api.iyzipay.com',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const payment = betterPayment({ providers: { iyzico: provider }, defaultProvider: 'iyzico' });
    const events: PaymentEvent[] = [];
    payment.on('payment.pending', (event) => void events.push(event));

    const result = await payment.chargeStoredCard(recurringRequest());

    expect(result).toMatchObject({
      status: PaymentStatus.PENDING,
      errorCode: 'NETWORK_ERROR',
      code: PaymentErrorCode.NETWORK_ERROR,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ operation: 'chargeStoredCard', type: 'payment.pending' });
  });

  it('emits payment.succeeded without card data in the request', async () => {
    const { provider } = iyzico();
    const payment = betterPayment({ providers: { iyzico: provider }, defaultProvider: 'iyzico' });
    const events: PaymentEvent[] = [];
    payment.on('payment.succeeded', (event) => void events.push(event));

    await payment.chargeStoredCard(recurringRequest());

    expect(events).toHaveLength(1);
    expect(events[0].request).toMatchObject({
      conversationId,
      storedCard: { customerToken: 'USERKEY', cardToken: 'CARDTOKEN' },
    });
    expect(JSON.stringify(events[0].request)).not.toContain('paymentCard');
    expect(JSON.stringify(events[0].request)).not.toContain('cardNumber');
  });
});

describe('chargeStoredCard on PayTR', () => {
  it('sends recurring_payment=1 with non_3d=1 and leaves it out of paytr_token', async () => {
    const { provider, form } = paytr();
    const payment = betterPayment({ providers: { paytr: provider }, defaultProvider: 'paytr' });

    const result = await payment.chargeStoredCard(
      recurringRequest({ storedCard: { ...storedCard, cvc: '987' } })
    );

    expect(result.status).toBe(PaymentStatus.SUCCESS);
    const sent = form();
    expect(sent).toMatchObject({
      non_3d: '1',
      recurring_payment: '1',
      utoken: 'USERKEY',
      ctoken: 'CARDTOKEN',
      require_cvv: '1',
      cvv: '987',
      merchant_oid: conversationId,
    });
    expect(sent.card_number).toBeUndefined();

    const expectedToken = sign(
      [
        sent.merchant_id,
        sent.user_ip,
        sent.merchant_oid,
        sent.email,
        sent.payment_amount,
        sent.payment_type,
        sent.installment_count,
        sent.currency,
        sent.test_mode,
        sent.non_3d,
      ].join('') + PAYTR.merchantSalt
    );
    expect(sent.paytr_token).toBe(expectedToken);
  });

  it('does not send recurring_payment without the flag', async () => {
    const { provider, form } = paytr();
    await provider.createPayment({ ...order, storedCard });
    expect(form().recurring_payment).toBeUndefined();
  });

  it('removes the stored card CVC from the event request', async () => {
    const { provider } = paytr();
    const payment = betterPayment({ providers: { paytr: provider }, defaultProvider: 'paytr' });
    const events: PaymentEvent[] = [];
    payment.on('payment.succeeded', (event) => void events.push(event));

    await payment.chargeStoredCard(recurringRequest({ storedCard: { ...storedCard, cvc: '987' } }));

    const request = JSON.stringify(events[0].request);
    expect(request).toContain('USERKEY');
    expect(request).not.toContain('987');
    expect(request).not.toContain('cvc');
    expect(request).not.toContain('5528790000000008');
  });
});

describe('providers without recurring stored-card support', () => {
  it('throws NOT_SUPPORTED before any request reaches the bank', async () => {
    const provider = parampos();
    const post = vi.fn();
    (provider as unknown as { client: { post: typeof post } }).client.post = post;
    const payment = betterPayment({
      providers: { parampos: provider },
      defaultProvider: 'parampos',
    });

    await expect(payment.chargeStoredCard(recurringRequest())).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    });
    expect(provider.capabilities).toEqual({ storedCard: false, recurring: false });
    expect(post).not.toHaveBeenCalled();
  });

  it('a direct payment with recurring: true is rejected by validation, not guessed', async () => {
    const provider = parampos();
    const post = vi.fn();
    (provider as unknown as { client: { post: typeof post } }).client.post = post;

    const result = await provider.createPayment(recurringRequest());

    expect(result).toMatchObject({ status: PaymentStatus.FAILURE });
    expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
    expect(result.errorMessage).toContain('recurring');
    expect(post).not.toHaveBeenCalled();
  });

  it('the HTTP handler answers 400', async () => {
    const provider = parampos();
    (provider as unknown as { client: { post: ReturnType<typeof vi.fn> } }).client.post = vi.fn();
    const payment = fakePayment(provider);
    const handler = new BetterPaymentHandler(payment, {
      allowedActions: ['recurring/charge'],
      authorize: () => true,
    });

    const response = await handler.handle({
      method: 'POST',
      url: '/api/pay/parampos/recurring/charge',
      headers: { 'content-type': 'application/json' },
      body: recurringRequest(),
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('not supported');
  });
});

describe('idempotent retries', () => {
  it('the handler charges once for a repeated Idempotency-Key', async () => {
    const provider: Record<string, any> = {
      chargeStoredCard: vi.fn().mockResolvedValue({ status: 'success', paymentId: 'P1' }),
    };
    const payment = fakePayment(provider);
    expect(
      () =>
        new BetterPaymentHandler(payment, {
          allowedActions: ['recurring/charge'],
        })
    ).toThrow(/authorize/);

    const handler = new BetterPaymentHandler(payment, {
      allowedActions: ['recurring/charge'],
      authorize: () => true,
    });
    const call = () =>
      handler.handle({
        method: 'POST',
        url: '/api/pay/iyzico/recurring/charge',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': conversationId },
        body: recurringRequest(),
      });

    const first = await call();
    const retry = await call();
    const different = await handler.handle({
      method: 'POST',
      url: '/api/pay/iyzico/recurring/charge',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': conversationId },
      body: { ...recurringRequest(), price: '2' },
    });

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.headers['Idempotent-Replayed']).toBe('true');
    expect(different.status).toBe(422);
    expect(provider.chargeStoredCard).toHaveBeenCalledTimes(1);
  });

  it('reuses the same billing order id for retries of one period', () => {
    const period = new Date(Date.UTC(2026, 1, 1));
    expect(billingOrderId('sub42', period)).toBe('sub42202602');
    expect(billingOrderId('sub42', new Date(Date.UTC(2026, 1, 27)))).toBe('sub42202602');
    expect(billingOrderId('sub42', new Date(Date.UTC(2026, 2, 1)))).toBe('sub42202603');
    expect(() => billingOrderId('sub 42', period)).toThrow(/alphanumeric/);
    expect(() => billingOrderId('sub-42', period)).toThrow(/alphanumeric/);
  });
});

describe('billing periods', () => {
  it('clamps to the end of shorter months without mutating the input', () => {
    const january31 = new Date(Date.UTC(2026, 0, 31, 15, 30));
    expect(addBillingMonths(january31, 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(addBillingMonths(january31, 0).toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(january31.toISOString()).toBe('2026-01-31T15:30:00.000Z');

    const leap = new Date(Date.UTC(2024, 0, 31));
    expect(addBillingMonths(leap, 1).toISOString()).toBe('2024-02-29T00:00:00.000Z');

    const may31 = new Date(Date.UTC(2026, 4, 31));
    expect(addBillingMonths(may31, 1).toISOString()).toBe('2026-06-30T00:00:00.000Z');
    expect(addBillingMonths(may31, 12).toISOString()).toBe('2027-05-31T00:00:00.000Z');
  });

  it('rejects invalid dates and month counts', () => {
    expect(() => addBillingMonths(new Date('nope'), 1)).toThrow(/valid Date/);
    expect(() => addBillingMonths(new Date(), 1.5)).toThrow(/Invalid billing months/);
    expect(() => addBillingMonths(new Date(), -1)).toThrow(/Invalid billing months/);
  });
});

describe('MockProvider', () => {
  it('runs the recurring flow in application tests', async () => {
    const mock = new MockProvider();
    const payment = betterPayment({ providers: { mock }, defaultProvider: 'mock' });
    expect(mock.capabilities).toEqual({ storedCard: true, recurring: true });

    const saved = await payment.createPayment({ ...mockPaymentRequest, saveCard: true });
    expect(saved.storedCard?.customerToken).toBeTruthy();

    const charged = await payment.chargeStoredCard({
      ...order,
      storedCard: {
        customerToken: saved.storedCard!.customerToken,
        cardToken: saved.storedCard!.cardToken!,
      },
      recurring: true,
      conversationId,
    });

    expect(charged.status).toBe(PaymentStatus.SUCCESS);
    expect(charged.conversationId).toBe(conversationId);
  });
});
