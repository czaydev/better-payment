import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../../src/core/http';
import { Iyzico } from '../../../../src/providers/iyzico';
import { PaymentStatus } from '../../../../src/types';

function createIyzico() {
  return new Iyzico({
    apiKey: 'api-key',
    secretKey: 'secret-key',
    baseUrl: 'https://sandbox-api.iyzipay.com',
  });
}

describe('Iyzico - payment status and request semantics', () => {
  let iyzico: Iyzico;
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    iyzico = createIyzico();
    request = vi.fn();
    (iyzico as any).client.request = request;
  });

  it('requires apiKey and secretKey', () => {
    expect(() => new Iyzico({ apiKey: '', secretKey: 's', baseUrl: 'https://x' })).toThrow(/apiKey/);
    expect(() => new Iyzico({ apiKey: 'a', secretKey: '', baseUrl: 'https://x' })).toThrow(/secretKey/);
  });

  it('checkout form retrieve is FAILURE when the API call succeeds but the payment failed', async () => {
    request.mockResolvedValue({
      data: { status: 'success', paymentStatus: 'FAILURE', token: 't', errorMessage: 'Kart limiti yetersiz' },
    });
    const result = await iyzico.retrieveCheckoutForm('t');
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.paymentStatus).toBe('FAILURE');
  });

  it('checkout form retrieve is SUCCESS only when paymentStatus is SUCCESS', async () => {
    request.mockResolvedValue({ data: { status: 'success', paymentStatus: 'SUCCESS', paymentId: '1' } });
    expect((await iyzico.retrieveCheckoutForm('t')).status).toBe(PaymentStatus.SUCCESS);
  });

  it('checkout form retrieve is PENDING while 3DS is in progress', async () => {
    request.mockResolvedValue({ data: { status: 'success', paymentStatus: 'INIT_THREEDS' } });
    expect((await iyzico.retrieveCheckoutForm('t')).status).toBe(PaymentStatus.PENDING);
  });

  it('retrieveSubscription uses GET and signs an empty JSON body', async () => {
    request.mockResolvedValue({ data: { status: 'success', data: { referenceCode: 'sub-1' } } });
    const result = await iyzico.retrieveSubscription({ subscriptionReferenceCode: 'sub-1' });

    const config = request.mock.calls[0][0];
    expect(config.method).toBe('GET');
    expect(config.url).toBe('/v2/subscription/subscriptions/sub-1');
    expect(config.data).toBeUndefined();
    expect(config.headers.Authorization).toMatch(/^IYZWSv2 /);
    expect(result.status).toBe(PaymentStatus.SUCCESS);
  });

  it('maps subscription API status to PaymentStatus', async () => {
    request.mockResolvedValue({ data: { status: 'failure', errorCode: '100001', errorMessage: 'x' } });
    const result = await iyzico.cancelSubscription({ subscriptionReferenceCode: 'sub-1' });
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorCode).toBe('100001');
  });

  it('does not authorize a 3DS payment when mdStatus is not 1', async () => {
    const result = await iyzico.completeThreeDSPayment({
      status: 'failure',
      paymentId: '123',
      mdStatus: '0',
      conversationId: 'c1',
    });
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(request).not.toHaveBeenCalled();
  });

  it('does not take paymentId/conversationId of a rejected callback from the request', async () => {
    const result = await iyzico.completeThreeDSPayment({
      status: 'failure',
      paymentId: 'P-OTHER',
      mdStatus: '0',
      conversationId: 'ORDER-OTHER',
    });
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.paymentId).toBeUndefined();
    expect(result.conversationId).toBeUndefined();
  });

  it('does not carry the echoed conversationId when iyzico rejects the 3DS auth', async () => {
    request.mockResolvedValue({
      data: { status: 'failure', errorCode: '5005', errorMessage: 'x', conversationId: 'ORDER-OTHER' },
    });
    const result = await iyzico.completeThreeDSPayment({
      status: 'success',
      paymentId: 'P-OTHER',
      mdStatus: '1',
      conversationId: 'ORDER-OTHER',
    });
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.paymentId).toBeUndefined();
    expect(result.conversationId).toBeUndefined();
  });

  it('authorizes a 3DS payment when status=success and mdStatus=1', async () => {
    request.mockResolvedValue({ data: { status: 'success', paymentId: '123', conversationId: 'c1' } });
    const result = await iyzico.completeThreeDSPayment({
      status: 'success',
      paymentId: '123',
      mdStatus: '1',
      conversationId: 'c1',
    });
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.paymentId).toBe('123');
    expect(result.conversationId).toBe('c1');
    expect(request.mock.calls[0][0].url).toBe('/payment/3dsecure/auth');
  });

  it('returns PENDING (outcome unknown) on network errors instead of FAILURE', async () => {
    request.mockRejectedValue(new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' }));
    const result = await iyzico.createPayment({
      price: '1.00',
      paidPrice: '1.00',
      currency: 'TRY',
      basketId: 'B1',
      paymentCard: { cardHolderName: 'A B', cardNumber: '5528790000000008', expireMonth: '12', expireYear: '2030', cvc: '123' },
      buyer: {
        id: 'b', name: 'A', surname: 'B', email: 'a@b.c', identityNumber: '11111111111',
        registrationAddress: 'x', city: 'x', country: 'x', ip: '1.1.1.1', gsmNumber: '+905350000000',
      },
      shippingAddress: { contactName: 'A', city: 'x', country: 'x', address: 'x' },
      billingAddress: { contactName: 'A', city: 'x', country: 'x', address: 'x' },
      basketItems: [{ id: 'i', name: 'n', category1: 'c', itemType: 'PHYSICAL', price: '1.00' }],
    });
    expect(result.status).toBe(PaymentStatus.PENDING);
    expect(result.errorCode).toBe('NETWORK_ERROR');
  });
});
