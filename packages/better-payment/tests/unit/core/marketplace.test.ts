import { describe, it, expect, vi } from 'vitest';
import { isValidIban } from '../../../src/core/validation';
import { Parampos } from '../../../src/providers/parampos';
import { PayTR } from '../../../src/providers/paytr';
import { BetterPaymentHandler } from '../../../src/core/BetterPaymentHandler';
import { BetterPaymentClient } from '../../../src/client';
import { PaymentErrorCode } from '../../../src/core/error-codes';
import type { PaymentEvent } from '../../../src/core/events';
import { PaymentStatus } from '../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../fixtures/payment-data';
import { fakePayment } from '../../helpers/fake-payment';

const IBAN = 'TR330006100519786457841326';

const splitBasket = mockPaymentRequest.basketItems.map((item) => ({
  ...item,
  subMerchant: { key: 'SUB-1', price: '0.1' },
}));

const splitRequest = { ...mockPaymentRequest, basketItems: splitBasket };

function parampos(validate = true) {
  const provider = new Parampos({
    clientCode: '10738',
    clientUsername: 'Test',
    clientPassword: 'Test',
    guid: '0c13d406-873b-403b-9c09-a5766840d98c',
    baseUrl: 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx',
    validate,
  });
  const post = vi.fn();
  (provider as any).client.post = post;
  return { provider, post };
}

function paytr() {
  const provider = new PayTR({
    merchantId: '123456',
    merchantKey: 'KEY',
    merchantSalt: 'SALT',
    baseUrl: 'https://www.paytr.com',
    testMode: true,
  });
  const post = vi.fn();
  (provider as any).client.post = post;
  return { provider, post };
}

describe('isValidIban', () => {
  it('accepts a Turkish IBAN, with or without spacing', () => {
    expect(isValidIban(IBAN)).toBe(true);
    expect(isValidIban('TR33 0006 1005 1978 6457 8413 26')).toBe(true);
  });

  it('rejects a wrong check digit, a non-IBAN and non-strings', () => {
    expect(isValidIban('TR340006100519786457841326')).toBe(false);
    expect(isValidIban('not-an-iban')).toBe(false);
    expect(isValidIban(undefined)).toBe(false);
    expect(isValidIban(12345)).toBe(false);
  });
});

describe('providers without a marketplace API', () => {
  it('Parampos refuses a split basket instead of charging the full amount', async () => {
    const { provider, post } = parampos();
    const result = await provider.createPayment(splitRequest);

    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorCode).toBe(PaymentErrorCode.NOT_SUPPORTED);
    expect(result.errorMessage).toContain('Marketplace split payments');
    expect(result.errorMessage).toContain('whole amount settles to the marketplace');
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses a split basket even when validation is disabled', async () => {
    const { provider, post } = parampos(false);
    const result = await provider.createPayment(splitRequest);
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorCode).toBe('NOT_SUPPORTED');
    expect(post).not.toHaveBeenCalled();
  });

  it('PayTR refuses a split basket and explains its panel-only marketplace', async () => {
    const { provider, post } = paytr();
    const result = await provider.createPayment(splitRequest);

    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorCode).toBe(PaymentErrorCode.NOT_SUPPORTED);
    expect(result.errorMessage).toContain('Platform Transfer Request');
    expect(result.errorMessage).toContain('merchant panel');
    expect(post).not.toHaveBeenCalled();
  });

  it('PayTR refuses a split basket in the token (3DS) path before building a form', async () => {
    const { provider, post } = paytr();
    await expect(
      provider.createPaymentWithToken({ ...mockThreeDSPaymentRequest, basketItems: splitBasket })
    ).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    expect(post).not.toHaveBeenCalled();
  });

  it('their marketplace methods throw NOT_SUPPORTED', async () => {
    const { provider } = parampos();
    await expect(
      provider.createSubMerchant({
        type: 'individual',
        externalId: 'SELLER-1',
        name: 'A',
        email: 'a@example.com',
        gsmNumber: '+905350000000',
        address: 'Adres',
        iban: IBAN,
        identityNumber: '74300864791',
      })
    ).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    await expect(provider.approvePayout({ paymentTransactionId: 'TX-1' })).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    });

    const paytrProvider = paytr().provider;
    await expect(
      paytrProvider.retrieveSubMerchant({ externalId: 'SELLER-1' })
    ).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    await expect(paytrProvider.disapprovePayout({ paymentTransactionId: 'TX-1' })).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    });
  });
});

describe('payment.iyzico.marketplace', () => {
  it('runs the operation through the provider proxy and emits payout events', async () => {
    const events: PaymentEvent[] = [];
    const payment = fakePayment({
      approvePayout: vi
        .fn()
        .mockResolvedValue({ status: PaymentStatus.SUCCESS, paymentTransactionId: 'TX-1' }),
      disapprovePayout: vi
        .fn()
        .mockResolvedValue({ status: PaymentStatus.FAILURE, errorCode: 'FAILED' }),
    });
    payment.on('*', (event) => void events.push(event));

    const approved = await payment.iyzico.marketplace.approvePayout({
      paymentTransactionId: 'TX-1',
    });
    const disapproved = await payment.iyzico.marketplace.disapprovePayout({
      paymentTransactionId: 'TX-1',
    });

    expect(approved.status).toBe(PaymentStatus.SUCCESS);
    expect(disapproved.status).toBe(PaymentStatus.FAILURE);
    expect(events.map((event) => [event.type, event.operation, event.provider])).toEqual([
      ['payout.approved', 'approvePayout', 'iyzico'],
      ['payout.failed', 'disapprovePayout', 'iyzico'],
    ]);
  });
});

describe('marketplace handler routes', () => {
  const body = {
    type: 'individual',
    externalId: 'SELLER-1',
    name: 'Ayşe Yılmaz',
    email: 'ayse@example.com',
    gsmNumber: '+905350000000',
    address: 'Nid…',
    iban: IBAN,
    identityNumber: '74300864791',
  };
  const req = (url: string, payload: unknown) => ({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json' },
    body: payload,
  });
  const provider = () => {
    const createSubMerchant = vi
      .fn()
      .mockResolvedValue({ status: PaymentStatus.SUCCESS, subMerchantKey: 'SUB-1' });
    const approvePayout = vi
      .fn()
      .mockResolvedValue({ status: PaymentStatus.SUCCESS, paymentTransactionId: 'TX-1' });
    return {
      payment: fakePayment({ createSubMerchant, approvePayout }),
      createSubMerchant,
      approvePayout,
    };
  };

  it('requires an authorize hook for the privileged marketplace actions', () => {
    const { payment } = provider();
    expect(
      () => new BetterPaymentHandler(payment, { allowedActions: ['marketplace/sub-merchant/create'] })
    ).toThrow(/authorize/);
    expect(
      () => new BetterPaymentHandler(payment, { allowedActions: ['marketplace/payout/approve'] })
    ).toThrow(/authorize/);
  });

  it('returns 403 when authorize rejects', async () => {
    const { payment, createSubMerchant } = provider();
    const handler = new BetterPaymentHandler(payment, {
      allowedActions: ['marketplace/sub-merchant/create'],
      authorize: () => false,
    });
    const result = await handler.handle(
      req('/api/pay/iyzico/marketplace/sub-merchant/create', body)
    );
    expect(result.status).toBe(403);
    expect(createSubMerchant).not.toHaveBeenCalled();
  });

  it('routes a sub-merchant creation to the provider', async () => {
    const { payment, createSubMerchant } = provider();
    const handler = new BetterPaymentHandler(payment, {
      allowedActions: 'all',
      authorize: () => true,
    });
    const result = await handler.handle(
      req('/api/pay/iyzico/marketplace/sub-merchant/create', body)
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'success', subMerchantKey: 'SUB-1' });
    expect(createSubMerchant).toHaveBeenCalledWith(body);
  });

  it('routes a payout approval to the provider', async () => {
    const { payment, approvePayout } = provider();
    const handler = new BetterPaymentHandler(payment, {
      allowedActions: ['marketplace/payout/approve'],
      authorize: () => true,
    });
    const result = await handler.handle(
      req('/api/pay/iyzico/marketplace/payout/approve', { paymentTransactionId: 'TX-1' })
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'success', paymentTransactionId: 'TX-1' });
    expect(approvePayout).toHaveBeenCalledWith({ paymentTransactionId: 'TX-1' });
  });
});

describe('client marketplace routes', () => {
  it('calls the documented handler routes', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      urls.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'success' }),
      });
    });
    const client = new BetterPaymentClient({ baseUrl: '/api/pay/', fetch: fetchMock });

    await client.iyzico.marketplace.createSubMerchant({ externalId: 'SELLER-1' } as any);
    await client.iyzico.marketplace.updateSubMerchant({ externalId: 'SELLER-1' } as any);
    await client.iyzico.marketplace.retrieveSubMerchant({ externalId: 'SELLER-1' });
    await client.iyzico.marketplace.approvePayout({ paymentTransactionId: 'TX-1' });
    await client.iyzico.marketplace.disapprovePayout({ paymentTransactionId: 'TX-1' });

    expect(urls).toEqual([
      '/api/pay/iyzico/marketplace/sub-merchant/create',
      '/api/pay/iyzico/marketplace/sub-merchant/update',
      '/api/pay/iyzico/marketplace/sub-merchant/retrieve',
      '/api/pay/iyzico/marketplace/payout/approve',
      '/api/pay/iyzico/marketplace/payout/disapprove',
    ]);
  });
});
