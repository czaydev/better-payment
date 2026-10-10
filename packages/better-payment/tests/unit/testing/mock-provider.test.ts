import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  betterPayment,
  PaymentErrorCode,
  PaymentStatus,
  ProviderType,
  createBetterPaymentClient,
  type BetterPaymentRequest,
  type PaymentRequest,
} from 'better-payment';
import { MockProvider, MOCK_CARDS } from 'better-payment/testing';
import { luhn } from '../../../src/core/validation';
import { mockPaymentRequest } from '../../fixtures/payment-data';

const order: PaymentRequest = { ...mockPaymentRequest, price: '100.00', paidPrice: '100.00' };
order.basketItems = [{ ...mockPaymentRequest.basketItems[0], price: '100.00' }];
const withCard = (cardNumber: string): PaymentRequest => ({
  ...order,
  paymentCard: { ...order.paymentCard!, cardNumber, registerCard: false },
});

// Nothing may touch the network
const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => {
    throw new Error('network access in a mock test');
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function setup(options: { onCallback?: (status: string) => void } = {}) {
  const mock = new MockProvider();
  const payment = betterPayment({
    providers: { [ProviderType.MOCK]: mock },
    handler: {
      allowedActions: 'all',
      authorize: () => true,
      exposeRawResponse: true,
      onCallback: async (result) => options.onCallback?.(result.status),
    },
  });
  const call = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ) =>
    payment.handler.handle({
      method,
      url: `/api/pay/mock/${path}`,
      headers: { 'content-type': 'application/json', ...headers },
      body,
    } as BetterPaymentRequest);
  return { mock, payment, call };
}

const formFields = (html: string) =>
  Object.fromEntries(
    [...html.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1], m[2]])
  ) as Record<string, string>;

describe('MOCK_CARDS', () => {
  it('are valid card numbers', () => {
    for (const number of Object.values(MOCK_CARDS)) expect(luhn(number)).toBe(true);
  });
});

describe('MockProvider', () => {
  it('charges a card and keeps the payment in memory', async () => {
    const { mock, payment } = setup();
    const result = await payment.use('mock').createPayment(withCard(MOCK_CARDS.SUCCESS));
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.paymentId).toBe('MOCKPAY000001');

    const fetched = await payment.use('mock').getPayment(result.paymentId!);
    expect(fetched.status).toBe(PaymentStatus.SUCCESS);
    expect(mock.getRecord(result.paymentId!)).toMatchObject({
      state: 'succeeded',
      amount: 10000,
      capturedAmount: 10000,
      cardLastFour: '4242',
    });
  });

  it('declines the magic cards with their error codes', async () => {
    const { payment } = setup();
    const declines = [
      'CARD_DECLINED',
      'INSUFFICIENT_FUNDS',
      'EXPIRED_CARD',
      'INVALID_CVC',
      'FRAUD_SUSPECTED',
      'LIMIT_EXCEEDED',
      'PROVIDER_ERROR',
    ] as const;
    for (const name of declines) {
      const result = await payment.use('mock').createPayment(withCard(MOCK_CARDS[name]));
      expect(result.status, name).toBe(PaymentStatus.FAILURE);
      expect(result.code, name).toBe(PaymentErrorCode[name]);
      expect(result.errorMessage).toBeTruthy();
      expect((await payment.use('mock').getPayment(result.paymentId!)).code).toBe(
        PaymentErrorCode[name]
      );
    }
  });

  it('validates requests like a real provider', async () => {
    const { payment } = setup();
    const result = await payment.use('mock').createPayment(withCard('4242424242424241'));
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
  });

  it('requires 3D Secure for THREEDS_REQUIRED', async () => {
    const { payment, mock } = setup();
    const direct = await payment.use('mock').createPayment(withCard(MOCK_CARDS.THREEDS_REQUIRED));
    expect(direct).toMatchObject({
      status: 'failure',
      code: 'CARD_DECLINED',
      errorCode: 'THREEDS_REQUIRED',
    });

    const init = await payment.use('mock').initThreeDSPayment({
      ...withCard(MOCK_CARDS.THREEDS_REQUIRED),
      callbackUrl: 'https://shop.test/cb',
    });
    const result = await payment
      .use('mock')
      .completeThreeDSPayment(await mock.threeDSCallback(init.paymentId!));
    expect(result.status).toBe(PaymentStatus.SUCCESS);
  });

  it('reports a lost response as PENDING while the payment went through', async () => {
    const { payment } = setup();
    const result = await payment.use('mock').createPayment(withCard(MOCK_CARDS.NETWORK_ERROR));
    expect(result).toMatchObject({
      status: 'pending',
      errorCode: 'NETWORK_ERROR',
      code: 'NETWORK_ERROR',
    });
    expect((await payment.use('mock').getPayment(result.paymentId!)).status).toBe(
      PaymentStatus.SUCCESS
    );
  });

  it('fails refunds and cancels for REFUND_FAILS', async () => {
    const { payment } = setup();
    const paid = await payment.use('mock').createPayment(withCard(MOCK_CARDS.REFUND_FAILS));
    expect(paid.status).toBe(PaymentStatus.SUCCESS);
    const refund = await payment
      .use('mock')
      .refund({ paymentId: paid.paymentId!, price: '10.00', currency: 'TRY', ip: '1.1.1.1' });
    expect(refund).toMatchObject({ status: 'failure', code: 'PROVIDER_ERROR' });
    const cancel = await payment.use('mock').cancel({ paymentId: paid.paymentId!, ip: '1.1.1.1' });
    expect(cancel).toMatchObject({ status: 'failure', code: 'PROVIDER_ERROR' });
  });

  it('refunds partially, never more than was paid, and cancels only untouched payments', async () => {
    const { payment, mock } = setup();
    const paid = await payment.use('mock').createPayment(withCard(MOCK_CARDS.SUCCESS));
    const refund = (price: string) =>
      payment
        .use('mock')
        .refund({ paymentId: paid.paymentId!, price, currency: 'TRY', ip: '1.1.1.1' });

    expect((await refund('40.00')).status).toBe(PaymentStatus.SUCCESS);
    expect((await refund('60.01')).code).toBe(PaymentErrorCode.INVALID_REQUEST);
    expect((await refund('60.00')).status).toBe(PaymentStatus.SUCCESS);
    expect(mock.getRecord(paid.paymentId!)).toMatchObject({ refundedAmount: 10000 });
    expect(mock.getRecord(paid.paymentId!)?.refunds.map((r) => r.amount)).toEqual([4000, 6000]);
    expect(
      (await payment.use('mock').cancel({ paymentId: paid.paymentId!, ip: '1.1.1.1' })).status
    ).toBe(PaymentStatus.FAILURE);

    const other = await payment.use('mock').createPayment(withCard(MOCK_CARDS.SUCCESS));
    expect(
      (await payment.use('mock').cancel({ paymentId: other.paymentId!, ip: '1.1.1.1' })).status
    ).toBe(PaymentStatus.SUCCESS);
    expect((await payment.use('mock').getPayment(other.paymentId!)).status).toBe(
      PaymentStatus.CANCELLED
    );
  });

  it('failNext and networkErrorNext override the next operation only', async () => {
    const { payment, mock } = setup();
    mock.failNext('payment', PaymentErrorCode.LIMIT_EXCEEDED).networkErrorNext('refund');

    const first = await payment.use('mock').createPayment(withCard(MOCK_CARDS.SUCCESS));
    expect(first.code).toBe(PaymentErrorCode.LIMIT_EXCEEDED);
    const second = await payment.use('mock').createPayment(withCard(MOCK_CARDS.SUCCESS));
    expect(second.status).toBe(PaymentStatus.SUCCESS);

    const refund = await payment
      .use('mock')
      .refund({ paymentId: second.paymentId!, price: '5.00', currency: 'TRY', ip: '1.1.1.1' });
    expect(refund).toMatchObject({ status: 'pending', errorCode: 'NETWORK_ERROR' });
    expect(mock.getRecord(second.paymentId!)?.refundedAmount).toBe(500);

    mock.failNext('threeDSInit');
    const init = await payment
      .use('mock')
      .initThreeDSPayment({ ...withCard(MOCK_CARDS.SUCCESS), callbackUrl: 'https://x.test' });
    expect(init).toMatchObject({ status: 'failure', code: 'CARD_DECLINED' });

    mock.reset();
    expect(mock.payments).toEqual([]);
  });

  it('pre-authorizes, captures part of the amount and voids', async () => {
    const { payment, mock } = setup();
    const auth = await payment.use('mock').authorize(withCard(MOCK_CARDS.SUCCESS));
    expect(mock.getRecord(auth.paymentId!)).toMatchObject({
      state: 'authorized',
      capturedAmount: 0,
    });
    expect(
      (
        await payment
          .use('mock')
          .capture({ paymentId: auth.paymentId!, amount: '100.01', ip: '1.1.1.1' })
      ).code
    ).toBe(PaymentErrorCode.INVALID_REQUEST);
    const captured = await payment
      .use('mock')
      .capture({ paymentId: auth.paymentId!, amount: '80.00', ip: '1.1.1.1' });
    expect(captured.status).toBe(PaymentStatus.SUCCESS);
    expect(mock.getRecord(auth.paymentId!)).toMatchObject({
      state: 'succeeded',
      capturedAmount: 8000,
    });
    expect(
      (
        await payment
          .use('mock')
          .refund({ paymentId: auth.paymentId!, price: '80.01', currency: 'TRY', ip: '1.1.1.1' })
      ).code
    ).toBe(PaymentErrorCode.INVALID_REQUEST);

    const other = await payment.use('mock').authorize(withCard(MOCK_CARDS.SUCCESS));
    expect(
      (await payment.use('mock').voidAuthorization({ paymentId: other.paymentId!, ip: '1.1.1.1' }))
        .status
    ).toBe(PaymentStatus.SUCCESS);
    expect((await payment.use('mock').getPayment(other.paymentId!)).status).toBe(
      PaymentStatus.CANCELLED
    );
  });

  it('saves cards during a payment and pays with the token, keeping the card behaviour', async () => {
    const { payment } = setup();
    const first = await payment
      .use('mock')
      .createPayment({ ...withCard(MOCK_CARDS.SUCCESS), saveCard: { alias: 'Work' } });
    const tokens = first.storedCard!;
    expect(tokens.customerToken).toBeTruthy();

    const { paymentCard: _card, ...rest } = withCard(MOCK_CARDS.SUCCESS);
    const again = await payment.use('mock').createPayment({
      ...rest,
      storedCard: { customerToken: tokens.customerToken, cardToken: tokens.cardToken! },
    });
    expect(again.status).toBe(PaymentStatus.SUCCESS);

    const declined = await payment.use('mock').saveCard({
      customerToken: tokens.customerToken,
      card: {
        cardHolderName: 'A B',
        cardNumber: MOCK_CARDS.INSUFFICIENT_FUNDS,
        expireMonth: '12',
        expireYear: '2030',
      },
    });
    const byToken = await payment.use('mock').createPayment({
      ...rest,
      storedCard: { customerToken: tokens.customerToken, cardToken: declined.card!.cardToken },
    });
    expect(byToken.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);

    const listed = await payment.use('mock').listCards({ customerToken: tokens.customerToken });
    expect(listed.cards.map((c) => [c.alias, c.lastFourDigits])).toEqual([
      ['Work', '4242'],
      [undefined, '9995'],
    ]);
    expect(JSON.stringify(listed)).not.toContain('scenario');
    expect(
      (
        await payment
          .use('mock')
          .deleteCard({ customerToken: tokens.customerToken, cardToken: tokens.cardToken! })
      ).status
    ).toBe(PaymentStatus.SUCCESS);
    const unknown = await payment.use('mock').createPayment({
      ...rest,
      storedCard: { customerToken: tokens.customerToken, cardToken: tokens.cardToken! },
    });
    expect(unknown.code).toBe(PaymentErrorCode.INVALID_REQUEST);
  });

  it('answers BIN and installment queries', async () => {
    const { payment } = setup();
    expect(await payment.use('mock').binCheck('555555')).toMatchObject({
      cardAssociation: 'MASTER_CARD',
      bankName: 'Mock Bank',
    });
    const info = await payment
      .use('mock')
      .installmentInfo({ binNumber: '424242', price: '100.00' });
    expect(
      info.installmentDetails?.[0].installmentPrices.map((p) => [p.installmentNumber, p.totalPrice])
    ).toEqual([
      [1, 100],
      [2, 102],
      [3, 103],
      [6, 105],
    ]);
  });

  it('rejects callbacks signed by another instance or tampered with', async () => {
    const { payment, mock } = setup();
    const init = await payment
      .use('mock')
      .initThreeDSPayment({ ...withCard(MOCK_CARDS.SUCCESS), callbackUrl: 'https://x.test' });
    const genuine = await mock.threeDSCallback(init.paymentId!);
    const foreign = await new MockProvider().threeDSCallback(init.paymentId!);

    expect((await payment.use('mock').completeThreeDSPayment(foreign)).code).toBe(
      PaymentErrorCode.INVALID_HASH
    );
    const declined = await mock.threeDSCallback(init.paymentId!, { approve: false });
    expect(
      (await payment.use('mock').completeThreeDSPayment({ ...declined, mdStatus: '1' })).code
    ).toBe(PaymentErrorCode.INVALID_HASH);
    expect((await payment.use('mock').completeThreeDSPayment(genuine)).status).toBe(
      PaymentStatus.SUCCESS
    );
  });

  it('returns VALIDATION_ERROR results for invalid input instead of throwing', async () => {
    const { payment, call } = setup();
    const paid = await payment.use('mock').createPayment(withCard(MOCK_CARDS.SUCCESS));
    const refund = await payment
      .use('mock')
      .refund({ paymentId: paid.paymentId!, price: 'abc', currency: 'TRY', ip: '1.1.1.1' });
    expect(refund).toMatchObject({
      status: 'failure',
      errorCode: 'VALIDATION_ERROR',
      code: 'INVALID_REQUEST',
    });
    const capture = await payment
      .use('mock')
      .capture({ paymentId: paid.paymentId!, amount: '', ip: '1.1.1.1' });
    expect(capture.code).toBe(PaymentErrorCode.INVALID_REQUEST);

    const saved = await call('POST', 'cards/save', {});
    expect(saved.status).toBe(422);
    expect(saved.body).toMatchObject({ errorCode: 'VALIDATION_ERROR' });
  });

  it('requires a provider instance in the config', () => {
    expect(() =>
      betterPayment({
        providers: { mock: {} as never },
      })
    ).toThrow(/MockProvider/);
  });
});

describe('end-to-end through the HTTP handler (no network)', () => {
  it('checkout → 3D Secure callback → refund', async () => {
    const callbacks: string[] = [];
    const { call } = setup({ onCallback: (status) => callbacks.push(status) });

    // 1. Checkout starts 3D Secure
    const init = await call('POST', 'payment/init-3ds', {
      ...withCard(MOCK_CARDS.SUCCESS),
      callbackUrl: 'https://shop.test/api/pay/mock/payment/complete-3ds',
    });
    expect(init.status).toBe(200);
    const { paymentId, threeDSHtmlContent } = init.body as {
      paymentId: string;
      threeDSHtmlContent: string;
    };
    expect(threeDSHtmlContent).toContain(
      'action="https://shop.test/api/pay/mock/payment/complete-3ds"'
    );

    // 2. The bank page posts the signed result back (form-urlencoded, as a browser would)
    const form = new URLSearchParams(formFields(threeDSHtmlContent)).toString();
    const complete = () =>
      call('POST', 'payment/complete-3ds', form, {
        'content-type': 'application/x-www-form-urlencoded',
      });
    const result = await complete();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'success', paymentId });

    // A reload of the return page is deduplicated: onCallback runs once
    expect((await complete()).status).toBe(200);
    expect(callbacks).toEqual(['success']);

    // 3. Refund part of it, with an Idempotency-Key
    const refundBody = { paymentId, price: '25.00', currency: 'TRY', ip: '1.1.1.1' };
    const refund = await call('POST', 'refund', refundBody, { 'idempotency-key': 'refund-1' });
    expect(refund.status).toBe(200);
    const replay = await call('POST', 'refund', refundBody, { 'idempotency-key': 'refund-1' });
    expect(replay.headers['Idempotent-Replayed']).toBe('true');

    const tooMuch = await call('POST', 'refund', { ...refundBody, price: '75.01' });
    expect(tooMuch.status).toBe(422);

    // 4. The payment reflects one refund of 25.00
    const fetched = await call('GET', `payment/${paymentId}`);
    expect(fetched.body).toMatchObject({
      status: 'success',
      rawResponse: { refundedAmount: 2500, refunds: [{ amount: 2500 }] },
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('a failed 3D Secure authentication and a forged callback', async () => {
    const callbacks: string[] = [];
    const { call } = setup({ onCallback: (status) => callbacks.push(status) });
    const init = await call('POST', 'payment/init-3ds', {
      ...withCard(MOCK_CARDS.THREEDS_FAILED),
      callbackUrl: 'https://shop.test/cb',
    });
    const fields = formFields((init.body as { threeDSHtmlContent: string }).threeDSHtmlContent);
    expect(fields.mdStatus).toBe('0');

    const failed = await call('POST', 'payment/complete-3ds', fields);
    expect(failed.status).toBe(422);
    expect(failed.body).toMatchObject({ status: 'failure', code: 'THREEDS_FAILED' });

    const forged = await call('POST', 'payment/complete-3ds', {
      ...fields,
      mdStatus: '1',
      paymentId: 'MOCKPAY999999',
    });
    expect(forged.body).toMatchObject({ code: 'INVALID_HASH' });
    expect(callbacks).toEqual(['failure']);
  });

  it('works with the browser client', async () => {
    const { payment } = setup();
    const client = createBetterPaymentClient({
      baseUrl: '/api/pay',
      fetch: async (input, init) => {
        const res = await payment.handler.handle({
          method: init?.method ?? 'GET',
          url: String(input),
          headers: (init?.headers as Record<string, string>) ?? {},
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return new Response(JSON.stringify(res.body), { status: res.status });
      },
    });
    const result = await client.mock.createPayment(withCard(MOCK_CARDS.INSUFFICIENT_FUNDS));
    expect(result).toMatchObject({ status: 'failure', code: 'INSUFFICIENT_FUNDS' });
  });
});
