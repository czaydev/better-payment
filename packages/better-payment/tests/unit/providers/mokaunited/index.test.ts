import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { HttpError } from '../../../../src/core/http';
import { BetterPaymentHandler } from '../../../../src/core/BetterPaymentHandler';
import { PaymentErrorCode } from '../../../../src/core/error-codes';
import { betterPayment } from '../../../../src';
import {
  MokaUnited,
  mokaUnited,
  mokaUnitedPaymentStatus,
} from '../../../../src/providers/mokaunited';
import {
  createMokaUnitedCheckKey,
  createMokaUnitedHashValue,
  getMokaUnitedCurrency,
  formatMokaUnitedInstallment,
} from '../../../../src/providers/mokaunited/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';
import {
  MOKAUNITED_BASE_URL,
  MOKAUNITED_TEST,
  mokaDetail,
  mokaError,
  mokaOk,
} from '../../../fixtures/mokaunited';

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const timeout = () => new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' });
const CODE_FOR_HASH = '9FDFBDFC-42C5-417E-AA93-E4D9D5312AAC';

describe('Moka United utils', () => {
  it('builds the CheckKey as SHA-256(DealerCode + "MK" + Username + "PD" + Password)', async () => {
    expect(await createMokaUnitedCheckKey(MOKAUNITED_TEST)).toBe(
      sha256('DEALER1MKapiuserPDapipass')
    );
  });

  it('builds the callback hash as SHA-256(CodeForHash + "T" / "F")', async () => {
    expect(await createMokaUnitedHashValue(CODE_FOR_HASH, true)).toBe(sha256(`${CODE_FOR_HASH}T`));
    expect(await createMokaUnitedHashValue(CODE_FOR_HASH, false)).toBe(sha256(`${CODE_FOR_HASH}F`));
  });

  it('maps currencies and installments', () => {
    expect(getMokaUnitedCurrency(undefined)).toBe('TL');
    expect(getMokaUnitedCurrency('eur')).toBe('EUR');
    expect(() => getMokaUnitedCurrency('JPY')).toThrow(/not supported/);
    expect(formatMokaUnitedInstallment(undefined)).toBe(1);
    expect(() => formatMokaUnitedInstallment(13)).toThrow(/1 to 12/);
  });

  it('maps payment details as the Sipay provider does', () => {
    const status = (detail: Record<string, unknown>) =>
      mokaUnitedPaymentStatus(mokaDetail(detail).Data as never);
    expect(status({})).toBe(PaymentStatus.SUCCESS);
    expect(status({ RefAmount: 0.5 })).toBe(PaymentStatus.SUCCESS);
    expect(status({ PaymentStatus: 1 })).toBe(PaymentStatus.SUCCESS);
    expect(status({ PaymentStatus: 3 })).toBe(PaymentStatus.CANCELLED);
    expect(status({ PaymentStatus: 4 })).toBe(PaymentStatus.CANCELLED);
    expect(status({ TrxStatus: 2 })).toBe(PaymentStatus.FAILURE);
    expect(status({ PaymentStatus: 0, TrxStatus: 0 })).toBe(PaymentStatus.PENDING);
    expect(mokaUnitedPaymentStatus(undefined)).toBe(PaymentStatus.PENDING);
  });
});

describe('Moka United provider', () => {
  let provider: MokaUnited;
  let post: ReturnType<typeof vi.fn>;

  const create = (overrides: Partial<ConstructorParameters<typeof MokaUnited>[0]> = {}) => {
    const instance = new MokaUnited({
      ...MOKAUNITED_TEST,
      baseUrl: MOKAUNITED_BASE_URL,
      ...overrides,
    });
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

  it.each(['dealerCode', 'username', 'password'])('requires %s', (field) => {
    expect(() => create({ [field]: '' })).toThrow(field);
  });

  it('follows mode for the base URL', () => {
    const sandbox = betterPayment({
      mode: 'sandbox',
      providers: { moka: mokaUnited(MOKAUNITED_TEST) },
    });
    const live = betterPayment({ providers: { moka: mokaUnited(MOKAUNITED_TEST) } });
    expect((sandbox.use('moka') as any).config.baseUrl).toBe('https://service.refmokaunited.com');
    expect((live.use('moka') as any).config.baseUrl).toBe('https://service.mokaunited.com');
  });

  describe('createPayment / authorize', () => {
    it('sends a signed non-3D payment with the order id as OtherTrxCode', async () => {
      post.mockResolvedValue({
        data: mokaOk({ IsSuccessful: true, ResultCode: '', VirtualPosOrderId: 'ORDER-1' }),
      });
      const result = await provider.createPayment({
        ...mockPaymentRequest,
        conversationId: 'ORDERMU',
        installment: 3,
      });

      expect(post.mock.calls[0][0]).toBe('/PaymentDealer/DoDirectPayment');
      expect(post.mock.calls[0][2]).toMatchObject({ retryable: false });
      const body = sent();
      expect(body.PaymentDealerAuthentication).toEqual({
        DealerCode: 'DEALER1',
        Username: 'apiuser',
        Password: 'apipass',
        CheckKey: sha256('DEALER1MKapiuserPDapipass'),
      });
      expect(body.PaymentDealerRequest).toMatchObject({
        CardHolderFullName: 'John Doe',
        CardNumber: '5528790000000008',
        ExpMonth: '12',
        ExpYear: '2030',
        CvcNumber: '123',
        Amount: 1.2,
        Currency: 'TL',
        InstallmentNumber: 3,
        ClientIP: '85.34.78.112',
        OtherTrxCode: 'ORDERMU',
        IsPreAuth: 0,
        IsPoolPayment: 0,
        IsTokenized: 0,
        Software: 'better-payment',
      });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDERMU');
    });

    it('sends IsPreAuth 1 for authorize()', async () => {
      post.mockResolvedValue({ data: mokaOk({ IsSuccessful: true, VirtualPosOrderId: 'O1' }) });
      await provider.authorize({ ...mockPaymentRequest, conversationId: 'ORDERMU' });
      expect(sent().PaymentDealerRequest.IsPreAuth).toBe(1);
    });

    it('maps a bank decline and a request error, without ids', async () => {
      post.mockResolvedValue({
        data: mokaOk({ IsSuccessful: false, ResultCode: '002', ResultMessage: 'Limit Yetersiz' }),
      });
      const declined = await provider.createPayment(mockPaymentRequest);
      expect(declined.status).toBe(PaymentStatus.FAILURE);
      expect(declined.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
      expectNoIds(declined);

      post.mockResolvedValue({ data: mokaError('PaymentDealer.DoDirectPayment.ThreeDRequired') });
      const refused = await provider.createPayment(mockPaymentRequest);
      expect(refused.errorCode).toBe('PaymentDealer.DoDirectPayment.ThreeDRequired');
      expect(refused.code).toBe(PaymentErrorCode.INVALID_REQUEST);
    });
  });

  describe('initThreeDSPayment', () => {
    it('returns the 3D page and the CodeForHash to keep with the order', async () => {
      const url = 'https://service.refmokaunited.com/PaymentDealerThreeDProcess?threeDTrxCode=abc';
      post.mockResolvedValue({ data: mokaOk({ Url: url, CodeForHash: CODE_FOR_HASH }) });

      const result = await provider.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        conversationId: 'ORDERMU',
      });

      expect(post.mock.calls[0][0]).toBe('/PaymentDealer/DoDirectPaymentThreeD');
      expect(sent().PaymentDealerRequest).toMatchObject({
        ReturnHash: 1,
        RedirectUrl: 'https://example.com/callback',
        OtherTrxCode: 'ORDERMU',
      });
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.redirectUrl).toBe(url);
      expect(result.threeDSHtmlContent).toContain(url);
      expect(result.codeForHash).toBe(CODE_FOR_HASH);
      expect(result.paymentId).toBe('ORDERMU');
    });

    it('fails when Moka United refuses it', async () => {
      post.mockResolvedValue({
        data: mokaError('PaymentDealer.CheckPaymentDealerAuthentication.InvalidAccount'),
      });
      const result = await provider.initThreeDSPayment(mockThreeDSPaymentRequest);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.codeForHash).toBeUndefined();
    });
  });

  describe('completeThreeDSPayment', () => {
    const callback = async (successful = true, overrides: Record<string, unknown> = {}) => ({
      hashValue: await createMokaUnitedHashValue(CODE_FOR_HASH, successful),
      resultCode: successful ? '' : '025',
      resultMessage: successful ? '' : '3D Onay Alma Hatası',
      trxCode: 'ORDER-17131QQFG04026575',
      OtherTrxCode: 'ORDERMU',
      ...overrides,
    });
    const trusted = { codeForHash: CODE_FOR_HASH };

    it('confirms a "T" hash with the payment detail', async () => {
      post.mockResolvedValue({ data: mokaDetail() });
      const result = await provider.completeThreeDSPayment(await callback(), trusted);
      expect(post.mock.calls[0][0]).toBe('/PaymentDealer/GetDealerPaymentTrxDetailList');
      expect(sent().PaymentDealerRequest).toEqual({ PaymentId: '', OtherTrxCode: 'ORDERMU' });
      expect(post.mock.calls[0][2]).toMatchObject({ retryable: true });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDERMU');
    });

    it('fails an "F" hash with the callback error, without a request or ids', async () => {
      const result = await provider.completeThreeDSPayment(await callback(false), trusted);
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('025');
      expect(result.code).toBe(PaymentErrorCode.THREEDS_FAILED);
      expectNoIds(result);
    });

    it('requires the codeForHash from your records', async () => {
      const result = await provider.completeThreeDSPayment(await callback());
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect(post).not.toHaveBeenCalled();
    });

    it('rejects a hash made for another payment', async () => {
      const result = await provider.completeThreeDSPayment(
        { ...(await callback()), hashValue: sha256('OTHER-CODE-FOR-HASHT') },
        trusted
      );
      expect(result.errorCode).toBe('INVALID_HASH');
      expect(post).not.toHaveBeenCalled();
      expectNoIds(result);
    });

    it.each([
      ['another order', mokaDetail({ OtherTrxCode: 'OTHER' })],
      ['a failed payment', mokaDetail({ TrxStatus: 2 })],
      ['a voided payment', mokaDetail({ PaymentStatus: 3 })],
      [
        'a different trxCode',
        mokaDetail({}, [{ TrxType: 2, TrxStatus: 1, VirtualPosOrderId: 'X' }]),
      ],
      ['no record', mokaError('PaymentDealer.GetDealerPaymentTrxDetailList.PaymentNotFound')],
    ])('rejects a valid hash when Moka United shows %s', async (_case, detail) => {
      post.mockResolvedValue({ data: detail });
      const result = await provider.completeThreeDSPayment(await callback(), trusted);
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('checks the amount when given, and prefers the order id from your records', async () => {
      post.mockResolvedValue({ data: mokaDetail() });
      const ok = await provider.completeThreeDSPayment(
        await callback(true, { OtherTrxCode: 'FORGED' }),
        { ...trusted, orderId: 'ORDERMU', amount: '1.20' }
      );
      expect(sent().PaymentDealerRequest.OtherTrxCode).toBe('ORDERMU');
      expect(ok.status).toBe(PaymentStatus.SUCCESS);

      const wrong = await provider.completeThreeDSPayment(await callback(), {
        ...trusted,
        amount: '99.00',
      });
      expect(wrong.errorCode).toBe('INVALID_HASH');
    });

    // The default handler passes only the HTTP body: a client must not be able to supply
    // the secret or the order
    it('ignores codeForHash, orderId and amount sent in the callback body', async () => {
      const forgedCode = 'ATTACKER-CODE';
      const body = {
        ...(await callback()),
        hashValue: sha256(`${forgedCode}T`),
        codeForHash: forgedCode,
        orderId: 'SOMEONE-ELSES-ORDER',
        amount: '1.20',
      };
      const direct = await provider.completeThreeDSPayment(body);
      expect(direct.errorCode).toBe('VALIDATION_ERROR');
      expect(post).not.toHaveBeenCalled();

      const payment = betterPayment({
        mode: 'sandbox',
        providers: { mokaunited: mokaUnited(MOKAUNITED_TEST) },
      });
      (payment.use('mokaunited') as any).client.post = post;
      const onCallback = vi.fn();
      await new BetterPaymentHandler(payment, { onCallback }).handle({
        method: 'POST',
        url: '/api/pay/mokaunited/callback',
        headers: { 'content-type': 'application/json' },
        body,
      });
      expect(post).not.toHaveBeenCalled();
      expect(onCallback).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: PaymentStatus.SUCCESS }),
        expect.anything()
      );
      expect(onCallback).not.toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: 'SOMEONE-ELSES-ORDER' }),
        expect.anything()
      );
    });

    it('keeps the ids on a timeout only for an order from your records', async () => {
      post.mockRejectedValue(timeout());
      const unsigned = await provider.completeThreeDSPayment(await callback(), trusted);
      expect(unsigned.status).toBe(PaymentStatus.PENDING);
      expectNoIds(unsigned);
      const withOrder = await provider.completeThreeDSPayment(await callback(), {
        ...trusted,
        orderId: 'ORDERMU',
      });
      expect(withOrder.paymentId).toBe('ORDERMU');
    });
  });

  describe('capture, cancel, refund, getPayment', () => {
    it('captures, voids and releases by order id', async () => {
      post.mockResolvedValue({ data: mokaOk({ IsSuccessful: true, ResultCode: '00' }) });
      expect(
        (await provider.capture({ paymentId: 'ORDERMU', amount: '1.00', ip: '1.2.3.4' })).status
      ).toBe(PaymentStatus.SUCCESS);
      expect(post.mock.calls[0][0]).toBe('/PaymentDealer/DoCapture');
      expect(sent(0).PaymentDealerRequest).toMatchObject({ OtherTrxCode: 'ORDERMU', Amount: 1 });

      expect((await provider.cancel({ paymentId: 'ORDERMU', ip: '1.2.3.4' })).status).toBe(
        PaymentStatus.SUCCESS
      );
      expect(post.mock.calls[1][0]).toBe('/PaymentDealer/DoVoid');
      expect(sent(1).PaymentDealerRequest).toMatchObject({
        OtherTrxCode: 'ORDERMU',
        VoidRefundReason: 2,
      });

      expect(
        (await provider.voidAuthorization({ paymentId: 'ORDERMU', ip: '1.2.3.4' })).status
      ).toBe(PaymentStatus.SUCCESS);
    });

    it('fails a void the bank declines', async () => {
      post.mockResolvedValue({
        data: mokaOk({ IsSuccessful: false, ResultCode: '004', ResultMessage: 'Genel Red' }),
      });
      const result = await provider.cancel({ paymentId: 'ORDERMU', ip: '1.2.3.4' });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('004');
    });

    it('returns a refund request as pending', async () => {
      post.mockResolvedValue({ data: mokaOk({ IsSuccessful: true, RefundRequestId: '1356' }) });
      const result = await provider.refund({
        paymentId: 'ORDERMU',
        price: '0.50',
        currency: 'TRY',
        ip: '1.2.3.4',
      });
      expect(post.mock.calls[0][0]).toBe('/PaymentDealer/DoCreateRefundRequest');
      expect(sent().PaymentDealerRequest).toMatchObject({ OtherTrxCode: 'ORDERMU', Amount: 0.5 });
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.refundId).toBe('1356');
    });

    it('reports a void and a full refund as cancelled', async () => {
      post.mockResolvedValueOnce({ data: mokaDetail({ PaymentStatus: 3 }) });
      expect((await provider.getPayment('ORDERMU')).status).toBe(PaymentStatus.CANCELLED);
      post.mockResolvedValueOnce({ data: mokaDetail({ PaymentStatus: 4, RefAmount: 1.2 }) });
      expect((await provider.getPayment('ORDERMU')).status).toBe(PaymentStatus.CANCELLED);
    });

    it('reports an unknown order as a failure', async () => {
      post.mockResolvedValue({
        data: mokaError('PaymentDealer.GetDealerPaymentTrxDetailList.PaymentNotFound'),
      });
      const result = await provider.getPayment('NOPE');
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('PaymentDealer.GetDealerPaymentTrxDetailList.PaymentNotFound');
    });
  });

  describe('BIN and installments', () => {
    const CARD = {
      BankName: 'FİNANSBANK',
      BankCode: '111',
      BinNumber: '52691100',
      CardType: 'MASTER',
      CreditType: 'CreditCard',
      ProductCategory: 'Bireysel',
      GroupName: 'CARDFINANS',
    };

    it('reads the card for a BIN', async () => {
      post.mockResolvedValue({ data: mokaOk(CARD) });
      const bin = await provider.binCheck('52691100');
      expect(post.mock.calls[0][0]).toBe('/PaymentDealer/GetBankCardInformation');
      expect(sent().BankCardInformationRequest).toEqual({ BinNumber: '52691100' });
      expect(bin).toMatchObject({
        cardType: 'CREDIT_CARD',
        cardAssociation: 'MASTER_CARD',
        cardFamily: 'CARDFINANS',
        bankName: 'FİNANSBANK',
        bankCode: 111,
        commercial: false,
      });
    });

    it('lists the counts Moka United calculates an amount for', async () => {
      post.mockImplementation(async (_url: string, body: string) => {
        const count = JSON.parse(body).PaymentDealerRequest.InstallmentNumber;
        return count <= 3
          ? {
              data: mokaOk({
                PaymentAmount: 100 + count,
                DealerCommissionRate: count,
                BankCard: CARD,
              }),
            }
          : { data: mokaError('PaymentDealer.DoCalcPaymentAmount.InvalidInstallmentNumber') };
      });
      const result = await provider.installmentInfo({ binNumber: '52691100', price: '100.00' });
      expect(post).toHaveBeenCalledTimes(12);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.installmentDetails![0].installmentPrices).toEqual([
        { installmentNumber: 1, totalPrice: 101, installmentPrice: 101, commissionRate: 1 },
        { installmentNumber: 2, totalPrice: 102, installmentPrice: 51, commissionRate: 2 },
        { installmentNumber: 3, totalPrice: 103, installmentPrice: 34.33, commissionRate: 3 },
      ]);
      expect(result.installmentDetails![0].cardFamilyName).toBe('CARDFINANS');
    });

    it('fails when no count is allowed', async () => {
      post.mockResolvedValue({
        data: mokaError('PaymentDealer.DoCalcPaymentAmount.DealerDoNotBinNumberInquiryAllowed'),
      });
      const result = await provider.installmentInfo({ binNumber: '52691100', price: '100.00' });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      await expect(provider.binCheck('52691100')).rejects.toThrow(/BIN query failed/);
    });
  });
});
