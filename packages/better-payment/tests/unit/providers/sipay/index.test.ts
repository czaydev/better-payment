import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../../src/core/http';
import { PaymentErrorCode } from '../../../../src/core/error-codes';
import { betterPayment } from '../../../../src';
import { Sipay, sipay, qnbpay } from '../../../../src/providers/sipay';
import { ProviderType, PROVIDER_DEFAULT_URLS } from '../../../../src';
import { createSipayHashKey, decryptSipayHashKey } from '../../../../src/providers/sipay/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';
import {
  SIPAY_3D_HTML,
  SIPAY_3D_REJECTED_HTML,
  SIPAY_BASE_URL,
  SIPAY_PAYMENT_DECLINED,
  SIPAY_POS_RESPONSE,
  SIPAY_REFUND_RESPONSE,
  SIPAY_STATUS_NOT_FOUND,
  SIPAY_TEST,
  SIPAY_TOKEN_RESPONSE,
  SIPAY_UNAUTHENTICATED,
  sipayCallback,
  sipayPaymentResponse,
  sipayStatusResponse,
} from '../../../fixtures/sipay';

const SECRET = SIPAY_TEST.appSecret;
const MERCHANT_KEY = SIPAY_TEST.merchantKey;

/** A callback signed like Sipay signs it: status|total|invoice_id|order_id|currency */
async function signedCallback(
  fields: { status?: string; total?: string; invoiceId?: string; orderId?: string } = {},
  overrides: Record<string, string> = {}
) {
  const invoiceId = fields.invoiceId ?? 'ORDER3D';
  const orderId = fields.orderId ?? 'VP17917145548423635';
  const hash_key = await createSipayHashKey(
    [fields.status ?? '1', fields.total ?? '1.20', invoiceId, orderId, 'TRY'],
    SECRET
  );
  return sipayCallback({ invoice_id: invoiceId, order_id: orderId, hash_key, ...overrides });
}

describe('Sipay provider', () => {
  let provider: Sipay;
  let post: ReturnType<typeof vi.fn>;
  /** Responses by endpoint; arrays are consumed in order */
  let responses: Record<string, unknown>;

  beforeEach(() => {
    provider = new Sipay({ ...SIPAY_TEST, baseUrl: SIPAY_BASE_URL });
    responses = {};
    post = vi.fn(async (url: string) => {
      if (url === '/ccpayment/api/token' && !(url in responses)) {
        return { data: SIPAY_TOKEN_RESPONSE, status: 200 };
      }
      const value = responses[url];
      const next = Array.isArray(value) ? value.shift() : value;
      if (next instanceof Error) throw next;
      return { data: next, status: 200 };
    });
    (provider as any).client.post = post;
  });

  /** Calls to an endpoint other than the token endpoint */
  const calls = () => post.mock.calls.filter(([url]) => url !== '/ccpayment/api/token');
  const sent = (call = 0) => {
    const [url, data, config] = calls()[call];
    return { url: url as string, body: JSON.parse(data), config };
  };

  it.each(['appId', 'appSecret', 'merchantKey'])('requires %s', (field) => {
    expect(() => new Sipay({ ...SIPAY_TEST, baseUrl: SIPAY_BASE_URL, [field]: '' })).toThrow(field);
  });

  it('follows mode for the base URL', () => {
    const sandbox = betterPayment({ mode: 'sandbox', providers: { sipay: sipay(SIPAY_TEST) } });
    const live = betterPayment({ mode: 'production', providers: { sipay: sipay(SIPAY_TEST) } });
    expect((sandbox.use('sipay') as any).config.baseUrl).toBe('https://provisioning.sipay.com.tr');
    expect((live.use('sipay') as any).config.baseUrl).toBe('https://app.sipay.com.tr');
  });

  describe('brands (QNBpay)', () => {
    it("qnbpay() uses QNBpay's hosts and provider id", () => {
      const sandbox = betterPayment({ mode: 'sandbox', providers: { qnbpay: qnbpay(SIPAY_TEST) } });
      const live = betterPayment({ mode: 'production', providers: { qnbpay: qnbpay(SIPAY_TEST) } });
      expect((sandbox.use('qnbpay') as any).config.baseUrl).toBe('https://test.qnbpay.com.tr');
      expect((live.use('qnbpay') as any).config.baseUrl).toBe('https://portal.qnbpay.com.tr');
      expect(ProviderType.QNBPAY).toBe('qnbpay');
      expect(PROVIDER_DEFAULT_URLS[ProviderType.QNBPAY].sandbox).toBe('https://test.qnbpay.com.tr');
    });

    it("sipay({ brand: 'qnbpay' }) is the same", () => {
      const bp = betterPayment({
        mode: 'sandbox',
        providers: { pos: sipay({ ...SIPAY_TEST, brand: 'qnbpay' }) },
      });
      expect((bp.use('pos') as any).config.baseUrl).toBe('https://test.qnbpay.com.tr');
    });

    it('rejects an unknown brand', () => {
      expect(
        () => new Sipay({ ...SIPAY_TEST, baseUrl: SIPAY_BASE_URL, brand: 'nope' as any })
      ).toThrow(/Unknown Sipay brand/);
    });

    it('names the brand in its errors', async () => {
      const brand = new Sipay({
        ...SIPAY_TEST,
        baseUrl: 'https://test.qnbpay.com.tr',
        brand: 'qnbpay',
      });
      (brand as any).client.post = vi.fn(async () => ({
        data: { status_code: 30, status_description: 'Invalid credentials.' },
        status: 200,
      }));
      const result = await brand.getPayment('ORDER1');
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('30');
      expect(result.errorMessage).toMatch(/^QNBpay did not issue a token/);
    });

    it("runs the same flows on QNBpay's host", async () => {
      const brand = new Sipay({
        ...SIPAY_TEST,
        baseUrl: 'https://test.qnbpay.com.tr',
        brand: 'qnbpay',
      });
      (brand as any).client.post = post;
      const hashKey = await createSipayHashKey(
        ['1', '1.20', 'INVQ1', 'ORDQ1', 'TRY'],
        SIPAY_TEST.appSecret
      );
      const result = await brand.completeThreeDSPayment({
        invoice_id: 'INVQ1',
        order_id: 'ORDQ1',
        payment_status: '1',
        hash_key: hashKey,
      } as any);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('INVQ1');
    });
  });

  describe('token', () => {
    it('requests a token once and sends it as Bearer', async () => {
      responses['/ccpayment/api/checkstatus'] = sipayStatusResponse();
      await provider.getPayment('ORDER1');
      await provider.getPayment('ORDER1');

      const tokenCalls = post.mock.calls.filter(([url]) => url === '/ccpayment/api/token');
      expect(tokenCalls).toHaveLength(1);
      expect(JSON.parse(tokenCalls[0][1])).toEqual({
        app_id: SIPAY_TEST.appId,
        app_secret: SECRET,
        app_lang: 'tr',
      });
      expect(sent().config.headers).toEqual({ Authorization: 'Bearer test-token' });
    });

    it('renews the token once when a request is rejected as unauthenticated', async () => {
      responses['/ccpayment/api/token'] = [
        SIPAY_TOKEN_RESPONSE,
        { ...SIPAY_TOKEN_RESPONSE, data: { token: 'new-token' } },
      ];
      responses['/ccpayment/api/checkstatus'] = [SIPAY_UNAUTHENTICATED, sipayStatusResponse()];

      const result = await provider.getPayment('ORDER1');

      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(sent(1).config.headers).toEqual({ Authorization: 'Bearer new-token' });
    });

    it('reports wrong credentials as a failure', async () => {
      responses['/ccpayment/api/token'] = {
        status_code: 30,
        status_description: 'Invalid credentials',
      };

      const result = await provider.getPayment('ORDER1');

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('30');
      expect(result.code).toBe(PaymentErrorCode.PROVIDER_ERROR);
      expect(result.errorMessage).toContain('Invalid credentials');
      expect(calls()).toHaveLength(0);
    });
  });

  describe('createPayment', () => {
    it('sends a signed paySmart2D request', async () => {
      responses['/ccpayment/api/paySmart2D'] = sipayPaymentResponse();

      const result = await provider.createPayment({
        ...mockPaymentRequest,
        conversationId: 'ORDER2D',
        installment: 3,
      });

      const { url, body, config } = sent();
      expect(url).toBe('/ccpayment/api/paySmart2D');
      expect(config.retryable).toBeUndefined();
      expect(body).toMatchObject({
        cc_holder_name: 'John Doe',
        cc_no: '5528790000000008',
        expiry_month: '12',
        expiry_year: '2030',
        cvv: '123',
        currency_code: 'TRY',
        installments_number: 3,
        invoice_id: 'ORDER2D',
        name: 'John',
        surname: 'Doe',
        total: '1.20',
        merchant_key: MERCHANT_KEY,
        // paidPrice differs from the basket: one item for the whole order
        items: [{ name: 'Order ORDER2D', price: '1.20', quantity: 1 }],
        bill_email: 'john.doe@example.com',
        bill_phone: '+905350000000',
        ip: '85.34.78.112',
        transaction_type: 'Auth',
        app_lang: 'tr',
      });
      expect(body.bill_address1).toBeTruthy();
      expect(body).not.toHaveProperty('app_secret');
      expect((await decryptSipayHashKey(body.hash_key, SECRET))?.join('|')).toBe(
        `1.20|3|TRY|${MERCHANT_KEY}|ORDER2D`
      );
      expect(result).toMatchObject({
        status: PaymentStatus.SUCCESS,
        paymentId: 'ORDER2D',
        conversationId: 'ORDER2D',
      });
    });

    it('sends the basket when it adds up to paidPrice', async () => {
      responses['/ccpayment/api/paySmart2D'] = sipayPaymentResponse();
      await provider.createPayment({ ...mockPaymentRequest, paidPrice: '1' });
      expect(sent().body.items).toHaveLength(3);
    });

    it('sends sale_web_hook_key when configured', async () => {
      const custom = new Sipay({
        ...SIPAY_TEST,
        baseUrl: SIPAY_BASE_URL,
        saleWebhookKey: 'sales',
      });
      (custom as any).client.post = post;
      responses['/ccpayment/api/paySmart2D'] = sipayPaymentResponse();
      await custom.createPayment(mockPaymentRequest);
      expect(sent().body.sale_web_hook_key).toBe('sales');
    });

    it('reports a bank decline with the bank code', async () => {
      responses['/ccpayment/api/paySmart2D'] = SIPAY_PAYMENT_DECLINED;

      const result = await provider.createPayment({ ...mockPaymentRequest, conversationId: 'X' });

      expect(result).toMatchObject({
        status: PaymentStatus.FAILURE,
        paymentId: 'X',
        errorCode: '51',
        errorMessage: 'Limit yetersiz',
        code: PaymentErrorCode.INSUFFICIENT_FUNDS,
      });
    });

    it('maps Sipay status codes when the bank did not answer', async () => {
      responses['/ccpayment/api/paySmart2D'] = {
        status_code: 3,
        status_description: 'The invoice id already processed',
        data: { invoice_id: 'X', payment_status: 0, error_code: 3, error: 'already processed' },
      };

      const result = await provider.createPayment(mockPaymentRequest);

      expect(result.errorCode).toBe('3');
      expect(result.code).toBe(PaymentErrorCode.DUPLICATE_ORDER);
    });

    it('reports a 422 without data (billing information missing)', async () => {
      responses['/ccpayment/api/paySmart2D'] = {
        status_code: 422,
        status_description: 'Billing information is required',
      };

      const result = await provider.createPayment(mockPaymentRequest);

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('422');
      expect(result.errorMessage).toBe('Billing information is required');
    });

    it('validates the request before calling Sipay', async () => {
      const result = await provider.createPayment({
        ...mockPaymentRequest,
        buyer: { ...mockPaymentRequest.buyer, email: '' },
      });
      expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
      expect(post).not.toHaveBeenCalled();
    });

    it('returns pending on a timeout and does not retry the payment', async () => {
      responses['/ccpayment/api/paySmart2D'] = new HttpError('timeout', {}, { code: 'ETIMEDOUT' });

      const result = await provider.createPayment({ ...mockPaymentRequest, conversationId: 'T1' });

      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.code).toBe(PaymentErrorCode.NETWORK_ERROR);
      expect(result.paymentId).toBe('T1');
      expect(calls()).toHaveLength(1);
    });
  });

  describe('initThreeDSPayment', () => {
    it('sends paySmart3D and returns the 3D Secure page', async () => {
      responses['/ccpayment/api/paySmart3D'] = SIPAY_3D_HTML;

      const result = await provider.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        conversationId: 'ORDER3D',
        failUrl: 'https://example.com/fail',
      });

      const { url, body, config } = sent();
      expect(url).toBe('/ccpayment/api/paySmart3D');
      expect(config.responseType).toBe('text');
      expect(body).toMatchObject({
        invoice_id: 'ORDER3D',
        total: '1.20',
        return_url: 'https://example.com/callback',
        cancel_url: 'https://example.com/fail',
        response_method: 'POST',
        transaction_type: 'Auth',
      });
      expect(result).toMatchObject({
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: SIPAY_3D_HTML,
        paymentId: 'ORDER3D',
      });
    });

    it('posts failures to callbackUrl when failUrl is not given', async () => {
      responses['/ccpayment/api/paySmart3D'] = SIPAY_3D_HTML;
      await provider.initThreeDSPayment(mockThreeDSPaymentRequest);
      expect(sent().body.cancel_url).toBe('https://example.com/callback');
    });

    it('reports a rejection form as a failure', async () => {
      responses['/ccpayment/api/paySmart3D'] = SIPAY_3D_REJECTED_HTML;

      const result = await provider.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        conversationId: 'ORDER3D',
      });

      expect(result).toMatchObject({
        status: PaymentStatus.FAILURE,
        paymentId: 'ORDER3D',
        errorCode: '68',
        errorMessage: 'Invalid hash key',
        code: PaymentErrorCode.PROVIDER_ERROR,
      });
      expect(result.threeDSHtmlContent).toBeUndefined();
    });

    it('reports a JSON error as a failure', async () => {
      responses['/ccpayment/api/paySmart3D'] = JSON.stringify({
        status_code: 1049,
        status_description: 'Invalid callback URL. Please use a whitelisted domain',
      });

      const result = await provider.initThreeDSPayment(mockThreeDSPaymentRequest);

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('1049');
      expect(result.errorMessage).toContain('whitelisted');
    });

    it('reports an empty response as a failure', async () => {
      responses['/ccpayment/api/paySmart3D'] = '';
      const result = await provider.initThreeDSPayment(mockThreeDSPaymentRequest);
      expect(result.status).toBe(PaymentStatus.FAILURE);
    });

    it('initThreeDSAuthorize sends a PreAuth', async () => {
      responses['/ccpayment/api/paySmart3D'] = SIPAY_3D_HTML;
      const result = await provider.initThreeDSAuthorize(mockThreeDSPaymentRequest);
      expect(sent().body.transaction_type).toBe('PreAuth');
      expect(result.status).toBe(PaymentStatus.PENDING);
    });
  });

  describe('completeThreeDSPayment', () => {
    it('accepts a callback with a valid hash key without calling Sipay', async () => {
      const result = await provider.completeThreeDSPayment(await signedCallback());

      expect(result).toMatchObject({
        status: PaymentStatus.SUCCESS,
        paymentId: 'ORDER3D',
        conversationId: 'ORDER3D',
      });
      expect((result.rawResponse as any).verified).toEqual({
        status: '1',
        total: '1.20',
        invoiceId: 'ORDER3D',
        orderId: 'VP17917145548423635',
        currency: 'TRY',
      });
      expect(post).not.toHaveBeenCalled();
    });

    it('reports a failed payment from the signed status', async () => {
      const result = await provider.completeThreeDSPayment(
        await signedCallback(
          { status: '0' },
          {
            sipay_status: '0',
            payment_status: '0',
            status_code: '41',
            error_code: '41',
            error: 'Insufficient funds',
          }
        )
      );

      expect(result).toMatchObject({
        status: PaymentStatus.FAILURE,
        paymentId: 'ORDER3D',
        errorCode: '41',
        errorMessage: 'Insufficient funds',
        code: PaymentErrorCode.CARD_DECLINED,
      });
    });

    it('trusts the signed status, not the callback fields', async () => {
      const result = await provider.completeThreeDSPayment(
        await signedCallback({ status: '0' }, { sipay_status: '1', payment_status: '1' })
      );
      expect(result.status).toBe(PaymentStatus.FAILURE);
    });

    it('rejects a callback without a hash key', async () => {
      const result = await provider.completeThreeDSPayment(sipayCallback());
      expect(result).toMatchObject({
        status: PaymentStatus.FAILURE,
        errorCode: 'INVALID_HASH',
        code: PaymentErrorCode.INVALID_HASH,
      });
      expect(result.paymentId).toBeUndefined();
    });

    it('rejects a hash key made with another secret', async () => {
      const hash_key = await createSipayHashKey(
        ['1', '1.20', 'ORDER3D', 'VP17917145548423635', 'TRY'],
        'attacker-secret'
      );
      const result = await provider.completeThreeDSPayment(sipayCallback({ hash_key }));
      expect(result.code).toBe(PaymentErrorCode.INVALID_HASH);
      expect(result.paymentId).toBeUndefined();
    });

    it('rejects a valid hash key replayed for another invoice or order', async () => {
      const callback = await signedCallback();
      for (const changed of [{ invoice_id: 'OTHER' }, { order_id: 'VP0000' }]) {
        const result = await provider.completeThreeDSPayment({ ...callback, ...changed });
        expect(result.code).toBe(PaymentErrorCode.INVALID_HASH);
        expect(result.paymentId).toBeUndefined();
      }
    });

    it('handles a missing callback', async () => {
      const result = await provider.completeThreeDSPayment(undefined as never);
      expect(result.code).toBe(PaymentErrorCode.INVALID_HASH);
    });
  });

  describe('getPayment', () => {
    it('sends a signed checkstatus request', async () => {
      responses['/ccpayment/api/checkstatus'] = sipayStatusResponse();

      const result = await provider.getPayment('ORDER1');

      const { url, body, config } = sent();
      expect(url).toBe('/ccpayment/api/checkstatus');
      expect(config.retryable).toBe(true);
      expect(body).toMatchObject({
        merchant_key: MERCHANT_KEY,
        invoice_id: 'ORDER1',
        include_pending_status: true,
      });
      expect((await decryptSipayHashKey(body.hash_key, SECRET))?.join('|')).toBe(
        `ORDER1|${MERCHANT_KEY}`
      );
      expect(result).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'ORDER1' });
    });

    it.each([
      ['Pending', PaymentStatus.PENDING],
      ['Refunded', PaymentStatus.CANCELLED],
      ['Partial Refund', PaymentStatus.SUCCESS],
    ])('maps %s', async (transaction_status, expected) => {
      responses['/ccpayment/api/checkstatus'] = sipayStatusResponse({ transaction_status });
      expect((await provider.getPayment('ORDER1')).status).toBe(expected);
    });

    it('reports an unknown invoice id as a failure', async () => {
      responses['/ccpayment/api/checkstatus'] = SIPAY_STATUS_NOT_FOUND;

      const result = await provider.getPayment('MISSING');

      expect(result).toMatchObject({
        status: PaymentStatus.FAILURE,
        errorCode: '32',
        code: PaymentErrorCode.INVALID_REQUEST,
      });
    });

    it('reports a bank decline with the bank code', async () => {
      responses['/ccpayment/api/checkstatus'] = sipayStatusResponse({
        status_code: 41,
        transaction_status: 'Failed',
        original_bank_error_code: '51',
        original_bank_error_description: 'Limit yetersiz',
      });

      const result = await provider.getPayment('ORDER1');

      expect(result).toMatchObject({
        status: PaymentStatus.FAILURE,
        errorCode: '51',
        code: PaymentErrorCode.INSUFFICIENT_FUNDS,
      });
    });
  });

  describe('refund', () => {
    it('sends a signed refund request', async () => {
      responses['/ccpayment/api/refund'] = SIPAY_REFUND_RESPONSE;

      const result = await provider.refund({
        paymentId: 'ORDER1',
        price: '3',
        currency: 'TRY',
        ip: '85.34.78.112',
        conversationId: 'R1',
      });

      const { url, body, config } = sent();
      expect(url).toBe('/ccpayment/api/refund');
      expect(config.retryable).toBeUndefined();
      expect(body).toMatchObject({
        invoice_id: 'ORDER1',
        amount: '3.00',
        merchant_key: MERCHANT_KEY,
      });
      expect(body).not.toHaveProperty('app_secret');
      expect((await decryptSipayHashKey(body.hash_key, SECRET))?.join('|')).toBe(
        `3.00|ORDER1|${MERCHANT_KEY}`
      );
      expect(result).toMatchObject({
        status: PaymentStatus.SUCCESS,
        refundId: '602800085396',
        conversationId: 'R1',
      });
    });

    it('reports a rejected refund', async () => {
      responses['/ccpayment/api/refund'] = {
        status_code: 49,
        status_description: 'Total refund amount must not exceed the net amount',
      };

      const result = await provider.refund({
        paymentId: 'ORDER1',
        price: '30',
        currency: 'TRY',
        ip: '85.34.78.112',
      });

      expect(result).toMatchObject({
        status: PaymentStatus.FAILURE,
        errorCode: '49',
        code: PaymentErrorCode.PROVIDER_ERROR,
      });
      expect(result.refundId).toBeUndefined();
    });
  });

  describe('cancel', () => {
    it('refunds what is left of a payment', async () => {
      responses['/ccpayment/api/checkstatus'] = sipayStatusResponse({
        transaction_status: 'Partial Refund',
        transaction_amount: 10,
        total_refunded_amount: 3,
      });
      responses['/ccpayment/api/refund'] = SIPAY_REFUND_RESPONSE;

      const result = await provider.cancel({ paymentId: 'ORDER1', ip: '85.34.78.112' });

      expect(sent(1).url).toBe('/ccpayment/api/refund');
      expect(sent(1).body.amount).toBe('7.00');
      expect(result).toMatchObject({
        status: PaymentStatus.SUCCESS,
        transactionId: '602800085396',
      });
    });

    it('releases an open pre-authorization', async () => {
      responses['/ccpayment/api/checkstatus'] = sipayStatusResponse({
        transaction_status: 'Pre-Authorization',
        transaction_type: 'Pre-Authorization',
        transaction_amount: 20,
      });
      responses['/ccpayment/api/confirmPayment'] = {
        status_code: 100,
        status_description: 'The transaction has been Rejected',
        transaction_status: 'Failed',
      };

      const result = await provider.cancel({ paymentId: 'ORDER1', ip: '85.34.78.112' });

      expect(sent(1).url).toBe('/ccpayment/api/confirmPayment');
      expect(sent(1).body).toMatchObject({ invoice_id: 'ORDER1', status: 2, total: 20 });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('does not refund a payment that is already refunded', async () => {
      responses['/ccpayment/api/checkstatus'] = sipayStatusResponse({
        transaction_status: 'Refunded',
        total_refunded_amount: 10,
      });

      const result = await provider.cancel({ paymentId: 'ORDER1', ip: '85.34.78.112' });

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('NOT_CANCELLABLE');
      expect(calls()).toHaveLength(1);
    });

    it('reports an unknown invoice id', async () => {
      responses['/ccpayment/api/checkstatus'] = SIPAY_STATUS_NOT_FOUND;
      const result = await provider.cancel({ paymentId: 'MISSING', ip: '85.34.78.112' });
      expect(result).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '32' });
    });
  });

  describe('pre-authorization', () => {
    it('authorize sends a PreAuth paySmart2D', async () => {
      responses['/ccpayment/api/paySmart2D'] = sipayPaymentResponse({
        transaction_type: 'Pre-Authorization',
      });

      const result = await provider.authorize({ ...mockPaymentRequest, conversationId: 'PA1' });

      expect(sent().body.transaction_type).toBe('PreAuth');
      expect(result).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'PA1' });
    });

    it('capture confirms the amount with status 1', async () => {
      responses['/ccpayment/api/confirmPayment'] = {
        status_code: 100,
        status_description: 'The transaction has been Approved',
        transaction_status: 'Completed',
      };

      const result = await provider.capture({ paymentId: 'PA1', amount: '15', ip: '85.34.78.112' });

      const { url, body } = sent();
      expect(url).toBe('/ccpayment/api/confirmPayment');
      expect(body).toMatchObject({ invoice_id: 'PA1', status: 1, total: 15 });
      expect((await decryptSipayHashKey(body.hash_key, SECRET))?.join('|')).toBe(
        `${MERCHANT_KEY}|PA1|1`
      );
      expect(result).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'PA1' });
    });

    it('voidAuthorization releases an open pre-authorization', async () => {
      responses['/ccpayment/api/checkstatus'] = sipayStatusResponse({
        transaction_status: 'Pre-Authorization',
        transaction_amount: 20,
      });
      responses['/ccpayment/api/confirmPayment'] = { status_code: 100 };

      const result = await provider.voidAuthorization({ paymentId: 'PA1', ip: '85.34.78.112' });

      expect(sent(1).body).toMatchObject({ status: 2, total: 20 });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('voidAuthorization refuses a payment that is not a pre-authorization', async () => {
      responses['/ccpayment/api/checkstatus'] = sipayStatusResponse();
      const result = await provider.voidAuthorization({ paymentId: 'PA1', ip: '85.34.78.112' });
      expect(result.errorCode).toBe('NOT_CANCELLABLE');
      expect(calls()).toHaveLength(1);
    });
  });

  describe('installments', () => {
    it('installmentInfo lists the options for a card', async () => {
      responses['/ccpayment/api/getpos'] = SIPAY_POS_RESPONSE;

      const result = await provider.installmentInfo({ binNumber: '540667', price: '100' });

      expect(sent().body).toMatchObject({
        credit_card: '540667',
        amount: 100,
        currency_code: 'TRY',
        merchant_key: MERCHANT_KEY,
      });
      expect(sent().config.retryable).toBe(true);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.installmentDetails?.[0]).toMatchObject({
        binNumber: '540667',
        price: 100,
        cardType: 'CREDIT CARD',
        cardAssociation: 'MASTERCARD',
        cardFamilyName: 'MAXIMUM',
        bankName: 'T. IS BANKASI A.S.',
        bankCode: 64,
        commercial: 0,
        installmentPrices: [
          { installmentNumber: 1, totalPrice: 100, installmentPrice: 100 },
          { installmentNumber: 3, totalPrice: 105, installmentPrice: 35 },
        ],
      });
    });

    it('binCheck returns the card details', async () => {
      responses['/ccpayment/api/getpos'] = SIPAY_POS_RESPONSE;
      expect(await provider.binCheck('540667')).toMatchObject({
        cardType: 'CREDIT CARD',
        cardAssociation: 'MASTERCARD',
        cardFamily: 'MAXIMUM',
        bankName: 'T. IS BANKASI A.S.',
        commercial: false,
      });
    });

    it('rejects an invalid BIN before calling Sipay', async () => {
      const result = await provider.installmentInfo({ binNumber: '12', price: '100' });
      expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
      expect(post).not.toHaveBeenCalled();
    });
  });
});
