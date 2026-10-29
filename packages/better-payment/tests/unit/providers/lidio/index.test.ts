import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../../src/core/http';
import { PaymentErrorCode } from '../../../../src/core/error-codes';
import { betterPayment, PROVIDER_DEFAULT_URLS, ProviderType } from '../../../../src';
import { Lidio, lidio, lidioPaymentStatus } from '../../../../src/providers/lidio';
import {
  createLidioReturnHash,
  formatLidioAmount,
  formatLidioInstallment,
  getLidioCurrency,
} from '../../../../src/providers/lidio/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';
import {
  LIDIO_3D_FAILED_RETURN,
  LIDIO_3D_RETURN,
  LIDIO_BASE_URL,
  LIDIO_CONTEXT,
  LIDIO_TEST,
  lidioPayment,
  lidioRefused,
} from '../../../fixtures/lidio';

const timeout = () => new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' });
const order = { ...mockPaymentRequest, conversationId: 'ORDERLD' };

describe('Lidio utils', () => {
  it('builds the return hash as Base64(SHA-256(OrderId:MerchantKey:TotalAmount:Result:customer))', async () => {
    expect(
      await createLidioReturnHash({
        orderId: 'ORDERLD',
        merchantKey: LIDIO_TEST.merchantKey,
        totalAmount: '1.20',
        result: '3DSuccess',
        customer: 'buyer@example.com',
      })
    ).toBe(LIDIO_3D_RETURN.Hash);
  });

  it('formats amounts, currencies and installments', () => {
    expect(formatLidioAmount('1.20')).toBe(1.2);
    expect(formatLidioAmount('100')).toBe(100);
    expect(getLidioCurrency(undefined)).toBe('TRY');
    expect(getLidioCurrency('tl')).toBe('TRY');
    expect(getLidioCurrency('eur')).toBe('EUR');
    expect(() => getLidioCurrency('XXX')).toThrow(/not supported/);
    expect(formatLidioInstallment(undefined)).toBe(0);
    expect(formatLidioInstallment(1)).toBe(0);
    expect(formatLidioInstallment(6)).toBe(6);
    expect(() => formatLidioInstallment(13)).toThrow(/1 to 12/);
  });

  it('maps PaymentInquiry answers', () => {
    expect(lidioPaymentStatus(lidioPayment())).toBe(PaymentStatus.SUCCESS);
    expect(lidioPaymentStatus(lidioPayment({}, { isRefunded: true }))).toBe(PaymentStatus.SUCCESS);
    expect(lidioPaymentStatus(lidioPayment({}, { isCancelled: true }))).toBe(
      PaymentStatus.CANCELLED
    );
    expect(lidioPaymentStatus(lidioPayment({}, { isFullRefunded: true }))).toBe(
      PaymentStatus.CANCELLED
    );
    expect(lidioPaymentStatus(lidioRefused())).toBe(PaymentStatus.FAILURE);
    expect(lidioPaymentStatus({ result: 'Waiting' })).toBe(PaymentStatus.PENDING);
    expect(lidioPaymentStatus({ result: 'Pending' })).toBe(PaymentStatus.PENDING);
    expect(lidioPaymentStatus({ result: 'SystemError' })).toBe(PaymentStatus.PENDING);
    expect(lidioPaymentStatus({ result: 'InvalidParameter' })).toBe(PaymentStatus.FAILURE);
    expect(lidioPaymentStatus(undefined)).toBe(PaymentStatus.FAILURE);
  });
});

describe('Lidio provider', () => {
  let provider: Lidio;
  let post: ReturnType<typeof vi.fn>;

  const create = (overrides: Partial<ConstructorParameters<typeof Lidio>[0]> = {}) => {
    const instance = new Lidio({ ...LIDIO_TEST, baseUrl: LIDIO_BASE_URL, ...overrides });
    (instance as any).client.post = post;
    return instance;
  };
  const sent = (call = 0) => JSON.parse(post.mock.calls[call][1]);
  const expectNoIds = (result: { paymentId?: string; conversationId?: string }) => {
    expect(result.paymentId).toBeUndefined();
    expect(result.conversationId).toBeUndefined();
  };

  beforeEach(() => {
    post = vi.fn();
    provider = create();
  });

  it.each(['merchantCode', 'apiKey', 'merchantKey'])('requires %s', (field) => {
    expect(() => create({ [field]: '' })).toThrow(field);
  });

  it('sends the API key and merchant code headers', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: 'Success', bankCode: '062', cardType: 'Visa' }), {
          headers: { 'content-type': 'application/json' },
        })
    );
    const instance = new Lidio({ ...LIDIO_TEST, baseUrl: LIDIO_BASE_URL, fetch });
    await instance.binCheck('428220');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${LIDIO_BASE_URL}/GetBankOfBINNumber`);
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('MxS2S TESTAPIKEY');
    expect(headers.get('merchantcode')).toBe('MERCHANT1');
  });

  describe('createPayment', () => {
    it('sends a NewCard sale with the order, customer and card', async () => {
      post.mockResolvedValue({ data: lidioPayment() });

      const result = await provider.createPayment(order);

      expect(post.mock.calls[0][0]).toBe('/ProcessPayment');
      const body = sent();
      expect(body).toMatchObject({
        orderId: 'ORDERLD',
        totalAmount: 1.2,
        currency: 'TRY',
        paymentInstrument: 'NewCard',
        customerInfo: { email: 'john.doe@example.com', customerId: 'BY789' },
        clientIp: '85.34.78.112',
      });
      expect(body.paymentInstrumentInfo.newCard).toMatchObject({
        processType: 'sales',
        use3DSecure: false,
        installmentCount: 0,
        loyaltyPointUsage: 'None',
        cardInfo: { lastMonth: 12, lastYear: 2030 },
      });
      expect(post.mock.calls[0][2]).toMatchObject({ retryable: false });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDERLD');
    });

    it('fails with the bank code on a refusal', async () => {
      post.mockResolvedValue({ data: lidioRefused('51') });
      const result = await provider.createPayment(order);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('51');
      expect(result.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
      expectNoIds(result);
    });

    it("fails with Lidio's code when the bank was not reached", async () => {
      post.mockResolvedValue({
        data: { result: 'InvalidParameter', resultDetail: 'InvalidCVV', resultMessage: 'CVV' },
      });
      const result = await provider.createPayment(order);
      expect(result.errorCode).toBe('InvalidCVV');
      expect(result.code).toBe(PaymentErrorCode.INVALID_CVC);
    });

    it('fails on an empty answer (rejected credentials)', async () => {
      post.mockResolvedValue({ data: '' });
      const result = await provider.createPayment(order);
      expect(result.status).toBe(PaymentStatus.FAILURE);
    });

    it('returns pending with the order id on SystemError or a timeout', async () => {
      post.mockResolvedValue({ data: { result: 'SystemError', resultDetail: 'SystemError' } });
      const unknown = await provider.createPayment(order);
      expect(unknown.status).toBe(PaymentStatus.PENDING);
      expect(unknown.paymentId).toBe('ORDERLD');

      post.mockRejectedValue(timeout());
      const timedOut = await provider.createPayment(order);
      expect(timedOut.status).toBe(PaymentStatus.PENDING);
      expect(timedOut.paymentId).toBe('ORDERLD');
    });

    it('authorize() sends a preauth', async () => {
      post.mockResolvedValue({ data: lidioPayment() });
      await provider.authorize({ ...order, installment: 3 });
      expect(sent().paymentInstrumentInfo.newCard).toMatchObject({
        processType: 'preauth',
        installmentCount: 3,
      });
    });
  });

  describe('initThreeDSPayment', () => {
    const request = {
      ...mockThreeDSPaymentRequest,
      conversationId: 'ORDERLD',
      callbackUrl: 'https://example.com/lidio/return',
    };

    it("returns Lidio's redirect form", async () => {
      post.mockResolvedValue({
        data: {
          result: 'RedirectFormCreated',
          resultDetail: 'ThreeDSRedirectFormCreated',
          redirectForm: '<form action="https://test.lidio.com/3d"></form>',
        },
      });

      const result = await provider.initThreeDSPayment(request);

      expect(sent()).toMatchObject({ returnUrl: 'https://example.com/lidio/return' });
      expect(sent().paymentInstrumentInfo.newCard.use3DSecure).toBe(true);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.threeDSHtmlContent).toContain('test.lidio.com/3d');
      expect(result.paymentId).toBe('ORDERLD');
    });

    it('fails when Lidio refuses the request', async () => {
      post.mockResolvedValue({
        data: { result: 'InvalidParameter', resultDetail: 'InvalidReturnURL', resultMessage: 'x' },
      });
      const result = await provider.initThreeDSPayment(request);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('InvalidReturnURL');
    });

    it('needs a callbackUrl', async () => {
      const result = await provider.initThreeDSPayment({ ...request, callbackUrl: '' });
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('completeThreeDSPayment', () => {
    it('checks the hash, then finishes the payment for your order and amount', async () => {
      post.mockResolvedValue({ data: lidioPayment() });

      const result = await provider.completeThreeDSPayment(LIDIO_3D_RETURN, LIDIO_CONTEXT);

      expect(post.mock.calls[0][0]).toBe('/FinishPaymentProcess');
      expect(sent()).toEqual({
        orderId: 'ORDERLD',
        totalAmount: 1.2,
        currency: 'TRY',
        systemTransId: 'SYS123',
        paymentInstrument: 'NewCard',
        paymentInstrumentInfo: { newCard: { posAccount: { id: 0 } } },
      });
      expect(post.mock.calls[0][2]).toMatchObject({ retryable: false });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDERLD');
      expect(result.conversationId).toBe('ORDERLD');
    });

    it('needs the order from your records', async () => {
      for (const context of [
        {},
        { ...LIDIO_CONTEXT, orderId: undefined },
        { ...LIDIO_CONTEXT, amount: undefined },
        { ...LIDIO_CONTEXT, customer: undefined },
      ]) {
        const result = await provider.completeThreeDSPayment(LIDIO_3D_RETURN, context);
        expect(result.errorCode).toBe('VALIDATION_ERROR');
        expectNoIds(result);
      }
      expect(post).not.toHaveBeenCalled();
    });

    it.each([
      ['a changed amount', { TotalAmount: '0.01' }],
      ['another order', { OrderId: 'OTHER' }],
      ['a changed result', { Result: '3DFailed' }],
      ['no hash', { Hash: undefined }],
    ])('rejects a return with %s as INVALID_HASH', async (_case, change) => {
      const result = await provider.completeThreeDSPayment(
        { ...LIDIO_3D_RETURN, ...change },
        LIDIO_CONTEXT
      );
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('rejects a signed return for another order than yours', async () => {
      const result = await provider.completeThreeDSPayment(LIDIO_3D_RETURN, {
        ...LIDIO_CONTEXT,
        orderId: 'ORDER2',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
    });

    it('rejects a signed return whose amount differs from yours', async () => {
      const result = await provider.completeThreeDSPayment(LIDIO_3D_RETURN, {
        ...LIDIO_CONTEXT,
        amount: '100.00',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('rejects a hash signed for another customer', async () => {
      const result = await provider.completeThreeDSPayment(LIDIO_3D_RETURN, {
        ...LIDIO_CONTEXT,
        customer: 'other@example.com',
      });
      expect(result.errorCode).toBe('INVALID_HASH');
    });

    it('fails without ids on a signed 3DFailed, without finishing', async () => {
      const result = await provider.completeThreeDSPayment(LIDIO_3D_FAILED_RETURN, LIDIO_CONTEXT);
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.code).toBe(PaymentErrorCode.THREEDS_FAILED);
      expectNoIds(result);
    });

    it('fails without ids when the bank refuses', async () => {
      post.mockResolvedValue({ data: lidioRefused('05', 'Red') });
      const result = await provider.completeThreeDSPayment(LIDIO_3D_RETURN, LIDIO_CONTEXT);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('05');
      expectNoIds(result);
    });

    it('rejects a finish answer for another order', async () => {
      post.mockResolvedValue({ data: lidioPayment({}, { orderId: 'OTHER' }) });
      const result = await provider.completeThreeDSPayment(LIDIO_3D_RETURN, LIDIO_CONTEXT);
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('returns pending with your order id on a timeout or SystemError', async () => {
      post.mockRejectedValue(timeout());
      const timedOut = await provider.completeThreeDSPayment(LIDIO_3D_RETURN, LIDIO_CONTEXT);
      expect(timedOut.status).toBe(PaymentStatus.PENDING);
      expect(timedOut.paymentId).toBe('ORDERLD');

      post.mockResolvedValue({ data: { result: 'SystemError' } });
      const unknown = await provider.completeThreeDSPayment(LIDIO_3D_RETURN, LIDIO_CONTEXT);
      expect(unknown.status).toBe(PaymentStatus.PENDING);
      expect(unknown.paymentId).toBe('ORDERLD');
    });

    it('ignores order values sent with the return itself', async () => {
      const result = await provider.completeThreeDSPayment({
        ...LIDIO_3D_RETURN,
        orderId: 'ORDERLD',
        amount: '1.20',
        customer: 'buyer@example.com',
      } as never);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('capture, cancel, refund, getPayment', () => {
    it('captures with Postauth', async () => {
      post.mockResolvedValue({ data: lidioPayment() });
      const result = await provider.capture({
        paymentId: 'ORDERLD',
        amount: '1.00',
        ip: '1.2.3.4',
      });
      expect(post.mock.calls[0][0]).toBe('/Postauth');
      expect(sent()).toMatchObject({ orderId: 'ORDERLD', totalAmount: 1, currency: 'TRY' });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('cancels and releases with Cancel', async () => {
      post.mockResolvedValue({ data: lidioPayment() });
      const cancelled = await provider.cancel({ paymentId: 'ORDERLD', ip: '1.2.3.4' });
      expect(post.mock.calls[0][0]).toBe('/Cancel');
      expect(sent()).toMatchObject({ orderId: 'ORDERLD', paymentInstrument: 'NewCard' });
      expect(cancelled.status).toBe(PaymentStatus.SUCCESS);

      post.mockResolvedValue({ data: lidioRefused('12') });
      const refused = await provider.voidAuthorization({ paymentId: 'ORDERLD', ip: '1.2.3.4' });
      expect(refused.status).toBe(PaymentStatus.FAILURE);
      expect(refused.errorCode).toBe('12');
    });

    it('refunds an amount; DuplicateRequest counts as done', async () => {
      post.mockResolvedValue({ data: lidioPayment({}, { systemTransId: 'RF1' }) });
      const refunded = await provider.refund({
        paymentId: 'ORDERLD',
        price: '0.50',
        currency: 'TRY',
        ip: '1.2.3.4',
      });
      expect(post.mock.calls[0][0]).toBe('/Refund');
      expect(sent()).toMatchObject({ orderId: 'ORDERLD', totalAmount: 0.5, currency: 'TRY' });
      expect(refunded.status).toBe(PaymentStatus.SUCCESS);
      expect(refunded.refundId).toBe('RF1');

      post.mockResolvedValue({ data: { result: 'DuplicateRequest' } });
      const again = await provider.refund({
        paymentId: 'ORDERLD',
        price: '0.50',
        currency: 'TRY',
        ip: '1.2.3.4',
      });
      expect(again.status).toBe(PaymentStatus.SUCCESS);
    });

    it('reads the status of a sale with PaymentInquiry', async () => {
      post.mockResolvedValue({ data: lidioPayment({}, { isCancelled: true }) });
      const result = await provider.getPayment('ORDERLD');
      expect(post.mock.calls[0][0]).toBe('/PaymentInquiry');
      expect(sent()).toEqual({
        orderId: 'ORDERLD',
        paymentInstrument: 'NewCard',
        paymentInquiryInstrumentInfo: { card: { processType: 'sales' } },
      });
      expect(post.mock.calls[0][2]).toMatchObject({ retryable: true });
      expect(result.status).toBe(PaymentStatus.CANCELLED);
      expect(result.paymentId).toBe('ORDERLD');
    });
  });

  describe('BIN and installments', () => {
    it('maps GetBankOfBINNumber', async () => {
      post.mockResolvedValue({
        data: {
          result: 'Success',
          bankCode: '0062',
          cardType: 'Mastercard',
          isDebitCard: false,
          cardProgramName: 'Bonus',
          isBusinessCard: true,
        },
      });
      const result = await provider.binCheck('54960412');
      expect(sent()).toEqual({ bin: '549604' });
      expect(result).toMatchObject({
        cardType: 'CREDIT_CARD',
        cardAssociation: 'MASTER_CARD',
        cardFamily: 'Bonus',
        bankCode: 62,
        commercial: true,
      });
    });

    it('throws when the BIN is unknown', async () => {
      post.mockResolvedValue({ data: { result: 'NotFound' } });
      await expect(provider.binCheck('999999')).rejects.toThrow(/NotFound/);
    });

    it('lists the options of the POS for the BIN', async () => {
      post.mockResolvedValue({
        data: {
          result: 'Success',
          posList: [
            {
              posId: 7,
              posBankCode: '0062',
              posBankName: 'Garanti BBVA',
              installmentOptionList: [
                { installmentCount: 0, installmentAppliesTo: 'AllCards', interestRateToUser: 0 },
                {
                  installmentCount: 3,
                  installmentAppliesTo: 'AllCards',
                  interestRateToUser: 4.5,
                  totalAmountWithInterest: 104.5,
                },
                { installmentCount: 6, installmentAppliesTo: 'BusinessCards' },
                { installmentCount: 9, baseInstallmentMinAmount: 500 },
              ],
            },
          ],
        },
      });
      const result = await provider.installmentInfo({ binNumber: '549604', price: '100.00' });
      expect(sent()).toEqual({ bin: '549604', amount: 100 });
      const details = result.installmentDetails![0];
      expect(details).toMatchObject({ bankName: 'Garanti BBVA', bankCode: 62 });
      expect(details.installmentPrices).toEqual([
        { installmentNumber: 1, totalPrice: 100, installmentPrice: 100, commissionRate: 0 },
        { installmentNumber: 3, totalPrice: 104.5, installmentPrice: 34.83, commissionRate: 4.5 },
      ]);
    });
  });

  describe('lidio()', () => {
    it('uses the test host in sandbox mode', () => {
      expect(PROVIDER_DEFAULT_URLS[ProviderType.LIDIO]).toEqual({
        sandbox: 'https://test.lidio.com/api',
        production: 'https://api.lidio.com',
      });
      const payment = betterPayment({ mode: 'sandbox', providers: { lidio: lidio(LIDIO_TEST) } });
      expect((payment.use('lidio') as any).config.baseUrl).toBe('https://test.lidio.com/api');
    });
  });
});
