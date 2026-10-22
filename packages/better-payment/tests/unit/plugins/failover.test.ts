import { describe, it, expect, vi } from 'vitest';
import {
  betterPayment,
  PaymentErrorCode,
  PaymentStatus,
  type PaymentRequest,
  type PaymentResponse,
} from 'better-payment';
import { failover } from 'better-payment/plugins';
import { MockProvider } from 'better-payment/testing';
import { mockPaymentRequest } from '../../fixtures/payment-data';

describe('failover plugin', () => {
  it('switches to the next provider on a transient provider failure', async () => {
    const a = new MockProvider();
    const b = new MockProvider();

    // Mock a to return PROVIDER_ERROR
    vi.spyOn(a, 'createPayment').mockResolvedValueOnce({
      status: PaymentStatus.FAILURE,
      code: PaymentErrorCode.PROVIDER_ERROR,
      errorCode: 'PROVIDER_ERROR',
      errorMessage: 'Service temporarily unavailable',
    } as PaymentResponse);

    // Mock b to succeed
    vi.spyOn(b, 'createPayment').mockResolvedValueOnce({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay_from_b',
    } as PaymentResponse);

    const onSwitch = vi.fn();

    const payment = betterPayment({
      providers: { a, b },
      defaultProvider: 'a',
      plugins: [
        failover({
          order: ['a', 'b'],
          onSwitch,
        }),
      ],
    });

    const res = await payment.createPayment(mockPaymentRequest);

    expect(res.status).toBe(PaymentStatus.SUCCESS);
    expect(res.paymentId).toBe('pay_from_b');
    expect(a.createPayment).toHaveBeenCalledTimes(1);
    expect(b.createPayment).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'a',
        to: 'b',
        operation: 'createPayment',
        attempt: 2,
      })
    );
  });

  it('never retries when the result is NETWORK_ERROR or pending (prevents double charging)', async () => {
    const a = new MockProvider();
    const b = new MockProvider();

    // Provider A returns NETWORK_ERROR with PENDING status
    vi.spyOn(a, 'createPayment').mockResolvedValueOnce({
      status: PaymentStatus.PENDING,
      code: PaymentErrorCode.NETWORK_ERROR,
      errorCode: 'NETWORK_ERROR',
      errorMessage: 'Socket hang up after request sent',
    } as PaymentResponse);

    vi.spyOn(b, 'createPayment');

    const payment = betterPayment({
      providers: { a, b },
      defaultProvider: 'a',
      plugins: [
        failover({
          order: ['a', 'b'],
        }),
      ],
    });

    const res = await payment.createPayment(mockPaymentRequest);

    // Should NOT retry on b!
    expect(res.status).toBe(PaymentStatus.PENDING);
    expect(res.code).toBe(PaymentErrorCode.NETWORK_ERROR);
    expect(a.createPayment).toHaveBeenCalledTimes(1);
    expect(b.createPayment).not.toHaveBeenCalled();
  });

  it('does not retry when a card is declined (e.g. INSUFFICIENT_FUNDS)', async () => {
    const a = new MockProvider();
    const b = new MockProvider();

    vi.spyOn(a, 'createPayment').mockResolvedValueOnce({
      status: PaymentStatus.FAILURE,
      code: PaymentErrorCode.INSUFFICIENT_FUNDS,
      errorCode: '51',
      errorMessage: 'Yetersiz bakiye',
    } as PaymentResponse);

    vi.spyOn(b, 'createPayment');

    const payment = betterPayment({
      providers: { a, b },
      defaultProvider: 'a',
      plugins: [
        failover({
          order: ['a', 'b'],
        }),
      ],
    });

    const res = await payment.createPayment(mockPaymentRequest);

    expect(res.status).toBe(PaymentStatus.FAILURE);
    expect(res.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
    expect(a.createPayment).toHaveBeenCalledTimes(1);
    expect(b.createPayment).not.toHaveBeenCalled();
  });

  it('circuit breaker opens after failure threshold and skips the faulty provider in before hook', async () => {
    const a = new MockProvider();
    const b = new MockProvider();

    const failureRes: PaymentResponse = {
      status: PaymentStatus.FAILURE,
      code: PaymentErrorCode.PROVIDER_ERROR,
      errorCode: 'TIMEOUT_BEFORE_SEND',
      errorMessage: 'Timeout before connect',
    };

    const successRes: PaymentResponse = {
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay_ok',
    };

    vi.spyOn(a, 'createPayment').mockResolvedValue(failureRes);
    vi.spyOn(b, 'createPayment').mockResolvedValue(successRes);

    const payment = betterPayment({
      providers: { a, b },
      defaultProvider: 'a',
      plugins: [
        failover({
          order: ['a', 'b'],
          circuitBreaker: {
            failures: 2,
            window: '1m',
            cooldown: '5m',
          },
        }),
      ],
    });

    // Request 1: a fails, switches to b (a has 1 failure)
    await payment.createPayment(mockPaymentRequest);
    expect(a.createPayment).toHaveBeenCalledTimes(1);
    expect(b.createPayment).toHaveBeenCalledTimes(1);
    expect((payment as any).failover.status().a.state).toBe('closed');

    // Request 2: a fails, switches to b (a has 2 failures => circuit TRIPS to open!)
    await payment.createPayment(mockPaymentRequest);
    expect(a.createPayment).toHaveBeenCalledTimes(2);
    expect(b.createPayment).toHaveBeenCalledTimes(2);
    expect((payment as any).failover.status().a.state).toBe('open');

    // Request 3: a circuit is OPEN! Before hook should immediately route to b without touching a!
    const res3 = await payment.createPayment(mockPaymentRequest);
    expect(res3.status).toBe(PaymentStatus.SUCCESS);
    expect(a.createPayment).toHaveBeenCalledTimes(2); // Still 2! Did NOT call a
    expect(b.createPayment).toHaveBeenCalledTimes(3);

    // Reset circuit breaker
    (payment as any).failover.reset('a');
    expect((payment as any).failover.status().a.state).toBe('closed');
  });

  it('supports dynamic order and custom trip manual override', async () => {
    const a = new MockProvider();
    const b = new MockProvider();
    const c = new MockProvider();

    vi.spyOn(a, 'createPayment').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay_a',
    } as PaymentResponse);

    vi.spyOn(b, 'createPayment').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay_b',
    } as PaymentResponse);

    const payment = betterPayment({
      providers: { a, b, c },
      defaultProvider: 'a',
      plugins: [
        failover({
          order: () => ['a', 'b', 'c'],
          circuitBreaker: { cooldown: '10m' },
        }),
      ],
    });

    // Manually trip a
    (payment as any).failover.trip('a');
    expect((payment as any).failover.status().a.state).toBe('open');

    // Now call createPayment: should route directly to b
    const res = await payment.createPayment(mockPaymentRequest);
    expect(res.paymentId).toBe('pay_b');
    expect(a.createPayment).not.toHaveBeenCalled();
    expect(b.createPayment).toHaveBeenCalledTimes(1);
  });

  it('does not failover non-routable direct provider calls', async () => {
    const a = new MockProvider();
    const b = new MockProvider();

    vi.spyOn(a, 'createPayment').mockResolvedValueOnce({
      status: PaymentStatus.FAILURE,
      code: PaymentErrorCode.PROVIDER_ERROR,
      errorCode: 'PROVIDER_ERROR',
      errorMessage: 'Down',
    } as PaymentResponse);

    vi.spyOn(b, 'createPayment');

    const payment = betterPayment({
      providers: { a, b },
      plugins: [
        failover({
          order: ['a', 'b'],
        }),
      ],
    });

    // Directly calling provider instance (routable is false)
    const res = await payment.use('a').createPayment(mockPaymentRequest);
    expect(res.status).toBe(PaymentStatus.FAILURE);
    expect(b.createPayment).not.toHaveBeenCalled();
  });

  it('fails over for authorize operation as well', async () => {
    const a = new MockProvider();
    const b = new MockProvider();

    vi.spyOn(a, 'authorize').mockResolvedValueOnce({
      status: PaymentStatus.FAILURE,
      code: PaymentErrorCode.PROVIDER_ERROR,
      errorCode: 'TIMEOUT',
      errorMessage: 'Gateway timed out',
    } as PaymentResponse);

    vi.spyOn(b, 'authorize').mockResolvedValueOnce({
      status: PaymentStatus.SUCCESS,
      paymentId: 'auth_ok_b',
    } as PaymentResponse);

    const payment = betterPayment({
      providers: { a, b },
      defaultProvider: 'a',
      plugins: [
        failover({
          order: ['a', 'b'],
        }),
      ],
    });

    const res = await payment.authorize(mockPaymentRequest);
    expect(res.status).toBe(PaymentStatus.SUCCESS);
    expect(res.paymentId).toBe('auth_ok_b');
    expect(a.authorize).toHaveBeenCalledTimes(1);
    expect(b.authorize).toHaveBeenCalledTimes(1);
  });

  it('returns last failure when all providers in order fail', async () => {
    const a = new MockProvider();
    const b = new MockProvider();

    vi.spyOn(a, 'createPayment').mockResolvedValueOnce({
      status: PaymentStatus.FAILURE,
      code: PaymentErrorCode.PROVIDER_ERROR,
      errorCode: 'ERR_A',
      errorMessage: 'A down',
    } as PaymentResponse);

    vi.spyOn(b, 'createPayment').mockResolvedValueOnce({
      status: PaymentStatus.FAILURE,
      code: PaymentErrorCode.PROVIDER_ERROR,
      errorCode: 'ERR_B',
      errorMessage: 'B down',
    } as PaymentResponse);

    const payment = betterPayment({
      providers: { a, b },
      defaultProvider: 'a',
      plugins: [
        failover({
          order: ['a', 'b'],
        }),
      ],
    });

    const res = await payment.createPayment(mockPaymentRequest);
    expect(res.status).toBe(PaymentStatus.FAILURE);
    expect(res.errorCode).toBe('ERR_B');
    expect(a.createPayment).toHaveBeenCalledTimes(1);
    expect(b.createPayment).toHaveBeenCalledTimes(1);
  });

  it('circuit breaker enters half-open and recovers on successful probe', async () => {
    const a = new MockProvider();
    const b = new MockProvider();

    const payment = betterPayment({
      providers: { a, b },
      defaultProvider: 'a',
      plugins: [
        failover({
          order: ['a', 'b'],
          circuitBreaker: { cooldown: 50 }, // 50ms cooldown for fast test
        }),
      ],
    });

    // Manually trip a
    (payment as any).failover.trip('a', 50);
    expect((payment as any).failover.status().a.state).toBe('open');

    // Wait 60ms for cooldown to elapse
    await new Promise((r) => setTimeout(r, 60));

    // Now state should be half-open
    expect((payment as any).failover.status().a.state).toBe('half-open');

    // Make successful payment on a
    vi.spyOn(a, 'createPayment').mockResolvedValueOnce({
      status: PaymentStatus.SUCCESS,
      paymentId: 'probe_ok',
    } as PaymentResponse);

    const res = await payment.createPayment(mockPaymentRequest);
    expect(res.status).toBe(PaymentStatus.SUCCESS);
    expect(res.paymentId).toBe('probe_ok');
    expect((payment as any).failover.status().a.state).toBe('closed');
  });

  it.each([500, 502, 504])(
    'never fails over after an HTTP %i answer, which may follow a charge',
    async (httpStatus) => {
      const a = new MockProvider();
      const b = new MockProvider();
      vi.spyOn(a, 'createPayment').mockResolvedValueOnce({
        status: PaymentStatus.FAILURE,
        code: PaymentErrorCode.PROVIDER_ERROR,
        errorCode: String(httpStatus),
        errorMessage: 'Gateway error',
        httpStatus,
      } as PaymentResponse);
      vi.spyOn(b, 'createPayment');

      const payment = betterPayment({
        providers: { a, b },
        defaultProvider: 'a',
        // Even when the codes are listed explicitly
        plugins: [failover({ order: ['a', 'b'], on: ['PROVIDER_ERROR', String(httpStatus)] })],
      });

      const res = await payment.createPayment(mockPaymentRequest);

      expect(res.status).toBe(PaymentStatus.FAILURE);
      expect(b.createPayment).not.toHaveBeenCalled();
    }
  );

  it('fails over after an HTTP 503 answer', async () => {
    const a = new MockProvider();
    const b = new MockProvider();
    vi.spyOn(a, 'createPayment').mockResolvedValueOnce({
      status: PaymentStatus.FAILURE,
      errorCode: '503',
      errorMessage: 'Service unavailable',
      httpStatus: 503,
    } as PaymentResponse);
    vi.spyOn(b, 'createPayment').mockResolvedValueOnce({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay_from_b',
    } as PaymentResponse);

    const payment = betterPayment({
      providers: { a, b },
      defaultProvider: 'a',
      plugins: [failover({ order: ['a', 'b'] })],
    });

    const res = await payment.createPayment(mockPaymentRequest);

    expect(res.paymentId).toBe('pay_from_b');
  });
});
