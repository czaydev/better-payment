import { fakePayment } from '../../helpers/fake-payment';
import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import { Iyzico } from '../../../src/providers/iyzico';
import { PayTR } from '../../../src/providers/paytr';
import { Akbank } from '../../../src/providers/akbank';
import { betterPayment, iyzico as iyzicoProvider } from '../../../src';
import { BetterPaymentHandler } from '../../../src/core/BetterPaymentHandler';
import { BetterPaymentClient } from '../../../src/client';
import { ProviderType } from '../../../src/core/BetterPaymentConfig';
import { PaymentErrorCode } from '../../../src/core/error-codes';
import { PaymentStatus } from '../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../fixtures/payment-data';
import { AKBANK_TEST } from '../../fixtures/akbank';

const stored = { customerToken: 'USERKEY', cardToken: 'CARDTOKEN' };
const { paymentCard: _card, ...order } = mockPaymentRequest;

function iyzico(data: Record<string, unknown> = { status: 'success', paymentId: '42' }) {
  const provider = new Iyzico({
    apiKey: 'k',
    secretKey: 's',
    baseUrl: 'https://sandbox-api.iyzipay.com',
  });
  const request = vi.fn().mockResolvedValue({ data });
  (provider as any).client.request = request;
  return {
    provider,
    request,
    sent: (i = 0) => ({
      url: request.mock.calls[i][0].url as string,
      method: request.mock.calls[i][0].method as string,
      data: JSON.parse(request.mock.calls[i][0].data),
    }),
  };
}

const PAYTR = { merchantId: '123456', merchantKey: 'KEY', merchantSalt: 'SALT' };
const sign = (s: string) =>
  crypto.createHmac('sha256', PAYTR.merchantKey).update(s).digest('base64');

function paytr(data: unknown = { status: 'success' }) {
  const provider = new PayTR({ ...PAYTR, baseUrl: 'https://www.paytr.com', testMode: true });
  const post = vi.fn().mockResolvedValue({ data });
  (provider as any).client.post = post;
  return {
    provider,
    post,
    sent: (i = 0) => ({
      url: post.mock.calls[i][0] as string,
      form: Object.fromEntries(new URLSearchParams(post.mock.calls[i][1])),
    }),
  };
}

describe('iyzico stored cards', () => {
  it('pays with a stored card: only cardUserKey and cardToken are sent', async () => {
    const { provider, sent } = iyzico();
    const result = await provider.createPayment({ ...order, storedCard: stored });
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(sent().data.paymentCard).toEqual({ cardUserKey: 'USERKEY', cardToken: 'CARDTOKEN' });
  });

  it('saves the card during a payment and returns its tokens', async () => {
    const { provider, sent } = iyzico({
      status: 'success',
      paymentId: '42',
      cardUserKey: 'U1',
      cardToken: 'C1',
    });

    const result = await provider.createPayment({
      ...mockPaymentRequest,
      saveCard: { customerToken: 'U1', alias: 'My card' },
    });

    expect(sent().data.paymentCard).toMatchObject({
      registerCard: 1,
      cardUserKey: 'U1',
      cardAlias: 'My card',
    });
    expect(result.storedCard).toEqual({ customerToken: 'U1', cardToken: 'C1' });
  });

  it('saveCard / listCards / deleteCard use the card storage API', async () => {
    const { provider, request, sent } = iyzico();
    request
      .mockResolvedValueOnce({
        data: {
          status: 'success',
          cardUserKey: 'U1',
          cardToken: 'C1',
          binNumber: '552879',
          lastFourDigits: '0008',
          cardAlias: 'Work',
        },
      })
      .mockResolvedValueOnce({
        data: {
          status: 'success',
          cardUserKey: 'U1',
          cardDetails: [{ cardToken: 'C1', lastFourDigits: '0008', cardBankName: 'Halkbank' }],
        },
      })
      .mockResolvedValueOnce({ data: { status: 'success' } });

    const saved = await provider.saveCard({
      email: 'a@b.co',
      alias: 'Work',
      card: {
        cardHolderName: 'John Doe',
        cardNumber: '5528790000000008',
        expireMonth: '12',
        expireYear: '2030',
      },
    });
    const listed = await provider.listCards({ customerToken: 'U1' });
    const deleted = await provider.deleteCard({ customerToken: 'U1', cardToken: 'C1' });

    expect(sent(0)).toMatchObject({
      url: '/cardstorage/card',
      data: { card: { cardAlias: 'Work' } },
    });
    expect(saved).toMatchObject({
      status: 'success',
      customerToken: 'U1',
      card: { cardToken: 'C1', lastFourDigits: '0008' },
    });
    expect(sent(1).url).toBe('/cardstorage/cards');
    expect(listed.cards).toEqual([
      expect.objectContaining({ cardToken: 'C1', bankName: 'Halkbank' }),
    ]);
    expect(sent(2)).toMatchObject({
      url: '/cardstorage/card',
      method: 'DELETE',
      data: { cardUserKey: 'U1', cardToken: 'C1' },
    });
    expect(deleted.status).toBe(PaymentStatus.SUCCESS);
  });

  it('requires both tokens', async () => {
    const { provider, request } = iyzico();
    const result = await provider.createPayment({
      ...order,
      storedCard: { customerToken: 'U', cardToken: '' },
    });
    expect(request).not.toHaveBeenCalled();
    expect(result.errorMessage).toContain('storedCard.cardToken');
  });
});

describe('PayTR stored cards', () => {
  it('lists cards with paytr_token = HMAC(utoken + salt)', async () => {
    const { provider, sent } = paytr([
      {
        ctoken: 'CT1',
        last_4: '4358',
        month: '12',
        year: '30',
        c_bank: 'Axess',
        require_cvv: '1',
        c_brand: 'axess',
        schema: 'VISA',
      },
    ]);

    const result = await provider.listCards({ customerToken: 'UT' });

    expect(sent()).toEqual({
      url: '/odeme/capi/list',
      form: { merchant_id: '123456', utoken: 'UT', paytr_token: sign('UT' + 'SALT') },
    });
    expect(result.cards).toEqual([
      {
        cardToken: 'CT1',
        lastFourDigits: '4358',
        expireMonth: '12',
        expireYear: '30',
        bankName: 'Axess',
        cardFamily: 'axess',
        cardType: undefined,
        cardAssociation: 'VISA',
        requiresCvc: true,
      },
    ]);
  });

  it('reports a list error', async () => {
    const { provider } = paytr({ status: 'error', err_msg: 'utoken gecersiz' });
    const result = await provider.listCards({ customerToken: 'UT' });
    expect(result).toMatchObject({ status: 'failure', cards: [], errorMessage: 'utoken gecersiz' });
  });

  it('deletes with paytr_token = HMAC(ctoken + utoken + salt)', async () => {
    const { provider, sent } = paytr({ status: 'success' });
    const result = await provider.deleteCard({ customerToken: 'UT', cardToken: 'CT1' });
    expect(sent()).toEqual({
      url: '/odeme/capi/delete',
      form: {
        merchant_id: '123456',
        ctoken: 'CT1',
        utoken: 'UT',
        paytr_token: sign('CT1' + 'UT' + 'SALT'),
      },
    });
    expect(result.status).toBe(PaymentStatus.SUCCESS);
  });

  it('charges a stored card through the Direct API without card data', async () => {
    const { provider, sent } = paytr({ status: 'success' });
    await provider.createPayment({ ...order, storedCard: { ...stored, cvc: '000' } });
    const { form } = sent();
    expect(form).toMatchObject({
      utoken: 'USERKEY',
      ctoken: 'CARDTOKEN',
      require_cvv: '1',
      cvv: '000',
    });
    expect(form.card_number).toBeUndefined();
  });

  it('stores the card during a Direct API payment (store_card=1) and returns the utoken', async () => {
    const { provider, sent } = paytr({ status: 'success', utoken: 'NEWUT' });
    const result = await provider.createPayment({ ...mockPaymentRequest, saveCard: true });
    expect(sent().form).toMatchObject({ store_card: '1', card_number: '5528790000000008' });
    expect(result.storedCard).toEqual({ customerToken: 'NEWUT' });
  });

  it('3D payment with a stored card uses the Direct API form', async () => {
    const { provider } = paytr();
    const result = await provider.initThreeDSPayment({
      ...mockThreeDSPaymentRequest,
      conversationId: 'ORDER1',
      storedCard: stored,
    });
    expect(result.status).toBe(PaymentStatus.PENDING);
    expect(result.threeDSHtmlContent).toContain('name="utoken" value="USERKEY"');
    expect(result.threeDSHtmlContent).toContain('name="ctoken" value="CARDTOKEN"');
  });

  it('the iFrame cannot save cards', async () => {
    const { provider, post } = paytr();
    const result = await provider.initThreeDSPayment({
      ...mockThreeDSPaymentRequest,
      saveCard: true,
    });
    expect(post).not.toHaveBeenCalled();
    expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
  });

  it('saveCard without a payment is not supported', async () => {
    const { provider } = paytr();
    await expect(
      provider.saveCard({
        card: {
          cardHolderName: 'A',
          cardNumber: '4355084355084358',
          expireMonth: '12',
          expireYear: '30',
        },
      })
    ).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
  });
});

describe('providers without card storage', () => {
  it('Akbank rejects stored cards before calling the bank and reports storage as unsupported', async () => {
    const akbank = new Akbank({
      ...AKBANK_TEST,
      baseUrl: 'https://apipre.akbank.com/api/v1/payment/virtualpos',
    });
    const post = vi.fn();
    (akbank as any).client.post = post;
    const result = await akbank.createPayment({ ...order, storedCard: stored });
    expect(post).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'failure', code: PaymentErrorCode.INVALID_REQUEST });
    expect(result.errorMessage).toContain('storedCard is not supported');

    for (const method of ['saveCard', 'listCards', 'deleteCard'] as const) {
      const args =
        method === 'saveCard'
          ? { card: { cardHolderName: 'A', cardNumber: '4355084355084358', expireMonth: '12', expireYear: '30' } }
          : { customerToken: 'U', cardToken: 'C' };
      await expect((akbank as any)[method](args)).rejects.toMatchObject({
        code: 'NOT_SUPPORTED',
        message: expect.stringContaining('manageSavedCard'),
      });
    }
    expect(post).not.toHaveBeenCalled();
  });
});

describe('entry points', () => {
  it('BetterPayment facade, handler routes (privileged) and client', async () => {
    const payment = betterPayment({
      providers: { iyzico: iyzicoProvider({ apiKey: 'k', secretKey: 's' }) },
    });
    // Operations on payment.iyzico run through the plugin hooks: keep the spies
    const provider = payment.iyzico as any;
    const spies: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const m of ['saveCard', 'listCards', 'deleteCard'])
      provider[m] = spies[m] = vi.fn().mockResolvedValue({ status: 'success', cards: [] });
    await payment.saveCard({ card: {} as any });
    await payment.listCards({ customerToken: 'U' });
    await payment.deleteCard({ customerToken: 'U', cardToken: 'C' });
    for (const m of ['saveCard', 'listCards', 'deleteCard'])
      expect(spies[m]).toHaveBeenCalledTimes(1);

    const mockPayment = fakePayment(provider);
    expect(() => new BetterPaymentHandler(mockPayment, { allowedActions: ['cards/list'] })).toThrow(
      /authorize/
    );
    const handler = new BetterPaymentHandler(mockPayment, {
      allowedActions: 'all',
      authorize: () => true,
    });
    const res = await handler.handle({
      method: 'POST',
      url: '/api/pay/iyzico/cards/list',
      headers: { 'content-type': 'application/json' },
      body: { customerToken: 'U' },
    });
    expect(res.status).toBe(200);
    expect(spies.listCards).toHaveBeenCalledTimes(2);

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
    await client.iyzico.saveCard({ card: {} as any });
    await client.iyzico.listCards({ customerToken: 'U' });
    await client.iyzico.deleteCard({ customerToken: 'U', cardToken: 'C' });
    expect(urls).toEqual([
      '/api/pay/iyzico/cards/save',
      '/api/pay/iyzico/cards/list',
      '/api/pay/iyzico/cards/delete',
    ]);
  });
});
