import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../../src/core/http';
import { PaymentErrorCode } from '../../../../src/core/error-codes';
import { betterPayment, PROVIDER_DEFAULT_URLS, ProviderType } from '../../../../src';
import { Est, est, estOrderStatus, isEstCapturedSale } from '../../../../src/providers/est';
import { createEstHash, parseEstXmlResponse } from '../../../../src/providers/est/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';
import {
  EST_TEST,
  EST_3D_CALLBACK,
  EST_3DPAY_CALLBACK,
  EST_APPROVED_XML,
  estXml,
  estOrderStatusXml,
} from '../../../fixtures/est';

const formFields = (html: string): Record<string, string> =>
  Object.fromEntries(
    [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [
      m[1],
      m[2].replace(/&amp;/g, '&'),
    ])
  );

/** Re-signs a callback after changing it, like a genuine bank POST would be */
const signed = async (data: Record<string, string | undefined>) => {
  const { HASH: _hash, ...rest } = data;
  return { ...rest, HASH: await createEstHash(rest, EST_TEST.storeKey) };
};

const EST_SANDBOX_URL = 'https://entegrasyon.asseco-see.com.tr';

const timeout = () => new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' });

describe('EST provider', () => {
  let provider: Est;
  let post: ReturnType<typeof vi.fn>;

  const create = (overrides: Partial<ConstructorParameters<typeof Est>[0]> = {}) => {
    const instance = new Est({ ...EST_TEST, baseUrl: EST_SANDBOX_URL, ...overrides });
    (instance as any).client.post = post;
    return instance;
  };

  beforeEach(() => {
    post = vi.fn();
    provider = create();
  });

  const sentXml = (call = 0) => post.mock.calls[call][1] as string;
  const sentFields = (call = 0) =>
    parseEstXmlResponse(
      sentXml(call).replace('CC5Request', 'CC5Response').replace('/CC5Request', '/CC5Response')
    );

  const expectNoIds = (result: { paymentId?: string; conversationId?: string }) => {
    expect(result.paymentId).toBeUndefined();
    expect(result.conversationId).toBeUndefined();
  };

  it.each(['clientId', 'username', 'password', 'storeKey'])('requires %s', (field) => {
    expect(() => create({ [field]: '' })).toThrow(field);
  });

  it('rejects an unknown storeType', () => {
    expect(() => create({ storeType: 'x' as any })).toThrow(/storeType/);
  });

  describe('createPayment', () => {
    it('sends a non-3D Auth to the XML API', async () => {
      post.mockResolvedValue({ data: EST_APPROVED_XML });

      const result = await provider.createPayment({
        ...mockPaymentRequest,
        conversationId: 'ORDER1',
      });

      expect(post.mock.calls[0][0]).toBe('/fim/api');
      expect(post.mock.calls[0][2]).toMatchObject({ responseType: 'text', retryable: false });
      expect(sentXml()).toMatch(/^<\?xml version="1.0" encoding="ISO-8859-9"\?><CC5Request>/);
      const { fields, extra } = sentFields();
      expect(fields).toMatchObject({
        Name: 'apiuser',
        Password: 'apipass',
        ClientId: '100100000',
        Type: 'Auth',
        IPAddress: '85.34.78.112',
        OrderId: 'ORDER1',
        Total: '1.20',
        Currency: '949',
        Taksit: '',
        Number: '5528790000000008',
        Expires: '12/30',
        Cvv2Val: '123',
        Mode: 'P',
      });
      expect(extra).toMatchObject({ CARDHOLDERNAME: 'John Doe' });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDER1');
    });

    it('sends the department when configured', async () => {
      post.mockResolvedValue({ data: EST_APPROVED_XML });
      await create({ department: 3 }).createPayment(mockPaymentRequest);
      expect(sentFields().extra).toMatchObject({ BOLUM: '3' });
    });

    it('maps a decline', async () => {
      post.mockResolvedValue({
        data: estXml({ Response: 'Declined', ProcReturnCode: '51', ErrMsg: 'Yetersiz bakiye' }),
      });
      const result = await provider.createPayment(mockPaymentRequest);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('51');
      expect(result.errorMessage).toBe('Yetersiz bakiye');
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
    it('returns a ver3-signed form to the 3D gate', async () => {
      const result = await provider.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        conversationId: 'ORDER3D',
        installment: 3,
      });

      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.PENDING);
      const html = result.threeDSHtmlContent!;
      expect(html).toContain(`action="${EST_SANDBOX_URL}/fim/est3Dgate"`);
      const fields = formFields(html);
      expect(fields).toMatchObject({
        clientid: '100100000',
        storetype: '3d',
        amount: '1.20',
        oid: 'ORDER3D',
        okUrl: 'https://example.com/callback',
        failUrl: 'https://example.com/callback',
        TranType: 'Auth',
        currency: '949',
        taksit: '3',
        lang: 'tr',
        hashAlgorithm: 'ver3',
        pan: '5528790000000008',
        Ecom_Payment_Card_ExpDate_Month: '12',
        Ecom_Payment_Card_ExpDate_Year: '30',
        cv2: '123',
        cardType: 'mastercard',
        cardHolderName: 'John Doe',
      });
      expect(fields.rnd).toMatch(/^[0-9a-f]{32}$/);
      const { hash, ...signedFields } = fields;
      expect(hash).toBe(await createEstHash(signedFields, EST_TEST.storeKey));
      expect(result.paymentId).toBe('ORDER3D');
    });

    it('sends no card data with a hosted store type', async () => {
      const hosted = create({ storeType: '3d_host' });
      const { paymentCard: _card, ...request } = mockThreeDSPaymentRequest;
      const result = await hosted.initThreeDSPayment(request as any);

      expect(result.status).toBe(PaymentStatus.PENDING);
      const fields = formFields(result.threeDSHtmlContent!);
      expect(fields.storetype).toBe('3d_host');
      expect(fields).not.toHaveProperty('pan');
      expect(fields).not.toHaveProperty('cv2');
    });

    it('uses failUrl when given', async () => {
      const result = await provider.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        failUrl: 'https://example.com/fail',
      });
      expect(formFields(result.threeDSHtmlContent!).failUrl).toBe('https://example.com/fail');
    });

    it('rejects an unsupported currency', async () => {
      const result = await provider.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        currency: 'JPY',
      });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
    });
  });

  describe('completeThreeDSPayment (3d)', () => {
    it('charges a verified callback with XML Auth', async () => {
      post.mockResolvedValue({ data: EST_APPROVED_XML });

      const result = await provider.completeThreeDSPayment(EST_3D_CALLBACK);

      const { fields } = sentFields();
      expect(fields).toMatchObject({
        Type: 'Auth',
        OrderId: 'ORDER3D',
        Total: '1.20',
        Currency: '949',
        Number: 'MDVALUE123',
        PayerTxnId: 'XIDVALUE=',
        PayerSecurityLevel: '02',
        PayerAuthenticationCode: 'CAVVVALUE=',
        Mode: 'P',
      });
      expect(post.mock.calls[0][2].retryable).toBe(false);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDER3D');
      expect(result.conversationId).toBe('ORDER3D');
    });

    it('rejects a callback with a bad hash as INVALID_HASH', async () => {
      const result = await provider.completeThreeDSPayment({ ...EST_3D_CALLBACK, amount: '0.01' });
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('rejects a signed callback of another store', async () => {
      const result = await provider.completeThreeDSPayment(
        await signed({ ...EST_3D_CALLBACK, clientid: '999' })
      );
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('fails without ids when the card was not authenticated', async () => {
      const result = await provider.completeThreeDSPayment(
        await signed({ ...EST_3D_CALLBACK, mdStatus: '0', mdErrorMsg: 'Not authenticated' })
      );
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.code).toBe(PaymentErrorCode.THREEDS_FAILED);
      expect(result.errorMessage).toBe('Not authenticated');
      expectNoIds(result);
    });

    it('fails without ids when the bank declines the Auth', async () => {
      post.mockResolvedValue({
        data: estXml({ Response: 'Declined', ProcReturnCode: '05', ErrMsg: 'Red' }),
      });
      const result = await provider.completeThreeDSPayment(EST_3D_CALLBACK);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('05');
      expectNoIds(result);
    });

    it('fails when the bank answers for another order', async () => {
      post.mockResolvedValue({
        data: estXml({ OrderId: 'OTHER', Response: 'Approved', ProcReturnCode: '00' }),
      });
      const result = await provider.completeThreeDSPayment(EST_3D_CALLBACK);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expectNoIds(result);
    });

    it('returns pending with the order id when the Auth times out', async () => {
      post.mockRejectedValue(timeout());
      const result = await provider.completeThreeDSPayment(EST_3D_CALLBACK);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.paymentId).toBe('ORDER3D');
    });
  });

  describe('completeThreeDSPayment (mdStatus)', () => {
    it('rejects half-secure mdStatus values by default', async () => {
      const result = await provider.completeThreeDSPayment(
        await signed({ ...EST_3D_CALLBACK, mdStatus: '2' })
      );
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('MD_STATUS_2');
      expectNoIds(result);
    });

    it('charges the mdStatus values listed in acceptedMdStatuses', async () => {
      post.mockResolvedValue({ data: EST_APPROVED_XML });
      const lenient = create({ acceptedMdStatuses: ['1', '2', '3', '4'] });
      const result = await lenient.completeThreeDSPayment(
        await signed({ ...EST_3D_CALLBACK, mdStatus: '4' })
      );
      expect(sentFields().fields).toMatchObject({ Type: 'Auth', Number: 'MDVALUE123' });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });
  });

  describe('completeThreeDSPayment (3d_host)', () => {
    // The hosted page only authenticates the card: the callback has md but no
    // ProcReturnCode, and the merchant charges with XML Auth like 3d
    const hostCallback = () =>
      signed({
        ...EST_3D_CALLBACK,
        storetype: '3d_host',
        Response: undefined,
        ProcReturnCode: undefined,
      });

    beforeEach(() => {
      provider = create({ storeType: '3d_host' });
    });

    it('charges the authenticated card with XML Auth', async () => {
      post.mockResolvedValue({ data: EST_APPROVED_XML });

      const result = await provider.completeThreeDSPayment(await hostCallback());

      expect(sentFields().fields).toMatchObject({
        Type: 'Auth',
        OrderId: 'ORDER3D',
        Number: 'MDVALUE123',
        PayerTxnId: 'XIDVALUE=',
        PayerAuthenticationCode: 'CAVVVALUE=',
      });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDER3D');
    });

    it('fails without ids when the card was not authenticated', async () => {
      const result = await provider.completeThreeDSPayment(
        await signed({ ...(await hostCallback()), mdStatus: '0' })
      );
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expectNoIds(result);
    });
  });

  describe('completeThreeDSPayment (3d_pay)', () => {
    beforeEach(() => {
      provider = create({ storeType: '3d_pay' });
    });

    it('confirms an approved callback with an order status query', async () => {
      post.mockResolvedValue({ data: estOrderStatusXml() });

      const result = await provider.completeThreeDSPayment(EST_3DPAY_CALLBACK);

      expect(sentFields().fields).toMatchObject({ OrderId: 'ORDERPAY', Mode: 'P' });
      expect(sentFields().extra).toMatchObject({ ORDERSTATUS: 'SOR' });
      expect(post.mock.calls[0][2].retryable).toBe(true);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDERPAY');
    });

    it('rejects an approved callback the bank does not confirm', async () => {
      post.mockResolvedValue({
        data: estXml({
          Response: 'Declined',
          ProcReturnCode: '99',
          ErrMsg: 'No record found for ORDERPAY',
        }),
      });
      const result = await provider.completeThreeDSPayment(EST_3DPAY_CALLBACK);
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('fails without ids on a declined callback, without calling the bank', async () => {
      const result = await provider.completeThreeDSPayment(
        await signed({
          ...EST_3DPAY_CALLBACK,
          Response: 'Declined',
          ProcReturnCode: '51',
          ErrMsg: 'Red',
        })
      );
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
      expectNoIds(result);
    });

    it('returns pending with the order id when the query times out', async () => {
      post.mockRejectedValue(timeout());
      const result = await provider.completeThreeDSPayment(EST_3DPAY_CALLBACK);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.paymentId).toBe('ORDERPAY');
    });

    it('treats 3d_pay_hosting the same way', async () => {
      post.mockResolvedValue({ data: estOrderStatusXml() });
      const result = await create({ storeType: '3d_pay_hosting' }).completeThreeDSPayment(
        await signed({ ...EST_3DPAY_CALLBACK, storetype: '3d_pay_hosting' })
      );
      expect(sentFields().extra).toMatchObject({ ORDERSTATUS: 'SOR' });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });
  });

  describe('Girogate', () => {
    beforeEach(() => {
      provider = create({ storeType: '3d_pay' });
    });

    const { paymentCard: _card, ...withoutCard } = mockThreeDSPaymentRequest;

    it('sends the method and country instead of card data, covered by the hash', async () => {
      const result = await provider.initThreeDSPayment({
        ...withoutCard,
        currency: 'EUR',
        conversationId: 'ORDERGG',
        girogate: { method: 'IDEAL', country: 'nl' },
      });

      expect(result.status).toBe(PaymentStatus.PENDING);
      const fields = formFields(result.threeDSHtmlContent!);
      expect(fields).toMatchObject({
        storetype: '3d_pay',
        paymentType: 'GIROGATE_IDEAL',
        ccode: 'NL',
        currency: '978',
        oid: 'ORDERGG',
      });
      expect(fields).not.toHaveProperty('pan');
      expect(fields).not.toHaveProperty('cv2');
      expect(fields).not.toHaveProperty('girogateemail');
      const { hash, ...signedFields } = fields;
      expect(hash).toBe(await createEstHash(signedFields, EST_TEST.storeKey));
    });

    it.each([
      ['P24', { girogateemail: 'john@example.com' }],
      ['TRUSTLY', { girogateconsumerid: 'BY789' }],
      ['GIROPAY', { girogatemobile: '+905350000000' }],
      ['DRAGONPAY', { girogateemail: 'john@example.com', girogatephone: '+905350000000' }],
    ] as const)('adds the customer fields %s needs, from the buyer', async (method, expected) => {
      const result = await provider.initThreeDSPayment({
        ...withoutCard,
        buyer: { ...withoutCard.buyer, email: 'john@example.com' },
        girogate: { method, country: 'PL' },
      });
      const fields = formFields(result.threeDSHtmlContent!);
      expect(fields).toMatchObject(expected);
      const { hash, ...signedFields } = fields;
      expect(hash).toBe(await createEstHash(signedFields, EST_TEST.storeKey));
    });

    it('prefers the customer fields given in the request', async () => {
      const result = await provider.initThreeDSPayment({
        ...withoutCard,
        girogate: { method: 'P24', country: 'PL', email: 'other@example.com' },
      });
      expect(formFields(result.threeDSHtmlContent!).girogateemail).toBe('other@example.com');
    });

    it.each([
      [{ method: 'NOPE' as any, country: 'NL' }, /Unknown Girogate method/],
      [{ method: 'IDEAL', country: 'Netherlands' }, /two-letter/],
    ] as const)('rejects an invalid request', async (girogate, message) => {
      const result = await provider.initThreeDSPayment({ ...withoutCard, girogate });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
      expect(result.errorMessage).toMatch(message);
    });

    it('requires the customer field a method needs', async () => {
      const result = await provider.initThreeDSPayment({
        ...withoutCard,
        buyer: { ...withoutCard.buyer, email: '' },
        girogate: { method: 'ZIMPLER', country: 'SE' },
      });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toMatch(/email/);
    });

    it('needs a store type where the bank charges', async () => {
      const result = await create({ storeType: '3d' }).initThreeDSPayment({
        ...withoutCard,
        girogate: { method: 'IDEAL', country: 'NL' },
      });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toMatch(/3d_pay/);
    });

    it('returns pending with the order id for a signed Pending callback', async () => {
      const result = await provider.completeThreeDSPayment(
        await signed({
          ...EST_3DPAY_CALLBACK,
          Response: 'Pending',
          ProcReturnCode: '',
          paymentType: 'GIROGATE_SEPA',
          ccode: 'DE',
        })
      );
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.paymentId).toBe('ORDERPAY');
    });

    it('rejects an unsigned Pending callback', async () => {
      const result = await provider.completeThreeDSPayment({
        ...EST_3DPAY_CALLBACK,
        Response: 'Pending',
      });
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    // Shaped like the test environment's answer for a store without Girogate
    it('fails without ids when the store has no Girogate', async () => {
      const result = await provider.completeThreeDSPayment(
        await signed({
          ...EST_3DPAY_CALLBACK,
          Response: 'Declined',
          ProcReturnCode: '99',
          ErrMsg: 'Not a girogate merchant: ',
          paymentType: 'GIROGATE_IDEAL',
          ccode: 'NL',
        })
      );
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('99');
      expectNoIds(result);
    });
  });

  describe('refund, cancel, getPayment', () => {
    it('refunds with Credit', async () => {
      post.mockResolvedValue({ data: EST_APPROVED_XML });
      const result = await provider.refund({
        paymentId: 'ORDER3D',
        price: '0.5',
        currency: 'TRY',
        ip: '1.1.1.1',
      });
      expect(sentFields().fields).toMatchObject({
        Type: 'Credit',
        OrderId: 'ORDER3D',
        Total: '0.50',
        Currency: '949',
      });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.refundId).toBe('26011AAAA1234');
    });

    it('cancels with Void', async () => {
      post.mockResolvedValue({ data: EST_APPROVED_XML });
      const result = await provider.cancel({ paymentId: 'ORDER3D', ip: '1.1.1.1' });
      expect(sentFields().fields).toMatchObject({ Type: 'Void', OrderId: 'ORDER3D' });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('maps a rejected refund', async () => {
      post.mockResolvedValue({
        data: estXml({ Response: 'Error', ProcReturnCode: '99', ErrMsg: 'Iade tutari fazla' }),
      });
      const result = await provider.refund({
        paymentId: 'ORDER3D',
        price: '5',
        currency: 'TRY',
        ip: '1.1.1.1',
      });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toBe('Iade tutari fazla');
    });

    it('returns the order status', async () => {
      post.mockResolvedValue({ data: estOrderStatusXml() });
      expect((await provider.getPayment('ORDERPAY')).status).toBe(PaymentStatus.SUCCESS);

      post.mockResolvedValue({ data: estOrderStatusXml({ CAPTURE_AMT: '0' }) });
      expect((await provider.getPayment('ORDERPAY')).status).toBe(PaymentStatus.PENDING);

      post.mockResolvedValue({
        data: estXml({
          Response: 'Declined',
          ProcReturnCode: '99',
          ErrMsg: 'No record found for X',
        }),
      });
      const missing = await provider.getPayment('X');
      expect(missing.status).toBe(PaymentStatus.FAILURE);
      expect(missing.errorMessage).toBe('No record found for X');
    });

    // Order status answers as seen in the EST test environment
    it('returns cancelled for a voided order', async () => {
      post.mockResolvedValue({ data: estOrderStatusXml({ TRANS_STAT: 'V', CAPTURE_AMT: '100' }) });
      const result = await provider.getPayment('ORDERPAY');
      expect(result.status).toBe(PaymentStatus.CANCELLED);
      expect(result.paymentId).toBe('ORDERPAY');
    });

    it('returns cancelled for a refunded order', async () => {
      post.mockResolvedValue({
        data: estOrderStatusXml({ TRANS_STAT: 'C', CHARGE_TYPE_CD: 'C', CAPTURE_AMT: '50' }),
      });
      expect((await provider.getPayment('ORDERPAY')).status).toBe(PaymentStatus.CANCELLED);
    });

    it('returns failure with the bank code for a declined order', async () => {
      post.mockResolvedValue({
        data: estXml(
          { ErrMsg: 'Record(s) found for ORDERPAY', ProcReturnCode: '12', Response: 'Declined' },
          { TRANS_STAT: 'D', CHARGE_TYPE_CD: 'S', CAPTURE_AMT: '100', PROC_RET_CD: '12' }
        ),
      });
      const result = await provider.getPayment('ORDERPAY');
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('12');
      expect(result.errorMessage).toBe('Declined by the bank');
    });
  });

  it('estOrderStatus maps the order status answer', () => {
    const status = (extra: Record<string, string>) =>
      estOrderStatus(parseEstXmlResponse(estOrderStatusXml(extra)));
    expect(status({ TRANS_STAT: 'C' })).toBe(PaymentStatus.SUCCESS);
    expect(status({ TRANS_STAT: 'V' })).toBe(PaymentStatus.CANCELLED);
    expect(status({ CHARGE_TYPE_CD: 'C' })).toBe(PaymentStatus.CANCELLED);
    expect(status({ TRANS_STAT: 'D' })).toBe(PaymentStatus.FAILURE);
    expect(status({ TRANS_STAT: '' })).toBe(PaymentStatus.FAILURE);
    expect(status({ CAPTURE_AMT: '0' })).toBe(PaymentStatus.PENDING);
  });

  it('isEstCapturedSale requires a captured sale', () => {
    const status = (extra: Record<string, string>) => parseEstXmlResponse(estOrderStatusXml(extra));
    expect(isEstCapturedSale(status({}))).toBe(true);
    expect(isEstCapturedSale(status({ TRANS_STAT: 'C' }))).toBe(true);
    expect(isEstCapturedSale(status({ TRANS_STAT: 'V' }))).toBe(false);
    expect(isEstCapturedSale(status({ CHARGE_TYPE_CD: 'C' }))).toBe(false);
    expect(isEstCapturedSale(status({ CAPTURE_AMT: '0' }))).toBe(false);
  });

  describe('est()', () => {
    it.each(['isbank', 'ziraat', 'halkbank', 'teb', 'sekerbank'] as const)(
      'uses the shared test environment for %s in sandbox mode',
      (bank) => {
        const bp = betterPayment({
          mode: 'sandbox',
          providers: { pos: est({ ...EST_TEST, bank }) },
        });
        expect((bp.pos as any).config.baseUrl).toBe(EST_SANDBOX_URL);
      }
    );

    it('registers each bank as a provider type with default URLs', () => {
      expect(ProviderType.ISBANK).toBe('isbank');
      expect(PROVIDER_DEFAULT_URLS[ProviderType.SEKERBANK]).toEqual({
        sandbox: EST_SANDBOX_URL,
        production: 'https://sanalpos.sekerbank.com.tr',
      });
    });

    it('requires baseUrl for an unknown bank', () => {
      expect(() =>
        betterPayment({ providers: { pos: est({ ...EST_TEST, bank: 'x' as any }) } })
      ).toThrow(/baseUrl/);
    });

    it.each([
      ['isbank', 'https://sanalpos.isbank.com.tr'],
      ['ziraat', 'https://sanalpos2.ziraatbank.com.tr'],
      ['halkbank', 'https://sanalpos.halkbank.com.tr'],
      ['teb', 'https://sanalpos.teb.com.tr'],
      ['sekerbank', 'https://sanalpos.sekerbank.com.tr'],
    ] as const)('uses the %s production host', (bank, url) => {
      const bp = betterPayment({ providers: { pos: est({ ...EST_TEST, bank }) } });
      expect((bp.pos as any).config.baseUrl).toBe(url);
    });

    it('lets baseUrl override the bank host', () => {
      const bp = betterPayment({
        providers: { pos: est({ ...EST_TEST, baseUrl: 'https://x.test' }) },
      });
      expect((bp.pos as any).config.baseUrl).toBe('https://x.test');
    });
  });
});
