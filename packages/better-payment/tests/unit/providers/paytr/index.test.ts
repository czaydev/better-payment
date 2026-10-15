import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../../src/core/http';
import { PayTR } from '../../../../src/providers/paytr';
import { PaymentStatus } from '../../../../src/types';
import {
  generatePayTRDirectToken,
  generatePayTRRefundToken,
  generatePayTRStatusToken,
} from '../../../../src/providers/paytr/utils';
import { mockThreeDSPaymentRequest, mockPaymentRequest } from '../../../fixtures/payment-data';

const SALT = 'YEUaNcdHXqyt7hjt';
const KEY = 'wWwU8buJp6jo1r25';

const baseConfig = {
  merchantId: '123456',
  merchantKey: KEY,
  merchantSalt: SALT,
  baseUrl: 'https://www.paytr.com',
};

function parseForm(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

describe('PayTR provider', () => {
  let paytr: PayTR;
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    paytr = new PayTR({ ...baseConfig, testMode: true });
    post = vi.fn();
    (paytr as any).client.post = post;
  });

  const sent = (call = 0) => ({
    url: post.mock.calls[call][0] as string,
    form: parseForm(post.mock.calls[call][1]),
    config: post.mock.calls[call][2],
  });

  describe('configuration', () => {
    it.each(['merchantId', 'merchantKey', 'merchantSalt'])('requires %s', (field) => {
      expect(() => new PayTR({ ...baseConfig, [field]: '' })).toThrow(field);
    });

    it('does not require apiKey/secretKey', async () => {
      expect(() => new PayTR(baseConfig)).not.toThrow();
    });
  });

  describe('initThreeDSPayment (iFrame)', () => {
    it('sends a correctly signed get-token request without secrets in the body', async () => {
      post.mockResolvedValue({ data: { status: 'success', token: 'TOKEN123' } });

      const result = await paytr.initThreeDSPayment({ ...mockThreeDSPaymentRequest, conversationId: 'ORDER1' });

      const { url, form } = sent();
      expect(url).toBe('/odeme/api/get-token');
      expect(form.merchant_key).toBeUndefined();
      expect(form.merchant_salt).toBeUndefined();
      expect(form.test_mode).toBe('1');
      expect(form.currency).toBe('TL');
      expect(form.payment_amount).toBe('120'); // paidPrice 1.2 TL in kuruş
      expect(form.merchant_oid).toBe('ORDER1');
      expect(JSON.parse(Buffer.from(form.user_basket, 'base64').toString())).toEqual([
        ['Binocular', '0.30', 1],
        ['Game code', '0.50', 1],
        ['Usb', '0.20', 1],
      ]);

      const { generatePayTRIframeToken } = await import('../../../../src/providers/paytr/utils');
      expect(form.paytr_token).toBe(
        await generatePayTRIframeToken(
          {
            merchantId: form.merchant_id,
            userIp: form.user_ip,
            merchantOid: form.merchant_oid,
            email: form.email,
            paymentAmount: form.payment_amount,
            userBasket: form.user_basket,
            noInstallment: form.no_installment,
            maxInstallment: form.max_installment,
            currency: form.currency,
            testMode: form.test_mode,
          },
          SALT,
          KEY
        )
      );

      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.paymentId).toBe('ORDER1');
      expect(result.redirectUrl).toBe('https://www.paytr.com/odeme/guvenli/TOKEN123');
      expect(result.threeDSHtmlContent).toContain('https://www.paytr.com/odeme/guvenli/TOKEN123');
    });

    it('generates an alphanumeric merchant_oid when none is given', async () => {
      post.mockResolvedValue({ data: { status: 'success', token: 'T' } });
      const result = await paytr.initThreeDSPayment({ ...mockThreeDSPaymentRequest, conversationId: undefined });
      expect(result.paymentId).toMatch(/^[A-Za-z0-9]+$/);
      expect(sent().form.merchant_oid).toBe(result.paymentId);
    });

    it('rejects a non-alphanumeric merchant_oid before calling PayTR', async () => {
      const result = await paytr.initThreeDSPayment({ ...mockThreeDSPaymentRequest, conversationId: 'ORDER-1' });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(post).not.toHaveBeenCalled();
    });

    it('uses test_mode=0 when testMode is off', async () => {
      const live = new PayTR(baseConfig);
      const livePost = vi.fn().mockResolvedValue({ data: { status: 'success', token: 'T' } });
      (live as any).client.post = livePost;
      await live.initThreeDSPayment(mockThreeDSPaymentRequest);
      expect(parseForm(livePost.mock.calls[0][1]).test_mode).toBe('0');
    });

    it('installment options', async () => {
      post.mockResolvedValue({ data: { status: 'success', token: 'T' } });
      await paytr.initThreeDSPayment({ ...mockThreeDSPaymentRequest, installment: 1 });
      expect(sent(0).form).toMatchObject({ no_installment: '1', max_installment: '0' });
      await paytr.initThreeDSPayment({ ...mockThreeDSPaymentRequest, installment: 6 });
      expect(sent(1).form).toMatchObject({ no_installment: '0', max_installment: '6' });
    });

    it('returns the PayTR reason on failure', async () => {
      post.mockResolvedValue({ data: { status: 'failed', reason: 'paytr_token gecersiz' } });
      const result = await paytr.initThreeDSPayment(mockThreeDSPaymentRequest);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toBe('paytr_token gecersiz');
    });
  });

  describe('completeThreeDSPayment (notification)', () => {
    const genuine = {
      merchant_oid: '202606234E4E',
      status: 'success',
      total_amount: '1001',
      hash: 'ZDVOQUw4aDJhNR5dWYBC5bD95bLtSOtj9DzzSQ9sUHs=',
    };

    it('accepts a genuine success notification', async () => {
      const result = await paytr.completeThreeDSPayment(genuine);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('202606234E4E');
    });

    it('rejects a notification with an invalid hash', async () => {
      const result = await paytr.completeThreeDSPayment({ ...genuine, status: 'failed' });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('INVALID_HASH');
    });
  });

  describe('refund', () => {
    it('sends return_amount in TL and signs with the merchant key', async () => {
      post.mockResolvedValue({ data: { status: 'success', merchant_oid: 'ORDER1', reference_no: 'R1' } });

      const result = await paytr.refund({ paymentId: 'ORDER1', price: '50', currency: 'TRY', ip: '1.1.1.1' });

      const { url, form } = sent();
      expect(url).toBe('/odeme/iade');
      expect(form.return_amount).toBe('50.00');
      expect(form.paytr_token).toBe(await generatePayTRRefundToken('123456', 'ORDER1', '50.00', SALT, KEY));
      expect(form.merchant_key).toBeUndefined();
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.refundId).toBe('R1');
    });

    it('maps err_no/err_msg on failure', async () => {
      post.mockResolvedValue({ data: { status: 'error', err_no: '004', err_msg: 'Tutar hatali' } });
      const result = await paytr.refund({ paymentId: 'ORDER1', price: '50', currency: 'TRY', ip: '1.1.1.1' });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('004');
      expect(result.errorMessage).toBe('Tutar hatali');
    });

    it('is never retried', async () => {
      post.mockResolvedValue({ data: { status: 'success' } });
      await paytr.refund({ paymentId: 'ORDER1', price: '50', currency: 'TRY', ip: '1.1.1.1' });
      expect(sent().config.retryable).toBe(false);
    });
  });

  describe('cancel', () => {
    it('fully refunds the amount returned by the status query', async () => {
      post
        .mockResolvedValueOnce({ data: { status: 'success', payment_amount: '10,01', payment_total: '10,01' } })
        .mockResolvedValueOnce({ data: { status: 'success', merchant_oid: 'ORDER1' } });

      const result = await paytr.cancel({ paymentId: 'ORDER1', ip: '1.1.1.1' });

      expect(sent(0).url).toBe('/odeme/durum-sorgu');
      expect(sent(1).form.return_amount).toBe('10.01');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });
  });

  describe('getPayment', () => {
    it('queries /odeme/durum-sorgu with a valid token', async () => {
      post.mockResolvedValue({ data: { status: 'success', payment_amount: '10.01', payment_total: '10.01' } });
      const result = await paytr.getPayment('ORDER1');
      expect(sent().url).toBe('/odeme/durum-sorgu');
      expect(sent().form.paytr_token).toBe(await generatePayTRStatusToken('123456', 'ORDER1', SALT, KEY));
      expect(sent().config.retryable).toBe(true);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('reports fully refunded payments as cancelled', async () => {
      post.mockResolvedValue({
        data: { status: 'success', payment_amount: '10.01', returns: [{ return_amount: '10.01' }] },
      });
      expect((await paytr.getPayment('ORDER1')).status).toBe(PaymentStatus.CANCELLED);
    });

    it('maps query errors', async () => {
      post.mockResolvedValue({ data: { status: 'error', err_no: '001', err_msg: 'Siparis bulunamadi' } });
      const result = await paytr.getPayment('ORDER1');
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toBe('Siparis bulunamadi');
    });
  });

  describe('createPayment (Direct API, non-3D)', () => {
    it('posts card data to /odeme with sync_mode', async () => {
      post.mockResolvedValue({ data: { status: 'success', merchant_oid: 'ORDER1' } });
      const result = await paytr.createPayment({ ...mockPaymentRequest, conversationId: 'ORDER1' });
      const { url, form } = sent();
      expect(url).toBe('/odeme');
      expect(form).toMatchObject({
        non_3d: '1',
        sync_mode: '1',
        payment_amount: '1.20',
        payment_type: 'card',
        expiry_month: '12',
        expiry_year: '30',
      });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('maps failed payments', async () => {
      post.mockResolvedValue({ data: { status: 'failed', failed_reason_code: '6', failed_reason_msg: 'Yetersiz bakiye' } });
      const result = await paytr.createPayment(mockPaymentRequest);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toBe('Yetersiz bakiye');
    });

    it('reports timeouts as PENDING (outcome unknown)', async () => {
      post.mockRejectedValue(new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' }));
      const result = await paytr.createPayment(mockPaymentRequest);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.errorCode).toBe('NETWORK_ERROR');
    });
  });

  describe('initThreeDSPayment (Direct API)', () => {
    const formFields = (html: string): Record<string, string> =>
      Object.fromEntries(
        [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [
          m[1],
          m[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
        ])
      );

    beforeEach(() => {
      paytr = new PayTR({ ...baseConfig, testMode: true, threeDSMode: 'direct' });
      (paytr as any).client.post = post;
    });

    it('returns a signed card form for the browser to post to /odeme', async () => {
      const result = await paytr.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        conversationId: 'ORDER1',
        installment: 3,
      });

      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.paymentId).toBe('ORDER1');
      const html = result.threeDSHtmlContent!;
      expect(html).toContain('action="https://www.paytr.com/odeme"');
      const fields = formFields(html);
      expect(fields).toMatchObject({
        merchant_id: '123456',
        merchant_oid: 'ORDER1',
        payment_amount: '1.20',
        payment_type: 'card',
        installment_count: '3',
        currency: 'TL',
        test_mode: '1',
        non_3d: '0',
        cc_owner: 'John Doe',
        card_number: '5528790000000008',
        expiry_month: '12',
        expiry_year: '30',
        cvv: '123',
        merchant_ok_url: mockThreeDSPaymentRequest.callbackUrl,
        merchant_fail_url: mockThreeDSPaymentRequest.callbackUrl,
      });
      expect(fields).not.toHaveProperty('sync_mode');
      expect(fields).not.toHaveProperty('merchant_key');
      expect(fields).not.toHaveProperty('merchant_salt');
      expect(fields.paytr_token).toBe(
        await generatePayTRDirectToken(
          {
            merchantId: '123456',
            userIp: fields.user_ip,
            merchantOid: 'ORDER1',
            email: fields.email,
            paymentAmount: '1.20',
            paymentType: 'card',
            installmentCount: '3',
            currency: 'TL',
            testMode: '1',
            non3d: '0',
          },
          SALT,
          KEY
        )
      );
    });

    it('asks PayTR to store the card with saveCard', async () => {
      const result = await paytr.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        saveCard: { customerToken: 'U1' },
      });
      const fields = formFields(result.threeDSHtmlContent!);
      expect(fields.store_card).toBe('1');
      expect(fields.utoken).toBe('U1');
    });

    it('needs the card in the request', async () => {
      const { paymentCard: _card, ...withoutCard } = mockThreeDSPaymentRequest;
      const result = await paytr.initThreeDSPayment(withoutCard as any);
      expect(result.status).toBe(PaymentStatus.FAILURE);
    });

    it('rejects an unknown threeDSMode', () => {
      expect(() => new PayTR({ ...baseConfig, threeDSMode: 'x' as any })).toThrow(/threeDSMode/);
    });
  });

  describe('createPaymentWithToken', () => {
    it('returns an auto-submit form for the Direct API with utoken/ctoken', async () => {
      const result = await paytr.createPaymentWithToken({
        utoken: 'U1',
        ctoken: 'C1',
        price: '10',
        callbackUrl: 'https://shop/return',
        conversationId: 'ORDER9',
        buyer: { email: 'a@b.c', name: 'A', surname: 'B', ip: '1.1.1.1', gsmNumber: '5350000000' },
        basketItems: [{ name: 'X', price: '10', quantity: 1 }],
      });
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.threeDSHtmlContent).toContain('action="https://www.paytr.com/odeme"');
      expect(result.threeDSHtmlContent).toContain('name="utoken" value="U1"');
      expect(result.threeDSHtmlContent).toContain('name="ctoken" value="C1"');
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('binCheck / installmentInfo', () => {
    it('binCheck maps the bin-detail response', async () => {
      post.mockResolvedValue({ data: { status: 'success', bank: 'Garanti', brand: 'bonus', cardType: 'credit', schema: 'MASTERCARD' } });
      const result = await paytr.binCheck('415956');
      expect(sent().url).toBe('/odeme/api/bin-detail');
      expect(result).toMatchObject({ bankName: 'Garanti', cardFamily: 'bonus', cardAssociation: 'MASTERCARD' });
    });

    it('installmentInfo computes totals from account commission rates', async () => {
      post
        .mockResolvedValueOnce({ data: { status: 'success', bank: 'Garanti', brand: 'bonus', cardType: 'credit' } })
        .mockResolvedValueOnce({ data: { status: 'success', oranlar: { bonus: { taksit_2: 2, taksit_3: '3.5' } } } });

      const result = await paytr.installmentInfo({ binNumber: '415956', price: '100' });

      expect(sent(1).url).toBe('/odeme/taksit-oranlari');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.installmentDetails![0].installmentPrices).toEqual([
        { installmentNumber: 1, totalPrice: 100, installmentPrice: 100 },
        { installmentNumber: 2, totalPrice: 102, installmentPrice: 51 },
        { installmentNumber: 3, totalPrice: 103.5, installmentPrice: 34.5 },
      ]);
    });
  });
});
