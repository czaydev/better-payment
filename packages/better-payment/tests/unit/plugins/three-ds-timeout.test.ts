import { describe, it, expect, vi } from 'vitest';
import {
  betterPayment,
  ProviderType,
  PaymentStatus,
  type ThreeDSInitResponse,
  type PaymentResponse,
} from '../../../src';
import { MockProvider } from '../../../src/testing';
import {
  threeDSTimeout,
  MemoryThreeDSFlowStore,
  type ThreeDSFlowStore,
  type StartedThreeDSFlow,
} from '../../../src/plugins/three-ds-timeout';
import { mockPaymentRequest } from '../../fixtures/payment-data';

function buildPayment(plugin: ReturnType<typeof threeDSTimeout>, mockOverrides?: Partial<MockProvider>) {
  const mockProvider = new MockProvider();
  if (mockOverrides) {
    Object.assign(mockProvider, mockOverrides);
  }

  const payment = betterPayment({
    providers: {
      [ProviderType.MOCK]: mockProvider,
    },
    defaultProvider: ProviderType.MOCK,
    plugins: [plugin],
  });

  return { payment, mockProvider };
}

describe('threeDSTimeout plugin', () => {
  it('parses duration strings and numbers properly', () => {
    expect(() => threeDSTimeout({ after: -5 })).toThrow('greater than 0');
    expect(() => threeDSTimeout({ after: 'invalid' })).toThrow("invalid duration 'invalid'");

    const p1 = threeDSTimeout({ after: 5000 });
    expect(p1.id).toBe('three-ds-timeout');

    const p2 = threeDSTimeout({ after: '15m' });
    expect(p2.id).toBe('three-ds-timeout');
  });

  it('tracks started flows on initThreeDSPayment and initThreeDSAuthorize', async () => {
    const store = new MemoryThreeDSFlowStore();
    const plugin = threeDSTimeout({ store, after: '10m' });
    const { payment } = buildPayment(plugin);

    const initResult = await payment.initThreeDSPayment({
      ...mockPaymentRequest,
      callbackUrl: 'https://example.com/callback',
    });

    expect(initResult.paymentId).toBeDefined();
    const tracked = await store.list();
    expect(tracked).toHaveLength(1);
    expect(tracked[0].paymentId).toBe(initResult.paymentId);
    expect(tracked[0].conversationId).toBe(mockPaymentRequest.conversationId);
    expect(tracked[0].operation).toBe('initThreeDSPayment');
    expect(tracked[0].provider).toBe(ProviderType.MOCK);
    expect(tracked[0].startedAt).toBeGreaterThan(0);

    // Also test initThreeDSAuthorize
    await payment.initThreeDSAuthorize({
      ...mockPaymentRequest,
      conversationId: 'conv-auth-123',
      callbackUrl: 'https://example.com/callback',
    });

    const tracked2 = await store.list();
    expect(tracked2).toHaveLength(2);
    expect(tracked2.some((f) => f.conversationId === 'conv-auth-123')).toBe(true);
  });

  it('does not track flows when initThreeDSPayment fails', async () => {
    const store = new MemoryThreeDSFlowStore();
    const plugin = threeDSTimeout({ store });
    const mockProvider = new MockProvider();
    vi.spyOn(mockProvider, 'initThreeDSPayment').mockResolvedValueOnce({
      status: PaymentStatus.FAILURE,
      errorMessage: 'Invalid card number',
    } as ThreeDSInitResponse);

    const payment = betterPayment({
      providers: { [ProviderType.MOCK]: mockProvider },
      plugins: [plugin],
    });

    await payment.initThreeDSPayment({
      ...mockPaymentRequest,
      callbackUrl: 'https://example.com/callback',
    });

    const tracked = await store.list();
    expect(tracked).toHaveLength(0);
  });

  it('removes tracked flow on completeThreeDSPayment', async () => {
    const store = new MemoryThreeDSFlowStore();
    const plugin = threeDSTimeout({ store });
    const { payment } = buildPayment(plugin);

    const initResult = await payment.initThreeDSPayment({
      ...mockPaymentRequest,
      callbackUrl: 'https://example.com/callback',
    });

    expect(await store.list()).toHaveLength(1);

    // Complete the payment
    await payment.completeThreeDSPayment({
      paymentId: initResult.paymentId,
      status: 'success',
    });

    expect(await store.list()).toHaveLength(0);
  });

  it('expireStale does not expire flows that are not yet stale', async () => {
    const store = new MemoryThreeDSFlowStore();
    const onExpire = vi.fn();
    const plugin = threeDSTimeout({ store, after: '15m', onExpire });
    const { payment } = buildPayment(plugin);

    await payment.initThreeDSPayment({
      ...mockPaymentRequest,
      callbackUrl: 'https://example.com/callback',
    });

    // Right now, flow is only a few ms old
    const result = await (payment as any).threeDS.expireStale();

    expect(result.checked).toBe(0);
    expect(result.expired).toHaveLength(0);
    expect(onExpire).not.toHaveBeenCalled();
    expect(await store.list()).toHaveLength(1);
  });

  it('expireStale expires abandoned flows past the timeout and triggers onExpire', async () => {
    const store = new MemoryThreeDSFlowStore();
    const onExpire = vi.fn();
    const plugin = threeDSTimeout({ store, after: '15m', onExpire });
    const mockProvider = new MockProvider();
    // getPayment returns PENDING (still waiting at provider)
    vi.spyOn(mockProvider, 'getPayment').mockResolvedValue({
      status: PaymentStatus.PENDING,
      paymentId: 'PMT-STALE',
    } as PaymentResponse);

    const payment = betterPayment({
      providers: { [ProviderType.MOCK]: mockProvider },
      plugins: [plugin],
    });

    await payment.initThreeDSPayment({
      ...mockPaymentRequest,
      conversationId: 'ORDER-999',
      callbackUrl: 'https://example.com/callback',
    });

    const [flow] = await store.list();
    expect(flow).toBeDefined();

    // Fast-forward time by 16 minutes
    const futureTime = flow.startedAt + 16 * 60 * 1000;
    const result = await (payment as any).threeDS.expireStale(futureTime);

    expect(result.checked).toBe(1);
    expect(result.expired).toHaveLength(1);
    expect(result.expired[0].conversationId).toBe('ORDER-999');
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onExpire).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'ORDER-999' }));

    // Store should now be empty
    expect(await store.list()).toHaveLength(0);
  });

  it('expireStale does NOT expire flow if provider returns SUCCESS (late callback resolved)', async () => {
    const store = new MemoryThreeDSFlowStore();
    const onExpire = vi.fn();
    const plugin = threeDSTimeout({ store, after: '15m', onExpire, checkProvider: true });
    const mockProvider = new MockProvider();
    // Simulate late success confirmed at bank/provider
    vi.spyOn(mockProvider, 'getPayment').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'PMT-RESOLVED',
    } as PaymentResponse);

    const payment = betterPayment({
      providers: { [ProviderType.MOCK]: mockProvider },
      plugins: [plugin],
    });

    await payment.initThreeDSPayment({
      ...mockPaymentRequest,
      conversationId: 'ORDER-LATE-OK',
      callbackUrl: 'https://example.com/callback',
    });

    const [flow] = await store.list();
    const futureTime = flow.startedAt + 20 * 60 * 1000;
    const result = await (payment as any).threeDS.expireStale(futureTime);

    expect(result.checked).toBe(1);
    expect(result.resolved).toBe(1);
    expect(result.expired).toHaveLength(0);
    expect(onExpire).not.toHaveBeenCalled();

    // Flow is cleaned from store since it completed at provider
    expect(await store.list()).toHaveLength(0);
  });

  it('expireStale cleans flow without onExpire if provider confirms it was FAILURE', async () => {
    const store = new MemoryThreeDSFlowStore();
    const onExpire = vi.fn();
    const plugin = threeDSTimeout({ store, after: '15m', onExpire, checkProvider: true });
    const mockProvider = new MockProvider();
    vi.spyOn(mockProvider, 'getPayment').mockResolvedValue({
      status: PaymentStatus.FAILURE,
      paymentId: 'PMT-FAILED',
    } as PaymentResponse);

    const payment = betterPayment({
      providers: { [ProviderType.MOCK]: mockProvider },
      plugins: [plugin],
    });

    await payment.initThreeDSPayment({
      ...mockPaymentRequest,
      conversationId: 'ORDER-FAILED',
      callbackUrl: 'https://example.com/callback',
    });

    const [flow] = await store.list();
    const futureTime = flow.startedAt + 20 * 60 * 1000;
    const result = await (payment as any).threeDS.expireStale(futureTime);

    expect(result.checked).toBe(1);
    expect(result.expired).toHaveLength(0);
    expect(onExpire).not.toHaveBeenCalled();
    expect(await store.list()).toHaveLength(0);
  });

  it('supports custom ThreeDSFlowStore implementation', async () => {
    const customMap = new Map<string, StartedThreeDSFlow>();
    const customStore: ThreeDSFlowStore = {
      save: vi.fn((f) => { customMap.set(f.paymentId, f); }),
      get: vi.fn((id) => customMap.get(id)),
      delete: vi.fn((id) => { customMap.delete(id); }),
      list: vi.fn(() => Array.from(customMap.values())),
    };

    const plugin = threeDSTimeout({ store: customStore });
    const { payment } = buildPayment(plugin);

    await payment.initThreeDSPayment({
      ...mockPaymentRequest,
      callbackUrl: 'https://example.com/callback',
    });

    expect(customStore.save).toHaveBeenCalledTimes(1);
    expect(customMap.size).toBe(1);
  });

  it('still expires stale flow if provider getPayment throws an error', async () => {
    const store = new MemoryThreeDSFlowStore();
    const onExpire = vi.fn();
    const plugin = threeDSTimeout({ store, after: '10m', onExpire });
    const mockProvider = new MockProvider();
    vi.spyOn(mockProvider, 'getPayment').mockRejectedValue(new Error('Network timeout to bank'));

    const payment = betterPayment({
      providers: { [ProviderType.MOCK]: mockProvider },
      plugins: [plugin],
    });

    await payment.initThreeDSPayment({
      ...mockPaymentRequest,
      callbackUrl: 'https://example.com/callback',
    });

    const [flow] = await store.list();
    const futureTime = flow.startedAt + 15 * 60 * 1000;
    const result = await (payment as any).threeDS.expireStale(futureTime);

    expect(result.checked).toBe(1);
    expect(result.expired).toHaveLength(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
