import { describe, it, expect, vi } from 'vitest';
import {
  betterPayment,
  definePlugin,
  defineProvider,
  iyzico,
  paytr,
  akbank,
  parampos,
  Iyzico,
  PayTR,
  ConfigurationError,
  ProviderNotEnabledError,
  EventListenerError,
  PaymentStatus,
  PaymentErrorCode,
  type BetterPaymentPlugin,
  type PaymentEvent,
} from 'better-payment';
import { MockProvider, MOCK_CARDS } from 'better-payment/testing';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../fixtures/payment-data';

const withCard = (cardNumber: string) => ({
  ...mockPaymentRequest,
  paymentCard: { ...mockPaymentRequest.paymentCard!, cardNumber },
});

const post = (url: string, body: unknown) => ({
  method: 'POST',
  url,
  headers: { 'content-type': 'application/json' },
  body,
});

function twoMocks(plugins: BetterPaymentPlugin[] = [], defaultProvider?: 'a' | 'b') {
  const a = new MockProvider();
  const b = new MockProvider();
  const payment = betterPayment({ providers: { a, b }, defaultProvider, plugins });
  return { payment, a, b };
}

describe('betterPayment() providers', () => {
  it('creates built-in providers from their factories, with mode defaults', () => {
    const payment = betterPayment({
      mode: 'sandbox',
      providers: {
        iyzico: iyzico({ apiKey: 'k', secretKey: 's' }),
        paytr: paytr({ merchantId: '1', merchantKey: 'k', merchantSalt: 's' }),
        akbank: akbank({ merchantSafeId: 'm', terminalSafeId: 't', secretKey: 's' }),
        parampos: parampos({
          clientCode: '1',
          clientUsername: 'u',
          clientPassword: 'p',
          guid: 'g',
        }),
      },
    });
    expect(payment.iyzico).toBeInstanceOf(Iyzico);
    expect(payment.paytr).toBeInstanceOf(PayTR);
    expect((payment.iyzico as any).config.baseUrl).toBe('https://sandbox-api.iyzipay.com');
    expect((payment.paytr as any).config.testMode).toBe(true);
    expect((payment.akbank as any).config.testMode).toBe(true);
    expect(payment.getEnabledProviders()).toEqual(['iyzico', 'paytr', 'akbank', 'parampos']);
  });

  it('passes the shared settings to provider definitions and accepts any id', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    const create = vi.fn((ctx) => new MockProvider({ logger: ctx.logger }));
    const payment = betterPayment({
      providers: { 'test-pos': defineProvider(create) },
      logger,
      mode: 'sandbox',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'test-pos', mode: 'sandbox', logger })
    );
    expect(payment.use('test-pos')).toBeInstanceOf(MockProvider);
    expect(payment.context.defaultProvider).toBe('test-pos');
  });

  it('rejects invalid entries, reserved ids and an unknown default provider', () => {
    expect(() => betterPayment({ providers: { x: {} as any } })).toThrow(ConfigurationError);
    expect(() => betterPayment({ providers: { handler: new MockProvider() } })).toThrow(/clashes/);
    expect(() =>
      betterPayment({ providers: { a: new MockProvider() }, defaultProvider: 'b' as any })
    ).toThrow(/Default provider 'b'/);
  });

  it('has no default provider when there are several', async () => {
    const { payment } = twoMocks();
    await expect(payment.createPayment(mockPaymentRequest)).rejects.toThrow(/No default provider/);
    expect(() => payment.use('c')).toThrow(ProviderNotEnabledError);
  });

  it('keeps provider-specific members of the provider', () => {
    const { payment, a } = twoMocks();
    expect(payment.a.failNext).toBe(a.failNext);
    expect(payment.a.payments).toEqual([]);
  });
});

describe('plugins', () => {
  it('validates ids', () => {
    expect(() => twoMocks([{} as any])).toThrow(/needs an id/);
    expect(() => twoMocks([{ id: 'x' }, { id: 'x' }])).toThrow(/registered twice/);
  });

  it('runs init once, in order, before the first operation', async () => {
    const calls: string[] = [];
    const init = (name: string) => async () => {
      await Promise.resolve();
      calls.push(name);
    };
    const { payment } = twoMocks(
      [
        { id: 'one', init: init('one') },
        { id: 'two', init: init('two') },
      ],
      'a'
    );
    expect(calls).toEqual([]);
    await Promise.all([
      payment.createPayment(mockPaymentRequest),
      payment.b.createPayment(mockPaymentRequest),
    ]);
    expect(calls).toEqual(['one', 'two']);
  });

  it('retries a failed init on the next operation, from the plugin that failed', async () => {
    const first = vi.fn();
    const second = vi.fn().mockRejectedValueOnce(new Error('rates unavailable'));
    const { payment } = twoMocks(
      [
        { id: 'one', init: first },
        { id: 'two', init: second },
      ],
      'a'
    );
    await expect(payment.createPayment(mockPaymentRequest)).rejects.toThrow('rates unavailable');
    expect((await payment.createPayment(mockPaymentRequest)).status).toBe(PaymentStatus.SUCCESS);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('adds members with methods, and rejects clashes', () => {
    const counter = definePlugin({
      id: 'counter',
      methods: (ctx) => ({ counter: { providers: () => ctx.providerIds } }),
      $ERROR_CODES: { LIMIT_REACHED: 'Limit reached' },
    });
    const payment = betterPayment({ providers: { a: new MockProvider() }, plugins: [counter] });
    expect(payment.counter.providers()).toEqual(['a']);
    expect(payment.$ERROR_CODES.LIMIT_REACHED).toBe('Limit reached');

    expect(() =>
      betterPayment({
        providers: { a: new MockProvider() },
        plugins: [{ id: 'bad', methods: () => ({ refund: () => undefined }) }],
      })
    ).toThrow(/clashes/);
    expect(() =>
      betterPayment({
        providers: { a: new MockProvider() },
        plugins: [{ id: 'bad', methods: () => ({ a: 1 }) }],
      })
    ).toThrow(/clashes/);
  });
});

describe('before hooks', () => {
  it('route calls made on the payment object to a provider', async () => {
    const router: BetterPaymentPlugin = {
      id: 'router',
      hooks: {
        before: [
          {
            matcher: (ctx) => ctx.operation === 'createPayment',
            handler: (ctx) => (ctx.routable ? { provider: 'b' } : undefined),
          },
        ],
      },
    };
    const { payment, a, b } = twoMocks([router], 'a');
    await payment.createPayment(mockPaymentRequest);
    await payment.a.createPayment(mockPaymentRequest); // explicit: stays on a
    expect(b.payments).toHaveLength(1);
    expect(a.payments).toHaveLength(1);
  });

  it('choose a provider when there is no default', async () => {
    const { payment, b } = twoMocks([
      { id: 'pick', hooks: { before: [{ handler: () => ({ provider: 'b' }) }] } },
    ]);
    const result = await payment.createPayment(mockPaymentRequest);
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(b.payments).toHaveLength(1);
  });

  it('cannot move a call made on a provider, or route to an unknown provider', async () => {
    const { payment } = twoMocks([
      { id: 'pick', hooks: { before: [{ handler: () => ({ provider: 'b' }) }] } },
    ]);
    await expect(payment.a.createPayment(mockPaymentRequest)).rejects.toThrow(
      /Only calls made on the payment object/
    );

    const other = twoMocks([
      { id: 'pick', hooks: { before: [{ handler: () => ({ provider: 'c' }) }] } },
    ]);
    await expect(other.payment.createPayment(mockPaymentRequest)).rejects.toThrow(
      ProviderNotEnabledError
    );
  });

  it('replace the request, or return a result without calling the provider', async () => {
    const after = vi.fn();
    const { payment, a } = twoMocks(
      [
        {
          id: 'amount',
          hooks: {
            before: [
              {
                matcher: (ctx) => ctx.operation === 'createPayment',
                handler: (ctx) => ({
                  request: { ...(ctx.request as object), conversationId: 'ORDER-9' },
                }),
              },
              {
                matcher: (ctx) => ctx.operation === 'refund',
                handler: () => ({
                  result: { status: PaymentStatus.FAILURE, code: PaymentErrorCode.INVALID_REQUEST },
                }),
              },
              { matcher: (ctx) => ctx.operation === 'refund', handler: () => after('skipped') },
            ],
            after: [{ handler: (ctx) => after(ctx.operation, ctx.provider) }],
          },
        },
      ],
      'a'
    );
    const paid = await payment.createPayment(mockPaymentRequest);
    expect(paid.conversationId).toBe('ORDER-9');

    const refunded = await payment.refund({
      paymentId: paid.paymentId!,
      price: '1',
      currency: 'TRY',
      ip: '1.1.1.1',
    });
    expect(refunded.status).toBe(PaymentStatus.FAILURE);
    expect(a.getRecord(paid.paymentId!)?.refunds ?? []).toHaveLength(0);
    expect(after.mock.calls).toEqual([
      ['createPayment', 'a'],
      ['refund', 'a'],
    ]);
  });
});

describe('after hooks', () => {
  it('replace the result', async () => {
    const { payment } = twoMocks(
      [
        {
          id: 'translate',
          hooks: {
            after: [
              {
                matcher: (ctx) => (ctx.result as { status: string }).status === 'failure',
                handler: (ctx) => ({
                  result: { ...(ctx.result as object), errorMessage: 'Kart reddedildi' },
                }),
              },
            ],
          },
        },
      ],
      'a'
    );
    const result = await payment.createPayment(withCard(MOCK_CARDS.CARD_DECLINED));
    expect(result.errorMessage).toBe('Kart reddedildi');
  });
});

describe('events', () => {
  it('emits typed events for payments, pre-authorizations, cancels and refunds', async () => {
    const events: PaymentEvent[] = [];
    const { payment } = twoMocks([{ id: 'log', events: { '*': (e) => void events.push(e) } }], 'a');

    const paid = await payment.createPayment({ ...mockPaymentRequest, conversationId: 'O-1' });
    await payment.createPayment(withCard(MOCK_CARDS.INSUFFICIENT_FUNDS));
    await payment.createPayment(withCard(MOCK_CARDS.NETWORK_ERROR));
    await payment.refund({
      paymentId: paid.paymentId!,
      price: '1.00',
      currency: 'TRY',
      ip: '1.1.1.1',
    });
    await payment.refund({
      paymentId: paid.paymentId!,
      price: '999.00',
      currency: 'TRY',
      ip: '1.1.1.1',
    });
    const auth = await payment.authorize(mockPaymentRequest);
    await payment.capture({
      paymentId: auth.paymentId!,
      amount: mockPaymentRequest.paidPrice,
      ip: '1.1.1.1',
    });
    const auth2 = await payment.authorize(mockPaymentRequest);
    await payment.voidAuthorization({ paymentId: auth2.paymentId!, ip: '1.1.1.1' });
    await payment.getPayment(paid.paymentId!); // queries emit nothing

    expect(events.map((e) => [e.type, e.operation])).toEqual([
      ['payment.succeeded', 'createPayment'],
      ['payment.failed', 'createPayment'],
      ['payment.pending', 'createPayment'],
      ['refund.succeeded', 'refund'],
      ['refund.failed', 'refund'],
      ['payment.authorized', 'authorize'],
      ['payment.succeeded', 'capture'],
      ['payment.authorized', 'authorize'],
      ['payment.cancelled', 'voidAuthorization'],
    ]);
    expect(events[0]).toMatchObject({
      provider: 'a',
      paymentId: paid.paymentId,
      conversationId: 'O-1',
      amount: mockPaymentRequest.paidPrice,
      currency: mockPaymentRequest.currency,
    });
    expect(events[1].code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
    expect(events[3].amount).toBe('1.00');
    expect(events[6].amount).toBe(mockPaymentRequest.paidPrice);
  });

  it('emits for 3D Secure, not for forged callbacks', async () => {
    const { payment, a } = twoMocks([], 'a');
    const types: string[] = [];
    payment.on('*', (e) => void types.push(e.type));

    const init = await payment.initThreeDSPayment(mockThreeDSPaymentRequest);
    const forged = await payment.completeThreeDSPayment({
      ...(await a.threeDSCallback(init.paymentId!)),
      signature: 'x',
    });
    expect(forged.errorCode).toBe('INVALID_HASH');
    await payment.completeThreeDSPayment(await a.threeDSCallback(init.paymentId!));
    a.failNext('threeDSInit');
    await payment.initThreeDSPayment(mockThreeDSPaymentRequest);
    expect(types).toEqual(['payment.succeeded', 'payment.failed']);
  });

  it('on() returns an unsubscribe function; listener errors keep the result', async () => {
    const { payment } = twoMocks([], 'a');
    const listener = vi.fn();
    const off = payment.on('payment.succeeded', listener);
    await payment.createPayment(mockPaymentRequest);
    off();
    await payment.createPayment(mockPaymentRequest);
    expect(listener).toHaveBeenCalledTimes(1);

    payment.on('payment.succeeded', () => {
      throw new Error('database down');
    });
    const error = await payment.createPayment(mockPaymentRequest).catch((e) => e);
    expect(error).toBeInstanceOf(EventListenerError);
    expect(error.message).toContain('database down');
    expect(error.result.status).toBe(PaymentStatus.SUCCESS);
    expect(error.event.type).toBe('payment.succeeded');
  });
});

describe('handler with plugins', () => {
  const quote = definePlugin({
    id: 'router',
    endpoints: {
      quote: {
        method: 'POST',
        path: '/router/quote',
        handler: (ctx) => ({ providers: ctx.providerIds, bin: ctx.body?.binNumber }),
      },
      status: {
        method: 'GET',
        path: 'router/status/',
        handler: (ctx) => ctx.json({ q: ctx.query.get('q') }, 202),
      },
      admin: { method: 'POST', path: '/router/admin', privileged: true, handler: () => 'ok' },
    },
  });

  it('serves plugin endpoints, with the authorize hook', async () => {
    const authorize = vi.fn((ctx) => ctx.action !== 'plugin:router/admin');
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [quote],
      handler: { authorize },
    });
    const handler = payment.handler;
    const res = await handler.handle(post('/api/pay/router/quote', { binNumber: '454360' }));
    expect(res).toMatchObject({ status: 200, body: { providers: ['mock'], bin: '454360' } });
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ provider: undefined, action: 'plugin:router/quote' })
    );
    const status = await handler.handle({
      method: 'GET',
      url: '/api/pay/router/status?q=1',
      headers: {},
    });
    expect(status).toMatchObject({ status: 202, body: { q: '1' } });
    expect(
      (await handler.handle({ method: 'GET', url: '/api/pay/router/quote', headers: {} })).status
    ).toBe(405);
    expect((await handler.handle(post('/api/pay/router/admin', {}))).status).toBe(403);
  });

  it('refuses form bodies on POST endpoints unless acceptForm is set (CSRF)', async () => {
    const callback = definePlugin({
      id: 'bank',
      endpoints: {
        callback: {
          method: 'POST',
          path: '/bank/callback',
          acceptForm: true,
          handler: (ctx) => ({ orderId: ctx.body?.orderId }),
        },
      },
    });
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [quote, callback],
      handler: { authorize: () => true },
    });
    const form = (path: string, contentType: string) =>
      payment.handler.handle({
        method: 'POST',
        url: path,
        headers: { 'content-type': contentType },
        body: 'orderId=1&binNumber=454360',
      });

    for (const type of ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']) {
      expect((await form('/api/pay/router/admin', type)).status).toBe(415);
    }
    expect(await form('/api/pay/bank/callback', 'application/x-www-form-urlencoded')).toMatchObject(
      { status: 200, body: { orderId: '1' } }
    );
  });

  it('answers 503 when an onRequest hook throws', async () => {
    const quoteSpy = vi.fn(() => 'ok');
    const broken = definePlugin({
      id: 'guard',
      onRequest: () => {
        throw new Error('store down');
      },
      endpoints: { quote: { method: 'POST', path: '/guarded', handler: quoteSpy } },
    });
    const payment = betterPayment({ providers: { mock: new MockProvider() }, plugins: [broken] });

    const res = await payment.handler.handle(post('/api/pay/guarded', {}));

    expect(res.status).toBe(503);
    expect(quoteSpy).not.toHaveBeenCalled();
  });

  it('requires authorize for privileged endpoints and rejects reserved or duplicate paths', () => {
    const payment = betterPayment({ providers: { mock: new MockProvider() }, plugins: [quote] });
    expect(() => payment.handler).toThrow(/plugin:router\/admin/);

    const reserved = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [
        { id: 'x', endpoints: { e: { method: 'GET', path: '/mock/x', handler: () => 1 } } },
      ],
    });
    expect(() => reserved.handler).toThrow(/reserved path/);

    const duplicate = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [
        { id: 'x', endpoints: { e: { method: 'GET', path: '/x', handler: () => 1 } } },
        { id: 'y', endpoints: { e: { method: 'GET', path: 'x', handler: () => 1 } } },
      ],
    });
    expect(() => duplicate.handler).toThrow(/Two plugin endpoints/);
  });

  it('runs hooks and events for handler routes', async () => {
    const events: string[] = [];
    const mock = new MockProvider();
    const payment = betterPayment({
      providers: { mock },
      plugins: [
        {
          id: 'x',
          hooks: {
            before: [
              {
                handler: (ctx) => ({
                  request: { ...(ctx.request as object), conversationId: 'H-1' },
                }),
              },
            ],
          },
          events: { 'payment.succeeded': (e) => void events.push(e.conversationId!) },
        },
      ],
      handler: { allowedActions: ['payment'], authorize: () => true },
    });
    const res = await payment.handler.handle(post('/api/pay/mock/payment', mockPaymentRequest));
    expect(res.status).toBe(200);
    expect(events).toEqual(['H-1']);
  });

  it('returns the result when a listener fails after a payment, and logs the error', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      logger,
      handler: { allowedActions: ['payment'], authorize: () => true },
    });
    payment.on('payment.succeeded', () => {
      throw new Error('boom');
    });
    const res = await payment.handler.handle(post('/api/pay/mock/payment', mockPaymentRequest));
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('success');
    expect(logger.error).toHaveBeenCalledWith(
      'Payment event listener failed',
      expect.any(EventListenerError),
      expect.objectContaining({ provider: 'mock', action: 'payment' })
    );
  });

  it('runs onResponse hooks in order, and ignores a failing one', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      logger,
      plugins: [
        {
          id: 'header',
          onResponse: (response) => ({ ...response, headers: { ...response.headers, 'X-A': '1' } }),
        },
        {
          id: 'broken',
          onResponse: () => {
            throw new Error('boom');
          },
        },
        { id: 'noop', onResponse: () => undefined },
      ],
    });
    const res = await payment.handler.handle({
      method: 'GET',
      url: '/api/pay/health',
      headers: {},
    });
    expect(res.status).toBe(200);
    expect(res.headers['X-A']).toBe('1');
    expect(logger.error).toHaveBeenCalledWith(
      "onResponse of plugin 'broken' failed",
      expect.any(Error)
    );
  });

  it('retries callback events with the stored result when a listener fails', async () => {
    const mock = new MockProvider();
    const complete = vi.spyOn(mock, 'completeThreeDSPayment');
    const payment = betterPayment({ providers: { mock } });
    let fail = true;
    const seen: string[] = [];
    payment.on('payment.succeeded', (e) => {
      if (fail) throw new Error('database down');
      seen.push(e.paymentId!);
    });

    const init = await payment.mock.initThreeDSPayment(mockThreeDSPaymentRequest);
    const callback = await mock.threeDSCallback(init.paymentId!);
    const first = await payment.handler.handle(
      post('/api/pay/mock/payment/complete-3ds', callback)
    );
    expect(first.status).toBe(500);

    fail = false;
    const second = await payment.handler.handle(
      post('/api/pay/mock/payment/complete-3ds', callback)
    );
    expect(second.status).toBe(200);
    expect(seen).toEqual([init.paymentId]);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
