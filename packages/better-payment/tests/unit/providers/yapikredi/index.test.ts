import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../../src/core/http';
import { PaymentErrorCode } from '../../../../src/core/error-codes';
import { betterPayment } from '../../../../src';
import { YapiKredi, yapikredi } from '../../../../src/providers/yapikredi';
import {
  createYapiKrediMac,
  formatYapiKrediAmount,
  getYapiKrediCurrencyCode,
  formatYapiKrediInstallment,
  formatYapiKrediExpiry,
  toYapiKrediXid,
  toYapiKrediOrderId,
  createYapiKrediResponseMac,
  buildYapiKrediRequestBody,
  parseYapiKrediXmlResponse,
} from '../../../../src/providers/yapikredi/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';
import {
  YAPIKREDI_TEST,
  YAPIKREDI_BASE_URL,
  YAPIKREDI_MAC,
  YAPIKREDI_RESOLVE_MAC,
  YAPIKREDI_CHARGE_MAC,
  ykbAgreementXml,
  YAPIKREDI_CALLBACK,
  YKB_OOS_REQUEST_XML,
  YKB_APPROVED_XML,
  YKB_DECLINED_XML,
  ykbResolveXml,
  ykbXml,
} from '../../../fixtures/yapikredi';

const timeout = () => new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' });
const ORDER = { orderId: 'ORDER3D', amount: '1.20', currency: 'TRY' };

describe('Yapı Kredi utils', () => {
  it('computes the MAC (reference vector)', async () => {
    expect(
      await createYapiKrediMac({
        xid: '0000000000000ORDER3D',
        amount: '120',
        currency: 'TL',
        merchantId: YAPIKREDI_TEST.merchantId,
        terminalId: YAPIKREDI_TEST.terminalId,
        encKey: YAPIKREDI_TEST.encKey,
      })
    ).toBe(YAPIKREDI_MAC);
  });

  it("matches the bank's own MAC sample from the 3D guide", async () => {
    // encKey 10,10,10,10,10,10,10,10, terminal 67005551, merchant 6706598320
    expect(
      await createYapiKrediMac({
        xid: 'YKB_TST_190620093100_024',
        amount: '175',
        currency: 'TL',
        merchantId: '6706598320',
        terminalId: '67005551',
        encKey: '10,10,10,10,10,10,10,10',
      })
    ).toBe('J/7/Xprj7F/KDf98luVfIGyUPRQzUCqGwpmvz3KT7oQ=');
    expect(
      await createYapiKrediResponseMac({
        first: '1',
        xid: '0000000000000ORDER3D',
        amount: '120',
        currency: 'TL',
        merchantId: YAPIKREDI_TEST.merchantId,
        terminalId: YAPIKREDI_TEST.terminalId,
        encKey: YAPIKREDI_TEST.encKey,
      })
    ).toBe(YAPIKREDI_RESOLVE_MAC);
  });

  it('formats amount, currency, installment, expiry and XID', () => {
    expect(formatYapiKrediAmount('1.2')).toBe('120');
    expect(getYapiKrediCurrencyCode(undefined)).toBe('TL');
    expect(getYapiKrediCurrencyCode('usd')).toBe('US');
    expect(() => getYapiKrediCurrencyCode('CHF')).toThrow(/not supported/);
    expect(formatYapiKrediInstallment(1)).toBe('00');
    expect(formatYapiKrediInstallment(3)).toBe('03');
    expect(formatYapiKrediExpiry('1', '2030')).toBe('3001');
    expect(toYapiKrediXid('ORDER3D')).toBe('0000000000000ORDER3D');
    expect(toYapiKrediXid('YKB_TST_1')).toBe('00000000000YKB_TST_1');
    expect(toYapiKrediOrderId('ORDER1')).toBe('000000000000000000ORDER1');
    expect(() => toYapiKrediXid('ORDER-3D')).toThrow(/letters, digits or "_"/);
    expect(() => toYapiKrediXid('A'.repeat(21))).toThrow();
  });

  it('sends the XML form-encoded as xmldata, ASCII only', () => {
    const body = buildYapiKrediRequestBody({ mid: '1', sale: { cardHolderName: 'Ayşe & Co' } });
    expect(body.startsWith('xmldata=')).toBe(true);
    const xml = decodeURIComponent(body.slice('xmldata='.length));
    expect(xml).toBe(
      '<?xml version="1.0" encoding="ISO-8859-9"?><posnetRequest><mid>1</mid>' +
        '<sale><cardHolderName>Ay&#351;e &amp; Co</cardHolderName></sale></posnetRequest>'
    );
  });

  it('parses the top-level fields and the nested blocks separately', () => {
    const parsed = parseYapiKrediXmlResponse(ykbResolveXml());
    expect(parsed.fields).toEqual({ approved: '1' });
    expect(parsed.oosResolveMerchantData).toMatchObject({
      xid: '0000000000000ORDER3D',
      mdStatus: '1',
    });
    expect(parseYapiKrediXmlResponse(YKB_OOS_REQUEST_XML).oosRequestData).toEqual({
      data1: 'DATA1VALUE',
      data2: 'DATA2VALUE',
      sign: 'SIGNVALUE',
    });
    expect(() => parseYapiKrediXmlResponse('<html/>')).toThrow(/unexpected response/);
  });
});

describe('Yapı Kredi provider', () => {
  let provider: YapiKredi;
  let post: ReturnType<typeof vi.fn>;

  const create = (overrides: Partial<ConstructorParameters<typeof YapiKredi>[0]> = {}) => {
    const instance = new YapiKredi({
      ...YAPIKREDI_TEST,
      baseUrl: YAPIKREDI_BASE_URL,
      ...overrides,
    });
    (instance as any).client.post = post;
    return instance;
  };

  beforeEach(() => {
    post = vi.fn();
    provider = create();
  });

  const sentXml = (call = 0) => decodeURIComponent((post.mock.calls[call][1] as string).slice(8));
  const leaf = (xml: string, tag: string) =>
    (xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1];
  const expectNoIds = (result: { paymentId?: string; conversationId?: string }) => {
    expect(result.paymentId).toBeUndefined();
    expect(result.conversationId).toBeUndefined();
  };

  it.each(['merchantId', 'terminalId', 'posnetId', 'encKey'])('requires %s', (field) => {
    expect(() => create({ [field]: '' })).toThrow(field);
  });

  describe('order ids', () => {
    it.each(['createPayment', 'initThreeDSPayment'] as const)(
      '%s generates a bank-compatible id when conversationId is omitted',
      async (method) => {
        const threeDS = method === 'initThreeDSPayment';
        post.mockResolvedValue({ data: threeDS ? YKB_OOS_REQUEST_XML : YKB_APPROVED_XML });
        const request = { ...mockThreeDSPaymentRequest, conversationId: undefined };
        const result = await provider[method](request);

        expect(result.status).toBe(threeDS ? PaymentStatus.PENDING : PaymentStatus.SUCCESS);
        expect(result.conversationId).toMatch(/^[A-F0-9]{20}$/);
        expect(leaf(sentXml(), threeDS ? 'XID' : 'orderID')).toBe(
          threeDS ? result.conversationId : result.conversationId!.padStart(24, '0')
        );
        const next = await provider[method](request);
        expect(next.conversationId).not.toBe(result.conversationId);
      }
    );

    it.each([
      ['createPayment', 24],
      ['initThreeDSPayment', 20],
    ] as const)('%s preserves a caller id at its %i-character limit', async (method, length) => {
      const threeDS = method === 'initThreeDSPayment';
      post.mockResolvedValue({ data: threeDS ? YKB_OOS_REQUEST_XML : YKB_APPROVED_XML });
      const conversationId = 'A'.repeat(length);
      const result = await provider[method]({ ...mockThreeDSPaymentRequest, conversationId });

      expect(result.status).toBe(threeDS ? PaymentStatus.PENDING : PaymentStatus.SUCCESS);
      expect(result.conversationId).toBe(conversationId);
      expect(leaf(sentXml(), threeDS ? 'XID' : 'orderID')).toBe(conversationId);
    });

    it.each([
      ['createPayment', 25],
      ['initThreeDSPayment', 21],
    ] as const)(
      '%s rejects an overlong caller id instead of truncating it',
      async (method, length) => {
        const result = await provider[method]({
          ...mockThreeDSPaymentRequest,
          conversationId: 'A'.repeat(length),
        });

        expect(result.status).toBe(PaymentStatus.FAILURE);
        expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
        expect(post).not.toHaveBeenCalled();
      }
    );
  });

  describe('createPayment', () => {
    it('sends a non-3D sale and returns the host log key', async () => {
      post.mockResolvedValue({ data: YKB_APPROVED_XML });

      const result = await provider.createPayment({
        ...mockPaymentRequest,
        conversationId: 'ORDER1',
      });

      expect(post.mock.calls[0][0]).toBe('/PosnetWebService/XML');
      const xml = sentXml();
      expect(leaf(xml, 'mid')).toBe(YAPIKREDI_TEST.merchantId);
      expect(leaf(xml, 'tid')).toBe(YAPIKREDI_TEST.terminalId);
      expect(leaf(xml, 'amount')).toBe('120');
      expect(leaf(xml, 'currencyCode')).toBe('TL');
      expect(leaf(xml, 'expDate')).toBe('3012');
      expect(leaf(xml, 'installment')).toBe('00');
      expect(leaf(xml, 'orderID')).toBe('000000000000000000ORDER1');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('021000000000000123');
      expect(result.conversationId).toBe('ORDER1');
    });

    it('maps a decline', async () => {
      post.mockResolvedValue({ data: YKB_DECLINED_XML });
      const result = await provider.createPayment({
        ...mockPaymentRequest,
        conversationId: 'ORDER1',
      });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('0225');
      expect(result.errorMessage).toBe('ONAYLANMADI');
    });

    it('rejects an order id the bank cannot take', async () => {
      const result = await provider.createPayment({
        ...mockPaymentRequest,
        conversationId: 'ORDER-1',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
    });
  });

  describe('initThreeDSPayment', () => {
    it('requests OOS data and returns the form to the 3D service', async () => {
      post.mockResolvedValue({ data: YKB_OOS_REQUEST_XML });

      const result = await provider.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        conversationId: 'ORDER3D',
      });

      const xml = sentXml();
      expect(leaf(xml, 'posnetid')).toBe(YAPIKREDI_TEST.posnetId);
      expect(leaf(xml, 'XID')).toBe('0000000000000ORDER3D');
      expect(leaf(xml, 'tranType')).toBe('Sale');
      expect(result.status).toBe(PaymentStatus.PENDING);
      const html = result.threeDSHtmlContent!;
      expect(html).toContain(`action="${YAPIKREDI_BASE_URL}/3DSWebService/YKBPaymentService"`);
      expect(html).toContain('name="posnetData" value="DATA1VALUE"');
      expect(html).toContain('name="posnetData2" value="DATA2VALUE"');
      expect(html).toContain('name="digest" value="SIGNVALUE"');
      expect(html).toContain('name="merchantReturnURL" value="https://example.com/callback"');
      expect(result.conversationId).toBe('ORDER3D');
    });

    it('fails when the bank rejects the OOS request', async () => {
      post.mockResolvedValue({
        data: ykbXml({ approved: '0', respCode: 'E146', respText: 'Terminal bulunamadi' }),
      });
      const result = await provider.initThreeDSPayment(mockThreeDSPaymentRequest);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('E146');
      expect(result.threeDSHtmlContent).toBeUndefined();
    });
  });

  describe('completeThreeDSPayment', () => {
    it('resolves, then charges with oosTranData, signed with the MAC', async () => {
      post
        .mockResolvedValueOnce({ data: ykbResolveXml() })
        .mockResolvedValueOnce({ data: YKB_APPROVED_XML });

      const result = await provider.completeThreeDSPayment({ ...YAPIKREDI_CALLBACK, ...ORDER });

      const resolve = sentXml(0);
      expect(resolve).toContain('<oosResolveMerchantData>');
      expect(leaf(resolve, 'bankData')).toBe('BANKPACKET0123456789');
      expect(leaf(resolve, 'merchantData')).toBe('MERCHANTPACKET0123456789');
      expect(leaf(resolve, 'sign')).toBe('SIGN0123456789');
      expect(leaf(resolve, 'mac')).toBe(YAPIKREDI_MAC);
      const tran = sentXml(1);
      expect(tran).toContain('<oosTranData>');
      expect(leaf(tran, 'mac')).toBe(YAPIKREDI_MAC);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('021000000000000123');
      expect(result.conversationId).toBe('ORDER3D');
    });

    it("checks the bank's MACs on the resolve and charge answers", async () => {
      post
        .mockResolvedValueOnce({ data: ykbResolveXml({ mac: YAPIKREDI_RESOLVE_MAC }) })
        .mockResolvedValueOnce({
          data: ykbXml({
            approved: '1',
            hostlogkey: '021000000000000123',
            mac: YAPIKREDI_CHARGE_MAC,
          }),
        });
      const ok = await provider.completeThreeDSPayment({ ...YAPIKREDI_CALLBACK, ...ORDER });
      expect(ok.status).toBe(PaymentStatus.SUCCESS);

      post.mockReset();
      post.mockResolvedValueOnce({ data: ykbResolveXml({ mac: 'FORGED=' }) });
      const forged = await provider.completeThreeDSPayment({ ...YAPIKREDI_CALLBACK, ...ORDER });
      expect(post).toHaveBeenCalledTimes(1);
      expect(forged.errorCode).toBe('INVALID_HASH');

      post.mockReset();
      post
        .mockResolvedValueOnce({ data: ykbResolveXml({ mac: YAPIKREDI_RESOLVE_MAC }) })
        .mockResolvedValueOnce({
          data: ykbXml({ approved: '1', hostlogkey: '021000000000000123', mac: 'FORGED=' }),
        });
      const unknown = await provider.completeThreeDSPayment({ ...YAPIKREDI_CALLBACK, ...ORDER });
      expect(unknown.status).toBe(PaymentStatus.PENDING);
      expect(unknown.errorCode).toBe('INVALID_HASH');
    });

    it('charges half-secure mdStatus values only when accepted', async () => {
      post.mockResolvedValueOnce({ data: ykbResolveXml({ mdStatus: '2' }) });
      const rejected = await provider.completeThreeDSPayment({ ...YAPIKREDI_CALLBACK, ...ORDER });
      expect(rejected.errorCode).toBe('MD_STATUS_2');
    });

    it('needs the order from your records', async () => {
      const result = await provider.completeThreeDSPayment(YAPIKREDI_CALLBACK);
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toMatch(/orderId, amount, currency/);
      expectNoIds(result);
    });

    it('rejects a callback without the bank packets', async () => {
      const result = await provider.completeThreeDSPayment({ ...ORDER, Sign: 'x' });
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it.each([
      ['XID', { xid: '0000000000000OTHER01' }],
      ['amount', { amount: '1' }],
      ['currency', { currency: 'US' }],
    ])('rejects a resolved %s that differs from the order', async (_name, data) => {
      post.mockResolvedValueOnce({ data: ykbResolveXml(data) });
      const result = await provider.completeThreeDSPayment({ ...YAPIKREDI_CALLBACK, ...ORDER });
      expect(post).toHaveBeenCalledTimes(1);
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('rejects a resolve the bank did not approve', async () => {
      post.mockResolvedValueOnce({
        data: ykbXml({ approved: '0', respCode: '0148', respText: 'MAC HATASI' }),
      });
      const result = await provider.completeThreeDSPayment({ ...YAPIKREDI_CALLBACK, ...ORDER });
      expect(post).toHaveBeenCalledTimes(1);
      expect(result.errorCode).toBe('INVALID_HASH');
    });

    it('fails without ids when the card was not authenticated', async () => {
      post.mockResolvedValueOnce({
        data: ykbResolveXml({ mdStatus: '0', mdErrorMessage: 'Not authenticated' }),
      });
      const result = await provider.completeThreeDSPayment({ ...YAPIKREDI_CALLBACK, ...ORDER });
      expect(post).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.code).toBe(PaymentErrorCode.THREEDS_FAILED);
      expectNoIds(result);
    });

    it('fails without ids when the charge is declined', async () => {
      post
        .mockResolvedValueOnce({ data: ykbResolveXml() })
        .mockResolvedValueOnce({ data: YKB_DECLINED_XML });
      const result = await provider.completeThreeDSPayment({ ...YAPIKREDI_CALLBACK, ...ORDER });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('0225');
      expectNoIds(result);
    });

    it('returns pending with the order id when the charge times out', async () => {
      post.mockResolvedValueOnce({ data: ykbResolveXml() }).mockRejectedValueOnce(timeout());
      const result = await provider.completeThreeDSPayment({ ...YAPIKREDI_CALLBACK, ...ORDER });
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.conversationId).toBe('ORDER3D');
    });
  });

  describe('refund, cancel, getPayment', () => {
    it('refunds by host log key', async () => {
      post.mockResolvedValue({ data: YKB_APPROVED_XML });
      const result = await provider.refund({
        paymentId: '021000000000000123',
        price: '0.5',
        currency: 'TRY',
        ip: '1.1.1.1',
      });
      const xml = sentXml();
      expect(xml).toContain('<return>');
      expect(leaf(xml, 'hostLogKey')).toBe('021000000000000123');
      expect(leaf(xml, 'amount')).toBe('50');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('cancels with reverse', async () => {
      post.mockResolvedValue({ data: YKB_APPROVED_XML });
      const result = await provider.cancel({ paymentId: '021000000000000123', ip: '1.1.1.1' });
      expect(sentXml()).toContain(
        '<reverse><transaction>sale</transaction><hostLogKey>021000000000000123</hostLogKey></reverse>'
      );
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('maps a rejected cancel', async () => {
      post.mockResolvedValue({ data: YKB_DECLINED_XML });
      const result = await provider.cancel({ paymentId: '1', ip: '1.1.1.1' });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('0225');
    });

    it('getPayment queries agreement by order id: a successful sale is success', async () => {
      post.mockResolvedValue({ data: ykbAgreementXml([{}]) });
      const result = await provider.getPayment('ORDER1');
      const xml = decodeURIComponent(post.mock.calls[0][1].slice('xmldata='.length));
      expect(xml).toContain('<agreement><orderID>000000000000000000ORDER1</orderID></agreement>');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('021450428990000191');
      expect(result.conversationId).toBe('ORDER1');
    });

    it('getPayment falls back to the 3D order id, and reports a reverse as cancelled', async () => {
      post
        .mockResolvedValueOnce({
          data: ykbXml({ approved: '0', respCode: 'E219', respText: 'KAYIT BULUNAMADI' }),
        })
        .mockResolvedValueOnce({
          data: ykbAgreementXml([
            { orderID: 'TDS_000000000000ORDER1' },
            { state: 'Sale_Reverse', hostLogKey: '021450428990000192' },
          ]),
        });
      const result = await provider.getPayment('ORDER1');
      const xml = decodeURIComponent(post.mock.calls[1][1].slice('xmldata='.length));
      expect(xml).toContain('<orderID>TDS_00000000000000ORDER1</orderID>');
      expect(result.status).toBe(PaymentStatus.CANCELLED);
    });

    it('getPayment reads an answer that arrives as UTF-16 text', async () => {
      const utf16 = ykbAgreementXml([{}]).split('').join('\u0000');
      post.mockResolvedValue({ data: utf16 });
      expect((await provider.getPayment('ORDER1')).status).toBe(PaymentStatus.SUCCESS);
    });

    it('getPayment: an order with no successful sale is failure', async () => {
      post.mockResolvedValue({ data: ykbAgreementXml([{ txnStatus: '0' }]) });
      expect((await provider.getPayment('ORDER1')).status).toBe(PaymentStatus.FAILURE);
      post.mockReset();
      post.mockResolvedValue({
        data: ykbXml({ approved: '0', respCode: 'E219', respText: 'KAYIT BULUNAMADI' }),
      });
      const missing = await provider.getPayment('ORDER1');
      expect(missing.status).toBe(PaymentStatus.FAILURE);
      expect(missing.errorCode).toBe('E219');
    });
  });

  it('yapikredi() follows mode for the base URL', () => {
    const sandbox = betterPayment({
      mode: 'sandbox',
      providers: { yapikredi: yapikredi(YAPIKREDI_TEST) },
    });
    expect((sandbox.yapikredi as any).config.baseUrl).toBe(YAPIKREDI_BASE_URL);
    const production = betterPayment({ providers: { yapikredi: yapikredi(YAPIKREDI_TEST) } });
    expect((production.yapikredi as any).config.baseUrl).toBe('https://posnet.yapikredi.com.tr');
  });
});
