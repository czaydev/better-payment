import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../../src/core/http';
import { BetterPaymentHandler } from '../../../../src/core/BetterPaymentHandler';
import { betterPayment, PROVIDER_DEFAULT_URLS, ProviderType } from '../../../../src';
import { LemonSqueezy, lemonSqueezy } from '../../../../src/providers/lemonsqueezy';
import {
  mapLemonSqueezyOrderStatus,
  verifyLemonSqueezySignature,
} from '../../../../src/providers/lemonsqueezy/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';
import {
  LEMONSQUEEZY_BASE_URL,
  LEMONSQUEEZY_TEST,
  LEMONSQUEEZY_WEBHOOK_BODY,
  LEMONSQUEEZY_WEBHOOK_SIGNATURE,
  lemonSqueezyError,
  lemonSqueezyOrder,
} from '../../../fixtures/lemonsqueezy';

const timeout = () => new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' });
const answer = (data: unknown, status = 200) => ({ status, data, headers: {} });
const webhook = {
  rawBody: LEMONSQUEEZY_WEBHOOK_BODY,
  signature: LEMONSQUEEZY_WEBHOOK_SIGNATURE,
};

describe('Lemon Squeezy utils', () => {
  it('verifies X-Signature as the hex HMAC-SHA256 of the raw body (independent vector)', async () => {
    const secret = LEMONSQUEEZY_TEST.webhookSecret;
    expect(
      await verifyLemonSqueezySignature(
        LEMONSQUEEZY_WEBHOOK_BODY,
        LEMONSQUEEZY_WEBHOOK_SIGNATURE,
        secret
      )
    ).toBe(true);
    expect(
      await verifyLemonSqueezySignature(
        `${LEMONSQUEEZY_WEBHOOK_BODY} `,
        LEMONSQUEEZY_WEBHOOK_SIGNATURE,
        secret
      )
    ).toBe(false);
    expect(
      await verifyLemonSqueezySignature(
        LEMONSQUEEZY_WEBHOOK_BODY,
        LEMONSQUEEZY_WEBHOOK_SIGNATURE,
        'other'
      )
    ).toBe(false);
    expect(await verifyLemonSqueezySignature(LEMONSQUEEZY_WEBHOOK_BODY, undefined, secret)).toBe(
      false
    );
  });

  it('maps order statuses', () => {
    expect(mapLemonSqueezyOrderStatus('paid')).toBe(PaymentStatus.SUCCESS);
    expect(mapLemonSqueezyOrderStatus('partial_refund')).toBe(PaymentStatus.SUCCESS);
    expect(mapLemonSqueezyOrderStatus('refunded')).toBe(PaymentStatus.CANCELLED);
    expect(mapLemonSqueezyOrderStatus('failed')).toBe(PaymentStatus.FAILURE);
    expect(mapLemonSqueezyOrderStatus('fraudulent')).toBe(PaymentStatus.FAILURE);
    expect(mapLemonSqueezyOrderStatus('pending')).toBe(PaymentStatus.PENDING);
    expect(mapLemonSqueezyOrderStatus(undefined)).toBe(PaymentStatus.PENDING);
  });
});

describe('Lemon Squeezy provider', () => {
  let provider: LemonSqueezy;
  let request: ReturnType<typeof vi.fn>;

  const create = (overrides: Partial<ConstructorParameters<typeof LemonSqueezy>[0]> = {}) => {
    const instance = new LemonSqueezy({
      ...LEMONSQUEEZY_TEST,
      baseUrl: LEMONSQUEEZY_BASE_URL,
      ...overrides,
    });
    (instance as any).client.request = request;
    return instance;
  };
  const sent = (call = 0) => request.mock.calls[call][0];
  const sentBody = (call = 0) => JSON.parse(sent(call).data);
  const expectNoIds = (result: { paymentId?: string; conversationId?: string }) => {
    expect(result.paymentId).toBeUndefined();
    expect(result.conversationId).toBeUndefined();
  };

  beforeEach(() => {
    request = vi.fn();
    provider = create();
  });

  it.each(['apiKey', 'storeId', 'variantId', 'webhookSecret'])('requires %s', (field) => {
    expect(() => create({ [field]: '' })).toThrow(field);
  });

  it('sends the API key and the JSON:API media type', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(lemonSqueezyOrder()), {
          headers: { 'content-type': 'application/vnd.api+json' },
        })
    );
    const instance = new LemonSqueezy({
      ...LEMONSQUEEZY_TEST,
      baseUrl: LEMONSQUEEZY_BASE_URL,
      fetch,
    });
    const result = await instance.getPayment('1001');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${LEMONSQUEEZY_BASE_URL}/v1/orders/1001`);
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer test_api_key');
    expect(headers.get('accept')).toBe('application/vnd.api+json');
    expect(result.status).toBe(PaymentStatus.SUCCESS);
  });

  it('does not take card payments directly', async () => {
    await expect(provider.createPayment(mockPaymentRequest)).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    });
    await expect(provider.binCheck('540667')).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
  });

  describe('initThreeDSPayment', () => {
    const order = {
      ...mockThreeDSPaymentRequest,
      paymentCard: undefined,
      price: '19.99',
      paidPrice: '19.99',
      currency: 'USD',
      conversationId: 'ORDERLS',
      callbackUrl: 'https://example.com/thanks',
    };

    it('creates a checkout for the variant at the order price, with the order id', async () => {
      request.mockResolvedValue(
        answer(
          {
            data: {
              type: 'checkouts',
              id: 'chk_1',
              attributes: { url: 'https://store.lemonsqueezy.com/checkout/custom/abc?signature=x' },
            },
          },
          201
        )
      );

      const result = await provider.initThreeDSPayment(order as never);

      expect(sent()).toMatchObject({ method: 'POST', url: '/v1/checkouts', retryable: false });
      expect(sentBody()).toEqual({
        data: {
          type: 'checkouts',
          attributes: {
            custom_price: 1999,
            product_options: {
              enabled_variants: [777],
              redirect_url: 'https://example.com/thanks',
            },
            checkout_options: { embed: false },
            checkout_data: {
              email: 'john.doe@example.com',
              name: 'John Doe',
              custom: { order_id: 'ORDERLS' },
            },
          },
          relationships: {
            store: { data: { type: 'stores', id: '4242' } },
            variant: { data: { type: 'variants', id: '777' } },
          },
        },
      });
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.redirectUrl).toBe(
        'https://store.lemonsqueezy.com/checkout/custom/abc?signature=x'
      );
      expect(result.threeDSHtmlContent).toContain('signature=x');
      expect(result.checkoutId).toBe('chk_1');
      expect(result.conversationId).toBe('ORDERLS');
    });

    it('asks for an overlay checkout with embed', async () => {
      request.mockResolvedValue(answer({ data: { id: 'c', attributes: { url: 'https://x' } } }));
      await create({ embed: true }).initThreeDSPayment(order as never);
      expect(sentBody().data.attributes.checkout_options).toEqual({ embed: true });
    });

    it("rejects a payment in another currency than the store's", async () => {
      const tl = await provider.initThreeDSPayment({ ...order, currency: 'TRY' } as never);
      expect(tl.errorCode).toBe('VALIDATION_ERROR');
      expect(request).not.toHaveBeenCalled();

      request.mockResolvedValue(answer({ data: { id: 'c', attributes: { url: 'https://x' } } }));
      const eur = await create({ currency: 'eur' }).initThreeDSPayment({
        ...order,
        currency: 'EUR',
      } as never);
      expect(eur.status).toBe(PaymentStatus.PENDING);
    });

    it('fails with Lemon Squeezy error', async () => {
      request.mockResolvedValue(
        answer(lemonSqueezyError('422', 'The custom price is invalid.'), 422)
      );
      const result = await provider.initThreeDSPayment(order as never);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('422');
      expect(result.errorMessage).toBe('The custom price is invalid.');
    });
  });

  describe('completeThreeDSPayment (webhook)', () => {
    it('verifies the signature, then reads the order from Lemon Squeezy', async () => {
      request.mockResolvedValue(answer(lemonSqueezyOrder()));

      const result = await provider.completeThreeDSPayment(
        {},
        { ...webhook, orderId: 'ORDERLS', amount: '19.99' }
      );

      expect(sent()).toMatchObject({ method: 'GET', url: '/v1/orders/1001', retryable: true });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('1001');
      expect(result.conversationId).toBe('ORDERLS');
    });

    it('needs the raw body and the signature', async () => {
      const parsed = JSON.parse(LEMONSQUEEZY_WEBHOOK_BODY);
      for (const context of [
        {},
        { rawBody: LEMONSQUEEZY_WEBHOOK_BODY },
        { signature: LEMONSQUEEZY_WEBHOOK_SIGNATURE },
      ]) {
        const result = await provider.completeThreeDSPayment(parsed, context);
        expect(result.errorCode).toBe('VALIDATION_ERROR');
        expectNoIds(result);
      }
      expect(request).not.toHaveBeenCalled();
    });

    it('rejects a body changed after signing, and trusts only the signed body', async () => {
      const forged = LEMONSQUEEZY_WEBHOOK_BODY.replace('ORDERLS', 'VICTIM');
      const changed = await provider.completeThreeDSPayment({}, { ...webhook, rawBody: forged });
      expect(changed.errorCode).toBe('INVALID_HASH');
      expectNoIds(changed);

      request.mockResolvedValue(answer(lemonSqueezyOrder()));
      const result = await provider.completeThreeDSPayment(
        { meta: { custom_data: { order_id: 'VICTIM' } }, data: { type: 'orders', id: '9999' } },
        webhook
      );
      expect(sent()).toMatchObject({ url: '/v1/orders/1001' });
      expect(result.conversationId).toBe('ORDERLS');
    });

    it('rejects an event for another order than yours', async () => {
      const result = await provider.completeThreeDSPayment({}, { ...webhook, orderId: 'ORDER2' });
      expect(request).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
    });

    it('rejects an order of another store, or another amount', async () => {
      request.mockResolvedValue(answer(lemonSqueezyOrder({ store_id: 1 })));
      const otherStore = await provider.completeThreeDSPayment({}, webhook);
      expect(otherStore.errorCode).toBe('INVALID_HASH');
      expectNoIds(otherStore);

      request.mockResolvedValue(answer(lemonSqueezyOrder({ total: 100 })));
      const otherAmount = await provider.completeThreeDSPayment(
        {},
        { ...webhook, amount: '19.99' }
      );
      expect(otherAmount.errorCode).toBe('INVALID_HASH');
      expectNoIds(otherAmount);
    });

    it("follows the order's status at Lemon Squeezy", async () => {
      request.mockResolvedValue(answer(lemonSqueezyOrder({ status: 'pending' })));
      expect((await provider.completeThreeDSPayment({}, webhook)).status).toBe(
        PaymentStatus.PENDING
      );

      request.mockResolvedValue(answer(lemonSqueezyOrder({ status: 'failed' })));
      const failed = await provider.completeThreeDSPayment({}, webhook);
      expect(failed.status).toBe(PaymentStatus.FAILURE);
      expectNoIds(failed);
    });

    it('ignores events that are not about orders', async () => {
      const body =
        '{"meta":{"event_name":"subscription_created"},"data":{"type":"subscriptions","id":"5"}}';
      const { createHmac } = await import('node:crypto');
      const signature = createHmac('sha256', LEMONSQUEEZY_TEST.webhookSecret)
        .update(body)
        .digest('hex');
      const result = await provider.completeThreeDSPayment({}, { rawBody: body, signature });
      expect(result.errorCode).toBe('INVALID_CALLBACK');
      expect(request).not.toHaveBeenCalled();
    });

    it('keeps the signed ids when reading the order times out', async () => {
      request.mockRejectedValue(timeout());
      const result = await provider.completeThreeDSPayment({}, webhook);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.paymentId).toBe('1001');
      expect(result.conversationId).toBe('ORDERLS');
    });

    describe('through the default handler (/lemonsqueezy/callback)', () => {
      const setup = () => {
        const payment = betterPayment({
          mode: 'sandbox',
          providers: { lemonsqueezy: lemonSqueezy(LEMONSQUEEZY_TEST) },
        });
        (payment.use('lemonsqueezy') as any).client.request = request;
        const onCallback = vi.fn();
        const handler = new BetterPaymentHandler(payment, { onCallback });
        const deliver = (body: unknown, signature = LEMONSQUEEZY_WEBHOOK_SIGNATURE) =>
          handler.handle({
            method: 'POST',
            url: '/api/pay/lemonsqueezy/callback',
            headers: { 'content-type': 'application/json', 'X-Signature': signature },
            body,
          });
        return { onCallback, deliver };
      };

      it('verifies the raw body and the X-Signature header, then acknowledges with 200', async () => {
        const { onCallback, deliver } = setup();
        request.mockResolvedValue(answer(lemonSqueezyOrder()));
        const response = await deliver(LEMONSQUEEZY_WEBHOOK_BODY);
        expect(response.status).toBe(200);
        expect(onCallback).toHaveBeenCalledWith(
          expect.objectContaining({
            status: PaymentStatus.SUCCESS,
            paymentId: '1001',
            conversationId: 'ORDERLS',
          }),
          expect.anything()
        );
      });

      it('answers 400 to a bad signature, without reading the order', async () => {
        const { onCallback, deliver } = setup();
        const forged = await deliver(LEMONSQUEEZY_WEBHOOK_BODY.replace('ORDERLS', 'VICTIM'));
        expect(forged.status).toBe(400);
        // A body that imitates the raw delivery is itself the raw body, so it fails too
        const imitation = await deliver(
          JSON.stringify({ rawBody: LEMONSQUEEZY_WEBHOOK_BODY, signature: 'x' }),
          'x'
        );
        expect(imitation.status).toBe(400);
        expect(request).not.toHaveBeenCalled();
        expect(onCallback).not.toHaveBeenCalled();
      });

      it('refuses a body already parsed before the handler', async () => {
        const { onCallback, deliver } = setup();
        const response = await deliver(JSON.parse(LEMONSQUEEZY_WEBHOOK_BODY));
        expect(response.status).toBe(400);
        expect(request).not.toHaveBeenCalled();
        expect(onCallback).not.toHaveBeenCalled();
      });

      it('asks Lemon Squeezy to retry (503) when the order cannot be read', async () => {
        const { deliver } = setup();
        request.mockRejectedValue(timeout());
        expect((await deliver(LEMONSQUEEZY_WEBHOOK_BODY)).status).toBe(503);
      });

      it('acknowledges a signed failed order with 200, so it is not re-sent', async () => {
        const { onCallback, deliver } = setup();
        request.mockResolvedValue(answer(lemonSqueezyOrder({ status: 'failed' })));
        expect((await deliver(LEMONSQUEEZY_WEBHOOK_BODY)).status).toBe(200);
        expect(onCallback).toHaveBeenCalledWith(
          expect.objectContaining({ status: PaymentStatus.FAILURE }),
          expect.anything()
        );
      });
    });
  });

  describe('refund, cancel, getPayment', () => {
    it('refunds part of an order in cents', async () => {
      request.mockResolvedValue(
        answer(lemonSqueezyOrder({ refunded_amount: 500, status: 'partial_refund' }))
      );
      const result = await provider.refund({
        paymentId: '1001',
        price: '5.00',
        currency: 'USD',
        ip: '1.2.3.4',
      });
      expect(sent()).toMatchObject({
        method: 'POST',
        url: '/v1/orders/1001/refund',
        retryable: false,
      });
      expect(sentBody()).toEqual({
        data: { type: 'orders', id: '1001', attributes: { amount: 500 } },
      });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('cancel() refunds the whole order', async () => {
      request.mockResolvedValue(answer(lemonSqueezyOrder({ status: 'refunded', refunded: true })));
      const result = await provider.cancel({ paymentId: '1001', ip: '1.2.3.4' });
      expect(sentBody()).toEqual({ data: { type: 'orders', id: '1001' } });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('maps a refused refund', async () => {
      request.mockResolvedValue(
        answer(lemonSqueezyError('422', 'Order has already been refunded.'), 422)
      );
      const result = await provider.refund({
        paymentId: '1001',
        price: '5.00',
        currency: 'USD',
        ip: '1.2.3.4',
      });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toBe('Order has already been refunded.');
    });

    it('reads an order, and refuses one of another store', async () => {
      request.mockResolvedValue(answer(lemonSqueezyOrder({ status: 'refunded' })));
      expect((await provider.getPayment('1001')).status).toBe(PaymentStatus.CANCELLED);

      request.mockResolvedValue(answer(lemonSqueezyOrder({ store_id: 1 })));
      expect((await provider.getPayment('1001')).status).toBe(PaymentStatus.FAILURE);
    });
  });

  it('lemonSqueezy() uses the one API host in both modes', () => {
    expect(PROVIDER_DEFAULT_URLS[ProviderType.LEMONSQUEEZY]).toEqual({
      sandbox: 'https://api.lemonsqueezy.com',
      production: 'https://api.lemonsqueezy.com',
    });
    const payment = betterPayment({ providers: { lemonsqueezy: lemonSqueezy(LEMONSQUEEZY_TEST) } });
    expect((payment.use('lemonsqueezy') as any).config.baseUrl).toBe(
      'https://api.lemonsqueezy.com'
    );
  });
});
