import { describe, it, expect, vi } from 'vitest';
import { Iyzico } from '../../../../src/providers/iyzico';
import { PaymentStatus } from '../../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';

const IBAN = 'TR330006100519786457841326';

const seller = {
  type: 'individual' as const,
  externalId: 'SELLER-1',
  name: 'Ayşe Yılmaz',
  email: 'ayse@example.com',
  gsmNumber: '+905350000000',
  address: 'Nidakule Göztepe, Merdivenköy Mah. Bora Sok. No:1',
  iban: IBAN,
  identityNumber: '74300864791',
};

function iyzico(data: Record<string, unknown> = { status: 'success' }) {
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

const splitBasket = mockPaymentRequest.basketItems.map((item, i) => ({
  ...item,
  subMerchant: { key: `KEY-${i + 1}`, price: '0.1' },
}));

describe('iyzico marketplace: sub-merchant registration', () => {
  it('creates an individual seller with the documented fields', async () => {
    const { provider, sent } = iyzico({ status: 'success', subMerchantKey: 'SUB-1' });

    const result = await provider.createSubMerchant(seller);

    expect(sent()).toEqual({
      url: '/onboarding/submerchant',
      method: 'POST',
      data: {
        locale: 'tr',
        subMerchantExternalId: 'SELLER-1',
        subMerchantType: 'PERSONAL',
        address: seller.address,
        email: seller.email,
        gsmNumber: seller.gsmNumber,
        name: seller.name,
        iban: IBAN,
        currency: 'TRY',
        identityNumber: seller.identityNumber,
      },
    });
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.subMerchantKey).toBe('SUB-1');
    // The create response has no detail fields, so no `subMerchant` object is invented
    expect(result.subMerchant).toBeUndefined();
  });

  it('maps a company seller type and requires its tax fields', async () => {
    const company = {
      ...seller,
      type: 'private_company' as const,
      legalCompanyTitle: 'Example Ltd.',
      taxOffice: 'Kadıköy',
      taxNumber: '1234567890',
    };
    const missingTax = iyzico();
    const failed = await missingTax.provider.createSubMerchant({
      ...company,
      taxNumber: undefined,
    });
    expect(failed.status).toBe(PaymentStatus.FAILURE);
    expect(failed.errorCode).toBe('VALIDATION_ERROR');
    expect(failed.errorMessage).toContain('taxNumber');
    expect(missingTax.request).not.toHaveBeenCalled();

    const { provider, sent } = iyzico();
    const result = await provider.createSubMerchant({
      ...company,
      type: 'PRIVATE_COMPANY',
      currency: 'USD',
    });
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(sent().data).toMatchObject({
      subMerchantType: 'PRIVATE_COMPANY',
      taxOffice: 'Kadıköy',
      taxNumber: '1234567890',
      legalCompanyTitle: 'Example Ltd.',
      currency: 'USD',
    });
  });

  it('rejects a company seller without an identity number and a bad IBAN before HTTP', async () => {
    const noIdentity = iyzico();
    const personal = await noIdentity.provider.createSubMerchant({
      ...seller,
      identityNumber: undefined,
    });
    expect(personal.status).toBe(PaymentStatus.FAILURE);
    expect(personal.errorMessage).toContain('identityNumber');

    const badIban = iyzico();
    const iban = await badIban.provider.createSubMerchant({ ...seller, iban: 'TR000000000000000000000000' });
    expect(iban.status).toBe(PaymentStatus.FAILURE);
    expect(iban.errorMessage).toContain('IBAN');
    expect(noIdentity.request).not.toHaveBeenCalled();
    expect(badIban.request).not.toHaveBeenCalled();
  });

  it('updates a seller with PUT and its subMerchantKey', async () => {
    const { provider, sent } = iyzico({ status: 'success', subMerchantKey: 'SUB-1' });

    const result = await provider.updateSubMerchant({
      ...seller,
      subMerchantKey: 'SUB-1',
      name: 'Ayşe Demir',
    });

    expect(sent()).toMatchObject({
      url: '/onboarding/submerchant',
      method: 'PUT',
      data: { subMerchantKey: 'SUB-1', subMerchantExternalId: 'SELLER-1', name: 'Ayşe Demir' },
    });
    expect(result.subMerchantKey).toBe('SUB-1');
  });

  it('looks a seller up by external id and maps the detail response', async () => {
    const { provider, sent } = iyzico({
      status: 'success',
      subMerchantKey: 'SUB-1',
      subMerchantExternalId: 'SELLER-1',
      subMerchantType: 'PERSONAL',
      name: seller.name,
      email: seller.email,
      iban: IBAN,
      currency: 'TRY',
    });

    const result = await provider.retrieveSubMerchant({ externalId: 'SELLER-1' });

    expect(sent()).toMatchObject({
      url: '/onboarding/submerchant/detail',
      method: 'POST',
      data: { locale: 'tr', subMerchantExternalId: 'SELLER-1' },
    });
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.subMerchant).toMatchObject({
      subMerchantKey: 'SUB-1',
      externalId: 'SELLER-1',
      type: 'PERSONAL',
      name: seller.name,
      iban: IBAN,
      currency: 'TRY',
    });
  });

  it('requires an external id for a lookup', async () => {
    const { provider, request } = iyzico();
    const result = await provider.retrieveSubMerchant({ externalId: ' ' });
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorCode).toBe('VALIDATION_ERROR');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('iyzico marketplace: item payouts', () => {
  it('approves and disapproves an item payout at the documented endpoints', async () => {
    const approve = iyzico({
      status: 'success',
      paymentTransactionId: 'TX-1',
      conversationId: 'C-1',
    });
    const approved = await approve.provider.approvePayout({
      paymentTransactionId: 'TX-1',
      conversationId: 'C-1',
    });
    expect(approve.sent()).toEqual({
      url: '/payment/iyzipos/item/approve',
      method: 'POST',
      data: { locale: 'tr', conversationId: 'C-1', paymentTransactionId: 'TX-1' },
    });
    expect(approved.status).toBe(PaymentStatus.SUCCESS);
    expect(approved.paymentTransactionId).toBe('TX-1');

    const disapprove = iyzico({ status: 'success', paymentTransactionId: 'TX-1' });
    const disapproved = await disapprove.provider.disapprovePayout({
      paymentTransactionId: 'TX-1',
    });
    expect(disapprove.sent().url).toBe(
      '/payment/iyzipos/item/disapprove'
    );
    expect(disapproved.status).toBe(PaymentStatus.SUCCESS);
  });

  it('does not call iyzico without a paymentTransactionId', async () => {
    const { provider, request } = iyzico();
    const result = await provider.approvePayout({ paymentTransactionId: '' });
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorCode).toBe('VALIDATION_ERROR');
    expect(result.errorMessage).toContain('paymentTransactionId');
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps an unknown provider status pending, never success', async () => {
    const { provider } = iyzico({ status: 'in progress' });
    const result = await provider.approvePayout({ paymentTransactionId: 'TX-1' });
    expect(result.status).toBe(PaymentStatus.PENDING);
  });
});

describe('iyzico marketplace: split basket mapping', () => {
  it('sends subMerchantKey and subMerchantPrice for every item of a split direct payment', async () => {
    const { provider, sent } = iyzico({ status: 'success', paymentId: 'PMT-1' });

    const result = await provider.createPayment({ ...mockPaymentRequest, basketItems: splitBasket });

    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(sent().url).toBe('/payment/auth');
    expect(sent().data.basketItems).toEqual([
      expect.objectContaining({ id: 'BI101', subMerchantKey: 'KEY-1', subMerchantPrice: '0.1' }),
      expect.objectContaining({ id: 'BI102', subMerchantKey: 'KEY-2', subMerchantPrice: '0.1' }),
      expect.objectContaining({ id: 'BI103', subMerchantKey: 'KEY-3', subMerchantPrice: '0.1' }),
    ]);
  });

  it('sends the split basket in the 3D Secure initialization too', async () => {
    const { provider, sent } = iyzico({ status: 'success', threeDSHtmlContent: '' });

    const result = await provider.initThreeDSPayment({
      ...mockThreeDSPaymentRequest,
      basketItems: splitBasket,
    });

    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(sent().url).toBe('/payment/3dsecure/initialize');
    expect(sent().data.basketItems.map((item: { subMerchantKey: string }) => item.subMerchantKey))
      .toEqual(['KEY-1', 'KEY-2', 'KEY-3']);
  });

  it('leaves ordinary baskets unchanged', async () => {
    const { provider, sent } = iyzico({ status: 'success', paymentId: 'PMT-1' });
    await provider.createPayment(mockPaymentRequest);
    expect(sent().data.basketItems[0]).not.toHaveProperty('subMerchantKey');
    expect(sent().data.basketItems[0]).not.toHaveProperty('subMerchantPrice');
  });

  it('rejects a seller share above the item price before any HTTP call', async () => {
    const items = mockPaymentRequest.basketItems.map((item, i) => ({
      ...item,
      subMerchant: { key: `KEY-${i + 1}`, price: i === 0 ? '0.4' : '0.3' },
    }));
    const { provider, request } = iyzico();

    const result = await provider.createPayment({ ...mockPaymentRequest, basketItems: items });

    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorCode).toBe('VALIDATION_ERROR');
    expect(result.errorMessage).toContain('subMerchant.price');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a mixed basket where only some items name a seller', async () => {
    const items = splitBasket.map((item, i) => (i === 1 ? { ...item, subMerchant: undefined } : item));
    const { provider, request } = iyzico();

    const result = await provider.createPayment({ ...mockPaymentRequest, basketItems: items });

    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorCode).toBe('VALIDATION_ERROR');
    expect(result.errorMessage).toContain('every item needs one');
    expect(request).not.toHaveBeenCalled();
  });

  it('reports a provider failure as failure and carries its code', async () => {
    const { provider } = iyzico({ status: 'failure', errorCode: '10005', errorMessage: 'Declined' });
    const result = await provider.createPayment({ ...mockPaymentRequest, basketItems: splitBasket });
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorCode).toBe('10005');
    expect(result.errorMessage).toBe('Declined');
  });
});
