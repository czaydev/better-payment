import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { betterPayment, ConfigurationError } from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import { rateLimit, parseDuration, MemoryRateLimitStore } from 'better-payment/plugins';
import { localizedErrors } from 'better-payment/plugins';
import { mockPaymentRequest } from '../../fixtures/payment-data';

function req(
  url: string,
  headers: Record<string, string> = {},
  body: unknown = mockPaymentRequest
) {
  return {
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body,
  };
}

describe('rateLimit plugin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses duration strings and numbers correctly', () => {
    expect(parseDuration('1000')).toBe(1000);
    expect(parseDuration(1500)).toBe(1500);
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('1m')).toBe(60_000);
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('1d')).toBe(86_400_000);

    expect(() => parseDuration(-5)).toThrow(ConfigurationError);
    expect(() => parseDuration('invalid')).toThrow(ConfigurationError);
  });

  it('enforces global limit and returns 429 with rate limit headers', async () => {
    const mockProvider = new MockProvider();
    const payment = betterPayment({
      providers: { mock: mockProvider },
      plugins: [
        rateLimit({
          window: '1m',
          max: 2,
          trustProxy: true,
        }),
      ],
      handler: { allowedActions: ['payment', 'bin-check', 'callback'] },
    });

    const handler = payment.handler;
    const clientReq = () =>
      handler.handle(req('/api/pay/mock/payment', { 'x-forwarded-for': '1.2.3.4' }));

    // Request 1: allowed
    const res1 = await clientReq();
    expect(res1.status).toBe(200);

    // Request 2: allowed
    const res2 = await clientReq();
    expect(res2.status).toBe(200);

    // Request 3: rate limited
    const res3 = await clientReq();
    expect(res3.status).toBe(429);
    expect(res3.headers['retry-after']).toBeDefined();
    expect(res3.headers['x-ratelimit-limit']).toBe('2');
    expect(res3.headers['x-ratelimit-remaining']).toBe('0');
    expect((res3.body as any).code).toBe('RATE_LIMITED');
    expect((res3.body as any).errorMessage).toContain('Too many requests');
  });

  it('enforces per-route custom rules', async () => {
    const mockProvider = new MockProvider();
    const payment = betterPayment({
      providers: { mock: mockProvider },
      plugins: [
        rateLimit({
          window: '1m',
          max: 10,
          trustProxy: true,
          rules: {
            '/payment': { window: '1m', max: 1 },
          },
        }),
      ],
      handler: { allowedActions: ['payment', 'bin-check', 'callback'] },
    });

    const handler = payment.handler;
    const paymentReq = () =>
      handler.handle(req('/api/pay/mock/payment', { 'x-forwarded-for': '10.0.0.1' }));
    const binReq = () =>
      handler.handle(
        req('/api/pay/mock/bin-check', { 'x-forwarded-for': '10.0.0.1' }, { binNumber: '454360' })
      );

    // 1st payment: allowed
    const p1 = await paymentReq();
    expect(p1.status).toBe(200);

    // 2nd payment: limited by per-route rule (max 1)
    const p2 = await paymentReq();
    expect(p2.status).toBe(429);
    expect(p2.headers['x-ratelimit-limit']).toBe('1');

    // BIN check: still allowed (uses global limit of 10)
    const b1 = await binReq();
    expect(b1.status).toBe(200);
  });

  it('excludes provider callbacks by default and when explicitly configured', async () => {
    const mockProvider = new MockProvider();
    const payment = betterPayment({
      providers: { mock: mockProvider },
      plugins: [
        rateLimit({
          window: '1m',
          max: 1,
          trustProxy: true,
          rules: {
            '/callback/*': false,
          },
        }),
      ],
      handler: { allowedActions: ['payment', 'bin-check', 'callback'] },
    });

    const handler = payment.handler;

    // Simulate callback requests (which should never be rate limited)
    for (let i = 0; i < 5; i++) {
      const res = await handler.handle(
        req('/api/pay/mock/callback', { 'x-forwarded-for': '1.2.3.4' }, { status: 'success' })
      );
      expect(res.status).not.toBe(429);
    }
  });

  it('resets limits after the window expires', async () => {
    const mockProvider = new MockProvider();
    const payment = betterPayment({
      providers: { mock: mockProvider },
      plugins: [
        rateLimit({
          window: '30s',
          max: 1,
          trustProxy: true,
        }),
      ],
      handler: { allowedActions: ['payment', 'bin-check', 'callback'] },
    });

    const handler = payment.handler;
    const clientReq = () =>
      handler.handle(req('/api/pay/mock/payment', { 'x-forwarded-for': '5.5.5.5' }));

    // 1st: allowed
    expect((await clientReq()).status).toBe(200);

    // 2nd: rate limited
    expect((await clientReq()).status).toBe(429);

    // Advance timer past window (31 seconds)
    vi.advanceTimersByTime(31_000);

    // 3rd: window reset, allowed again
    expect((await clientReq()).status).toBe(200);
  });

  it('supports custom key extractor function', async () => {
    const mockProvider = new MockProvider();
    const payment = betterPayment({
      providers: { mock: mockProvider },
      plugins: [
        rateLimit({
          window: '1m',
          max: 1,
          key: (r) => (r.headers as any).get?.('x-api-key') ?? r.headers['x-api-key'] ?? 'anon',
        }),
      ],
      handler: { allowedActions: ['payment', 'bin-check', 'callback'] },
    });

    const handler = payment.handler;

    // User A: 1st allowed, 2nd blocked
    expect(
      (await handler.handle(req('/api/pay/mock/payment', { 'x-api-key': 'user-a' }))).status
    ).toBe(200);
    expect(
      (await handler.handle(req('/api/pay/mock/payment', { 'x-api-key': 'user-a' }))).status
    ).toBe(429);

    // User B: distinct key, allowed
    expect(
      (await handler.handle(req('/api/pay/mock/payment', { 'x-api-key': 'user-b' }))).status
    ).toBe(200);
  });

  it('translates 429 response body with localizedErrors plugin', async () => {
    const mockProvider = new MockProvider();
    const payment = betterPayment({
      providers: { mock: mockProvider },
      plugins: [
        rateLimit({
          window: '1m',
          max: 1,
          trustProxy: true,
        }),
        localizedErrors({
          locale: 'tr',
          messages: {
            tr: {
              RATE_LIMITED: 'Çok fazla istek gönderildi, lütfen bir dakika sonra tekrar deneyin.',
            },
          },
        }),
      ],
      handler: { allowedActions: ['payment', 'bin-check', 'callback'] },
    });

    const handler = payment.handler;
    const clientReq = () =>
      handler.handle(req('/api/pay/mock/payment', { 'x-forwarded-for': '9.9.9.9' }));

    expect((await clientReq()).status).toBe(200);
    const res = await clientReq();
    expect(res.status).toBe(429);
    expect((res.body as any).code).toBe('RATE_LIMITED');
    expect((res.body as any).errorMessage).toBe(
      'Çok fazla istek gönderildi, lütfen bir dakika sonra tekrar deneyin.'
    );
  });

  it('allows manual reset through methods', async () => {
    const mockProvider = new MockProvider();
    const payment = betterPayment({
      providers: { mock: mockProvider },
      plugins: [
        rateLimit({
          window: '1m',
          max: 1,
          trustProxy: true,
        }),
      ],
      handler: { allowedActions: ['payment', 'bin-check', 'callback'] },
    });

    const handler = payment.handler;
    const clientReq = () =>
      handler.handle(req('/api/pay/mock/payment', { 'x-forwarded-for': '7.7.7.7' }));

    expect((await clientReq()).status).toBe(200);
    expect((await clientReq()).status).toBe(429);

    // Manual reset
    payment.rateLimit.reset();

    // Allowed again
    expect((await clientReq()).status).toBe(200);
  });

  it('throws at construction when neither key nor trustProxy can produce a safe bucket', () => {
    expect(() => rateLimit({ window: '1m', max: 60 })).toThrow(ConfigurationError);
    expect(() => rateLimit({ trustProxy: false })).toThrow(ConfigurationError);
    expect(() => rateLimit({ trustProxy: 0 })).toThrow(ConfigurationError);
    expect(() => rateLimit({ trustProxy: 1.5 })).toThrow(ConfigurationError);
  });

  it('does not let clients dodge the limit by forging X-Forwarded-For when trustProxy is off', async () => {
    const mockProvider = new MockProvider();
    const payment = betterPayment({
      providers: { mock: mockProvider },
      plugins: [
        rateLimit({
          window: '1m',
          max: 2,
          // No trustProxy: the identity must come from data the app controls.
          key: (r) => r.headers['x-api-key'] ?? 'anonymous',
        }),
      ],
      handler: { allowedActions: ['payment', 'bin-check', 'callback'] },
    });

    const handler = payment.handler;

    // Same anonymous client presents a fresh IP on every request...
    expect(
      (await handler.handle(req('/api/pay/mock/payment', { 'x-forwarded-for': '1.1.1.1' }))).status
    ).toBe(200);
    expect(
      (
        await handler.handle(
          req('/api/pay/mock/payment', { 'x-forwarded-for': '2.2.2.2, 3.3.3.3' })
        )
      ).status
    ).toBe(200);
    // ...and still hits the shared bucket, because proxy headers are ignored.
    expect(
      (await handler.handle(req('/api/pay/mock/payment', { 'x-forwarded-for': '4.4.4.4' }))).status
    ).toBe(429);
  });

  it('honours the forwarded identity from the trusted proxy hop when trustProxy is enabled', async () => {
    const mockProvider = new MockProvider();
    const payment = betterPayment({
      providers: { mock: mockProvider },
      plugins: [
        rateLimit({
          window: '1m',
          max: 2,
          trustProxy: true,
        }),
      ],
      handler: { allowedActions: ['payment', 'bin-check', 'callback'] },
    });

    const handler = payment.handler;

    // Real client 9.9.9.9 with forged prefix entries: all three land in one bucket.
    expect(
      (
        await handler.handle(
          req('/api/pay/mock/payment', { 'x-forwarded-for': '1.1.1.1, 9.9.9.9' })
        )
      ).status
    ).toBe(200);
    expect(
      (
        await handler.handle(
          req('/api/pay/mock/payment', { 'x-forwarded-for': '2.2.2.2, 9.9.9.9' })
        )
      ).status
    ).toBe(200);
    expect(
      (
        await handler.handle(
          req('/api/pay/mock/payment', { 'x-forwarded-for': '3.3.3.3, 9.9.9.9' })
        )
      ).status
    ).toBe(429);

    // A different real client (right-most entry) gets its own bucket.
    expect(
      (
        await handler.handle(
          req('/api/pay/mock/payment', { 'x-forwarded-for': '3.3.3.3, 8.8.8.8' })
        )
      ).status
    ).toBe(200);
  });

  it('counts multiple hops from the right of X-Forwarded-For', async () => {
    const mockProvider = new MockProvider();
    const payment = betterPayment({
      providers: { mock: mockProvider },
      plugins: [
        rateLimit({
          window: '1m',
          max: 1,
          // Two trusted proxies in front of the app.
          trustProxy: 2,
        }),
      ],
      handler: { allowedActions: ['payment', 'bin-check', 'callback'] },
    });

    const handler = payment.handler;

    // With 2 hops the second-to-last entry is the client; the last one is the outer proxy.
    expect(
      (
        await handler.handle(
          req('/api/pay/mock/payment', { 'x-forwarded-for': '1.1.1.1, 9.9.9.9, 203.0.113.1' })
        )
      ).status
    ).toBe(200);
    expect(
      (
        await handler.handle(
          req('/api/pay/mock/payment', { 'x-forwarded-for': '2.2.2.2, 9.9.9.9, 203.0.113.2' })
        )
      ).status
    ).toBe(429);
  });

  it('keeps the explicit key option in charge over trustProxy', async () => {
    const mockProvider = new MockProvider();
    const payment = betterPayment({
      providers: { mock: mockProvider },
      plugins: [
        rateLimit({
          window: '1m',
          max: 1,
          trustProxy: true,
          key: () => 'explicit',
        }),
      ],
      handler: { allowedActions: ['payment', 'bin-check', 'callback'] },
    });

    const handler = payment.handler;

    // Distinct forwarded identities still share the single explicit bucket.
    expect(
      (await handler.handle(req('/api/pay/mock/payment', { 'x-forwarded-for': '9.9.9.9' }))).status
    ).toBe(200);
    expect(
      (await handler.handle(req('/api/pay/mock/payment', { 'x-forwarded-for': '8.8.8.8' }))).status
    ).toBe(429);
  });

  it('answers 503 while the store fails, unless passOnStoreError is set', async () => {
    const store = {
      increment: () => {
        throw new Error('redis down');
      },
    };
    const make = (passOnStoreError?: boolean) =>
      betterPayment({
        providers: { mock: new MockProvider() },
        plugins: [rateLimit({ key: () => 'client', store, passOnStoreError })],
        handler: { allowedActions: ['payment'] },
      });

    const closed = await make().handler.handle(req('/api/pay/mock/payment'));
    expect(closed.status).toBe(503);

    const open = await make(true).handler.handle(req('/api/pay/mock/payment'));
    expect(open.status).toBe(200);
  });
});
