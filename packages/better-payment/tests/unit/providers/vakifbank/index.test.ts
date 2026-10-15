import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../../src/core/http';
import { PaymentErrorCode } from '../../../../src/core/error-codes';
import { betterPayment } from '../../../../src';
import { VakifBank, vakifbank } from '../../../../src/providers/vakifbank';
import {
  formatVakifBankAmount,
  getVakifBankCurrencyCode,
  formatVakifBankInstallment,
  formatVakifBankMpiExpiry,
  formatVakifBankVposExpiry,
  getVakifBankBrandName,
  validateVakifBankOrderId,
  buildVakifBankRequestBody,
  parseVakifBankXml,
} from '../../../../src/providers/vakifbank/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';

// Store values are made up; response shapes follow the VakıfBank test services
const VAKIF_TEST = { merchantId: '000000000111111', password: 'apipass', terminalNo: 'VP000001' };
const BASE_URL = 'https://onlineodemetest.vakifbank.com.tr:4443';

const vposXml = (fields: Record<string, string>) =>
  '<?xml version="1.0" encoding="utf-8"?><VposResponse>' +
  Object.entries(fields)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('') +
  '</VposResponse>';
const APPROVED = vposXml({
  MerchantId: VAKIF_TEST.merchantId,
  TransactionType: 'Sale',
  TransactionId: 'ORDER3D',
  ResultCode: '0000',
  ResultDetail: 'İŞLEM BAŞARILI',
  AuthCode: '985347',
  Rrn: '918911726582',
  CurrencyAmount: '1.20',
  CurrencyCode: '949',
});
const DECLINED = vposXml({ ResultCode: '0051', ResultDetail: 'YETERSIZ BAKIYE' });
const ENROLLED = `<?xml version="1.0" encoding="utf-8" ?><IPaySecure><Message ID="m1"><VERes><Version>1.0.2</Version><Status>Y</Status><PaReq>PAREQVALUE</PaReq><ACSUrl>https://acs.example-bank.test/pareq</ACSUrl><TermUrl>https://3dsecuretest.vakifbank.com.tr/MPIAPI/MPI_PARes.aspx</TermUrl><MD>MDVALUE</MD><ACTUALBRAND>200</ACTUALBRAND></VERes></Message><VerifyEnrollmentRequestId>ORDER3D</VerifyEnrollmentRequestId><MessageErrorCode>200</MessageErrorCode></IPaySecure>`;
const NOT_FOUND = `<?xml version="1.0" encoding="utf-8"?><IPaySecure><Message><VERes><Status>E</Status></VERes></Message><VerifyEnrollmentRequestId>ORDER3D</VerifyEnrollmentRequestId><MessageErrorCode>9093</MessageErrorCode><ErrorMessage>Aranan İşyeri Kaydı Bulunamadı.</ErrorMessage></IPaySecure>`;
const CALLBACK = {
  MerchantId: VAKIF_TEST.merchantId,
  VerifyEnrollmentRequestId: 'ORDER3D',
  Status: 'Y',
  Xid: 'XIDVALUE',
  PurchAmount: '120',
  PurchCurrency: '949',
  ExpiryDate: '3012',
  Eci: '02',
  Cavv: 'CAVVVALUE=',
  SessionInfo: '85.34.78.112',
};
const timeout = () => new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' });

describe('VakıfBank utils', () => {
  it('formats amount, currency, installment, expiry and brand', () => {
    expect(formatVakifBankAmount('1.2')).toBe('1.20');
    expect(formatVakifBankAmount(1234.5)).toBe('1234.50');
    expect(getVakifBankCurrencyCode(undefined)).toBe('949');
    expect(getVakifBankCurrencyCode('usd')).toBe('840');
    expect(() => getVakifBankCurrencyCode('CHF')).toThrow(/not supported/);
    expect(formatVakifBankInstallment(1)).toBeUndefined();
    expect(formatVakifBankInstallment(6)).toBe(6);
    expect(formatVakifBankMpiExpiry('3', '2025')).toBe('2503');
    expect(formatVakifBankVposExpiry('3', '25')).toBe('202503');
    expect(() => formatVakifBankVposExpiry('13', '2025')).toThrow(/Invalid card expiry/);
    expect(getVakifBankBrandName('4289450189088488')).toBe('100');
    expect(getVakifBankBrandName('5528790000000008')).toBe('200');
    expect(getVakifBankBrandName('9792030000000000')).toBe('300');
    expect(getVakifBankBrandName('375987000000088')).toBe('400');
  });

  it('accepts order ids of up to 40 letters, digits, "-" or "_"', () => {
    expect(validateVakifBankOrderId('ORDER_3D-1')).toBe('ORDER_3D-1');
    expect(() => validateVakifBankOrderId('A'.repeat(41))).toThrow();
    expect(() => validateVakifBankOrderId('ORDER 1')).toThrow();
  });

  it('posts the XML as prmstr', () => {
    const body = buildVakifBankRequestBody('VposRequest', { MerchantId: '1', ClientIp: '1.1.1.1' });
    expect(decodeURIComponent(body.slice('prmstr='.length))).toBe(
      '<?xml version="1.0" encoding="utf-8"?><VposRequest><MerchantId>1</MerchantId><ClientIp>1.1.1.1</ClientIp></VposRequest>'
    );
  });

  it('parses answers', () => {
    expect(parseVakifBankXml(APPROVED, 'VposResponse')).toMatchObject({
      ResultCode: '0000',
      AuthCode: '985347',
    });
    expect(() => parseVakifBankXml('<html/>', 'VposResponse')).toThrow(/unexpected response/);
  });
});

describe('VakıfBank provider', () => {
  let provider: VakifBank;
  let post: ReturnType<typeof vi.fn>;

  const create = (overrides: Partial<ConstructorParameters<typeof VakifBank>[0]> = {}) => {
    const instance = new VakifBank({
      ...VAKIF_TEST,
      baseUrl: BASE_URL,
      testMode: true,
      ...overrides,
    });
    (instance as any).client.post = post;
    return instance;
  };

  beforeEach(() => {
    post = vi.fn();
    provider = create();
  });

  const sentXml = (call = 0) =>
    decodeURIComponent((post.mock.calls[call][1] as string).slice('prmstr='.length));
  const leaf = (xml: string, tag: string) =>
    (xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1];
  const expectNoIds = (result: { paymentId?: string; conversationId?: string }) => {
    expect(result.paymentId).toBeUndefined();
    expect(result.conversationId).toBeUndefined();
  };

  it.each(['merchantId', 'password', 'terminalNo'])('requires %s', (field) => {
    expect(() => create({ [field]: '' })).toThrow(field);
  });

  describe('createPayment', () => {
    it('sends a non-3D sale to VPOS', async () => {
      post.mockResolvedValue({ data: APPROVED });

      const result = await provider.createPayment({
        ...mockPaymentRequest,
        conversationId: 'ORDER1',
        installment: 3,
      });

      expect(post.mock.calls[0][0]).toBe('/VposService/v3/Vposreq.aspx');
      const xml = sentXml();
      expect(leaf(xml, 'MerchantId')).toBe(VAKIF_TEST.merchantId);
      expect(leaf(xml, 'TerminalNo')).toBe('VP000001');
      expect(leaf(xml, 'TransactionType')).toBe('Sale');
      expect(leaf(xml, 'TransactionId')).toBe('ORDER1');
      expect(leaf(xml, 'CurrencyAmount')).toBe('1.20');
      expect(leaf(xml, 'Expiry')).toBe('203012');
      expect(leaf(xml, 'NumberOfInstallments')).toBe('3');
      expect(leaf(xml, 'ClientIp')).toBe('85.34.78.112');
      expect(leaf(xml, 'TransactionDeviceSource')).toBe('0');
      expect(xml).not.toContain('<ECI>');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDER1');
    });

    it('omits the installment count for a single payment', async () => {
      post.mockResolvedValue({ data: APPROVED });
      await provider.createPayment({ ...mockPaymentRequest, conversationId: 'ORDER1' });
      expect(sentXml()).not.toContain('NumberOfInstallments');
    });

    it('maps a decline', async () => {
      post.mockResolvedValue({ data: DECLINED });
      const result = await provider.createPayment({
        ...mockPaymentRequest,
        conversationId: 'ORDER1',
      });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('0051');
      expect(result.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
    });
  });

  describe('initThreeDSPayment', () => {
    it('enrolls the card and returns the ACS form', async () => {
      post.mockResolvedValue({ data: ENROLLED });

      const result = await provider.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        conversationId: 'ORDER3D',
      });

      expect(post.mock.calls[0][0]).toBe(
        'https://3dsecuretest.vakifbank.com.tr:4443/MPIAPI/MPI_Enrollment.aspx'
      );
      const form = new URLSearchParams(post.mock.calls[0][1] as string);
      expect(Object.fromEntries(form)).toMatchObject({
        MerchantId: VAKIF_TEST.merchantId,
        MerchantPassword: 'apipass',
        VerifyEnrollmentRequestId: 'ORDER3D',
        Pan: '5528790000000008',
        ExpiryDate: '3012',
        PurchaseAmount: '1.20',
        Currency: '949',
        BrandName: '200',
        SuccessUrl: 'https://example.com/callback',
        FailureUrl: 'https://example.com/callback',
        SessionInfo: '85.34.78.112',
      });
      expect(result.status).toBe(PaymentStatus.PENDING);
      const html = result.threeDSHtmlContent!;
      expect(html).toContain('action="https://acs.example-bank.test/pareq"');
      expect(html).toContain('name="PaReq" value="PAREQVALUE"');
      expect(html).toContain('name="MD" value="MDVALUE"');
      expect(result.paymentId).toBe('ORDER3D');
    });

    it('uses the production MPI outside test mode', async () => {
      post.mockResolvedValue({ data: ENROLLED });
      await create({ testMode: false }).initThreeDSPayment(mockThreeDSPaymentRequest);
      expect(post.mock.calls[0][0]).toBe(
        'https://3dsecure.vakifbank.com.tr:4443/MPIAPI/MPI_Enrollment.aspx'
      );
    });

    it('fails when the enrollment is rejected', async () => {
      post.mockResolvedValue({ data: NOT_FOUND });
      const result = await provider.initThreeDSPayment(mockThreeDSPaymentRequest);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('9093');
      expect(result.code).toBe(PaymentErrorCode.PROVIDER_ERROR);
      expect(result.threeDSHtmlContent).toBeUndefined();
    });

    it('stops for a card that is not enrolled', async () => {
      post.mockResolvedValue({
        data: '<IPaySecure><Message ID="x"/><VERes><Version>1.0.2</Version><Status>N</Status></VERes></IPaySecure>',
      });
      const result = await provider.initThreeDSPayment(mockThreeDSPaymentRequest);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toMatch(/not enrolled/);
    });
  });

  describe('completeThreeDSPayment', () => {
    it('charges with MpiTransactionId, without card or amount', async () => {
      post.mockResolvedValue({ data: APPROVED });

      const result = await provider.completeThreeDSPayment(CALLBACK);

      const xml = sentXml();
      expect(leaf(xml, 'TransactionType')).toBe('Sale');
      expect(leaf(xml, 'MpiTransactionId')).toBe('ORDER3D');
      expect(leaf(xml, 'TransactionId')).toBe('ORDER3D');
      expect(leaf(xml, 'ECI')).toBe('02');
      expect(leaf(xml, 'CAVV')).toBe('CAVVVALUE=');
      expect(leaf(xml, 'ClientIp')).toBe('85.34.78.112');
      for (const tag of ['Pan', 'Expiry', 'CurrencyAmount', 'CurrencyCode']) {
        expect(xml).not.toContain(`<${tag}>`);
      }
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDER3D');
      expect(result.conversationId).toBe('ORDER3D');
    });

    it('ignores an amount in the callback', async () => {
      post.mockResolvedValue({ data: APPROVED });
      await provider.completeThreeDSPayment({ ...CALLBACK, PurchAmount: '1' });
      expect(sentXml()).not.toContain('CurrencyAmount');
    });

    it('sends the installment count from the callback', async () => {
      post.mockResolvedValue({ data: APPROVED });
      await provider.completeThreeDSPayment({ ...CALLBACK, InstallmentCount: '6' });
      expect(leaf(sentXml(), 'NumberOfInstallments')).toBe('6');
    });

    it.each(['A', 'U', 'E', 'N', undefined])('fails without ids for Status %s', async (status) => {
      const result = await provider.completeThreeDSPayment({ ...CALLBACK, Status: status });
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.code).toBe(PaymentErrorCode.THREEDS_FAILED);
      expectNoIds(result);
    });

    it('rejects a callback of another merchant', async () => {
      const result = await provider.completeThreeDSPayment({ ...CALLBACK, MerchantId: '999' });
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('fails without ids when VPOS declines', async () => {
      post.mockResolvedValue({ data: DECLINED });
      const result = await provider.completeThreeDSPayment(CALLBACK);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('0051');
      expectNoIds(result);
    });

    it('returns pending with the order id when VPOS times out', async () => {
      post.mockRejectedValue(timeout());
      const result = await provider.completeThreeDSPayment(CALLBACK);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.paymentId).toBe('ORDER3D');
    });
  });

  describe('refund, cancel, getPayment', () => {
    it('refunds by reference transaction id', async () => {
      post.mockResolvedValue({ data: vposXml({ ResultCode: '0000', TransactionId: 'R1' }) });
      const result = await provider.refund({
        paymentId: 'ORDER3D',
        price: '0.5',
        currency: 'TRY',
        ip: '1.1.1.1',
      });
      const xml = sentXml();
      expect(leaf(xml, 'TransactionType')).toBe('Refund');
      expect(leaf(xml, 'ReferenceTransactionId')).toBe('ORDER3D');
      expect(leaf(xml, 'CurrencyAmount')).toBe('0.50');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.refundId).toBe('R1');
    });

    it('cancels by reference transaction id', async () => {
      post.mockResolvedValue({ data: vposXml({ ResultCode: '0000', TransactionId: 'C1' }) });
      const result = await provider.cancel({ paymentId: 'ORDER3D', ip: '1.1.1.1' });
      expect(leaf(sentXml(), 'TransactionType')).toBe('Cancel');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    // The record search by order id returns the order's approved sale but not the
    // cancel or refund records, so it cannot give the current status: getPayment()
    // must not report a reversed payment as paid.
    it.each([
      ['a cancel', (p: VakifBank) => p.cancel({ paymentId: 'ORDER3D', ip: '1.1.1.1' })],
      [
        'a full refund',
        (p: VakifBank) =>
          p.refund({ paymentId: 'ORDER3D', price: '1.20', currency: 'TRY', ip: '1.1.1.1' }),
      ],
    ])('does not report a sale as paid after %s', async (_case, reverse) => {
      post.mockResolvedValueOnce({ data: APPROVED });
      expect(
        (await provider.createPayment({ ...mockPaymentRequest, conversationId: 'ORDER3D' })).status
      ).toBe(PaymentStatus.SUCCESS);
      post.mockResolvedValueOnce({ data: vposXml({ ResultCode: '0000', TransactionId: 'REV1' }) });
      expect((await reverse(provider)).status).toBe(PaymentStatus.SUCCESS);
      post.mockClear();

      await expect(provider.getPayment('ORDER3D')).rejects.toMatchObject({
        code: 'NOT_SUPPORTED',
      });
      expect(post).not.toHaveBeenCalled();
    });
  });

  it('vakifbank() follows mode for the base URL and MPI', () => {
    const sandbox = betterPayment({
      mode: 'sandbox',
      providers: { vakifbank: vakifbank(VAKIF_TEST) },
    });
    expect((sandbox.vakifbank as any).config).toMatchObject({ baseUrl: BASE_URL, testMode: true });
    const production = betterPayment({ providers: { vakifbank: vakifbank(VAKIF_TEST) } });
    expect((production.vakifbank as any).config).toMatchObject({
      baseUrl: 'https://onlineodeme.vakifbank.com.tr:4443',
      testMode: false,
    });
  });
});
