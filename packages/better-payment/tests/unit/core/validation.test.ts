import { describe, it, expect, vi } from 'vitest';
import { luhn, validatePaymentRequest, RequestValidator } from '../../../src/core/validation';
import { ValidationError } from '../../../src/core/errors';
import { PaymentErrorCode } from '../../../src/core/error-codes';
import { betterPayment, iyzico as iyzicoProvider } from '../../../src';
import { Iyzico } from '../../../src/providers/iyzico';
import { PayTR } from '../../../src/providers/paytr';
import { PaymentStatus } from '../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../fixtures/payment-data';

const issuesOf = (fn: () => void) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof ValidationError) return error.issues.map((i) => i.path);
    throw error;
  }
  return [];
};

const card = mockPaymentRequest.paymentCard;

describe('luhn', () => {
  it('accepts valid numbers and rejects invalid ones', () => {
    expect(luhn('5528790000000008')).toBe(true);
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
  });
});

describe('RequestValidator.card', () => {
  const now = new Date(Date.UTC(2026, 8, 25));
  const check = (overrides: Partial<typeof card>) =>
    new RequestValidator()
      .card({ ...card, ...overrides }, 'paymentCard', now)
      .issues.map((i) => i.path);

  it('accepts a valid card, with spaces in the number', () => {
    expect(check({ cardNumber: '5528 7900 0000 0008' })).toEqual([]);
  });

  it('rejects bad numbers', () => {
    expect(check({ cardNumber: '1234' })).toEqual(['paymentCard.cardNumber']);
    expect(check({ cardNumber: '5528790000000009' })).toEqual(['paymentCard.cardNumber']);
  });

  it('accepts the current month and rejects past months', () => {
    expect(check({ expireMonth: '09', expireYear: '2026' })).toEqual([]);
    expect(check({ expireMonth: '09', expireYear: '26' })).toEqual([]);
    expect(check({ expireMonth: '08', expireYear: '2026' })).toEqual(['paymentCard.expireYear']);
  });

  it('rejects invalid month, year and CVC', () => {
    expect(check({ expireMonth: '13' })).toEqual(['paymentCard.expireMonth']);
    expect(check({ expireYear: '203' })).toEqual(['paymentCard.expireYear']);
    expect(check({ cvc: '12' })).toEqual(['paymentCard.cvc']);
    expect(check({ cvc: '12a' })).toEqual(['paymentCard.cvc']);
  });

  it('requires the card holder name', () => {
    expect(check({ cardHolderName: ' ' })).toEqual(['paymentCard.cardHolderName']);
  });
});

describe('validatePaymentRequest', () => {
  it('passes the test fixtures with every rule enabled', () => {
    expect(
      issuesOf(() =>
        validatePaymentRequest(mockPaymentRequest, {
          card: true,
          basketRequired: true,
          basketMatchesPrice: true,
          required: ['buyer.email', 'buyer.identityNumber', 'billingAddress.city'],
        })
      )
    ).toEqual([]);
  });

  it('checks amounts', () => {
    expect(issuesOf(() => validatePaymentRequest({ ...mockPaymentRequest, price: '0' }))).toEqual([
      'price',
    ]);
    expect(
      issuesOf(() => validatePaymentRequest({ ...mockPaymentRequest, price: '10.555' }))
    ).toEqual(['price']);
    expect(
      issuesOf(() => validatePaymentRequest({ ...mockPaymentRequest, paidPrice: '-1' }))
    ).toEqual(['paidPrice']);
  });

  it('requires basket prices to add up to price when asked', () => {
    const request = { ...mockPaymentRequest, price: '2', paidPrice: '2' };
    expect(issuesOf(() => validatePaymentRequest(request))).toEqual([]);
    expect(issuesOf(() => validatePaymentRequest(request, { basketMatchesPrice: true }))).toEqual([
      'basketItems',
    ]);
  });

  it('checks required fields and buyer formats', () => {
    const request = {
      ...mockPaymentRequest,
      buyer: { ...mockPaymentRequest.buyer, email: 'nope', ip: '999.1.1.1', gsmNumber: '12' },
    };
    expect(
      issuesOf(() => validatePaymentRequest(request, { required: ['buyer.identityNumber'] }))
    ).toEqual(['buyer.email', 'buyer.ip', 'buyer.gsmNumber']);
    expect(
      issuesOf(() =>
        validatePaymentRequest(
          { ...mockPaymentRequest, buyer: { ...mockPaymentRequest.buyer, identityNumber: '' } },
          { required: ['buyer.identityNumber'] }
        )
      )
    ).toEqual(['buyer.identityNumber']);
  });

  it('checks the email domain', () => {
    for (const email of ['a@b', 'a@b.', 'a@.b', 'a@b..c', '!@!.' + '!.'.repeat(1000)]) {
      const request = { ...mockPaymentRequest, buyer: { ...mockPaymentRequest.buyer, email } };
      expect(issuesOf(() => validatePaymentRequest(request))).toEqual(['buyer.email']);
    }
    const valid = { ...mockPaymentRequest.buyer, email: 'first.last@mail.example.com.tr' };
    expect(issuesOf(() => validatePaymentRequest({ ...mockPaymentRequest, buyer: valid }))).toEqual(
      []
    );
  });

  it('accepts IPv6 addresses', () => {
    const request = {
      ...mockPaymentRequest,
      buyer: { ...mockPaymentRequest.buyer, ip: '2001:db8::1' },
    };
    expect(issuesOf(() => validatePaymentRequest(request))).toEqual([]);
  });

  it('reports every issue and names the fields in the message', () => {
    try {
      validatePaymentRequest(
        { ...mockPaymentRequest, price: 'x' },
        { card: true, required: ['buyer.foo'] }
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const e = error as ValidationError;
      expect(e.field).toBe('price');
      expect(e.message).toContain('price must be a decimal amount');
      expect(e.message).toContain('buyer.foo is required');
    }
  });
});

describe('providers validate before calling the API', () => {
  const iyzico = (validate?: boolean) => {
    const provider = new Iyzico({
      apiKey: 'k',
      secretKey: 's',
      baseUrl: 'https://sandbox-api.iyzipay.com',
      validate,
    });
    const request = vi.fn().mockResolvedValue({ data: { status: 'success', paymentId: '1' } });
    (provider as any).client.request = request;
    return { provider, request };
  };

  it('returns INVALID_REQUEST without an HTTP call', async () => {
    const { provider, request } = iyzico();

    const result = await provider.createPayment({
      ...mockPaymentRequest,
      paymentCard: { ...card, cardNumber: '5528790000000009' },
    });

    expect(request).not.toHaveBeenCalled();
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
    expect(result.errorMessage).toContain('paymentCard.cardNumber');
  });

  it('checks iyzico basket totals', async () => {
    const { provider, request } = iyzico();
    const result = await provider.createPayment({
      ...mockPaymentRequest,
      price: '5',
      paidPrice: '5',
    });
    expect(request).not.toHaveBeenCalled();
    expect(result.errorMessage).toContain('basketItems');
  });

  it('can be disabled per provider', async () => {
    const { provider, request } = iyzico(false);
    const result = await provider.createPayment({
      ...mockPaymentRequest,
      price: '5',
      paidPrice: '5',
    });
    expect(request).toHaveBeenCalled();
    expect(result.status).toBe(PaymentStatus.SUCCESS);
  });

  it('can be disabled globally', () => {
    const payment = betterPayment({
      validate: false,
      providers: { iyzico: iyzicoProvider({ apiKey: 'k', secretKey: 's' }) },
    });
    expect((payment.iyzico as any).config.validate).toBe(false);
  });

  it('validates refund amounts', async () => {
    const { provider, request } = iyzico();
    const result = await provider.refund({
      paymentId: '1',
      price: '-5',
      currency: 'TRY',
      ip: '1.1.1.1',
    });
    expect(request).not.toHaveBeenCalled();
    expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
  });

  it('PayTR iFrame payments do not require card data', async () => {
    const provider = new PayTR({
      merchantId: '123456',
      merchantKey: 'key',
      merchantSalt: 'salt',
      baseUrl: 'https://www.paytr.com',
    });
    const post = vi.fn().mockResolvedValue({ data: { status: 'success', token: 't' } });
    (provider as any).client.post = post;

    const result = await provider.initThreeDSPayment({
      ...mockThreeDSPaymentRequest,
      conversationId: 'ORDER1',
      paymentCard: { ...card, cardNumber: '' },
    });

    expect(post).toHaveBeenCalled();
    expect(result.status).toBe(PaymentStatus.PENDING);
  });
});
