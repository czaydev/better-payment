import { describe, it, expect, vi } from 'vitest';
import { betterPayment, ConfigurationError, PaymentStatus } from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import { multiTenant } from 'better-payment/plugins';
import { mockPaymentRequest, mockRefundRequest } from '../../fixtures/payment-data';

describe('multiTenant plugin', () => {
  it('validates configuration options', () => {
    expect(() =>
      // @ts-expect-error test missing credentials
      multiTenant({})
    ).toThrow(ConfigurationError);
  });

  it('routes operations to different tenant provider credentials via forTenant', async () => {
    const providerA = new MockProvider();
    const providerB = new MockProvider();

    const credentialsFn = vi.fn(async (tenantId: string) => {
      if (tenantId === 'merchant-a') return providerA;
      if (tenantId === 'merchant-b') return providerB;
      throw new Error('Unknown tenant');
    });

    const payment = betterPayment({
      providers: { default: new MockProvider() },
      plugins: [
        multiTenant({
          credentials: credentialsFn,
        }),
      ],
    });

    // Tenant A
    const resA = await payment.forTenant('merchant-a').createPayment({
      ...mockPaymentRequest,
      price: '100.00',
      paidPrice: '100.00',
    });
    expect(resA.status).toBe(PaymentStatus.SUCCESS);
    expect(resA.tenantId).toBe('merchant-a');

    // Tenant B
    const resB = await payment.forTenant('merchant-b').createPayment({
      ...mockPaymentRequest,
      price: '200.00',
      paidPrice: '200.00',
    });
    expect(resB.status).toBe(PaymentStatus.SUCCESS);
    expect(resB.tenantId).toBe('merchant-b');

    expect(credentialsFn).toHaveBeenCalledWith('merchant-a', 'default');
    expect(credentialsFn).toHaveBeenCalledWith('merchant-b', 'default');
  });

  it('routes operations through before hook using custom tenant resolver and request metadata', async () => {
    const providerA = new MockProvider();
    const providerB = new MockProvider();

    const payment = betterPayment({
      providers: { default: new MockProvider() },
      plugins: [
        multiTenant({
          tenant: (ctx) => {
            const req = ctx.request as Record<string, unknown>;
            return req?.tenantId as string | undefined;
          },
          credentials: async (tenantId) => {
            return tenantId === 'shop-1' ? providerA : providerB;
          },
        }),
      ],
    });

    // Request with explicit tenantId
    const res1 = await payment.createPayment({
      ...mockPaymentRequest,
      // @ts-expect-error custom metadata field
      tenantId: 'shop-1',
    });
    expect(res1.tenantId).toBe('shop-1');

    const res2 = await payment.createPayment({
      ...mockPaymentRequest,
      // @ts-expect-error custom metadata field
      tenantId: 'shop-2',
    });
    expect(res2.tenantId).toBe('shop-2');
  });

  it('routes 3D Secure callbacks carrying tenant id in conversationId', async () => {
    const providerA = new MockProvider();
    const providerB = new MockProvider();

    const payment = betterPayment({
      providers: { default: new MockProvider() },
      plugins: [
        multiTenant({
          trustRequestTenant: true,
          credentials: async (tenantId) => {
            return tenantId === 'tenant-alpha' ? providerA : providerB;
          },
        }),
      ],
    });

    // Callback carrying tenant in conversationId prefix `tenant:tenant-alpha:order-123`
    const callbackResult = await payment.completeThreeDSPayment({
      conversationId: 'tenant:tenant-alpha:order-123',
      paymentId: 'pay_123',
    });

    expect(callbackResult.tenantId).toBe('tenant-alpha');
  });

  it.each([
    ['tenantId', { tenantId: 'merchant-b' }],
    ['__tenantId', { __tenantId: 'merchant-b' }],
    ['metadata.tenantId', { metadata: { tenantId: 'merchant-b' } }],
  ])('refuses a handler request that names the tenant in its %s field', async (_field, extra) => {
    const providerA = new MockProvider();
    const providerB = new MockProvider();
    const credentials = vi.fn(async (tenantId: string) =>
      tenantId === 'merchant-a' ? providerA : providerB
    );

    const payment = betterPayment({
      providers: { default: new MockProvider() },
      plugins: [multiTenant({ credentials })],
    });

    // `payment.use()` is how the HTTP handler runs an operation: the body is the
    // caller's, so it must not choose whose credentials the payment runs with.
    await expect(
      payment.use('default').createPayment({ ...mockPaymentRequest, ...extra })
    ).rejects.toThrow(/written by the caller/);
    expect(credentials).not.toHaveBeenCalled();
  });

  it('refuses the body tenant even with trustRequestTenant when the call is not routable', async () => {
    const credentials = vi.fn(async () => new MockProvider());
    const payment = betterPayment({
      providers: { default: new MockProvider() },
      plugins: [multiTenant({ credentials, trustRequestTenant: true })],
    });

    await expect(
      payment.use('default').createPayment({ ...mockPaymentRequest, tenantId: 'merchant-b' })
    ).rejects.toThrow(/written by the caller/);
    expect(credentials).not.toHaveBeenCalled();
  });

  it('never routes a callback with a forged conversationId prefix by default', async () => {
    const providerB = new MockProvider();
    const spy = vi.spyOn(providerB, 'createPayment');
    const credentials = vi.fn(async () => providerB);

    const payment = betterPayment({
      providers: { default: new MockProvider() },
      plugins: [multiTenant({ credentials })],
    });

    const res = await payment.use('default').createPayment({
      ...mockPaymentRequest,
      conversationId: 'tenant:merchant-b:order-1',
    });

    // The conversationId alone is only ignored, never trusted: merchant-b's contract is
    // never loaded, never called, and the response carries no tenant tag.
    expect(res.tenantId).toBeUndefined();
    expect(credentials).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps the server-side resolver authoritative over the body', async () => {
    const providerA = new MockProvider();
    const providerB = new MockProvider();
    const payment = betterPayment({
      providers: { default: new MockProvider() },
      plugins: [
        multiTenant({
          tenant: () => 'merchant-a',
          trustRequestTenant: true,
          credentials: async (tenantId) => (tenantId === 'merchant-a' ? providerA : providerB),
        }),
      ],
    });

    const res = await payment.createPayment({
      ...mockPaymentRequest,
      // @ts-expect-error forged tenant field
      tenantId: 'merchant-b',
    });
    expect(res.tenantId).toBe('merchant-a');
  });

  it('caches tenant provider instances and respects cache TTL and eviction', async () => {
    const credentialsFn = vi.fn(async () => new MockProvider());

    const payment = betterPayment({
      providers: { default: new MockProvider() },
      plugins: [
        multiTenant({
          credentials: credentialsFn,
          cache: { ttl: 50 }, // 50ms TTL
        }),
      ],
    });

    // 1st call: loads credentials
    await payment.forTenant('cached-shop').createPayment(mockPaymentRequest);
    expect(credentialsFn).toHaveBeenCalledTimes(1);

    // 2nd call: hits cache
    await payment.forTenant('cached-shop').createPayment(mockPaymentRequest);
    expect(credentialsFn).toHaveBeenCalledTimes(1);

    // Manual clearCache
    payment.tenants.clearCache('cached-shop');

    // 3rd call: reloads credentials
    await payment.forTenant('cached-shop').createPayment(mockPaymentRequest);
    expect(credentialsFn).toHaveBeenCalledTimes(2);

    // Wait for TTL expiry
    await new Promise((resolve) => setTimeout(resolve, 60));

    // 4th call: reloads credentials after TTL
    await payment.forTenant('cached-shop').createPayment(mockPaymentRequest);
    expect(credentialsFn).toHaveBeenCalledTimes(3);
  });

  it('supports instantiating providers via provider factory mapping', async () => {
    const factory = vi.fn((creds: Record<string, unknown>) => {
      return new MockProvider();
    });

    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [
        multiTenant({
          credentials: async (tenantId) => ({
            apiKey: `key_${tenantId}`,
            secretKey: `secret_${tenantId}`,
          }),
          providers: {
            mock: factory,
          },
        }),
      ],
    });

    const res = await payment.forTenant('merchant-x').createPayment({
      ...mockPaymentRequest,
      // @ts-expect-error provider selector
      provider: 'mock',
    });
    expect(res.status).toBe(PaymentStatus.SUCCESS);
    expect(factory).toHaveBeenCalledWith({
      apiKey: 'key_merchant-x',
      secretKey: 'secret_merchant-x',
    });
  });
});
