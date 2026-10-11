import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../../src/core/http';
import { PaymentErrorCode } from '../../../../src/core/error-codes';
import { betterPayment, PROVIDER_DEFAULT_URLS, ProviderType } from '../../../../src';
import { Albaraka, albaraka } from '../../../../src/providers/albaraka';
import {
  formatAlbarakaAmount,
  getAlbarakaCurrencyCode,
  formatAlbarakaInstallment,
  formatAlbarakaExpiry,
  formatAlbarakaOrderId,
} from '../../../../src/providers/albaraka/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';
import {
  ALBARAKA_TEST,
  ALBARAKA_BASE_URL,
  ALBARAKA_SALE_MAC,
  ALBARAKA_3D_MAC,
  ALBARAKA_REFERENCE_MAC,
  ALBARAKA_INQUIRY_MAC,
  ALBARAKA_3D_CALLBACK,
  albarakaResponse,
} from '../../../fixtures/albaraka';

const card = {
  cardHolderName: 'John Doe',
  cardNumber: '5400010000000004',
  expireMonth: '12',
  expireYear: '2030',
  cvc: '000',
};
const order = { ...mockPaymentRequest, paymentCard: card, conversationId: 'ORDER1' };
const timeout = () => new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' });
const formFields = (html: string): Record<string, string> =>
  Object.fromEntries(
    [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [
      m[1],
      m[2],
    ])
  );

describe('Albaraka utils', () => {
  it('formats amount, currency, installment, expiry and order id', () => {
    expect(formatAlbarakaAmount('1.20')).toBe(120);
    expect(getAlbarakaCurrencyCode('TRY')).toBe('TL');
    expect(getAlbarakaCurrencyCode('EUR')).toBe('EU');
    expect(() => getAlbarakaCurrencyCode('JPY')).toThrow();
    expect(formatAlbarakaInstallment(1)).toEqual({ InstallmentCount: 0, InstallmentType: 'N' });
    expect(formatAlbarakaInstallment(3)).toEqual({ InstallmentCount: 3, InstallmentType: 'Y' });
    expect(formatAlbarakaExpiry('1', '2030')).toBe('3001');
    expect(formatAlbarakaOrderId('ORDER1')).toBe('00000000000000ORDER1');
    expect(() => formatAlbarakaOrderId('ORDER-1')).toThrow();
    expect(() => formatAlbarakaOrderId('X'.repeat(21))).toThrow();
  });
});

describe('Albaraka provider', () => {
  let provider: Albaraka;
  let post: ReturnType<typeof vi.fn>;

  const create = (overrides: Partial<ConstructorParameters<typeof Albaraka>[0]> = {}) => {
    const instance = new Albaraka({ ...ALBARAKA_TEST, baseUrl: ALBARAKA_BASE_URL, ...overrides });
    (instance as any).client.post = post;
    return instance;
  };
  const sent = (call = 0) => JSON.parse(post.mock.calls[call][1]);

  beforeEach(() => {
    post = vi.fn();
    provider = create();
  });

  it.each(['merchantId', 'terminalId', 'posnetId', 'encKey'])('requires %s', (field) => {
    expect(() => create({ [field]: '' })).toThrow(field);
  });

  describe('createPayment', () => {
    it('sends a JSON Sale with every data member and the MAC (reference vector)', async () => {
      post.mockResolvedValue({ data: albarakaResponse() });

      const result = await provider.createPayment(order);

      expect(post.mock.calls[0][0]).toBe('/ALBMerchantService/MerchantJSONAPI.svc/Sale');
      const body = sent();
      expect(body).toMatchObject({
        ApiType: 'JSON',
        ApiVersion: 'V100',
        MerchantNo: '6700000067',
        TerminalNo: '67000067',
        CardInformationData: { CardNo: '5400010000000004', ExpireDate: '3012', Cvc2: '000' },
        IsMailOrder: 'N',
        PaymentInstrumentType: 'CARD',
        Amount: 120,
        CurrencyCode: 'TL',
        OrderId: '00000000000000ORDER1',
        InstallmentCount: 0,
        InstallmentType: 'N',
        MAC: ALBARAKA_SALE_MAC,
      });
      // The service rejects requests that leave these out
      expect(body).toHaveProperty('IsTDSecureMerchant', null);
      expect(body).toHaveProperty('PointAmount', null);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('REF123');
      expect(result.conversationId).toBe('ORDER1');
    });

    it('maps a decline', async () => {
      post.mockResolvedValue({ data: albarakaResponse('0148') });
      const result = await provider.createPayment(order);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('0148');
      expect(result.errorMessage).toBe('UNAUTHORIZED REQUEST');
      expect(result.paymentId).toBeUndefined();
    });

    it('rejects order ids the bank does not take', async () => {
      const result = await provider.createPayment({ ...order, conversationId: 'ORDER-1' });
      expect(post).not.toHaveBeenCalled();
      expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
    });

    it('returns pending on a timeout', async () => {
      post.mockRejectedValue(timeout());
      const result = await provider.createPayment(order);
      expect(result.status).toBe(PaymentStatus.PENDING);
    });
  });

  it('initThreeDSPayment returns a signed form to the 3D verification page', async () => {
    const result = await provider.initThreeDSPayment({
      ...mockThreeDSPaymentRequest,
      paymentCard: card,
      conversationId: 'ORDER1',
      installment: 3,
    });

    expect(post).not.toHaveBeenCalled();
    expect(result.status).toBe(PaymentStatus.PENDING);
    const html = result.threeDSHtmlContent!;
    expect(html).toContain(
      `action="${ALBARAKA_BASE_URL}/ALBSecurePaymentUI/SecureProcess/SecureVerification.aspx"`
    );
    expect(formFields(html)).toMatchObject({
      MerchantNo: '6700000067',
      TerminalNo: '67000067',
      PosnetID: '1010',
      TransactionType: 'Sale',
      OrderId: '00000000000000ORDER1',
      Amount: '120',
      CurrencyCode: 'TL',
      MerchantReturnURL: mockThreeDSPaymentRequest.callbackUrl,
      InstallmentCount: '3',
      InstallmentType: 'Y',
      CardNo: '5400010000000004',
      ExpiredDate: '3012',
      Cvv: '000',
      UseOOS: '0',
      MAC: ALBARAKA_SALE_MAC,
    });
    expect(html).not.toContain(ALBARAKA_TEST.encKey);
  });

  describe('completeThreeDSPayment', () => {
    const complete = {
      ...ALBARAKA_3D_CALLBACK,
      orderId: 'ORDER1',
      amount: '1.20',
      currency: 'TRY',
    };

    it('charges with the 3D data and the order values from your records', async () => {
      post.mockResolvedValue({ data: albarakaResponse() });

      const result = await provider.completeThreeDSPayment(complete);

      expect(post.mock.calls[0][0]).toBe('/ALBMerchantService/MerchantJSONAPI.svc/Sale');
      expect(sent()).toMatchObject({
        IsTDSecureMerchant: 'Y',
        ThreeDSecureData: {
          SecureTransactionId: 'SECTXN1',
          CavvData: 'CAVVVALUE=',
          Eci: '05',
          MdStatus: 1,
          MD: 'MDVALUE',
        },
        MACParams: 'MerchantNo:TerminalNo:SecureTransactionId:CavvData:Eci:MdStatus',
        Amount: 120,
        CurrencyCode: 'TL',
        OrderId: '00000000000000ORDER1',
        PointAmount: 0,
        MAC: ALBARAKA_3D_MAC,
      });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('REF123');
      expect(result.conversationId).toBe('ORDER1');
    });

    it('fails without ids when the card was not authenticated', async () => {
      const result = await provider.completeThreeDSPayment({
        ...complete,
        MdStatus: '0',
        MdErrorMessage: 'Not authenticated',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.code).toBe(PaymentErrorCode.THREEDS_FAILED);
      expect(result.errorMessage).toBe('Not authenticated');
      expect(result.conversationId).toBeUndefined();
    });

    it('charges half-secure MdStatus values only when accepted', async () => {
      const rejected = await provider.completeThreeDSPayment({ ...complete, MdStatus: '2' });
      expect(rejected.errorCode).toBe('MD_STATUS_2');
      expect(post).not.toHaveBeenCalled();

      post.mockResolvedValue({ data: albarakaResponse() });
      const accepted = await create({ acceptedMdStatuses: ['1', '2'] }).completeThreeDSPayment({
        ...complete,
        MdStatus: '2',
      });
      expect(sent().ThreeDSecureData.MdStatus).toBe(2);
      expect(accepted.status).toBe(PaymentStatus.SUCCESS);
    });

    it('needs the order id and amount from your records', async () => {
      const result = await provider.completeThreeDSPayment(ALBARAKA_3D_CALLBACK);
      expect(post).not.toHaveBeenCalled();
      expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
      expect(result.errorMessage).toMatch(/orderId and amount/);
    });

    it('fails without ids when the bank declines', async () => {
      post.mockResolvedValue({ data: albarakaResponse('0148') });
      const result = await provider.completeThreeDSPayment(complete);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.paymentId).toBeUndefined();
      expect(result.conversationId).toBeUndefined();
    });

    it('returns pending with the order id on a timeout', async () => {
      post.mockRejectedValue(timeout());
      const result = await provider.completeThreeDSPayment(complete);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.conversationId).toBe('ORDER1');
    });
  });

  it('refunds with Return by ReferenceCode', async () => {
    post.mockResolvedValue({ data: albarakaResponse() });
    const result = await provider.refund({
      paymentId: 'REF123',
      price: '0.5',
      currency: 'TRY',
      ip: '1.1.1.1',
    });
    expect(post.mock.calls[0][0]).toBe('/ALBMerchantService/MerchantJSONAPI.svc/Return');
    expect(sent()).toMatchObject({
      ReferenceCode: 'REF123',
      OrderId: null,
      Amount: 50,
      CurrencyCode: 'TL',
      MACParams: 'MerchantNo:TerminalNo:ReferenceCode:OrderId',
      MAC: ALBARAKA_REFERENCE_MAC,
    });
    expect(result.status).toBe(PaymentStatus.SUCCESS);
  });

  it('cancels with Reverse by ReferenceCode', async () => {
    post.mockResolvedValue({ data: albarakaResponse() });
    const result = await provider.cancel({ paymentId: 'REF123', ip: '1.1.1.1' });
    expect(post.mock.calls[0][0]).toBe('/ALBMerchantService/MerchantJSONAPI.svc/Reverse');
    expect(sent()).toMatchObject({ ReferenceCode: 'REF123', MAC: ALBARAKA_REFERENCE_MAC });
    expect(result.status).toBe(PaymentStatus.SUCCESS);
  });

  describe('getPayment', () => {
    it('looks the order up by order id with TransactionInquiry', async () => {
      post.mockResolvedValue({ data: albarakaResponse('00', { TransactionData: [{}] }) });
      const result = await provider.getPayment('ORDER1');
      expect(post.mock.calls[0][0]).toBe(
        '/ALBMerchantService/MerchantJSONAPI.svc/TransactionInquiry'
      );
      expect(sent()).toMatchObject({
        MACParams: 'MerchantNo:TerminalNo:OrderId',
        OrderId: '00000000000000ORDER1',
        MAC: ALBARAKA_INQUIRY_MAC,
      });
      // The TransactionData format is not confirmed yet, so a found order stays pending
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.conversationId).toBe('ORDER1');
    });

    it('reports an unknown order (E219, as the test host answers) as failure', async () => {
      post.mockResolvedValue({
        data: {
          ServiceResponseData: { ResponseCode: 'E219', ResponseDescription: 'Kayıt Bulunamadı' },
          AuthCode: null,
          ReferenceCode: null,
          TransactionData: null,
        },
      });
      const result = await provider.getPayment('ORDER1');
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('E219');
      expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
    });
  });

  describe('pre-authorization', () => {
    it('authorize() sends the sale body to Auth', async () => {
      post.mockResolvedValue({ data: albarakaResponse() });
      const result = await provider.authorize(order);
      expect(post.mock.calls[0][0]).toBe('/ALBMerchantService/MerchantJSONAPI.svc/Auth');
      expect(sent().MAC).toBe(ALBARAKA_SALE_MAC);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('initThreeDSAuthorize() sets TransactionType Auth, and the completion uses Auth', async () => {
      const init = await provider.initThreeDSAuthorize({
        ...mockThreeDSPaymentRequest,
        paymentCard: card,
        conversationId: 'ORDER1',
      });
      expect(formFields(init.threeDSHtmlContent!).TransactionType).toBe('Auth');

      post.mockResolvedValue({ data: albarakaResponse() });
      await provider.completeThreeDSPayment({
        ...ALBARAKA_3D_CALLBACK,
        orderId: 'ORDER1',
        amount: '1.20',
        transactionType: 'Auth',
      });
      expect(post.mock.calls[0][0]).toBe('/ALBMerchantService/MerchantJSONAPI.svc/Auth');
    });

    it('captures with Capture by ReferenceCode', async () => {
      post.mockResolvedValue({ data: albarakaResponse() });
      const result = await provider.capture({ paymentId: 'REF123', amount: '0.5', ip: '1.1.1.1' });
      expect(post.mock.calls[0][0]).toBe('/ALBMerchantService/MerchantJSONAPI.svc/Capture');
      expect(sent()).toMatchObject({
        MACParams: 'MerchantNo:TerminalNo:ReferenceCode',
        ReferenceCode: 'REF123',
        Amount: 50,
        CurrencyCode: 'TL',
        PointAmount: null,
        InstallmentCount: 0,
        InstallmentType: 'N',
        MAC: ALBARAKA_REFERENCE_MAC,
      });
      expect(sent()).not.toHaveProperty('OrderId');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('voids with Reverse of the Auth', async () => {
      post.mockResolvedValue({ data: albarakaResponse() });
      const result = await provider.voidAuthorization({ paymentId: 'REF123', ip: '1.1.1.1' });
      expect(post.mock.calls[0][0]).toBe('/ALBMerchantService/MerchantJSONAPI.svc/Reverse');
      expect(sent().TransactionType).toBe('Auth');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });
  });

  it('albaraka() follows mode for the base URL', () => {
    const bp = betterPayment({ mode: 'sandbox', providers: { albaraka: albaraka(ALBARAKA_TEST) } });
    expect((bp.albaraka as any).config.baseUrl).toBe(ALBARAKA_BASE_URL);
    expect(PROVIDER_DEFAULT_URLS[ProviderType.ALBARAKA].production).toBe(
      'https://epos.albarakaturk.com.tr'
    );
  });
});
