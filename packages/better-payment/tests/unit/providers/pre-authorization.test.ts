import { fakePayment } from '../../helpers/fake-payment';
import { describe, it, expect, vi } from 'vitest';
import { Iyzico } from '../../../src/providers/iyzico';
import { PayTR } from '../../../src/providers/paytr';
import { Parampos } from '../../../src/providers/parampos';
import { Akbank } from '../../../src/providers/akbank';
import { generateParamposPreAuthHash } from '../../../src/providers/parampos/utils';
import { BetterPaymentHandler } from '../../../src/core/BetterPaymentHandler';
import { ProviderType } from '../../../src/core/BetterPaymentConfig';
import { PaymentErrorCode } from '../../../src/core/error-codes';
import { PaymentStatus } from '../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../fixtures/payment-data';
import { AKBANK_TEST } from '../../fixtures/akbank';

const GUID = '0c13d406-873b-403b-9c09-a5766840d98c';
const soap = (action: string, result: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${action}Response xmlns="https://turkpos.com.tr/"><${action}Result>${result}</${action}Result></${action}Response></soap:Body></soap:Envelope>`;

function parampos() {
  const provider = new Parampos({
    clientCode: '10738',
    clientUsername: 'Test',
    clientPassword: 'Test',
    guid: GUID,
    baseUrl: 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx',
  });
  const post = vi.fn();
  (provider as any).client.post = post;
  const call = (i = 0) => ({
    action: post.mock.calls[i][2].headers.SOAPAction as string,
    xml: post.mock.calls[i][1] as string,
  });
  return { provider, post, call };
}

function akbank() {
  const provider = new Akbank({
    ...AKBANK_TEST,
    baseUrl: 'https://apipre.akbank.com/api/v1/payment/virtualpos',
    testMode: true,
  });
  const post = vi.fn().mockResolvedValue({ data: { responseCode: 'VPS-0000' } });
  (provider as any).client.post = post;
  return { provider, post, body: (i = 0) => JSON.parse(post.mock.calls[i][1]) };
}

function iyzico() {
  const provider = new Iyzico({
    apiKey: 'k',
    secretKey: 's',
    baseUrl: 'https://sandbox-api.iyzipay.com',
  });
  const request = vi.fn().mockResolvedValue({ data: { status: 'success', paymentId: '42' } });
  (provider as any).client.request = request;
  return {
    provider,
    request,
    sent: (i = 0) => ({
      url: request.mock.calls[i][0].url,
      data: JSON.parse(request.mock.calls[i][0].data),
    }),
  };
}

describe('Parampos pre-authorization', () => {
  it('hashes like Param: CLIENT_CODE+GUID+Islem_Tutar+Toplam_Tutar+Siparis_ID+Hata_URL+Basarili_URL', async () => {
    // mews/pos reference vector (3D pre-authorization)
    expect(
      await generateParamposPreAuthHash(
        '10738',
        GUID,
        '1000,25',
        '1000,25',
        'order222',
        'https://domain.com/fail',
        'https://domain.com/success'
      )
    ).toBe('LFZ+Sl0mW+ybGvLr1u0ehZoxhxM=');
  });

  it('authorize sends TP_Islem_Odeme_OnProv_WMD (NS) without URLs', async () => {
    const { provider, post, call } = parampos();
    post.mockResolvedValue({
      data: soap(
        'TP_Islem_Odeme_OnProv_WMD',
        '<Islem_ID>6005034747</Islem_ID><UCD_HTML>NONSECURE</UCD_HTML><Sonuc>1</Sonuc><Sonuc_Str>Ön Provizyon İşlemi Başarılı</Sonuc_Str>'
      ),
    });

    const result = await provider.authorize({ ...mockPaymentRequest, conversationId: 'ORDER1' });

    const { action, xml } = call();
    expect(action).toBe('https://turkpos.com.tr/TP_Islem_Odeme_OnProv_WMD');
    expect(xml).toContain('<Islem_Guvenlik_Tip>NS</Islem_Guvenlik_Tip>');
    expect(xml).not.toContain('Basarili_URL');
    expect(xml).toContain(
      `<Islem_Hash>${await generateParamposPreAuthHash('10738', GUID, '1,00', '1,20', 'ORDER1')}</Islem_Hash>`
    );
    expect(result).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'ORDER1' });
  });

  it('initThreeDSAuthorize returns the bank form', async () => {
    const { provider, post, call } = parampos();
    post.mockResolvedValue({
      data: soap(
        'TP_Islem_Odeme_OnProv_WMD',
        '<Islem_ID>1</Islem_ID><UCD_HTML>&lt;form&gt;&lt;/form&gt;</UCD_HTML><Sonuc>1</Sonuc>'
      ),
    });

    const result = await provider.initThreeDSAuthorize({
      ...mockThreeDSPaymentRequest,
      conversationId: 'ORDER1',
    });

    expect(call().xml).toContain('<Islem_Guvenlik_Tip>3D</Islem_Guvenlik_Tip>');
    expect(call().xml).toContain('<Basarili_URL>https://example.com/callback</Basarili_URL>');
    expect(result).toMatchObject({
      status: PaymentStatus.PENDING,
      threeDSHtmlContent: '<form></form>',
    });
  });

  it('capture sends TP_Islem_Odeme_OnProv_Kapa with the (partial) amount', async () => {
    const { provider, post, call } = parampos();
    post.mockResolvedValue({
      data: soap(
        'TP_Islem_Odeme_OnProv_Kapa',
        '<Sonuc>1</Sonuc><Sonuc_Str>Provizyon Kapama İşlem Başarılı</Sonuc_Str>'
      ),
    });

    const result = await provider.capture({ paymentId: 'ORDER1', amount: '0.60', ip: '1.1.1.1' });

    expect(call().action).toBe('https://turkpos.com.tr/TP_Islem_Odeme_OnProv_Kapa');
    expect(call().xml).toContain('<Prov_Tutar>0,60</Prov_Tutar>');
    expect(call().xml).toContain('<Siparis_ID>ORDER1</Siparis_ID>');
    expect(result.status).toBe(PaymentStatus.SUCCESS);
  });

  it('voidAuthorization sends TP_Islem_Iptal_OnProv', async () => {
    const { provider, post, call } = parampos();
    post.mockResolvedValue({
      data: soap('TP_Islem_Iptal_OnProv', '<Sonuc>1</Sonuc><Sonuc_Str>Approved</Sonuc_Str>'),
    });

    const result = await provider.voidAuthorization({ paymentId: 'ORDER1', ip: '1.1.1.1' });

    expect(call().action).toBe('https://turkpos.com.tr/TP_Islem_Iptal_OnProv');
    expect(result.status).toBe(PaymentStatus.SUCCESS);
  });

  it('reports a declined capture as failure', async () => {
    const { provider, post } = parampos();
    post.mockResolvedValue({
      data: soap(
        'TP_Islem_Odeme_OnProv_Kapa',
        '<Sonuc>-1</Sonuc><Sonuc_Str>Provizyon bulunamadı</Sonuc_Str>'
      ),
    });
    const result = await provider.capture({ paymentId: 'ORDER1', amount: '1', ip: '1.1.1.1' });
    expect(result).toMatchObject({
      status: PaymentStatus.FAILURE,
      errorMessage: 'Provizyon bulunamadı',
    });
  });
});

describe('Akbank pre-authorization', () => {
  it('authorize uses txnCode 1004', async () => {
    const { provider, body } = akbank();
    const result = await provider.authorize({ ...mockPaymentRequest, conversationId: 'ORDER1' });
    expect(body().txnCode).toBe('1004');
    expect(result).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'ORDER1' });
  });

  it('initThreeDSAuthorize posts a 3D_PAY form with txnCode 3004', async () => {
    const { provider } = akbank();
    const result = await provider.initThreeDSAuthorize({
      ...mockThreeDSPaymentRequest,
      conversationId: 'ORDER1',
    });
    expect(result.status).toBe(PaymentStatus.PENDING);
    expect(result.threeDSHtmlContent).toContain('name="txnCode" value="3004"');
    expect(result.threeDSHtmlContent).toContain('name="paymentModel" value="3D_PAY"');
  });

  it('capture uses txnCode 1005 with the amount and order id', async () => {
    const { provider, body } = akbank();
    const result = await provider.capture({ paymentId: 'ORDER1', amount: '0.60', ip: '1.1.1.1' });
    expect(body()).toMatchObject({
      txnCode: '1005',
      order: { orderId: 'ORDER1' },
      transaction: { amount: '0.60', currencyCode: 949 },
      customer: { ipAddress: '1.1.1.1' },
    });
    expect(result.status).toBe(PaymentStatus.SUCCESS);
  });

  it('voidAuthorization uses txnCode 1003', async () => {
    const { provider, body } = akbank();
    await provider.voidAuthorization({ paymentId: 'ORDER1', ip: '1.1.1.1' });
    expect(body()).toMatchObject({ txnCode: '1003', order: { orderId: 'ORDER1' } });
  });
});

describe('iyzico pre-authorization', () => {
  it('authorize uses /payment/preauth', async () => {
    const { provider, sent } = iyzico();
    const result = await provider.authorize(mockPaymentRequest);
    expect(sent().url).toBe('/payment/preauth');
    expect(result).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: '42' });
  });

  it('initThreeDSAuthorize uses /payment/3dsecure/initialize/preauth', async () => {
    const { provider, sent } = iyzico();
    await provider.initThreeDSAuthorize(mockThreeDSPaymentRequest);
    expect(sent().url).toBe('/payment/3dsecure/initialize/preauth');
    expect(sent().data.callbackUrl).toBe('https://example.com/callback');
  });

  it('capture uses /payment/postauth with paidPrice', async () => {
    const { provider, sent } = iyzico();
    await provider.capture({ paymentId: '42', amount: '0.60', ip: '1.1.1.1', currency: 'TRY' });
    expect(sent()).toMatchObject({
      url: '/payment/postauth',
      data: { paymentId: '42', paidPrice: '0.60', currency: 'TRY', ip: '1.1.1.1' },
    });
  });

  it('voidAuthorization uses /payment/cancel', async () => {
    const { provider, sent } = iyzico();
    await provider.voidAuthorization({ paymentId: '42', ip: '1.1.1.1' });
    expect(sent().url).toBe('/payment/cancel');
  });

  it('validates the capture before calling the API', async () => {
    const { provider, request } = iyzico();
    const result = await provider.capture({ paymentId: '42', amount: '0', ip: '1.1.1.1' });
    expect(request).not.toHaveBeenCalled();
    expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
  });
});

describe('PayTR pre-authorization', () => {
  const provider = () =>
    new PayTR({
      merchantId: '1',
      merchantKey: 'k',
      merchantSalt: 's',
      baseUrl: 'https://www.paytr.com',
    });

  it('all four methods throw NOT_SUPPORTED (the API is not publicly documented, #60)', async () => {
    const paytr = provider();
    const post = vi.fn();
    (paytr as any).client.post = post;

    for (const call of [
      () => paytr.authorize(mockPaymentRequest),
      () => paytr.initThreeDSAuthorize(mockThreeDSPaymentRequest),
      () => paytr.capture({ paymentId: 'O', amount: '1', ip: '1.1.1.1' }),
      () => paytr.voidAuthorization({ paymentId: 'O', ip: '1.1.1.1' }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    }

    // Honest NOT_SUPPORTED: it must not invent an undocumented endpoint, so no HTTP call fires.
    expect(post).not.toHaveBeenCalled();
  });

  it('the error points to #60 and names the gating (not documented publicly)', async () => {
    const err = await provider()
      .authorize(mockPaymentRequest)
      .catch((e: unknown) => e as Error);
    expect(err.message).toContain('issues/60');
    expect(err.message).toMatch(/not publish|not documented publicly|iletisim|contact us/i);
  });

  it('a pre-auth can only be confirmed by the verified notification, never a redirect flag', async () => {
    // The #60 result would arrive at the notification (Bildirim) URL and be accepted only
    // through completeThreeDSPayment's hash check. A hash signed with a different merchant
    // key (i.e. a tampered/spoofed notification) must not map to success.
    const result = await provider().completeThreeDSPayment({
      merchant_oid: '202606234E4E',
      status: 'success',
      total_amount: '1001',
      hash: 'ZDVOQUw4aDJhNR5dWYBC5bD95bLtSOtj9DzzSQ9sUHs=',
    });
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorCode).toBe('INVALID_HASH');
  });
});

describe('handler routes', () => {
  const setup = (overrides: Record<string, any> = {}) => {
    const provider = {
      authorize: vi.fn().mockResolvedValue({ status: 'success', paymentId: 'O1' }),
      initThreeDSAuthorize: vi
        .fn()
        .mockResolvedValue({ status: 'pending', threeDSHtmlContent: '<form>' }),
      capture: vi.fn().mockResolvedValue({ status: 'success', paymentId: 'O1' }),
      voidAuthorization: vi.fn().mockResolvedValue({ status: 'success' }),
      ...overrides,
    };
    const payment = fakePayment(provider);
    return { payment, provider };
  };
  const post = (url: string, body: unknown) => ({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json' },
    body,
  });

  it('capture and void require an authorize hook', async () => {
    const { payment } = setup();
    expect(() => new BetterPaymentHandler(payment, { allowedActions: ['capture'] })).toThrow(
      /authorize/
    );
    expect(() => new BetterPaymentHandler(payment, { allowedActions: ['void'] })).toThrow(
      /authorize/
    );
    expect(
      () => new BetterPaymentHandler(payment, { allowedActions: ['authorize'] })
    ).not.toThrow();
  });

  it('routes authorize, 3D authorize, capture and void', async () => {
    const { payment, provider } = setup();
    const handler = new BetterPaymentHandler(payment, {
      allowedActions: 'all',
      authorize: () => true,
    });

    await handler.handle(post('/api/pay/akbank/authorize', { price: '1' }));
    await handler.handle(post('/api/pay/akbank/authorize/init-3ds', { price: '1' }));
    const captured = await handler.handle(
      post('/api/pay/akbank/capture', { paymentId: 'O1', amount: '1' })
    );
    await handler.handle(post('/api/pay/akbank/void', { paymentId: 'O1' }));

    expect(provider.authorize).toHaveBeenCalled();
    expect(provider.initThreeDSAuthorize).toHaveBeenCalled();
    expect(provider.capture).toHaveBeenCalledWith({ paymentId: 'O1', amount: '1' });
    expect(provider.voidAuthorization).toHaveBeenCalled();
    expect(captured.status).toBe(200);
  });

  it('answers 400 when the provider does not support it', async () => {
    const provider = new PayTR({
      merchantId: '1',
      merchantKey: 'k',
      merchantSalt: 's',
      baseUrl: 'https://www.paytr.com',
    });
    const payment = fakePayment(provider);
    const handler = new BetterPaymentHandler(payment, {
      allowedActions: 'all',
      authorize: () => true,
    });

    const res = await handler.handle(
      post('/api/pay/paytr/capture', { paymentId: 'O', amount: '1', ip: '1.1.1.1' })
    );

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain('not supported');
  });
});

describe('pre-authorization entry points', () => {
  it('BetterPayment delegates to the default provider', async () => {
    const { betterPayment, iyzico: iyzicoProvider } = await import('../../../src');
    const payment = betterPayment({
      providers: { iyzico: iyzicoProvider({ apiKey: 'k', secretKey: 's' }) },
    });
    // Operations on payment.iyzico run through the plugin hooks: keep the spies
    const provider = payment.iyzico as any;
    const spies: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const m of ['authorize', 'initThreeDSAuthorize', 'capture', 'voidAuthorization']) {
      provider[m] = spies[m] = vi.fn().mockResolvedValue({ status: 'success' });
    }

    await payment.authorize(mockPaymentRequest);
    await payment.initThreeDSAuthorize(mockThreeDSPaymentRequest);
    await payment.capture({ paymentId: '1', amount: '1', ip: '1.1.1.1' });
    await payment.voidAuthorization({ paymentId: '1', ip: '1.1.1.1' });

    for (const m of ['authorize', 'initThreeDSAuthorize', 'capture', 'voidAuthorization']) {
      expect(spies[m]).toHaveBeenCalledTimes(1);
    }
  });

  it('the browser client calls the handler routes', async () => {
    const { BetterPaymentClient } = await import('../../../src/client');
    const urls: string[] = [];
    const fetch = vi.fn((url: string) => {
      urls.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ status: 'success' }),
      });
    });
    const client = new BetterPaymentClient({ baseUrl: '/api/pay', fetch: fetch as any });

    await client.akbank.authorize(mockPaymentRequest);
    await client.akbank.initThreeDSAuthorize(mockThreeDSPaymentRequest);
    await client.akbank.capture({ paymentId: '1', amount: '1', ip: '1.1.1.1' });
    await client.akbank.voidAuthorization({ paymentId: '1', ip: '1.1.1.1' });

    expect(urls).toEqual([
      '/api/pay/akbank/authorize',
      '/api/pay/akbank/authorize/init-3ds',
      '/api/pay/akbank/capture',
      '/api/pay/akbank/void',
    ]);
  });

  it('providers without support throw NOT_SUPPORTED from the base class', async () => {
    const { PaymentProvider } = await import('../../../src/core/PaymentProvider');
    class Minimal extends (PaymentProvider as any) {}
    const provider = Object.create((Minimal as any).prototype);
    for (const call of [
      () => provider.authorize(mockPaymentRequest),
      () => provider.initThreeDSAuthorize(mockThreeDSPaymentRequest),
      () => provider.capture({ paymentId: '1', amount: '1', ip: '1.1.1.1' }),
      () => provider.voidAuthorization({ paymentId: '1', ip: '1.1.1.1' }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    }
  });
});
