import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../../src/core/http';
import { PaymentErrorCode } from '../../../../src/core/error-codes';
import { betterPayment, PROVIDER_DEFAULT_URLS, ProviderType } from '../../../../src';
import { VakifKatilim, vakifKatilim } from '../../../../src/providers/vakifkatilim';
import {
  buildVakifKatilimXml,
  decodeVakifKatilimPaymentId,
  formatVakifKatilimInstallment,
  getVakifKatilimCurrencyCode,
  parseVakifKatilimResponse,
} from '../../../../src/providers/vakifkatilim/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';
import {
  VAKIFKATILIM_TEST,
  VAKIFKATILIM_BASE_URL,
  VAKIFKATILIM_3D_HASH,
  VAKIFKATILIM_NON3D_HASH,
  VAKIFKATILIM_PARTIAL_HASH,
  VAKIFKATILIM_REVERSAL_HASH,
  VAKIFKATILIM_REJECTED_3D_PAGE,
  VAKIFKATILIM_ACS_PAGE,
  VAKIFKATILIM_CALLBACK,
  vakifKatilimResponse,
} from '../../../fixtures/vakifkatilim';

const timeout = () => new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' });
const order = { ...mockPaymentRequest, conversationId: 'ORDER1' };

describe('Vakıf Katılım utils', () => {
  it('formats currency and installment, and reads the response', () => {
    expect(getVakifKatilimCurrencyCode('TRY')).toBe('0949');
    expect(getVakifKatilimCurrencyCode('USD')).toBe('0840');
    expect(() => getVakifKatilimCurrencyCode('GBP')).toThrow();
    expect(formatVakifKatilimInstallment(1)).toBe('0');
    expect(formatVakifKatilimInstallment(6)).toBe('6');
    // The echoed VPosMessage is skipped
    expect(parseVakifKatilimResponse(vakifKatilimResponse())).toMatchObject({
      ResponseCode: '00',
      OrderId: '123456',
      MerchantOrderId: 'ORDER1',
    });
    expect(() => parseVakifKatilimResponse('<html/>')).toThrow();
  });

  it('sends non-ASCII characters as character references', () => {
    expect(buildVakifKatilimXml({ CardHolderName: 'Şükrü' })).toContain(
      '<CardHolderName>&#350;&#252;kr&#252;</CardHolderName>'
    );
  });

  it('decodes the paymentId', () => {
    expect(decodeVakifKatilimPaymentId('ORDER1:123456')).toEqual({
      merchantOrderId: 'ORDER1',
      orderId: '123456',
    });
    expect(() => decodeVakifKatilimPaymentId('ORDER1')).toThrow();
    expect(() => decodeVakifKatilimPaymentId('ORDER1:0')).toThrow();
  });
});

describe('Vakıf Katılım provider', () => {
  let provider: VakifKatilim;
  let post: ReturnType<typeof vi.fn>;

  const create = (overrides: Partial<ConstructorParameters<typeof VakifKatilim>[0]> = {}) => {
    const instance = new VakifKatilim({
      ...VAKIFKATILIM_TEST,
      baseUrl: VAKIFKATILIM_BASE_URL,
      ...overrides,
    });
    (instance as any).client.post = post;
    return instance;
  };
  const sentXml = (call = 0) => post.mock.calls[call][1] as string;
  const tag = (xml: string, name: string) =>
    new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];

  beforeEach(() => {
    post = vi.fn();
    provider = create();
  });

  it.each(['merchantId', 'customerId', 'username', 'password'])('requires %s', (field) => {
    expect(() => create({ [field]: '' })).toThrow(field);
  });

  describe('createPayment', () => {
    it('sends a Non3DPayGate request (reference hash)', async () => {
      post.mockResolvedValue({ data: vakifKatilimResponse() });

      const result = await provider.createPayment(order);

      expect(post.mock.calls[0][0]).toBe('/Home/Non3DPayGate');
      const xml = sentXml();
      expect(xml).toMatch(/^<\?xml version="1.0" encoding="ISO-8859-1"\?><VPosMessageContract>/);
      expect(tag(xml, 'HashData')).toBe(VAKIFKATILIM_NON3D_HASH);
      expect(tag(xml, 'MerchantId')).toBe('9999');
      expect(tag(xml, 'CustomerId')).toBe('8888');
      expect(tag(xml, 'Amount')).toBe('120');
      expect(tag(xml, 'FECCurrencyCode')).toBe('0949');
      expect(tag(xml, 'CardExpireDateYear')).toBe('30');
      expect(tag(xml, 'TransactionSecurity')).toBe('1');
      expect(xml).not.toContain('TESTPASS');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDER1:123456');
      expect(result.conversationId).toBe('ORDER1');
    });

    it('maps a rejection', async () => {
      post.mockResolvedValue({
        data: vakifKatilimResponse({
          ResponseCode: 'MerchantNotDefined',
          ResponseMessage: 'Uye isyeri kullanici tanimi bulunamadi.',
          OrderId: '0',
        }),
      });
      const result = await provider.createPayment(order);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('MerchantNotDefined');
      expect(result.code).toBe(PaymentErrorCode.PROVIDER_ERROR);
      expect(result.paymentId).toBeUndefined();
    });

    it('keeps the first line of a technical error', async () => {
      post.mockResolvedValue({
        data: vakifKatilimResponse({
          ResponseCode: 'TechnicalException',
          ResponseMessage: 'System.FormatException: bad\r\n   at System.Convert',
          OrderId: '0',
        }),
      });
      const result = await provider.createPayment(order);
      expect(result.errorMessage).toBe('System.FormatException: bad');
    });

    it('returns pending on a timeout', async () => {
      post.mockRejectedValue(timeout());
      expect((await provider.createPayment(order)).status).toBe(PaymentStatus.PENDING);
    });
  });

  describe('initThreeDSPayment', () => {
    const request = { ...mockThreeDSPaymentRequest, conversationId: 'ORDER1' };

    it("returns the bank's 3D page for a signed ThreeDModelPayGate request", async () => {
      post.mockResolvedValue({ data: VAKIFKATILIM_ACS_PAGE });

      const result = await provider.initThreeDSPayment(request);

      expect(post.mock.calls[0][0]).toBe('/Home/ThreeDModelPayGate');
      const xml = sentXml();
      expect(tag(xml, 'OkUrl')).toBe('https://example.com/callback');
      expect(tag(xml, 'HashData')).toBe(VAKIFKATILIM_3D_HASH);
      expect(tag(xml, 'TransactionSecurity')).toBe('3');
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.threeDSHtmlContent).toBe(VAKIFKATILIM_ACS_PAGE);
    });

    it('fails at once when the gateway rejects the request', async () => {
      post.mockResolvedValue({ data: VAKIFKATILIM_REJECTED_3D_PAGE });
      const result = await provider.initThreeDSPayment(request);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('MerchantNotDefined');
      expect(result.errorMessage).toBe('Uye isyeri kullanici tanimi bulunamadi.');
    });
  });

  describe('completeThreeDSPayment', () => {
    const complete = {
      ...VAKIFKATILIM_CALLBACK,
      orderId: 'ORDER1',
      amount: '1.20',
      callbackUrl: 'https://example.com/callback',
    };

    it('charges with ThreeDModelProvisionGate and the MD', async () => {
      post.mockResolvedValue({ data: vakifKatilimResponse() });

      const result = await provider.completeThreeDSPayment(complete);

      expect(post.mock.calls[0][0]).toBe('/Home/ThreeDModelProvisionGate');
      const xml = sentXml();
      expect(tag(xml, 'HashData')).toBe(VAKIFKATILIM_3D_HASH);
      expect(tag(xml, 'MerchantOrderId')).toBe('ORDER1');
      expect(xml).toContain(
        '<AdditionalData><AdditionalDataList><VPosAdditionalData><Key>MD</Key><Data>ENCRYPTEDMD==</Data></VPosAdditionalData></AdditionalDataList></AdditionalData>'
      );
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDER1:123456');
    });

    it('fails without ids when the card was not verified', async () => {
      const result = await provider.completeThreeDSPayment({
        ...complete,
        ResponseCode: 'CardNotVerified',
        ResponseMessage: 'Kart doğrulanamadı',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('CardNotVerified');
      expect(result.conversationId).toBeUndefined();
    });

    it('rejects a callback for another order', async () => {
      const result = await provider.completeThreeDSPayment({
        ...complete,
        MerchantOrderId: 'OTHER',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_CALLBACK');
    });

    it('needs the order values from your records', async () => {
      const result = await provider.completeThreeDSPayment(VAKIFKATILIM_CALLBACK);
      expect(post).not.toHaveBeenCalled();
      expect(result.errorMessage).toMatch(/orderId, amount and callbackUrl/);
    });

    it('fails without ids when the provision is declined', async () => {
      post.mockResolvedValue({
        data: vakifKatilimResponse({
          ResponseCode: '51',
          ResponseMessage: 'Yetersiz bakiye',
          OrderId: '0',
        }),
      });
      const result = await provider.completeThreeDSPayment(complete);
      expect(result.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
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

  describe('cancel and refund', () => {
    it('cancels with SaleReversal and the bank OrderId', async () => {
      post.mockResolvedValue({ data: vakifKatilimResponse() });
      const result = await provider.cancel({ paymentId: 'ORDER1:123456', ip: '1.1.1.1' });
      expect(post.mock.calls[0][0]).toBe('/Home/SaleReversal');
      const xml = sentXml();
      expect(tag(xml, 'MerchantOrderId')).toBe('ORDER1');
      expect(tag(xml, 'OrderId')).toBe('123456');
      expect(tag(xml, 'HashData')).toBe(VAKIFKATILIM_REVERSAL_HASH);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('refunds part of a payment with PartialDrawback', async () => {
      post.mockResolvedValue({ data: vakifKatilimResponse() });
      const result = await provider.refund({
        paymentId: 'ORDER1:123456',
        price: '0.5',
        currency: 'TRY',
        ip: '1.1.1.1',
      });
      expect(post.mock.calls[0][0]).toBe('/Home/PartialDrawback');
      expect(tag(sentXml(), 'Amount')).toBe('50');
      expect(tag(sentXml(), 'HashData')).toBe(VAKIFKATILIM_PARTIAL_HASH);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('refunds a whole payment with Drawback', async () => {
      post.mockResolvedValue({ data: vakifKatilimResponse() });
      await provider.refund({
        paymentId: 'ORDER1:123456',
        price: '1.2',
        currency: 'TRY',
        ip: '1.1.1.1',
        fullRefund: true,
      });
      expect(post.mock.calls[0][0]).toBe('/Home/Drawback');
    });

    it('rejects a paymentId without the bank OrderId', async () => {
      const result = await provider.cancel({ paymentId: 'ORDER1', ip: '1.1.1.1' });
      expect(post).not.toHaveBeenCalled();
      expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
    });
  });

  it('getPayment is not supported', async () => {
    await expect(provider.getPayment('ORDER1:123456')).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    });
  });

  it('vakifKatilim() uses the gateway in both modes', () => {
    const bp = betterPayment({
      mode: 'sandbox',
      providers: { vakifkatilim: vakifKatilim(VAKIFKATILIM_TEST) },
    });
    expect((bp.vakifkatilim as any).config.baseUrl).toBe(VAKIFKATILIM_BASE_URL);
    expect(PROVIDER_DEFAULT_URLS[ProviderType.VAKIFKATILIM].production).toBe(VAKIFKATILIM_BASE_URL);
  });
});
