import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../src/core/http';
import { Parampos, mapParamposOrderStatus } from '../../../src/providers/parampos';
import {
  generateParamposPaymentHash,
  generateParampos3DSVerificationHash,
  verifyParampos3DSCallback,
  formatParamposAmount,
  formatParamposRefundAmount,
  formatParamposExpiryMonth,
  formatParamposExpiryYear,
  formatParamposGsm,
  buildParamposSoapEnvelope,
  parseParamposSoapResponse,
  escapeXml,
  unescapeXml,
  encodeIso88599,
  isParamposSuccess,
  validateTurkishIdentityNumber,
  maskCardNumber,
} from '../../../src/providers/parampos/utils';
import { PaymentStatus } from '../../../src/types';
import { PaymentErrorCode } from '../../../src/core/error-codes';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../fixtures/payment-data';

// Reference values from Param's test environment (also used by the mews/pos test-suite)
const GUID = '0c13d406-873b-403b-9c09-a5766840d98c';

function soap(action: string, fields: Record<string, string>): string {
  const inner = Object.entries(fields)
    .map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
    `<${action}Response xmlns="https://turkpos.com.tr/"><${action}Result>${inner}</${action}Result></${action}Response>` +
    '</soap:Body></soap:Envelope>'
  );
}

describe('Parampos utils', () => {
  it('payment hash matches the reference vector (base64(sha1), ISO-8859-9)', async () => {
    expect(await generateParamposPaymentHash('10738', GUID, '3', '1.000,01', '1.000,01', '202412293F4E')).toBe(
      'jsLYSB3lJ81leFgDLw4D8PbXURs='
    );
  });

  it('3D callback hash matches the reference vector', async () => {
    expect(
      await generateParampos3DSVerificationHash(
        '35513153-9902-4a4c-a256-af6ed9cadc52',
        '581877:A65A349B0BAE27FC6567294215158DD8AE223843B5C96462F04A750CA7E8B165:3680:##500100000',
        '1',
        '2025011749D1',
        GUID
      )
    ).toBe('b1D7+nI3j4k3WGJuhW5IuPOFpEE=');
  });

  describe('verifyParampos3DSCallback', () => {
    const callback = {
      islemGUID: '35513153-9902-4a4c-a256-af6ed9cadc52',
      md: '581877:A65A349B0BAE27FC6567294215158DD8AE223843B5C96462F04A750CA7E8B165:3680:##500100000',
      mdStatus: '1',
      orderId: '2025011749D1',
      islemHash: 'b1D7+nI3j4k3WGJuhW5IuPOFpEE=',
    };

    it('accepts a valid callback', async () => {
      expect(await verifyParampos3DSCallback(callback, GUID)).toBe(true);
    });

    it('rejects a tampered mdStatus', async () => {
      expect(await verifyParampos3DSCallback({ ...callback, mdStatus: '0' }, GUID)).toBe(false);
    });

    it('rejects a callback signed with an attacker-chosen GUID', async () => {
      const attackerGuid = '11111111-1111-1111-1111-111111111111';
      const forged = {
        ...callback,
        GUID: attackerGuid,
        islemHash: await generateParampos3DSVerificationHash(
          callback.islemGUID,
          callback.md,
          '1',
          callback.orderId,
          attackerGuid
        ),
      };
      expect(await verifyParampos3DSCallback(forged, GUID)).toBe(false);
    });

    it('rejects callbacks with missing fields', async () => {
      expect(await verifyParampos3DSCallback({ ...callback, islemHash: undefined }, GUID)).toBe(false);
      expect(await verifyParampos3DSCallback({}, GUID)).toBe(false);
    });
  });

  it('formats payment amounts with a decimal comma', async () => {
    expect(formatParamposAmount('100')).toBe('100,00');
    expect(formatParamposAmount(10.5)).toBe('10,50');
    expect(formatParamposAmount('1.006')).toBe('1,01');
    expect(() => formatParamposAmount('abc')).toThrow();
    expect(() => formatParamposAmount('-1')).toThrow();
  });

  it('formats refund amounts with a decimal dot', async () => {
    expect(formatParamposRefundAmount('10.5')).toBe('10.50');
  });

  it('formats card expiry', async () => {
    expect(formatParamposExpiryMonth('3')).toBe('03');
    expect(() => formatParamposExpiryMonth('13')).toThrow();
    expect(formatParamposExpiryYear('30')).toBe('2030');
    expect(formatParamposExpiryYear('2031')).toBe('2031');
    expect(() => formatParamposExpiryYear('203')).toThrow();
  });

  it('formats GSM numbers to 10 digits', async () => {
    expect(formatParamposGsm('+90 535 000 00 00')).toBe('5350000000');
    expect(formatParamposGsm('05350000000')).toBe('5350000000');
    expect(formatParamposGsm(undefined)).toBe('');
  });

  it('encodes Turkish characters as ISO-8859-9', async () => {
    expect([...encodeIso88599('ğüşİıç')]).toEqual([0xf0, 0xfc, 0xfe, 0xdd, 0xfd, 0xe7]);
  });

  it('escapes and unescapes XML', async () => {
    expect(escapeXml('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
    expect(unescapeXml('&lt;form action=&quot;x&quot;&gt;&#x130;&#252;')).toBe('<form action="x">İü');
    expect(escapeXml(undefined)).toBe('');
  });

  it('builds a SOAP envelope with escaped values', async () => {
    const xml = buildParamposSoapEnvelope('TP_WMD_Pay', { G: { CLIENT_CODE: '1' }, Siparis_ID: 'a<b' });
    expect(xml).toContain('<TP_WMD_Pay xmlns="https://turkpos.com.tr/">');
    expect(xml).toContain('<G><CLIENT_CODE>1</CLIENT_CODE></G>');
    expect(xml).toContain('<Siparis_ID>a&lt;b</Siparis_ID>');
  });

  it('parses results, unescaping HTML and flattening nested elements', async () => {
    const xml = soap('TP_Islem_Sorgulama4', { Sonuc: '1', Sonuc_Str: 'Başarılı' }).replace(
      '<Sonuc>',
      '<DT_Bilgi><Durum>SUCCESS</Durum><Toplam_Tutar>10.01</Toplam_Tutar></DT_Bilgi><Sonuc>'
    );
    const result = parseParamposSoapResponse(xml, 'TP_Islem_Sorgulama4Result');
    expect(result).toMatchObject({ Sonuc: '1', Durum: 'SUCCESS', Toplam_Tutar: '10.01' });

    const html = parseParamposSoapResponse(soap('TP_WMD_UCD', { UCD_HTML: '<form id="x"></form>' }), 'TP_WMD_UCDResult');
    expect(html.UCD_HTML).toBe('<form id="x"></form>');
  });

  it('throws on SOAP faults and missing results', async () => {
    expect(() =>
      parseParamposSoapResponse('<soap:Fault><faultstring>Server was unable</faultstring></soap:Fault>', 'X')
    ).toThrow(/Server was unable/);
    expect(() => parseParamposSoapResponse('<a/>', 'TP_WMD_UCDResult')).toThrow();
  });

  it('isParamposSuccess treats positive codes as success', async () => {
    expect(isParamposSuccess('1')).toBe(true);
    expect(isParamposSuccess('0')).toBe(false);
    expect(isParamposSuccess('-102')).toBe(false);
    expect(isParamposSuccess(undefined)).toBe(false);
  });

  it('maps Durum values', async () => {
    expect(mapParamposOrderStatus('SUCCESS')).toBe(PaymentStatus.SUCCESS);
    expect(mapParamposOrderStatus('REFUND')).toBe(PaymentStatus.CANCELLED);
    expect(mapParamposOrderStatus('CANCEL')).toBe(PaymentStatus.CANCELLED);
    expect(mapParamposOrderStatus('FAIL')).toBe(PaymentStatus.FAILURE);
    expect(mapParamposOrderStatus(undefined)).toBe(PaymentStatus.PENDING);
  });

  it('validates TC identity numbers and masks card numbers', async () => {
    expect(validateTurkishIdentityNumber('10000000146')).toBe(true);
    expect(validateTurkishIdentityNumber('12345678901')).toBe(false);
    expect(maskCardNumber('4446763125813623')).toBe('4446********3623');
  });
});

describe('Parampos provider', () => {
  let parampos: Parampos;
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    parampos = new Parampos({
      clientCode: '10738',
      clientUsername: 'Test',
      clientPassword: 'Test',
      guid: GUID,
      baseUrl: 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx',
    });
    post = vi.fn();
    (parampos as any).client.post = post;
  });

  const sentXml = (call = 0): string => post.mock.calls[call][1];

  it('requires all credentials', async () => {
    expect(
      () =>
        new Parampos({
          clientCode: '1',
          clientUsername: '',
          clientPassword: 'p',
          guid: 'g',
          baseUrl: 'https://x',
        })
    ).toThrow(/clientUsername/);
  });

  it('sends a non-3D payment with TP_WMD_UCD, comma amounts and a valid hash', async () => {
    post.mockResolvedValue({ data: soap('TP_WMD_UCD', { Sonuc: '1', Islem_ID: '3007296556', UCD_HTML: 'NONSECURE' }) });

    const result = await parampos.createPayment({ ...mockPaymentRequest, conversationId: 'ORDER1' });

    const xml = sentXml();
    expect(post.mock.calls[0][2].headers.SOAPAction).toBe('https://turkpos.com.tr/TP_WMD_UCD');
    expect(xml).toContain('<Islem_Guvenlik_Tip>NS</Islem_Guvenlik_Tip>');
    expect(xml).toContain('<Islem_Tutar>1,00</Islem_Tutar>');
    expect(xml).toContain('<Toplam_Tutar>1,20</Toplam_Tutar>');
    expect(xml).toContain('<Siparis_ID>ORDER1</Siparis_ID>');
    expect(xml).toContain('<GUID>' + GUID + '</GUID>');
    expect(xml).toContain(
      `<Islem_Hash>${await generateParamposPaymentHash('10738', GUID, 1, '1,00', '1,20', 'ORDER1')}</Islem_Hash>`
    );
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.paymentId).toBe('ORDER1');
  });

  it('declines when Sonuc > 0 but Islem_ID is 0', async () => {
    post.mockResolvedValue({ data: soap('TP_WMD_UCD', { Sonuc: '-1', Islem_ID: '0', Sonuc_Str: 'Tekrar deneyin' }) });
    const result = await parampos.createPayment(mockPaymentRequest);
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorMessage).toBe('Tekrar deneyin');
  });

  it('rejects non-TRY currencies instead of silently charging TRY', async () => {
    const result = await parampos.createPayment({ ...mockPaymentRequest, currency: 'USD' });
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(post).not.toHaveBeenCalled();
  });

  it('never invents installment commission: Toplam_Tutar is paidPrice', async () => {
    post.mockResolvedValue({ data: soap('TP_WMD_UCD', { Sonuc: '1', UCD_HTML: '<form></form>' }) });
    await parampos.initThreeDSPayment({ ...mockThreeDSPaymentRequest, price: '100', paidPrice: '104.50', installment: 3 });
    const xml = sentXml();
    expect(xml).toContain('<Taksit>3</Taksit>');
    expect(xml).toContain('<Islem_Tutar>100,00</Islem_Tutar>');
    expect(xml).toContain('<Toplam_Tutar>104,50</Toplam_Tutar>');
  });

  it('initializes 3DS and returns the unescaped UCD_HTML', async () => {
    post.mockResolvedValue({ data: soap('TP_WMD_UCD', { Sonuc: '1', UCD_HTML: '<form action="https://bank">x</form>' }) });
    const result = await parampos.initThreeDSPayment({ ...mockThreeDSPaymentRequest, conversationId: 'ORDER3D' });
    expect(sentXml()).toContain('<Islem_Guvenlik_Tip>3D</Islem_Guvenlik_Tip>');
    expect(sentXml()).toContain('<Basarili_URL>https://example.com/callback</Basarili_URL>');
    expect(result.status).toBe(PaymentStatus.PENDING);
    expect(result.threeDSHtmlContent).toBe('<form action="https://bank">x</form>');
    expect(result.paymentId).toBe('ORDER3D');
  });

  describe('completeThreeDSPayment', () => {
    const callback = {
      islemGUID: '35513153-9902-4a4c-a256-af6ed9cadc52',
      md: '581877:A65A349B0BAE27FC6567294215158DD8AE223843B5C96462F04A750CA7E8B165:3680:##500100000',
      mdStatus: '1',
      orderId: '2025011749D1',
      islemHash: 'b1D7+nI3j4k3WGJuhW5IuPOFpEE=',
    };

    it('finalizes with TP_WMD_Pay and succeeds only with a Dekont_ID', async () => {
      post.mockResolvedValue({ data: soap('TP_WMD_Pay', { Sonuc: '1', Dekont_ID: '3007295376', Siparis_ID: callback.orderId }) });

      const result = await parampos.completeThreeDSPayment(callback);

      expect(post).toHaveBeenCalledTimes(1);
      const xml = sentXml();
      expect(xml).toContain('<TP_WMD_Pay xmlns="https://turkpos.com.tr/">');
      expect(xml).toContain(`<UCD_MD>${callback.md}</UCD_MD>`);
      expect(xml).toContain(`<Islem_GUID>${callback.islemGUID}</Islem_GUID>`);
      expect(xml).toContain(`<Siparis_ID>${callback.orderId}</Siparis_ID>`);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe(callback.orderId);
    });

    it('fails when TP_WMD_Pay declines', async () => {
      post.mockResolvedValue({ data: soap('TP_WMD_Pay', { Sonuc: '-100', Sonuc_Ack: 'Hesap bulunamadı.' }) });
      const result = await parampos.completeThreeDSPayment(callback);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toBe('Hesap bulunamadı.');
    });

    it('maps the bank code of a declined TP_WMD_Pay', async () => {
      post.mockResolvedValue({
        data: soap('TP_WMD_Pay', { Sonuc: '-1', Banka_Sonuc_Kod: '51', Sonuc_Str: 'Yetersiz bakiye' }),
      });
      const result = await parampos.completeThreeDSPayment(callback);
      expect(result.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
      expect(result.errorCode).toBe('-1');
    });

    it('rejects forged callbacks without contacting Param', async () => {
      const attackerGuid = 'attacker';
      const forged = {
        ...callback,
        GUID: attackerGuid,
        islemHash: await generateParampos3DSVerificationHash(callback.islemGUID, callback.md, '1', callback.orderId, attackerGuid),
      };
      const result = await parampos.completeThreeDSPayment(forged);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('INVALID_HASH');
      expect(post).not.toHaveBeenCalled();
    });

    it('does not finalize when mdStatus is not 1', async () => {
      const md0 = {
        ...callback,
        mdStatus: '0',
        islemHash: await generateParampos3DSVerificationHash(callback.islemGUID, callback.md, '0', callback.orderId, GUID),
      };
      const result = await parampos.completeThreeDSPayment(md0);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(post).not.toHaveBeenCalled();
    });
  });

  it('refunds with TP_Islem_Iptal_Iade_Kismi2 (IADE, dot amount, Siparis_ID)', async () => {
    post.mockResolvedValue({ data: soap('TP_Islem_Iptal_Iade_Kismi2', { Sonuc: '1', Sonuc_Str: 'OK' }) });
    const result = await parampos.refund({ paymentId: 'ORDER1', price: '5.5', currency: 'TRY', ip: '1.1.1.1' });
    const xml = sentXml();
    expect(xml).toContain('<Durum>IADE</Durum>');
    expect(xml).toContain('<Siparis_ID>ORDER1</Siparis_ID>');
    expect(xml).toContain('<Tutar>5.50</Tutar>');
    expect(result.status).toBe(PaymentStatus.SUCCESS);
  });

  it('cancel looks up the amount when price is not given', async () => {
    post
      .mockResolvedValueOnce({
        data: soap('TP_Islem_Sorgulama4', { Sonuc: '1', Durum: 'SUCCESS', Toplam_Tutar: '10.01', Siparis_ID: 'ORDER1' }),
      })
      .mockResolvedValueOnce({ data: soap('TP_Islem_Iptal_Iade_Kismi2', { Sonuc: '1' }) });

    const result = await parampos.cancel({ paymentId: 'ORDER1', ip: '1.1.1.1' });

    expect(sentXml(1)).toContain('<Durum>IPTAL</Durum>');
    expect(sentXml(1)).toContain('<Tutar>10.01</Tutar>');
    expect(result.status).toBe(PaymentStatus.SUCCESS);
  });

  it('getPayment maps Durum and marks the query as retryable', async () => {
    post.mockResolvedValue({
      data: soap('TP_Islem_Sorgulama4', { Sonuc: '1', Durum: 'REFUND', Siparis_ID: 'ORDER1' }),
    });
    const result = await parampos.getPayment('ORDER1');
    expect(result.status).toBe(PaymentStatus.CANCELLED);
    expect(post.mock.calls[0][2].retryable).toBe(true);
  });

  it('payment requests are not retryable', async () => {
    post.mockResolvedValue({ data: soap('TP_WMD_UCD', { Sonuc: '1', Islem_ID: '1' }) });
    await parampos.createPayment(mockPaymentRequest);
    expect(post.mock.calls[0][2].retryable).toBe(false);
  });

  it('reports network errors as PENDING (outcome unknown)', async () => {
    post.mockRejectedValue(new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' }));
    const result = await parampos.createPayment(mockPaymentRequest);
    expect(result.status).toBe(PaymentStatus.PENDING);
    expect(result.errorCode).toBe('NETWORK_ERROR');
  });

  it('binCheck uses BIN_SanalPos and surfaces errors', async () => {
    post.mockResolvedValueOnce({
      data: soap('BIN_SanalPos', { Sonuc: '1', BIN: '444676', Kart_Banka: 'ZİRAAT', Kart_Org: 'VISA', Kart_Tip: 'Kredi Kartı' }),
    });
    const result = await parampos.binCheck('444676');
    expect(sentXml()).toContain('<BIN>444676</BIN>');
    expect(result.bankName).toBe('ZİRAAT');

    post.mockResolvedValueOnce({ data: soap('BIN_SanalPos', { Sonuc: '-1', Sonuc_Str: 'Hata' }) });
    await expect(parampos.binCheck('000000')).rejects.toThrow('Hata');
  });
});

describe('Parampos error codes', () => {
  let parampos: Parampos;
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    parampos = new Parampos({
      clientCode: '10738',
      clientUsername: 'Test',
      clientPassword: 'Test',
      guid: GUID,
      baseUrl: 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx',
    });
    post = vi.fn();
    (parampos as any).client.post = post;
  });

  async function declineWith(fields: Record<string, string>) {
    post.mockResolvedValue({ data: soap('TP_WMD_UCD', { Islem_ID: '0', Sonuc_Str: 'Hata', ...fields }) });
    return parampos.createPayment(mockPaymentRequest);
  }

  it.each([
    ['51', PaymentErrorCode.INSUFFICIENT_FUNDS],
    ['05', PaymentErrorCode.CARD_DECLINED],
    ['54', PaymentErrorCode.EXPIRED_CARD],
    ['82', PaymentErrorCode.INVALID_CVC],
    ['5', PaymentErrorCode.CARD_DECLINED],
  ])('maps bank code %s from Banka_Sonuc_Kod', async (bankCode, code) => {
    const result = await declineWith({ Sonuc: '-1', Banka_Sonuc_Kod: bankCode });
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.code).toBe(code);
    expect(result.errorCode).toBe('-1');
  });

  it.each([
    ['-105', PaymentErrorCode.INVALID_CVC],
    ['-106', PaymentErrorCode.EXPIRED_CARD],
    ['-119', PaymentErrorCode.INVALID_CARD],
    ['-113', PaymentErrorCode.INVALID_REQUEST],
    ['-101', PaymentErrorCode.PROVIDER_ERROR],
    ['-220', PaymentErrorCode.CARD_DECLINED],
  ])('maps Sonuc %s', async (sonuc, code) => {
    const result = await declineWith({ Sonuc: sonuc });
    expect(result.code).toBe(code);
    expect(result.errorCode).toBe(sonuc);
  });

  it('falls back to Sonuc when the bank code is not mapped', async () => {
    const result = await declineWith({ Sonuc: '-105', Banka_Sonuc_Kod: '99' });
    expect(result.code).toBe(PaymentErrorCode.INVALID_CVC);
  });

  it('returns UNKNOWN with the raw value for unmapped codes', async () => {
    const result = await declineWith({ Sonuc: '-999' });
    expect(result.code).toBe(PaymentErrorCode.UNKNOWN);
    expect(result.errorCode).toBe('-999');
  });
});
