import { describe, it, expect, vi } from 'vitest';
import {
  BetterPaymentHandler,
  BetterPaymentHandlerOptions,
  DEFAULT_HANDLER_ACTIONS,
  CALLBACK_HANDLER_ACTIONS,
} from '../../../src/core/BetterPaymentHandler';
import { ProviderType } from '../../../src/core/BetterPaymentConfig';
import { fakePayment } from '../../helpers/fake-payment';
import { Iyzico } from '../../../src/providers/iyzico';
import { VERSION } from '../../../src/version';

function buildMockPayment(providerOverrides: Record<string, any> = {}, enabled = true) {
  const mockProvider: Record<string, any> = {
    createPayment: vi.fn().mockResolvedValue({ status: 'success', paymentId: 'PMT-1' }),
    initThreeDSPayment: vi.fn().mockResolvedValue({ status: 'pending', threeDSHtmlContent: '<form>' }),
    completeThreeDSPayment: vi.fn().mockResolvedValue({ status: 'success', paymentId: 'PMT-1' }),
    refund: vi.fn().mockResolvedValue({ status: 'success' }),
    cancel: vi.fn().mockResolvedValue({ status: 'success' }),
    getPayment: vi.fn().mockResolvedValue({ status: 'success', paymentId: 'PMT-1' }),
    binCheck: vi.fn().mockResolvedValue({ binNumber: '454360' }),
    installmentInfo: vi.fn().mockResolvedValue({ status: 'success', installmentDetails: [] }),
    ...providerOverrides,
  };

  const payment = fakePayment(mockProvider, { enabled: enabled });

  return { payment, mockProvider };
}

function iyzicoLike(methods: Record<string, any>) {
  const provider = Object.create(Iyzico.prototype);
  return Object.assign(provider, methods);
}

function req(method: string, url: string, body?: any, headers: Record<string, string> = {}) {
  return {
    method,
    url,
    headers: { 'content-type': 'application/json', ...headers },
    body,
  };
}

const allowAll: BetterPaymentHandlerOptions = { allowedActions: 'all', authorize: () => true };

describe('BetterPaymentHandler', () => {
  describe('health', () => {
    it('returns status and version without listing providers', async () => {
      const { payment } = buildMockPayment();
      const res = await new BetterPaymentHandler(payment).handle(req('GET', '/api/pay/health'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', service: 'better-payment', version: VERSION });
      expect(res.body.providers).toBeUndefined();
    });

    it('does not treat /:provider/.../health as the health check', async () => {
      const { payment } = buildMockPayment();
      const res = await new BetterPaymentHandler(payment).handle(req('GET', '/api/pay/iyzico/payment/health'));
      expect(res.status).not.toBe(200);
    });
  });

  describe('routing', () => {
    it('returns 404 outside basePath, for unknown providers and unknown actions', async () => {
      const { payment } = buildMockPayment();
      const handler = new BetterPaymentHandler(payment, allowAll);
      expect((await handler.handle(req('POST', '/other/iyzico/payment', {}))).status).toBe(404);
      expect((await handler.handle(req('POST', '/api/pay/stripe/payment', {}))).status).toBe(404);
      expect((await handler.handle(req('POST', '/api/pay/iyzico/unknown', {}))).status).toBe(404);
    });

    it('supports absolute URLs, query strings and trailing slashes', async () => {
      const { payment, mockProvider } = buildMockPayment();
      const handler = new BetterPaymentHandler(payment, allowAll);
      const res = await handler.handle(req('POST', 'https://shop.example/api/pay/iyzico/payment/?x=1', { price: '1' }));
      expect(res.status).toBe(200);
      expect(mockProvider.createPayment).toHaveBeenCalledWith({ price: '1' });
    });

    it('supports a custom basePath', async () => {
      const { payment, mockProvider } = buildMockPayment();
      const handler = new BetterPaymentHandler(payment, { ...allowAll, basePath: '/payments/' });
      expect((await handler.handle(req('POST', '/payments/iyzico/payment', {}))).status).toBe(200);
      expect((await handler.handle(req('POST', '/api/pay/iyzico/payment', {}))).status).toBe(404);
      expect(mockProvider.createPayment).toHaveBeenCalledTimes(1);
    });

    it('returns 400 when the provider is not enabled', async () => {
      const { payment } = buildMockPayment({}, false);
      const res = await new BetterPaymentHandler(payment, allowAll).handle(req('POST', '/api/pay/paytr/payment', {}));
      expect(res.status).toBe(400);
    });

    it('routes GET /payment/:id to getPayment (URL-decoded)', async () => {
      const { payment, mockProvider } = buildMockPayment();
      const res = await new BetterPaymentHandler(payment, allowAll).handle(req('GET', '/api/pay/iyzico/payment/ORD%201'));
      expect(res.status).toBe(200);
      expect(mockProvider.getPayment).toHaveBeenCalledWith('ORD 1');
    });

    it('returns 405 for wrong methods', async () => {
      const { payment } = buildMockPayment();
      const res = await new BetterPaymentHandler(payment, allowAll).handle(req('GET', '/api/pay/iyzico/payment'));
      expect(res.status).toBe(405);
    });

    it('returns 400 when the body is missing', async () => {
      const { payment } = buildMockPayment();
      const res = await new BetterPaymentHandler(payment, allowAll).handle(req('POST', '/api/pay/iyzico/payment'));
      expect(res.status).toBe(400);
    });
  });

  describe('secure defaults', () => {
    it('only exposes callbacks and card queries by default', async () => {
      expect(DEFAULT_HANDLER_ACTIONS).toEqual(['payment/complete-3ds', 'callback', 'installment', 'bin-check']);
      const { payment, mockProvider } = buildMockPayment();
      const handler = new BetterPaymentHandler(payment);

      for (const [method, path] of [
        ['POST', 'payment'],
        ['POST', 'payment/init-3ds'],
        ['POST', 'refund'],
        ['POST', 'cancel'],
        ['GET', 'payment/PMT-1'],
        ['POST', 'subscription/cancel'],
      ]) {
        const res = await handler.handle(req(method, `/api/pay/iyzico/${path}`, {}));
        expect(res.status, path).toBe(404);
      }
      expect(mockProvider.refund).not.toHaveBeenCalled();

      const res = await handler.handle(req('POST', '/api/pay/iyzico/bin-check', { binNumber: '454360' }));
      expect(res.status).toBe(200);
    });

    it('refuses to enable privileged actions without an authorize hook', () => {
      const { payment } = buildMockPayment();
      expect(() => new BetterPaymentHandler(payment, { allowedActions: ['refund'] })).toThrow(/authorize/);
      expect(() => new BetterPaymentHandler(payment, { allowedActions: 'all' })).toThrow(/authorize/);
      expect(() => new BetterPaymentHandler(payment, { allowedActions: ['payment/init-3ds'] })).not.toThrow();
    });

    it('returns 403 when authorize rejects or throws', async () => {
      const { payment, mockProvider } = buildMockPayment();
      const deny = new BetterPaymentHandler(payment, { allowedActions: ['refund'], authorize: () => false });
      expect((await deny.handle(req('POST', '/api/pay/iyzico/refund', {}))).status).toBe(403);

      const boom = new BetterPaymentHandler(payment, {
        allowedActions: ['refund'],
        authorize: () => {
          throw new Error('no session');
        },
      });
      expect((await boom.handle(req('POST', '/api/pay/iyzico/refund', {}))).status).toBe(403);
      expect(mockProvider.refund).not.toHaveBeenCalled();
    });

    it('passes the context to authorize', async () => {
      const { payment } = buildMockPayment();
      const authorize = vi.fn().mockResolvedValue(true);
      await new BetterPaymentHandler(payment, { allowedActions: ['refund'], authorize }).handle(
        req('POST', '/api/pay/iyzico/refund', { paymentId: '1' }, { authorization: 'Bearer x' })
      );
      const ctx = authorize.mock.calls[0][0];
      expect(ctx).toMatchObject({ provider: 'iyzico', action: 'refund', body: { paymentId: '1' } });
      expect(ctx.request.headers.authorization).toBe('Bearer x');
    });

    it('transformRequest replaces the client body (server-side amounts)', async () => {
      const { payment, mockProvider } = buildMockPayment();
      const handler = new BetterPaymentHandler(payment, {
        allowedActions: ['payment/init-3ds'],
        transformRequest: (ctx) => ({ ...ctx.body, price: '100.00', paidPrice: '100.00' }),
      });
      await handler.handle(req('POST', '/api/pay/iyzico/payment/init-3ds', { orderId: 'o1', price: '0.01' }));
      expect(mockProvider.initThreeDSPayment).toHaveBeenCalledWith({ orderId: 'o1', price: '100.00', paidPrice: '100.00' });
    });

    it('does not leak internal error messages by default', async () => {
      const { payment } = buildMockPayment({ createPayment: vi.fn().mockRejectedValue(new Error('db password wrong')) });
      const res = await new BetterPaymentHandler(payment, allowAll).handle(req('POST', '/api/pay/iyzico/payment', {}));
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('Internal server error');

      const exposed = await new BetterPaymentHandler(payment, { ...allowAll, exposeErrors: true }).handle(
        req('POST', '/api/pay/iyzico/payment', {})
      );
      expect(exposed.body.message).toBe('db password wrong');
    });
  });

  describe('status codes', () => {
    it('returns 422 when the provider reports a failure', async () => {
      const { payment } = buildMockPayment({
        createPayment: vi.fn().mockResolvedValue({ status: 'failure', errorMessage: 'declined' }),
      });
      const res = await new BetterPaymentHandler(payment, allowAll).handle(req('POST', '/api/pay/iyzico/payment', {}));
      expect(res.status).toBe(422);
      expect(res.body.errorMessage).toBe('declined');
    });

    it('returns 200 for pending results', async () => {
      const { payment } = buildMockPayment();
      const res = await new BetterPaymentHandler(payment, allowAll).handle(
        req('POST', '/api/pay/iyzico/payment/init-3ds', {})
      );
      expect(res.status).toBe(200);
    });

    it('validates binNumber and maps bin-check errors to 422', async () => {
      const { payment } = buildMockPayment({ binCheck: vi.fn().mockRejectedValue(new Error('not supported')) });
      const handler = new BetterPaymentHandler(payment);
      expect((await handler.handle(req('POST', '/api/pay/iyzico/bin-check', { binNumber: 'abc' }))).status).toBe(400);
      const res = await handler.handle(req('POST', '/api/pay/iyzico/bin-check', { binNumber: '454360' }));
      expect(res.status).toBe(422);
    });
  });

  describe('response data', () => {
    const raw = { cardUserKey: 'card-user', merchantCommissionRate: '2.5' };

    it('leaves out rawResponse by default', async () => {
      const { payment } = buildMockPayment({
        createPayment: vi.fn().mockResolvedValue({ status: 'success', paymentId: 'PMT-1', rawResponse: raw }),
        binCheck: vi.fn().mockResolvedValue({ binNumber: '454360', rawResponse: raw }),
      });
      const handler = new BetterPaymentHandler(payment, allowAll);
      const res = await handler.handle(req('POST', '/api/pay/iyzico/payment', {}));
      expect(res.body).toEqual({ status: 'success', paymentId: 'PMT-1' });
      const bin = await handler.handle(req('POST', '/api/pay/iyzico/bin-check', { binNumber: '454360' }));
      expect(bin.body).toEqual({ binNumber: '454360' });
    });

    it('returns rawResponse with exposeRawResponse', async () => {
      const { payment } = buildMockPayment({
        createPayment: vi.fn().mockResolvedValue({ status: 'success', rawResponse: raw }),
      });
      const handler = new BetterPaymentHandler(payment, { ...allowAll, exposeRawResponse: true });
      const res = await handler.handle(req('POST', '/api/pay/iyzico/payment', {}));
      expect(res.body.rawResponse).toEqual(raw);
    });

    it('passes rawResponse to onCallback', async () => {
      const onCallback = vi.fn();
      const { payment } = buildMockPayment({
        completeThreeDSPayment: vi.fn().mockResolvedValue({ status: 'success', paymentId: 'PMT-1', rawResponse: raw }),
      });
      const handler = new BetterPaymentHandler(payment, { onCallback });
      const res = await handler.handle(req('POST', '/api/pay/iyzico/payment/complete-3ds', { paymentId: 'PMT-1' }));
      expect(res.body.rawResponse).toBeUndefined();
      expect(onCallback.mock.calls[0][0].rawResponse).toEqual(raw);
    });
  });

  describe('Idempotency-Key scope', () => {
    const user = (id: string) => ({ 'idempotency-key': 'order-1', 'x-user': id });

    it('shares stored responses between callers by default', async () => {
      const { payment, mockProvider } = buildMockPayment();
      const handler = new BetterPaymentHandler(payment, allowAll);
      await handler.handle(req('POST', '/api/pay/iyzico/payment', {}, user('a')));
      const second = await handler.handle(req('POST', '/api/pay/iyzico/payment', {}, user('b')));
      expect(second.headers['Idempotent-Replayed']).toBe('true');
      expect(mockProvider.createPayment).toHaveBeenCalledTimes(1);
    });

    it('keeps the keys of different callers apart with scope', async () => {
      const { payment, mockProvider } = buildMockPayment();
      const handler = new BetterPaymentHandler(payment, {
        ...allowAll,
        idempotency: { scope: (ctx) => ctx.request.headers['x-user'] },
      });
      await handler.handle(req('POST', '/api/pay/iyzico/payment', {}, user('a')));
      const other = await handler.handle(req('POST', '/api/pay/iyzico/payment', {}, user('b')));
      expect(other.headers['Idempotent-Replayed']).toBeUndefined();
      const same = await handler.handle(req('POST', '/api/pay/iyzico/payment', {}, user('a')));
      expect(same.headers['Idempotent-Replayed']).toBe('true');
      expect(mockProvider.createPayment).toHaveBeenCalledTimes(2);
    });
  });

  describe('callbacks', () => {
    it('parses form-urlencoded callbacks', async () => {
      const { payment, mockProvider } = buildMockPayment();
      await new BetterPaymentHandler(payment).handle(
        req('POST', '/api/pay/iyzico/payment/complete-3ds', 'status=success&paymentId=1&mdStatus=1', {
          'content-type': 'application/x-www-form-urlencoded',
        })
      );
      expect(mockProvider.completeThreeDSPayment).toHaveBeenCalledWith({ status: 'success', paymentId: '1', mdStatus: '1' });
    });

    it.each(['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'text/plain'])(
      'rejects %s bodies on non-callback actions (CSRF)',
      async (contentType) => {
        const { payment, mockProvider } = buildMockPayment();
        const res = await new BetterPaymentHandler(payment, allowAll).handle(
          req('POST', '/api/pay/iyzico/refund', 'paymentId=1&price=100', { 'content-type': contentType })
        );
        expect(res.status).toBe(415);
        expect(mockProvider.refund).not.toHaveBeenCalled();
      }
    );

    it('rejects form bodies already parsed by a body parser on non-callback actions', async () => {
      const { payment, mockProvider } = buildMockPayment();
      const res = await new BetterPaymentHandler(payment, allowAll).handle(
        req('POST', '/api/pay/iyzico/refund', { paymentId: '1', price: '100' }, {
          'content-type': 'application/x-www-form-urlencoded',
        })
      );
      expect(res.status).toBe(415);
      expect(mockProvider.refund).not.toHaveBeenCalled();
    });

    it('answers PayTR notifications with plain "OK" and calls onCallback', async () => {
      const { payment } = buildMockPayment({
        completeThreeDSPayment: vi.fn().mockResolvedValue({ status: 'failure', paymentId: 'O1', errorMessage: 'declined' }),
      });
      const onCallback = vi.fn();
      const res = await new BetterPaymentHandler(payment, { onCallback }).handle(
        req('POST', '/api/pay/paytr/callback', { merchant_oid: 'O1' })
      );
      expect(res.status).toBe(200);
      expect(res.headers['Content-Type']).toBe('text/plain');
      expect(res.body).toBe('OK');
      expect(onCallback).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failure', paymentId: 'O1' }),
        expect.objectContaining({ provider: 'paytr', action: 'callback' })
      );
    });

    it('does not acknowledge PayTR notifications with a bad hash and skips onCallback', async () => {
      const { payment } = buildMockPayment({
        completeThreeDSPayment: vi.fn().mockResolvedValue({ status: 'failure', errorCode: 'INVALID_HASH' }),
      });
      const onCallback = vi.fn();
      const res = await new BetterPaymentHandler(payment, { onCallback }).handle(req('POST', '/api/pay/paytr/callback', {}));
      expect(res.status).toBe(400);
      expect(res.body).not.toBe('OK');
      expect(onCallback).not.toHaveBeenCalled();
    });

    it('returns 500 (so PayTR retries) when onCallback fails', async () => {
      const { payment } = buildMockPayment();
      const res = await new BetterPaymentHandler(payment, {
        onCallback: () => {
          throw new Error('db down');
        },
      }).handle(req('POST', '/api/pay/paytr/callback', {}));
      expect(res.status).toBe(500);
    });

    it('redirects browser callbacks when callbackRedirect returns a URL', async () => {
      const { payment } = buildMockPayment();
      const res = await new BetterPaymentHandler(payment, {
        callbackRedirect: (result) => `https://shop.example/orders/${result.paymentId}`,
      }).handle(req('POST', '/api/pay/iyzico/payment/complete-3ds', {}));
      expect(res.status).toBe(303);
      expect(res.headers.Location).toBe('https://shop.example/orders/PMT-1');
    });

    it('does not run transformRequest for callbacks', async () => {
      const { payment, mockProvider } = buildMockPayment();
      const transformRequest = vi.fn();
      await new BetterPaymentHandler(payment, { transformRequest }).handle(
        req('POST', '/api/pay/iyzico/payment/complete-3ds', { a: '1' })
      );
      expect(transformRequest).not.toHaveBeenCalled();
      expect(mockProvider.completeThreeDSPayment).toHaveBeenCalledWith({ a: '1' });
    });

    it('CALLBACK_HANDLER_ACTIONS lists the callback routes', () => {
      expect(CALLBACK_HANDLER_ACTIONS).toEqual(['payment/complete-3ds', 'callback']);
    });
  });

  describe('provider-specific routes', () => {
    it('iyzico-only routes return 400 for other providers', async () => {
      const { payment } = buildMockPayment();
      const handler = new BetterPaymentHandler(payment, allowAll);
      expect((await handler.handle(req('POST', '/api/pay/paytr/checkout/init', {}))).status).toBe(400);
      expect((await handler.handle(req('POST', '/api/pay/paytr/subscription/initialize', {}))).status).toBe(400);
    });

    it.each([
      ['checkout/init', 'initCheckoutForm'],
      ['checkout/retrieve', 'retrieveCheckoutForm'],
      ['pwi/init', 'initPWIPayment'],
      ['pwi/retrieve', 'retrievePWIPayment'],
      ['subscription/initialize', 'initializeSubscription'],
      ['subscription/cancel', 'cancelSubscription'],
      ['subscription/upgrade', 'upgradeSubscription'],
      ['subscription/retrieve', 'retrieveSubscription'],
      ['subscription/card-update', 'updateSubscriptionCard'],
      ['subscription/product', 'createSubscriptionProduct'],
      ['subscription/pricing-plan', 'createPricingPlan'],
    ])('%s calls %s', async (path, method) => {
      const fn = vi.fn().mockResolvedValue({ status: 'success' });
      const payment = fakePayment(iyzicoLike({ [method]: fn }));
      const res = await new BetterPaymentHandler(payment, allowAll).handle(
        req('POST', `/api/pay/iyzico/${path}`, { token: 't', conversationId: 'c' })
      );
      expect(res.status).toBe(200);
      expect(fn).toHaveBeenCalled();
    });

    it('token payments require provider support', async () => {
      const { payment } = buildMockPayment();
      const handler = new BetterPaymentHandler(payment, allowAll);
      expect((await handler.handle(req('POST', '/api/pay/iyzico/payment/token', {}))).status).toBe(400);

      const withToken = buildMockPayment({ createPaymentWithToken: vi.fn().mockResolvedValue({ status: 'pending' }) });
      const res = await new BetterPaymentHandler(withToken.payment, allowAll).handle(
        req('POST', '/api/pay/paytr/payment/token', { utoken: 'u' })
      );
      expect(res.status).toBe(200);
      expect(withToken.mockProvider.createPaymentWithToken).toHaveBeenCalledWith({ utoken: 'u' });
    });
  });
});
