import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../../src/core/http';
import { BetterPaymentHandler } from '../../../../src/core/BetterPaymentHandler';
import { PaymentErrorCode } from '../../../../src/core/error-codes';
import { betterPayment } from '../../../../src';
import {
  Garanti,
  garanti,
  mapGarantiOrderStatus,
  isGarantiCapturedSale,
} from '../../../../src/providers/garanti';
import {
  createGarantiHashData,
  createGaranti3DHash,
  parseGarantiXmlResponse,
} from '../../../../src/providers/garanti/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';
import {
  GARANTI_TEST,
  GARANTI_BASE_URL,
  GARANTI_SECURITY_DATA,
  GARANTI_3D_CALLBACK,
  GARANTI_3DPAY_CALLBACK,
  GARANTI_APPROVED_XML,
  garantiXml,
  garantiInquiryXml,
} from '../../../fixtures/garanti';

const leaf = (xml: string, tag: string) =>
  (xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1];
const formFields = (html: string): Record<string, string> =>
  Object.fromEntries(
    [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [
      m[1],
      m[2].replace(/&amp;/g, '&'),
    ])
  );
const timeout = () => new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' });
const DECLINED = garantiXml(
  { Code: '92', ReasonCode: '0651', Message: 'Declined', ErrorMsg: 'Kullanıcı şifresi hatalı' },
  { RetrefNum: '' }
);

describe('Garanti BBVA provider', () => {
  let provider: Garanti;
  let post: ReturnType<typeof vi.fn>;

  const create = (overrides: Partial<ConstructorParameters<typeof Garanti>[0]> = {}) => {
    const instance = new Garanti({
      ...GARANTI_TEST,
      baseUrl: GARANTI_BASE_URL,
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

  const sent = (call = 0) => post.mock.calls[call][1] as string;
  const expectNoIds = (result: { paymentId?: string; conversationId?: string }) => {
    expect(result.paymentId).toBeUndefined();
    expect(result.conversationId).toBeUndefined();
  };

  it.each(['merchantId', 'terminalId', 'password', 'storeKey'])('requires %s', (field) => {
    expect(() => create({ [field]: '' })).toThrow(field);
  });

  it('rejects an unknown securityLevel', () => {
    expect(() => create({ securityLevel: '3D_HALF' as any })).toThrow(/securityLevel/);
  });

  describe('createPayment', () => {
    it('sends a signed non-3D sale', async () => {
      post.mockResolvedValue({ data: GARANTI_APPROVED_XML });

      const result = await provider.createPayment({
        ...mockPaymentRequest,
        conversationId: 'ORDER1',
      });

      expect(post.mock.calls[0][0]).toBe('/VPServlet');
      expect(post.mock.calls[0][2]).toMatchObject({ responseType: 'text', retryable: false });
      const xml = sent();
      expect(xml).toMatch(
        /^<\?xml version="1.0" encoding="UTF-8"\?><GVPSRequest><Mode>TEST<\/Mode>/
      );
      expect(leaf(xml, 'Version')).toBe('512');
      expect(leaf(xml, 'ProvUserID')).toBe('PROVAUT');
      expect(leaf(xml, 'MerchantID')).toBe('7000679');
      expect(leaf(xml, 'IPAddress')).toBe('85.34.78.112');
      expect(leaf(xml, 'Number')).toBe('5528790000000008');
      expect(leaf(xml, 'ExpireDate')).toBe('1230');
      expect(leaf(xml, 'Type')).toBe('sales');
      expect(leaf(xml, 'Amount')).toBe('120');
      expect(leaf(xml, 'CardholderPresentCode')).toBe('0');
      expect(leaf(xml, 'HashData')).toBe(
        await createGarantiHashData({
          orderId: 'ORDER1',
          terminalId: GARANTI_TEST.terminalId,
          cardNumber: '5528790000000008',
          amount: '120',
          currencyCode: '949',
          securityData: GARANTI_SECURITY_DATA,
        })
      );
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDER1');
    });

    it('sends Mode PROD outside test mode', async () => {
      post.mockResolvedValue({ data: GARANTI_APPROVED_XML });
      await create({ testMode: false }).createPayment(mockPaymentRequest);
      expect(leaf(sent(), 'Mode')).toBe('PROD');
    });

    it('maps a bank decline by its reason code', async () => {
      post.mockResolvedValue({
        data: garantiXml({
          Code: '51',
          ReasonCode: '51',
          Message: 'Declined',
          ErrorMsg: 'Bakiye yetersiz',
        }),
      });
      const result = await provider.createPayment(mockPaymentRequest);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('51');
      expect(result.errorMessage).toBe('Bakiye yetersiz');
      expect(result.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
    });

    it('returns pending on a timeout', async () => {
      post.mockRejectedValue(timeout());
      const result = await provider.createPayment(mockPaymentRequest);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.code).toBe(PaymentErrorCode.NETWORK_ERROR);
    });
  });

  describe('initThreeDSPayment', () => {
    it('returns a signed form to the 3D engine', async () => {
      const result = await provider.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        conversationId: 'ORDER3D',
        installment: 3,
      });

      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.PENDING);
      const html = result.threeDSHtmlContent!;
      expect(html).toContain(`action="${GARANTI_BASE_URL}/servlet/gt3dengine"`);
      const fields = formFields(html);
      expect(fields).toMatchObject({
        secure3dsecuritylevel: '3D',
        mode: 'TEST',
        apiversion: '512',
        terminalprovuserid: 'PROVAUT',
        terminalmerchantid: '7000679',
        terminalid: '30691297',
        txntype: 'sales',
        txnamount: '120',
        txncurrencycode: '949',
        txninstallmentcount: '3',
        orderid: 'ORDER3D',
        successurl: 'https://example.com/callback',
        errorurl: 'https://example.com/callback',
        customeripaddress: '85.34.78.112',
        cardnumber: '5528790000000008',
        cardexpiredatemonth: '12',
        cardexpiredateyear: '30',
        cardcvv2: '123',
      });
      expect(fields.secure3dhash).toBe(
        await createGaranti3DHash({
          terminalId: GARANTI_TEST.terminalId,
          orderId: 'ORDER3D',
          amount: '120',
          currencyCode: '949',
          successUrl: 'https://example.com/callback',
          errorUrl: 'https://example.com/callback',
          type: 'sales',
          installment: '3',
          storeKey: GARANTI_TEST.storeKey,
          securityData: GARANTI_SECURITY_DATA,
        })
      );
      expect(result.paymentId).toBe('ORDER3D');
    });

    it('uses the 3D_PAY level and failUrl when configured', async () => {
      const result = await create({ securityLevel: '3D_PAY' }).initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        failUrl: 'https://example.com/fail',
      });
      const fields = formFields(result.threeDSHtmlContent!);
      expect(fields.secure3dsecuritylevel).toBe('3D_PAY');
      expect(fields.errorurl).toBe('https://example.com/fail');
    });
  });

  describe('completeThreeDSPayment (3D)', () => {
    const ORDER = { orderId: 'ORDER3D', amount: '1.20' };
    // The same signed byte sequence, split differently: clientid gives its last
    // digit to oid, and the hash still verifies
    const RESPLIT = {
      ...GARANTI_3D_CALLBACK,
      clientid: '3069129',
      oid: '7ORDER3D',
      orderid: '7ORDER3D',
    };

    it('provisions a verified callback for the order from your records', async () => {
      post.mockResolvedValue({ data: GARANTI_APPROVED_XML });

      const result = await provider.completeThreeDSPayment(GARANTI_3D_CALLBACK, ORDER);

      const xml = sent();
      expect(leaf(xml, 'OrderID')).toBe('ORDER3D');
      expect(leaf(xml, 'Type')).toBe('sales');
      expect(leaf(xml, 'Amount')).toBe('120');
      expect(leaf(xml, 'CardholderPresentCode')).toBe('13');
      expect(leaf(xml, 'AuthenticationCode')).toBe('CAVVVALUE=');
      expect(leaf(xml, 'SecurityLevel')).toBe('02');
      expect(leaf(xml, 'TxnID')).toBe('XIDVALUE=');
      expect(leaf(xml, 'Md')).toBe('MDVALUE123');
      expect(xml).not.toContain('<Card>');
      expect(post.mock.calls[0][2].retryable).toBe(false);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDER3D');
      expect(result.conversationId).toBe('ORDER3D');
    });

    it('charges the amount and currency from your records, not the callback', async () => {
      post.mockResolvedValue({ data: GARANTI_APPROVED_XML });
      await provider.completeThreeDSPayment(
        { ...GARANTI_3D_CALLBACK, txnamount: '1', txncurrencycode: '840' },
        { ...ORDER, installment: 3 }
      );
      expect(leaf(sent(), 'Amount')).toBe('120');
      expect(leaf(sent(), 'CurrencyCode')).toBe('949');
      expect(leaf(sent(), 'InstallmentCnt')).toBe('3');
    });

    it('needs the order from your records before provisioning', async () => {
      const result = await provider.completeThreeDSPayment(GARANTI_3D_CALLBACK);
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expectNoIds(result);
    });

    it('rejects a re-split callback whose hash still verifies', async () => {
      const result = await provider.completeThreeDSPayment(RESPLIT, ORDER);
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    // The default handler passes only the HTTP body: neither a re-split order nor
    // order values POSTed with it may lead to a provision
    it('does not provision a re-split callback through the default handler', async () => {
      const payment = betterPayment({
        mode: 'sandbox',
        providers: { garanti: garanti({ ...GARANTI_TEST, baseUrl: GARANTI_BASE_URL }) },
      });
      (payment.use('garanti') as any).client.post = post;
      const onCallback = vi.fn();
      await new BetterPaymentHandler(payment, { onCallback }).handle({
        method: 'POST',
        url: '/api/pay/garanti/callback',
        headers: { 'content-type': 'application/json' },
        body: { ...RESPLIT, orderId: '7ORDER3D', amount: '0.01' },
      });
      expect(post).not.toHaveBeenCalled();
      expect(onCallback).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: PaymentStatus.SUCCESS }),
        expect.anything()
      );
      expect(onCallback).not.toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: '7ORDER3D' }),
        expect.anything()
      );
    });

    it('rejects a bad hash as INVALID_HASH', async () => {
      const result = await provider.completeThreeDSPayment({ ...GARANTI_3D_CALLBACK, hash: 'X' });
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('rejects a callback whose order id was changed', async () => {
      const result = await provider.completeThreeDSPayment({
        ...GARANTI_3D_CALLBACK,
        orderid: 'OTHER',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('rejects a callback of another terminal', async () => {
      const result = await provider.completeThreeDSPayment({
        ...GARANTI_3D_CALLBACK,
        terminalmerchantid: '1',
      });
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('fails without ids when the card was not authenticated', async () => {
      const notAuthenticated = await create({ storeKey: 'k' }).completeThreeDSPayment(
        GARANTI_3D_CALLBACK
      );
      expect(notAuthenticated.errorCode).toBe('INVALID_HASH');

      // mdstatus is covered by the hash, so a genuine "0" needs its own hash
      const { createHash } = await import('node:crypto');
      const value = '30691297ORDER3D0CAVVVALUE=02MDVALUE123RNDVALUE';
      const hash = createHash('sha512')
        .update(value + GARANTI_TEST.storeKey)
        .digest('hex')
        .toUpperCase();
      const result = await provider.completeThreeDSPayment({
        ...GARANTI_3D_CALLBACK,
        mdstatus: '0',
        mderrormessage: 'Not authenticated',
        hashparamsval: value,
        hash,
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.code).toBe(PaymentErrorCode.THREEDS_FAILED);
      expectNoIds(result);
    });

    it('provisions half-secure mdstatus values only when accepted', async () => {
      const { createHash } = await import('node:crypto');
      const value = '30691297ORDER3D2CAVVVALUE=02MDVALUE123RNDVALUE';
      const halfSecure = {
        ...GARANTI_3D_CALLBACK,
        mdstatus: '2',
        hashparamsval: value,
        hash: createHash('sha512')
          .update(value + GARANTI_TEST.storeKey)
          .digest('hex')
          .toUpperCase(),
      };

      const rejected = await provider.completeThreeDSPayment(halfSecure);
      expect(post).not.toHaveBeenCalled();
      expect(rejected.errorCode).toBe('MD_STATUS_2');
      expectNoIds(rejected);

      post.mockResolvedValue({ data: GARANTI_APPROVED_XML });
      const lenient = create({ acceptedMdStatuses: ['1', '2', '3', '4'] });
      const accepted = await lenient.completeThreeDSPayment(halfSecure, ORDER);
      expect(post).toHaveBeenCalledTimes(1);
      expect(accepted.status).toBe(PaymentStatus.SUCCESS);
    });

    it('fails without ids when the provision is declined', async () => {
      post.mockResolvedValue({
        data: garantiXml({ Code: '05', ReasonCode: '05', Message: 'Declined', ErrorMsg: 'Red' }),
      });
      const result = await provider.completeThreeDSPayment(GARANTI_3D_CALLBACK, ORDER);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('05');
      expectNoIds(result);
    });

    it('returns pending with the order id when the provision times out', async () => {
      post.mockRejectedValue(timeout());
      const result = await provider.completeThreeDSPayment(GARANTI_3D_CALLBACK, ORDER);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.paymentId).toBe('ORDER3D');
    });
  });

  describe('GarantiPay (GARANTI_PAY)', () => {
    beforeEach(() => {
      provider = create({ securityLevel: 'GARANTI_PAY', companyName: 'Test Shop' });
    });

    it('returns a signed gpdatarequest form without card fields', async () => {
      const { paymentCard: _card, ...withoutCard } = mockThreeDSPaymentRequest;
      const result = await provider.initThreeDSPayment({
        ...withoutCard,
        conversationId: 'ORDERGP',
      } as any);

      expect(result.status).toBe(PaymentStatus.PENDING);
      const fields = formFields(result.threeDSHtmlContent!);
      expect(fields).toMatchObject({
        secure3dsecuritylevel: 'CUSTOM_PAY',
        txntype: 'gpdatarequest',
        txnsubtype: 'sales',
        garantipay: 'Y',
        bnsuseflag: 'Y',
        fbbuseflag: 'Y',
        chequeuseflag: 'Y',
        mileuseflag: 'Y',
        companyname: 'Test Shop',
        lang: 'tr',
        orderid: 'ORDERGP',
        txnamount: '120',
      });
      expect(fields.txntimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(fields).not.toHaveProperty('cardnumber');
      expect(fields).not.toHaveProperty('cardcvv2');
      expect(fields.secure3dhash).toBe(
        await createGaranti3DHash({
          terminalId: GARANTI_TEST.terminalId,
          orderId: 'ORDERGP',
          amount: '120',
          currencyCode: '949',
          successUrl: 'https://example.com/callback',
          errorUrl: 'https://example.com/callback',
          type: 'gpdatarequest',
          installment: '',
          storeKey: GARANTI_TEST.storeKey,
          securityData: GARANTI_SECURITY_DATA,
        })
      );
    });

    it('confirms an approved callback with an order inquiry', async () => {
      post.mockResolvedValue({ data: garantiInquiryXml() });
      const result = await provider.completeThreeDSPayment(GARANTI_3DPAY_CALLBACK);
      expect(leaf(sent(), 'Type')).toBe('orderinq');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDERPAY');
    });

    it('rejects an approved callback the bank does not confirm', async () => {
      post.mockResolvedValue({ data: garantiInquiryXml({ Status: 'DECLINED' }) });
      const result = await provider.completeThreeDSPayment(GARANTI_3DPAY_CALLBACK);
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    // Shaped like the test environment's answer when the GarantiPay page timed out:
    // the request fields echoed back with an error, and no hash
    const TIMED_OUT = {
      mdstatus: '7',
      procreturncode: '92',
      response: 'Error',
      errmsg: 'İşlem kullanıcıya verilen sürede tamamlanamadı.',
      txntype: 'gpdatarequest',
      secure3dsecuritylevel: 'CUSTOM_PAY',
      terminalid: '30691297',
      orderid: 'ORDERGP',
      oid: 'ORDERGP',
      txnamount: '100',
    };

    it('reports an unsigned timeout callback as a failure with its code, without ids', async () => {
      const result = await provider.completeThreeDSPayment(TIMED_OUT);
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('92');
      expect(result.errorMessage).toBe('İşlem kullanıcıya verilen sürede tamamlanamadı.');
      expectNoIds(result);
    });

    it('rejects an unsigned callback that claims approval', async () => {
      const result = await provider.completeThreeDSPayment({
        ...TIMED_OUT,
        procreturncode: '00',
        response: 'Approved',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });
  });

  describe('completeThreeDSPayment (3D_PAY)', () => {
    beforeEach(() => {
      provider = create({ securityLevel: '3D_PAY' });
    });

    it('confirms an approved callback with an order inquiry', async () => {
      post.mockResolvedValue({ data: garantiInquiryXml() });

      const result = await provider.completeThreeDSPayment(GARANTI_3DPAY_CALLBACK);

      expect(leaf(sent(), 'Type')).toBe('orderinq');
      expect(leaf(sent(), 'OrderID')).toBe('ORDERPAY');
      expect(post.mock.calls[0][2].retryable).toBe(true);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDERPAY');
    });

    it('rejects an approved callback the bank does not confirm', async () => {
      post.mockResolvedValue({ data: garantiInquiryXml({ Status: 'DECLINED' }) });
      const result = await provider.completeThreeDSPayment(GARANTI_3DPAY_CALLBACK);
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('rejects a callback whose amount differs from the bank record', async () => {
      post.mockResolvedValue({ data: garantiInquiryXml({ AuthAmount: '99999' }) });
      const result = await provider.completeThreeDSPayment(GARANTI_3DPAY_CALLBACK);
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('checks the bank amount against yours when given', async () => {
      post.mockResolvedValue({ data: garantiInquiryXml() });
      const ok = await provider.completeThreeDSPayment(GARANTI_3DPAY_CALLBACK, {
        orderId: 'ORDERPAY',
        amount: '1.20',
      });
      expect(ok.status).toBe(PaymentStatus.SUCCESS);
      const wrong = await provider.completeThreeDSPayment(
        { ...GARANTI_3DPAY_CALLBACK },
        { orderId: 'ORDERPAY', amount: '99.00' }
      );
      expect(wrong.errorCode).toBe('INVALID_HASH');
      expectNoIds(wrong);
    });

    it('rejects a callback for another order than yours, without asking the bank', async () => {
      const result = await provider.completeThreeDSPayment(GARANTI_3DPAY_CALLBACK, {
        orderId: 'ORDER2',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
    });

    it('returns pending without the callback order id when the inquiry times out', async () => {
      post.mockRejectedValue(timeout());
      const result = await provider.completeThreeDSPayment(GARANTI_3DPAY_CALLBACK);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expectNoIds(result);
      const trusted = await provider.completeThreeDSPayment(GARANTI_3DPAY_CALLBACK, {
        orderId: 'ORDERPAY',
      });
      expect(trusted.paymentId).toBe('ORDERPAY');
    });
  });

  describe('refund, cancel, getPayment', () => {
    it('refunds with the PROVRFN user', async () => {
      post.mockResolvedValue({ data: GARANTI_APPROVED_XML });
      const result = await provider.refund({
        paymentId: 'ORDER1',
        price: '0.5',
        currency: 'TRY',
        ip: '1.1.1.1',
      });
      const xml = sent();
      expect(leaf(xml, 'ProvUserID')).toBe('PROVRFN');
      expect(leaf(xml, 'Type')).toBe('refund');
      expect(leaf(xml, 'Amount')).toBe('50');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.refundId).toBe('628408842186');
    });

    it('signs refunds with refundPassword when given', async () => {
      post.mockResolvedValue({ data: GARANTI_APPROVED_XML });
      await create({ refundPassword: 'other', refundUserId: 'RFNUSER' }).refund({
        paymentId: 'ORDER1',
        price: '0.5',
        currency: 'TRY',
        ip: '1.1.1.1',
      });
      expect(leaf(sent(), 'ProvUserID')).toBe('RFNUSER');
      expect(leaf(sent(), 'HashData')).not.toBe(
        await createGarantiHashData({
          orderId: 'ORDER1',
          terminalId: GARANTI_TEST.terminalId,
          amount: '50',
          currencyCode: '949',
          securityData: GARANTI_SECURITY_DATA,
        })
      );
    });

    it('cancels with void', async () => {
      post.mockResolvedValue({ data: GARANTI_APPROVED_XML });
      const result = await provider.cancel({ paymentId: 'ORDER1', ip: '1.1.1.1' });
      expect(leaf(sent(), 'Type')).toBe('void');
      expect(leaf(sent(), 'ProvUserID')).toBe('PROVRFN');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('maps a rejected cancel', async () => {
      post.mockResolvedValue({ data: DECLINED });
      const result = await provider.cancel({ paymentId: 'ORDER1', ip: '1.1.1.1' });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('0651');
      expect(result.errorMessage).toBe('Kullanıcı şifresi hatalı');
    });

    it('maps the order inquiry status', async () => {
      post.mockResolvedValue({ data: garantiInquiryXml() });
      expect((await provider.getPayment('ORDER1')).status).toBe(PaymentStatus.SUCCESS);

      post.mockResolvedValue({ data: garantiInquiryXml({ Status: 'VOID', AuthAmount: '0' }) });
      expect((await provider.getPayment('ORDER1')).status).toBe(PaymentStatus.CANCELLED);

      post.mockResolvedValue({
        data: garantiInquiryXml({
          Status: 'DECLINED',
          Code: '53',
          ReasonCode: '53',
          SysErrMsg: 'HESAP YOK',
        }),
      });
      const declined = await provider.getPayment('ORDER1');
      expect(declined.status).toBe(PaymentStatus.FAILURE);
      expect(declined.errorCode).toBe('53');

      post.mockResolvedValue({
        data: garantiXml({
          Source: 'GVPS',
          Code: '92',
          ReasonCode: '0110',
          Message: 'Declined',
          ErrorMsg: 'İşlem bulunamadı',
        }),
      });
      const missing = await provider.getPayment('NOPE');
      expect(missing.status).toBe(PaymentStatus.FAILURE);
      expect(missing.errorMessage).toBe('İşlem bulunamadı');
    });
  });

  it('maps statuses and recognises a captured sale', () => {
    expect(mapGarantiOrderStatus('APPROVED')).toBe(PaymentStatus.SUCCESS);
    expect(mapGarantiOrderStatus('DECLINED')).toBe(PaymentStatus.FAILURE);
    expect(mapGarantiOrderStatus('VOID')).toBe(PaymentStatus.CANCELLED);
    expect(mapGarantiOrderStatus('REFUND')).toBe(PaymentStatus.CANCELLED);
    expect(mapGarantiOrderStatus('WAITING')).toBe(PaymentStatus.PENDING);
    expect(isGarantiCapturedSale(parseGarantiXmlResponse(garantiInquiryXml()))).toBe(true);
    expect(
      isGarantiCapturedSale(parseGarantiXmlResponse(garantiInquiryXml({ ChargeType: 'PRE' })))
    ).toBe(false);
  });

  describe('garanti()', () => {
    it('uses the test host and Mode TEST in sandbox mode', () => {
      const bp = betterPayment({ mode: 'sandbox', providers: { garanti: garanti(GARANTI_TEST) } });
      expect((bp.garanti as any).config.baseUrl).toBe(GARANTI_BASE_URL);
      expect((bp.garanti as any).config.testMode).toBe(true);
    });

    it('uses the production host by default', () => {
      const bp = betterPayment({ providers: { garanti: garanti(GARANTI_TEST) } });
      expect((bp.garanti as any).config.baseUrl).toBe('https://sanalposprov.garanti.com.tr');
      expect((bp.garanti as any).config.testMode).toBe(false);
    });
  });
});
