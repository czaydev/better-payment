import { describe, it, expect, vi, afterEach } from 'vitest';
import { betterPayment, ConfigurationError, PaymentErrorCode, PaymentStatus } from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import { chaos, type ChaosOptions } from 'better-payment/plugins';
import { mockPaymentRequest } from '../../fixtures/payment-data';

function setup(options: ChaosOptions, mode: 'sandbox' | 'production' = 'sandbox') {
  const a = new MockProvider();
  const b = new MockProvider();
  const spyA = vi.spyOn(a, 'createPayment');
  const spyB = vi.spyOn(b, 'createPayment');
  const payment = betterPayment({
    providers: { a, b },
    defaultProvider: 'a',
    mode,
    plugins: [chaos(options)],
  });
  return { payment, spyA, spyB };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('chaos', () => {
  it('returns an injected failure without calling the provider', async () => {
    const { payment, spyA } = setup({ rules: [{ fail: 'CARD_DECLINED' }] });
    const result = await payment.createPayment(mockPaymentRequest);
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.code).toBe(PaymentErrorCode.CARD_DECLINED);
    expect(result.errorMessage).toContain('chaos');
    expect(spyA).not.toHaveBeenCalled();
  });

  it('returns a pending result for NETWORK_ERROR, with a custom message', async () => {
    const { payment } = setup({
      rules: [{ fail: 'NETWORK_ERROR', message: 'lost response' }],
    });
    const result = await payment.createPayment(mockPaymentRequest);
    expect(result.status).toBe(PaymentStatus.PENDING);
    expect(result.code).toBe(PaymentErrorCode.NETWORK_ERROR);
    expect(result.errorMessage).toBe('lost response');
  });

  it('emits the event of the injected result', async () => {
    const { payment } = setup({ rules: [{ fail: 'INSUFFICIENT_FUNDS' }] });
    const failed = vi.fn();
    payment.on('payment.failed', failed);
    await payment.createPayment(mockPaymentRequest);
    expect(failed).toHaveBeenCalledOnce();
  });

  it('applies rules only to matching operations and providers', async () => {
    const { payment, spyA, spyB } = setup({
      rules: [
        { operation: 'refund', fail: 'PROVIDER_ERROR' },
        { operation: 'createPayment', provider: 'b', fail: 'CARD_DECLINED' },
      ],
    });
    const viaA = await payment.createPayment(mockPaymentRequest);
    expect(viaA.status).toBe(PaymentStatus.SUCCESS);
    expect(spyA).toHaveBeenCalledOnce();

    const viaB = await payment.use('b').createPayment(mockPaymentRequest);
    expect(viaB.code).toBe(PaymentErrorCode.CARD_DECLINED);
    expect(spyB).not.toHaveBeenCalled();

    const refund = await payment.refund({ paymentTransactionId: 'x', price: '1.00' } as never);
    expect(refund.code).toBe(PaymentErrorCode.PROVIDER_ERROR);
  });

  it('uses the first matching rule that fires', async () => {
    const { payment } = setup({
      rules: [
        { probability: 0, fail: 'CARD_DECLINED' },
        { fail: 'EXPIRED_CARD' },
        { fail: 'INVALID_CVC' },
      ],
    });
    const result = await payment.createPayment(mockPaymentRequest);
    expect(result.code).toBe(PaymentErrorCode.EXPIRED_CARD);
  });

  it('fires the same calls for the same seed', async () => {
    const run = async () => {
      const { payment } = setup({ seed: 42, rules: [{ probability: 0.5, fail: 'CARD_DECLINED' }] });
      const statuses: string[] = [];
      for (let i = 0; i < 20; i++)
        statuses.push((await payment.createPayment(mockPaymentRequest)).status);
      return statuses;
    };
    const first = await run();
    expect(await run()).toEqual(first);
    expect(first).toContain(PaymentStatus.FAILURE);
    expect(first).toContain(PaymentStatus.SUCCESS);
  });

  it('delays the call and then runs it on the provider', async () => {
    vi.useFakeTimers();
    const { payment, spyA } = setup({ rules: [{ delay: '3s' }] });
    const pending = payment.createPayment(mockPaymentRequest);
    await vi.advanceTimersByTimeAsync(2999);
    expect(spyA).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(spyA).toHaveBeenCalledOnce();
    expect(result.status).toBe(PaymentStatus.SUCCESS);
  });

  it('can be turned off and on at runtime', async () => {
    const { payment, spyA } = setup({ enabled: false, rules: [{ fail: 'CARD_DECLINED' }] });
    expect(payment.chaos.enabled).toBe(false);
    expect((await payment.createPayment(mockPaymentRequest)).status).toBe(PaymentStatus.SUCCESS);
    payment.chaos.enable();
    expect((await payment.createPayment(mockPaymentRequest)).code).toBe(
      PaymentErrorCode.CARD_DECLINED
    );
    payment.chaos.disable();
    expect((await payment.createPayment(mockPaymentRequest)).status).toBe(PaymentStatus.SUCCESS);
    expect(spyA).toHaveBeenCalledTimes(2);
  });

  it('refuses to run in production mode unless allowed', async () => {
    const blocked = setup({ rules: [{ fail: 'CARD_DECLINED' }] }, 'production');
    await expect(blocked.payment.createPayment(mockPaymentRequest)).rejects.toThrow(
      ConfigurationError
    );

    const disabled = setup({ enabled: false, rules: [{ fail: 'CARD_DECLINED' }] }, 'production');
    expect((await disabled.payment.createPayment(mockPaymentRequest)).status).toBe(
      PaymentStatus.SUCCESS
    );
    expect(() => disabled.payment.chaos.enable()).toThrow(ConfigurationError);

    const allowed = setup(
      { allowProduction: true, rules: [{ fail: 'CARD_DECLINED' }] },
      'production'
    );
    expect((await allowed.payment.createPayment(mockPaymentRequest)).code).toBe(
      PaymentErrorCode.CARD_DECLINED
    );
  });

  it('validates its options', () => {
    expect(() => chaos({ rules: [{ probability: 2 }] })).toThrow(ConfigurationError);
    expect(() => chaos({ rules: [{ fail: 'NOPE' as never }] })).toThrow(ConfigurationError);
    expect(() => chaos({ rules: [{ delay: 'soon' }] })).toThrow(ConfigurationError);
  });
});
