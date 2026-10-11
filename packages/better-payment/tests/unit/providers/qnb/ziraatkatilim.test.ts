import { describe, it, expect, beforeEach, vi } from 'vitest';
import { betterPayment, PROVIDER_DEFAULT_URLS, ProviderType } from '../../../../src';
import { ZiraatKatilim, ziraatKatilim } from '../../../../src/providers/qnb';
import {
  createQnb3DHash,
  parseQnbXmlResponse,
  verifyZiraatKatilimCallback,
} from '../../../../src/providers/qnb/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';
import {
  QNB_3DPAY_CALLBACK,
  ZIRAAT_KATILIM_TEST,
  ZIRAAT_KATILIM_BASE_URL,
  ZIRAAT_KATILIM_FORM_HASH,
  ZIRAAT_KATILIM_3DMODEL_CALLBACK,
  ZIRAAT_KATILIM_3DPAY_CALLBACK,
  payforText,
} from '../../../fixtures/qnb';

const credentials = {
  merchantId: ZIRAAT_KATILIM_TEST.merchantId,
  merchantPass: ZIRAAT_KATILIM_TEST.merchantPass,
};
const formFields = (html: string): Record<string, string> =>
  Object.fromEntries(
    [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [
      m[1],
      m[2],
    ])
  );
const approved = (fields: Record<string, string> = {}) => ({
  data: payforText({
    OrderId: 'ORDER3D',
    ProcReturnCode: '00',
    ErrMsg: 'Onaylandı',
    AuthCode: 'S12345',
    HostRefNum: '628400000001',
    ...fields,
  }),
});

describe('Ziraat Katılım utils', () => {
  it('signs the 3D form with the configured institution code (reference vector)', async () => {
    expect(
      await createQnb3DHash({
        mbrId: ZIRAAT_KATILIM_TEST.mbrId,
        orderId: 'ORDER3D',
        amount: '1.20',
        okUrl: 'https://example.com/callback',
        failUrl: 'https://example.com/callback',
        txnType: 'Auth',
        installment: '0',
        rnd: '0123456789abcdef0123',
        merchantPass: ZIRAAT_KATILIM_TEST.merchantPass,
      })
    ).toBe(ZIRAAT_KATILIM_FORM_HASH);
  });

  it('verifies 3DModel and 3DPay callbacks (reference vectors)', async () => {
    expect(
      await verifyZiraatKatilimCallback(ZIRAAT_KATILIM_3DMODEL_CALLBACK, credentials, '3DModel')
    ).toBe(true);
    expect(
      await verifyZiraatKatilimCallback(ZIRAAT_KATILIM_3DPAY_CALLBACK, credentials, '3DPay')
    ).toBe(true);
  });

  it.each(['OrderId', 'ResponseRnd'])('rejects a 3DModel callback with a changed %s', async (f) => {
    expect(
      await verifyZiraatKatilimCallback(
        { ...ZIRAAT_KATILIM_3DMODEL_CALLBACK, [f]: 'X' },
        credentials,
        '3DModel'
      )
    ).toBe(false);
  });

  it.each(['AuthCode', 'ProcReturnCode'])(
    'rejects a 3DPay callback with a changed %s',
    async (f) => {
      expect(
        await verifyZiraatKatilimCallback(
          { ...ZIRAAT_KATILIM_3DPAY_CALLBACK, [f]: 'X' },
          credentials,
          '3DPay'
        )
      ).toBe(false);
    }
  );

  it('reads the Key=Value;; answer of the XML API', () => {
    expect(
      parseQnbXmlResponse(
        'OrderId=;;ProcReturnCode=V004;;ErrMsg=Hatalı kullanıcı adı veya şifre;;Note=a=b;;'
      )
    ).toEqual({
      OrderId: '',
      ProcReturnCode: 'V004',
      ErrMsg: 'Hatalı kullanıcı adı veya şifre',
      Note: 'a=b',
    });
    expect(() => parseQnbXmlResponse('<html>error</html>')).toThrow(/unexpected/);
  });
});

describe('Ziraat Katılım provider', () => {
  let provider: ZiraatKatilim;
  let post: ReturnType<typeof vi.fn>;

  const create = (overrides: Partial<ConstructorParameters<typeof ZiraatKatilim>[0]> = {}) => {
    const instance = new ZiraatKatilim({
      ...ZIRAAT_KATILIM_TEST,
      baseUrl: ZIRAAT_KATILIM_BASE_URL,
      ...overrides,
    });
    (instance as any).client.post = post;
    return instance;
  };
  const sentXml = (call = 0) => post.mock.calls[call][1] as string;

  beforeEach(() => {
    post = vi.fn();
    provider = create();
  });

  it('requires the institution code', () => {
    expect(() => create({ mbrId: '' })).toThrow(/mbrId/);
    expect(() => create({ userPass: '' })).toThrow(/Ziraat Katılım configuration is missing/);
  });

  it('createPayment posts to /MPI/Default.aspx and reads the text answer', async () => {
    post.mockResolvedValue(approved({ OrderId: 'ORDER1' }));

    const result = await provider.createPayment({
      ...mockPaymentRequest,
      conversationId: 'ORDER1',
    });

    expect(post.mock.calls[0][0]).toBe('/MPI/Default.aspx');
    expect(sentXml()).toContain('<MbrId>99</MbrId>');
    expect(sentXml()).toContain('<SecureType>NonSecure</SecureType>');
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.paymentId).toBe('ORDER1');
  });

  it('maps a declined text answer', async () => {
    post.mockResolvedValue({
      data: payforText({ ProcReturnCode: 'V004', ErrMsg: 'Hatalı kullanıcı adı veya şifre' }),
    });
    const result = await provider.createPayment(mockPaymentRequest);
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorCode).toBe('V004');
  });

  it('initThreeDSPayment signs a form for the Ziraat Katılım gateway', async () => {
    const result = await provider.initThreeDSPayment({
      ...mockThreeDSPaymentRequest,
      conversationId: 'ORDER3D',
    });
    const html = result.threeDSHtmlContent!;
    expect(html).toContain(`action="${ZIRAAT_KATILIM_BASE_URL}/MPI/Default.aspx"`);
    const fields = formFields(html);
    expect(fields).toMatchObject({
      MbrId: '99',
      MerchantID: '000000000111',
      SecureType: '3DModel',
    });
    expect(fields).not.toHaveProperty('UserPass');
    expect(fields.Hash).toBe(
      await createQnb3DHash({
        mbrId: '99',
        orderId: 'ORDER3D',
        amount: fields.PurchAmount,
        okUrl: fields.OkUrl,
        failUrl: fields.FailUrl,
        txnType: 'Auth',
        installment: fields.InstallmentCount,
        rnd: fields.Rnd,
        merchantPass: ZIRAAT_KATILIM_TEST.merchantPass,
      })
    );
  });

  describe('completeThreeDSPayment', () => {
    it('charges a verified 3DModel callback with 3DModelPayment', async () => {
      post.mockResolvedValue(approved());

      const result = await provider.completeThreeDSPayment(ZIRAAT_KATILIM_3DMODEL_CALLBACK);

      expect(sentXml()).toContain('<SecureType>3DModelPayment</SecureType>');
      expect(sentXml()).toContain('<RequestGuid>1000000000000001</RequestGuid>');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDER3D');
    });

    it('rejects a changed OrderId as INVALID_HASH', async () => {
      const result = await provider.completeThreeDSPayment({
        ...ZIRAAT_KATILIM_3DMODEL_CALLBACK,
        OrderId: 'OTHER',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
      expect(result.paymentId).toBeUndefined();
    });

    it('rejects a callback signed with the QNB formula', async () => {
      const result = await create({ secureType: '3DPay' }).completeThreeDSPayment(
        QNB_3DPAY_CALLBACK
      );
      expect(result.errorCode).toBe('INVALID_HASH');
    });

    it('fails without ids when the bank declines 3DModelPayment', async () => {
      post.mockResolvedValue({ data: payforText({ ProcReturnCode: '05', ErrMsg: 'Red' }) });
      const result = await provider.completeThreeDSPayment(ZIRAAT_KATILIM_3DMODEL_CALLBACK);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.paymentId).toBeUndefined();
    });

    it('confirms a 3DPay callback with OrderInquiry', async () => {
      post.mockResolvedValue({
        data: payforText({
          OrderId: 'ORDERPAY',
          ProcReturnCode: '00',
          TxnResult: 'Success',
          TxnStatus: 'Y',
          IsVoided: 'false',
          IsRefunded: 'false',
          PurchAmount: '1.00',
        }),
      });
      const result = await create({ secureType: '3DPay' }).completeThreeDSPayment(
        ZIRAAT_KATILIM_3DPAY_CALLBACK
      );
      expect(sentXml()).toContain('<TxnType>OrderInquiry</TxnType>');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDERPAY');
    });
  });

  it('ziraatKatilim() follows mode for the base URL', () => {
    const sandbox = betterPayment({
      mode: 'sandbox',
      providers: { ziraatkatilim: ziraatKatilim(ZIRAAT_KATILIM_TEST) },
    });
    expect((sandbox.ziraatkatilim as any).config.baseUrl).toBe(ZIRAAT_KATILIM_BASE_URL);
    const live = betterPayment({
      providers: { ziraatkatilim: ziraatKatilim(ZIRAAT_KATILIM_TEST) },
    });
    expect((live.ziraatkatilim as any).config.baseUrl).toBe(
      PROVIDER_DEFAULT_URLS[ProviderType.ZIRAATKATILIM].production
    );
  });
});
