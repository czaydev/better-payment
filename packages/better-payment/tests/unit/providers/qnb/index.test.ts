import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../../src/core/http';
import { PaymentErrorCode } from '../../../../src/core/error-codes';
import { betterPayment } from '../../../../src';
import { Qnb, qnb, mapQnbOrderStatus } from '../../../../src/providers/qnb';
import {
  createQnb3DHash,
  verifyQnbCallback,
  formatQnbAmount,
  getQnbCurrencyCode,
  formatQnbInstallment,
  formatQnbExpiry,
  validateQnbOrderId,
  buildQnbXml,
  parseQnbXmlResponse,
} from '../../../../src/providers/qnb/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';
import {
  QNB_TEST,
  QNB_BASE_URL,
  QNB_FORM_HASH,
  QNB_3DMODEL_CALLBACK,
  QNB_3DPAY_CALLBACK,
  QNB_APPROVED_XML,
  qnbXml,
  qnbInquiryXml,
} from '../../../fixtures/qnb';

const credentials = {
  merchantId: QNB_TEST.merchantId,
  merchantPass: QNB_TEST.merchantPass,
  userCode: QNB_TEST.userCode,
};
const formFields = (html: string): Record<string, string> =>
  Object.fromEntries(
    [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [
      m[1],
      m[2],
    ])
  );
const timeout = () => new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' });

describe('QNB utils', () => {
  it('computes the 3D form hash (reference vector)', async () => {
    expect(
      await createQnb3DHash({
        orderId: 'ORDER3D',
        amount: '1.20',
        okUrl: 'https://example.com/callback',
        failUrl: 'https://example.com/callback',
        txnType: 'Auth',
        installment: '0',
        rnd: '0123456789abcdef0123',
        merchantPass: QNB_TEST.merchantPass,
      })
    ).toBe(QNB_FORM_HASH);
  });

  describe('verifyQnbCallback', () => {
    it('accepts the reference 3DModel and 3DPay callbacks', async () => {
      expect(await verifyQnbCallback(QNB_3DMODEL_CALLBACK, credentials)).toBe(true);
      expect(await verifyQnbCallback(QNB_3DPAY_CALLBACK, credentials)).toBe(true);
    });

    it.each(['OrderId', 'ProcReturnCode', '3DStatus', 'AuthCode', 'ResponseRnd'])(
      'rejects a changed %s',
      async (field) => {
        expect(await verifyQnbCallback({ ...QNB_3DPAY_CALLBACK, [field]: 'X' }, credentials)).toBe(
          false
        );
      }
    );

    it('uses the configured merchant and user, not callback values', async () => {
      expect(
        await verifyQnbCallback(QNB_3DPAY_CALLBACK, { ...credentials, userCode: 'OTHER' })
      ).toBe(false);
      expect(
        await verifyQnbCallback(QNB_3DPAY_CALLBACK, { ...credentials, merchantPass: 'x' })
      ).toBe(false);
    });

    it('rejects a callback without ResponseHash', async () => {
      expect(
        await verifyQnbCallback({ ...QNB_3DPAY_CALLBACK, ResponseHash: undefined }, credentials)
      ).toBe(false);
    });
  });

  it('formats amount, currency, installment, expiry and order id', () => {
    expect(formatQnbAmount('1.2')).toBe('1.20');
    expect(getQnbCurrencyCode(undefined)).toBe('949');
    expect(getQnbCurrencyCode('eur')).toBe('978');
    expect(() => getQnbCurrencyCode('GBP')).toThrow(/not supported/);
    expect(formatQnbInstallment(1)).toBe('0');
    expect(formatQnbInstallment(6)).toBe('6');
    expect(formatQnbExpiry('2', '2030')).toBe('0230');
    expect(validateQnbOrderId('ORDER_1-A')).toBe('ORDER_1-A');
    expect(() => validateQnbOrderId('SİPARİŞ')).toThrow();
  });

  it('builds and parses PayFor XML, trimming empty values', () => {
    expect(buildQnbXml({ MbrId: '5', OrderId: 'A&B' })).toBe(
      '<?xml version="1.0" encoding="utf-8"?><PayforRequest><MbrId>5</MbrId><OrderId>A&amp;B</OrderId></PayforRequest>'
    );
    expect(parseQnbXmlResponse(qnbInquiryXml())).toMatchObject({ TxnStatus: 'Y', HostRefNum: '' });
    expect(() => parseQnbXmlResponse('<html/>')).toThrow(/unexpected response/);
  });

  it('maps order inquiry answers', () => {
    const status = (fields: Record<string, string>) =>
      mapQnbOrderStatus(parseQnbXmlResponse(qnbInquiryXml(fields)));
    expect(status({})).toBe(PaymentStatus.SUCCESS);
    expect(status({ TxnStatus: 'V', IsVoided: 'true' })).toBe(PaymentStatus.CANCELLED);
    expect(status({ IsRefunded: 'true' })).toBe(PaymentStatus.CANCELLED);
    expect(status({ TxnResult: 'Failed', TxnStatus: 'N' })).toBe(PaymentStatus.FAILURE);
    expect(status({ TxnStatus: 'P', TxnResult: '' })).toBe(PaymentStatus.PENDING);
  });
});

describe('QNB provider', () => {
  let provider: Qnb;
  let post: ReturnType<typeof vi.fn>;

  const create = (overrides: Partial<ConstructorParameters<typeof Qnb>[0]> = {}) => {
    const instance = new Qnb({ ...QNB_TEST, baseUrl: QNB_BASE_URL, ...overrides });
    (instance as any).client.post = post;
    return instance;
  };

  beforeEach(() => {
    post = vi.fn();
    provider = create();
  });

  const sent = (call = 0) => post.mock.calls[call][1] as string;
  const leaf = (xml: string, tag: string) =>
    (xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1];
  const expectNoIds = (result: { paymentId?: string; conversationId?: string }) => {
    expect(result.paymentId).toBeUndefined();
    expect(result.conversationId).toBeUndefined();
  };

  it.each(['merchantId', 'userCode', 'userPass', 'merchantPass'])('requires %s', (field) => {
    expect(() => create({ [field]: '' })).toThrow(field);
  });

  it('createPayment sends a NonSecure Auth', async () => {
    post.mockResolvedValue({ data: QNB_APPROVED_XML });
    const result = await provider.createPayment({
      ...mockPaymentRequest,
      conversationId: 'ORDER1',
    });
    expect(post.mock.calls[0][0]).toBe('/Gateway/XmlGate.aspx');
    const xml = sent();
    expect(leaf(xml, 'MbrId')).toBe('5');
    expect(leaf(xml, 'UserPass')).toBe('FwCX2');
    expect(leaf(xml, 'SecureType')).toBe('NonSecure');
    expect(leaf(xml, 'TxnType')).toBe('Auth');
    expect(leaf(xml, 'PurchAmount')).toBe('1.20');
    expect(leaf(xml, 'Expiry')).toBe('1230');
    expect(leaf(xml, 'InstallmentCount')).toBe('0');
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.paymentId).toBe('ORDER1');
  });

  it('initThreeDSPayment returns a signed form without the API password', async () => {
    const result = await provider.initThreeDSPayment({
      ...mockThreeDSPaymentRequest,
      conversationId: 'ORDER3D',
    });
    expect(post).not.toHaveBeenCalled();
    const html = result.threeDSHtmlContent!;
    expect(html).toContain(`action="${QNB_BASE_URL}/Gateway/Default.aspx"`);
    const fields = formFields(html);
    expect(fields).toMatchObject({
      MbrId: '5',
      MerchantID: QNB_TEST.merchantId,
      UserCode: QNB_TEST.userCode,
      SecureType: '3DModel',
      TxnType: 'Auth',
      InstallmentCount: '0',
      OrderId: 'ORDER3D',
      PurchAmount: '1.20',
      Pan: '5528790000000008',
      Expiry: '1230',
    });
    expect(fields).not.toHaveProperty('UserPass');
    expect(html).not.toContain(QNB_TEST.userPass);
    expect(html).not.toContain(QNB_TEST.merchantPass);
    expect(fields.Hash).toBe(
      await createQnb3DHash({
        orderId: 'ORDER3D',
        amount: '1.20',
        okUrl: fields.OkUrl,
        failUrl: fields.FailUrl,
        txnType: 'Auth',
        installment: '0',
        rnd: fields.Rnd,
        merchantPass: QNB_TEST.merchantPass,
      })
    );
    expect(result.status).toBe(PaymentStatus.PENDING);
  });

  describe('completeThreeDSPayment (3DModel)', () => {
    it('charges a verified callback with 3DModelPayment', async () => {
      post.mockResolvedValue({ data: QNB_APPROVED_XML });
      const result = await provider.completeThreeDSPayment(QNB_3DMODEL_CALLBACK);
      const xml = sent();
      expect(leaf(xml, 'SecureType')).toBe('3DModelPayment');
      expect(leaf(xml, 'RequestGuid')).toBe('1000000128757956');
      expect(leaf(xml, 'OrderId')).toBe('ORDER3D');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDER3D');
    });

    it('rejects a callback with a changed OrderId as INVALID_HASH', async () => {
      const result = await provider.completeThreeDSPayment({
        ...QNB_3DMODEL_CALLBACK,
        OrderId: 'SOMEONE-ELSE',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('rejects a callback for another merchant', async () => {
      const result = await provider.completeThreeDSPayment({
        ...QNB_3DMODEL_CALLBACK,
        MerchantID: '1',
      });
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('fails without ids when the bank declines the payment', async () => {
      post.mockResolvedValue({ data: qnbXml({ ProcReturnCode: '51', ErrMsg: 'Yetersiz bakiye' }) });
      const result = await provider.completeThreeDSPayment(QNB_3DMODEL_CALLBACK);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
      expectNoIds(result);
    });

    it('returns pending with the order id on a timeout only for an order from your records', async () => {
      post.mockRejectedValue(timeout());
      const result = await provider.completeThreeDSPayment(QNB_3DMODEL_CALLBACK);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.paymentId).toBeUndefined();
      expect(result.conversationId).toBeUndefined();
      const trusted = await provider.completeThreeDSPayment(QNB_3DMODEL_CALLBACK, {
        orderId: 'ORDER3D',
      });
      expect(trusted.paymentId).toBe('ORDER3D');
    });

    it('rejects a callback for another order than yours', async () => {
      const result = await provider.completeThreeDSPayment(QNB_3DMODEL_CALLBACK, {
        orderId: 'ORDER2',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
    });
  });

  describe('completeThreeDSPayment (3DPay)', () => {
    beforeEach(() => {
      provider = create({ secureType: '3DPay' });
    });

    it('confirms an approved callback with OrderInquiry', async () => {
      post.mockResolvedValue({ data: qnbInquiryXml() });
      const result = await provider.completeThreeDSPayment(QNB_3DPAY_CALLBACK);
      expect(leaf(sent(), 'TxnType')).toBe('OrderInquiry');
      expect(leaf(sent(), 'OrgOrderId')).toBe('ORDERPAY');
      expect(post.mock.calls[0][2].retryable).toBe(true);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it.each([
      ['a voided order', { TxnStatus: 'V', IsVoided: 'true' }],
      ['another amount', { PurchAmount: '999.00' }],
      ['an unknown order', { ProcReturnCode: 'V013', TxnResult: '', TxnStatus: 'P' }],
    ])('rejects a callback the bank does not confirm: %s', async (_name, fields) => {
      post.mockResolvedValue({ data: qnbInquiryXml(fields) });
      const result = await provider.completeThreeDSPayment(QNB_3DPAY_CALLBACK);
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it("checks the bank's amount against yours when given", async () => {
      post.mockResolvedValue({ data: qnbInquiryXml() });
      const ok = await provider.completeThreeDSPayment(QNB_3DPAY_CALLBACK, {
        orderId: 'ORDERPAY',
        amount: QNB_3DPAY_CALLBACK.PurchAmount,
      });
      expect(ok.status).toBe(PaymentStatus.SUCCESS);
      const wrong = await provider.completeThreeDSPayment(QNB_3DPAY_CALLBACK, {
        orderId: 'ORDERPAY',
        amount: '999.00',
      });
      expect(wrong.errorCode).toBe('INVALID_HASH');
      expectNoIds(wrong);
    });
  });

  describe('refund, cancel, getPayment', () => {
    it('refunds and cancels by OrgOrderId', async () => {
      post.mockResolvedValue({ data: QNB_APPROVED_XML });
      await provider.refund({ paymentId: 'ORDER1', price: '0.5', currency: 'TRY', ip: '1.1.1.1' });
      expect(leaf(sent(0), 'TxnType')).toBe('Refund');
      expect(leaf(sent(0), 'OrgOrderId')).toBe('ORDER1');
      expect(leaf(sent(0), 'PurchAmount')).toBe('0.50');
      await provider.cancel({ paymentId: 'ORDER1', ip: '1.1.1.1' });
      expect(leaf(sent(1), 'TxnType')).toBe('Void');
    });

    it('maps a same-day refund rejection', async () => {
      post.mockResolvedValue({
        data: qnbXml({
          ProcReturnCode: 'V014',
          ErrMsg: 'Bu işlem geri alınamaz, lüften asıl işlemi iptal edin.',
        }),
      });
      const result = await provider.refund({
        paymentId: 'ORDER1',
        price: '1',
        currency: 'TRY',
        ip: '1.1.1.1',
      });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('V014');
    });

    it('returns the order status', async () => {
      post.mockResolvedValue({ data: qnbInquiryXml({ TxnStatus: 'V', IsVoided: 'true' }) });
      expect((await provider.getPayment('ORDERPAY')).status).toBe(PaymentStatus.CANCELLED);
      post.mockResolvedValue({
        data: qnbXml({ ProcReturnCode: 'V013', ErrMsg: 'Seçili İşlem Bulunamadı!' }),
      });
      const missing = await provider.getPayment('NOPE');
      expect(missing.status).toBe(PaymentStatus.FAILURE);
      expect(missing.errorCode).toBe('V013');
    });
  });

  it('qnb() follows mode for the base URL', () => {
    const sandbox = betterPayment({ mode: 'sandbox', providers: { qnb: qnb(QNB_TEST) } });
    expect((sandbox.qnb as any).config.baseUrl).toBe(QNB_BASE_URL);
    const production = betterPayment({ providers: { qnb: qnb(QNB_TEST) } });
    expect((production.qnb as any).config.baseUrl).toBe('https://vpos.qnb.com.tr');
  });
});
