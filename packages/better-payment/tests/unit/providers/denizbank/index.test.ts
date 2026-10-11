import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../../src/core/http';
import { PaymentErrorCode } from '../../../../src/core/error-codes';
import { betterPayment } from '../../../../src';
import { Denizbank, denizbank } from '../../../../src/providers/denizbank';
import {
  createDenizbank3DHash,
  verifyDenizbankCallback,
  formatDenizbankAmount,
  getDenizbankCurrencyCode,
  formatDenizbankInstallment,
  formatDenizbankExpiry,
  getDenizbankCardType,
  parseDenizbankResponse,
} from '../../../../src/providers/denizbank/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';

// Store values are made up; hashes are computed independently (Python hashlib)
const TEST = {
  shopCode: '9999',
  userCode: 'apiuser',
  userPass: 'apipass',
  merchantPass: 'TESTSTOREKEY',
};
const BASE_URL = 'https://test.inter-vpos.com.tr';
const CALLBACK = {
  Version3D: '2.0',
  PurchAmount: '1.20',
  TotalAmount: '1.20',
  InstallmentCount: '',
  Currency: '949',
  OrderId: 'ORDER3D',
  TxnType: 'Auth',
  ShopCode: '9999',
  '3DStatus': '1',
  MD: 'MDVALUE123',
  PayerTxnId: 'XIDVALUE=',
  Eci: '05',
  PayerAuthenticationCode: 'CAVVVALUE=',
  HASHPARAMS:
    'Version3D:PurchAmount:TotalAmount:InstallmentCount:Currency:OrderId:TxnType:ShopCode:3DStatus:MD',
  HASHPARAMSVAL: '2.01.201.20949ORDER3DAuth99991MDVALUE123',
  HASH: 'cV+UFR1qPHiX/I8VFi2DNpn9G20=',
};
const answer = (fields: Record<string, string>) =>
  Object.entries({ OrderId: '', HostRefNum: '', AuthCode: '', TxnResult: '', ...fields })
    .map(([k, v]) => `${k}=${v}`)
    .join(';;') + ';;';
const APPROVED = answer({
  ProcReturnCode: '00',
  ErrorMessage: '',
  OrderId: 'ORDER3D',
  AuthCode: '123456',
  TxnResult: 'Success',
  TransId: 'T1',
});
const DECLINED = answer({
  ProcReturnCode: '51',
  ErrorCode: '51',
  ErrorMessage: 'Yetersiz bakiye',
  TxnResult: 'Failed',
});
const timeout = () => new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' });

describe('Denizbank utils', () => {
  it('computes the 3D form hash (reference vector)', async () => {
    expect(
      await createDenizbank3DHash({
        shopCode: '9999',
        orderId: 'ORDER3D',
        amount: '1.20',
        okUrl: 'https://example.com/callback',
        failUrl: 'https://example.com/callback',
        txnType: 'Auth',
        installment: '',
        rnd: '0123456789abcdef0123456789abcdef',
        merchantPass: TEST.merchantPass,
      })
    ).toBe('iOJGlbU8NMSpo5xow2StNX9p36w=');
  });

  describe('verifyDenizbankCallback', () => {
    it('accepts the reference callback', async () => {
      expect(await verifyDenizbankCallback(CALLBACK, TEST.merchantPass)).toBe(true);
    });

    it('rebuilds the value from the fields, ignoring a forged HASHPARAMSVAL', async () => {
      // The genuine HASH and HASHPARAMSVAL, with the order id changed
      expect(
        await verifyDenizbankCallback({ ...CALLBACK, OrderId: 'OTHER' }, TEST.merchantPass)
      ).toBe(false);
    });

    it('requires HASHPARAMS to cover OrderId', async () => {
      expect(
        await verifyDenizbankCallback(
          { ...CALLBACK, HASHPARAMS: 'Version3D:MD' },
          TEST.merchantPass
        )
      ).toBe(false);
    });

    it('rejects a wrong store key or a missing HASH', async () => {
      expect(await verifyDenizbankCallback(CALLBACK, 'other')).toBe(false);
      expect(
        await verifyDenizbankCallback({ ...CALLBACK, HASH: undefined }, TEST.merchantPass)
      ).toBe(false);
    });
  });

  it('formats amount, currency, installment, expiry and card type', () => {
    expect(formatDenizbankAmount('1.2')).toBe('1.20');
    expect(getDenizbankCurrencyCode('usd')).toBe('840');
    expect(() => getDenizbankCurrencyCode('JPY')).toThrow(/not supported/);
    expect(formatDenizbankInstallment(1)).toBe('');
    expect(formatDenizbankInstallment(3)).toBe('3');
    expect(formatDenizbankExpiry('1', '2030')).toBe('0130');
    expect(getDenizbankCardType('4111111111111111')).toBe('visa');
    expect(getDenizbankCardType('5528790000000008')).toBe('mastercard');
    expect(getDenizbankCardType('375987000000088')).toBe('amex');
  });

  it('parses Key=Value;; answers', () => {
    const parsed = parseDenizbankResponse(
      'ProcReturnCode=96;;ErrorCode=031;;ErrorMessage=Gecersiz Islem Tipi;;OrderId=;;HostRefNum=hostid;;;TRXDATE=01.01.0001 00:00:00;;'
    );
    expect(parsed).toMatchObject({
      ProcReturnCode: '96',
      ErrorCode: '031',
      ErrorMessage: 'Gecersiz Islem Tipi',
      OrderId: '',
      TRXDATE: '01.01.0001 00:00:00',
    });
    expect(() => parseDenizbankResponse('<html/>')).toThrow(/unexpected response/);
  });
});

describe('Denizbank provider', () => {
  let provider: Denizbank;
  let post: ReturnType<typeof vi.fn>;

  const create = (overrides: Partial<ConstructorParameters<typeof Denizbank>[0]> = {}) => {
    const instance = new Denizbank({ ...TEST, baseUrl: BASE_URL, ...overrides });
    (instance as any).client.post = post;
    return instance;
  };

  beforeEach(() => {
    post = vi.fn();
    provider = create();
  });

  const sent = (call = 0) =>
    Object.fromEntries(new URLSearchParams(post.mock.calls[call][1] as string));
  const expectNoIds = (result: { paymentId?: string; conversationId?: string }) => {
    expect(result.paymentId).toBeUndefined();
    expect(result.conversationId).toBeUndefined();
  };

  it.each(['shopCode', 'userCode', 'userPass', 'merchantPass'])('requires %s', (field) => {
    expect(() => create({ [field]: '' })).toThrow(field);
  });

  it('createPayment sends a NonSecure Auth', async () => {
    post.mockResolvedValue({ data: APPROVED });
    const result = await provider.createPayment({
      ...mockPaymentRequest,
      conversationId: 'ORDER1',
    });
    expect(post.mock.calls[0][0]).toBe('/mpi/Default.aspx');
    expect(sent()).toMatchObject({
      ShopCode: '9999',
      UserCode: 'apiuser',
      UserPass: 'apipass',
      TxnType: 'Auth',
      SecureType: 'NonSecure',
      OrderId: 'ORDER1',
      PurchAmount: '1.20',
      Currency: '949',
      CardType: 'mastercard',
      Expiry: '1230',
      MOTO: '0',
    });
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.paymentId).toBe('ORDER1');
  });

  it('createPayment maps a decline', async () => {
    post.mockResolvedValue({ data: DECLINED });
    const result = await provider.createPayment(mockPaymentRequest);
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
  });

  it('initThreeDSPayment returns a signed 3DModel form without the API password', async () => {
    const result = await provider.initThreeDSPayment({
      ...mockThreeDSPaymentRequest,
      conversationId: 'ORDER3D',
    });
    expect(post).not.toHaveBeenCalled();
    const html = result.threeDSHtmlContent!;
    expect(html).toContain(`action="${BASE_URL}/mpi/Default.aspx"`);
    const fields = Object.fromEntries(
      [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [
        m[1],
        m[2],
      ])
    );
    expect(fields).toMatchObject({
      ShopCode: '9999',
      SecureType: '3DModel',
      TxnType: 'Auth',
      OrderId: 'ORDER3D',
      PurchAmount: '1.20',
    });
    expect(fields).not.toHaveProperty('UserPass');
    expect(html).not.toContain(TEST.userPass);
    expect(html).not.toContain(TEST.merchantPass);
    expect(fields.Hash).toBe(
      await createDenizbank3DHash({
        shopCode: '9999',
        orderId: 'ORDER3D',
        amount: '1.20',
        okUrl: fields.OkUrl,
        failUrl: fields.FailUrl,
        txnType: 'Auth',
        installment: '',
        rnd: fields.Rnd,
        merchantPass: TEST.merchantPass,
      })
    );
  });

  describe('completeThreeDSPayment', () => {
    it('charges a verified callback with the 3D Secure data', async () => {
      post.mockResolvedValue({ data: APPROVED });
      const result = await provider.completeThreeDSPayment(CALLBACK);
      expect(sent()).toMatchObject({
        TxnType: 'Auth',
        SecureType: 'NonSecure',
        OrderId: 'ORDER3D',
        PurchAmount: '1.20',
        Currency: '949',
        MD: 'MDVALUE123',
        PayerTxnId: 'XIDVALUE=',
        Eci: '05',
        PayerAuthenticationCode: 'CAVVVALUE=',
      });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDER3D');
    });

    it('rejects a callback with a changed order id as INVALID_HASH', async () => {
      const result = await provider.completeThreeDSPayment({
        ...CALLBACK,
        OrderId: 'SOMEONE-ELSE',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('fails without ids when the bank declines', async () => {
      post.mockResolvedValue({ data: DECLINED });
      const result = await provider.completeThreeDSPayment(CALLBACK);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expectNoIds(result);
    });

    it('returns pending with the order id on a timeout', async () => {
      post.mockRejectedValue(timeout());
      const result = await provider.completeThreeDSPayment(CALLBACK);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.paymentId).toBe('ORDER3D');
    });
  });

  describe('completeThreeDSPayment (3DPay)', () => {
    // In 3DPay the bank charged the card; HASHPARAMS must cover the result
    const PAY_CALLBACK = {
      OrderId: 'ORDERPAY',
      PurchAmount: '1.20',
      ProcReturnCode: '00',
      '3DStatus': '1',
      HASHPARAMS: 'OrderId:PurchAmount:ProcReturnCode:3DStatus',
      HASHPARAMSVAL: 'ORDERPAY1.20001',
      HASH: 'd2XPSTYKP1rwyweOp+tpxXu7HE8=',
    };
    beforeEach(() => {
      provider = create({ secureType: '3DPay' });
    });

    it('sends SecureType 3DPay in the form', async () => {
      const result = await provider.initThreeDSPayment(mockThreeDSPaymentRequest);
      expect(result.threeDSHtmlContent).toContain('name="SecureType" value="3DPay"');
    });

    it("takes the bank's answer from a verified callback, without charging again", async () => {
      const result = await provider.completeThreeDSPayment(PAY_CALLBACK);
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDERPAY');
    });

    it('fails without ids on a declined callback', async () => {
      const result = await provider.completeThreeDSPayment({
        ...PAY_CALLBACK,
        ProcReturnCode: '51',
        HASHPARAMSVAL: 'ORDERPAY1.20511',
        HASH: 'AvjlCVCcooUtRHqTDlHJG5PHVCY=',
      });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
      expectNoIds(result);
    });

    it('rejects a callback whose hash does not cover the result', async () => {
      const result = await provider.completeThreeDSPayment({
        OrderId: 'ORDERPAY',
        ProcReturnCode: '00',
        HASHPARAMS: 'OrderId',
        HASHPARAMSVAL: 'ORDERPAY',
        HASH: 'VEB83cRSF+yDAPk/+DicLS1WEb4=',
      });
      expect(result.errorCode).toBe('INVALID_HASH');
    });
  });

  it('refunds and cancels by orgOrderId', async () => {
    post.mockResolvedValue({ data: APPROVED });
    const refund = await provider.refund({
      paymentId: 'ORDER1',
      price: '0.5',
      currency: 'TRY',
      ip: '1.1.1.1',
    });
    expect(sent(0)).toMatchObject({ TxnType: 'Refund', orgOrderId: 'ORDER1', PurchAmount: '0.50' });
    expect(refund.refundId).toBe('T1');
    const cancel = await provider.cancel({ paymentId: 'ORDER1', ip: '1.1.1.1' });
    expect(sent(1)).toMatchObject({ TxnType: 'Void', orgOrderId: 'ORDER1' });
    expect(cancel.status).toBe(PaymentStatus.SUCCESS);
  });

  it('does not support order status yet', async () => {
    await expect(provider.getPayment('x')).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
  });

  it('denizbank() follows mode for the base URL', () => {
    const sandbox = betterPayment({ mode: 'sandbox', providers: { denizbank: denizbank(TEST) } });
    expect((sandbox.denizbank as any).config.baseUrl).toBe(BASE_URL);
    const production = betterPayment({ providers: { denizbank: denizbank(TEST) } });
    expect((production.denizbank as any).config.baseUrl).toBe('https://inter-vpos.com.tr');
  });
});
