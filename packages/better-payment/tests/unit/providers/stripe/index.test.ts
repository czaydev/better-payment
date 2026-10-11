import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../../src/core/http';
import { PaymentErrorCode } from '../../../../src/core/error-codes';
import { betterPayment, PROVIDER_DEFAULT_URLS, ProviderType } from '../../../../src';
import { Stripe, stripe } from '../../../../src/providers/stripe';
import {
  encodeStripeForm,
  fromStripeAmount,
  mapStripeStatus,
  refundedAmount,
  stripeCurrency,
  toStripeAmount,
} from '../../../../src/providers/stripe/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';
import { STRIPE_TEST, stripeCardError, stripeIntent, stripeRefund } from '../../../fixtures/stripe';

const { paymentCard: _card, ...orderWithoutCard } = mockPaymentRequest;
const order = { ...orderWithoutCard, price: '100', paidPrice: '100', conversationId: 'ORDER1' };
const timeout = () => new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' });
const ok = (data: unknown) => ({ data, status: 200, headers: {} });
const fail = (data: unknown, status = 402) => ({ data, status, headers: {} });

describe('Stripe utils', () => {
  it('converts amounts to the smallest currency unit', () => {
    expect(toStripeAmount('100.50', 'TRY')).toBe(10050);
    expect(toStripeAmount('0.1', 'USD')).toBe(10);
    expect(toStripeAmount('1000', 'JPY')).toBe(1000);
    expect(toStripeAmount('1.5', 'KWD')).toBe(1500);
    expect(fromStripeAmount(10050, 'try')).toBe('100.50');
    expect(fromStripeAmount(1000, 'jpy')).toBe('1000');
    expect(stripeCurrency('TRY')).toBe('try');
    expect(() => stripeCurrency('TL1')).toThrow();
  });

  it('encodes nested parameters in Stripe form style', () => {
    expect(
      encodeStripeForm({
        amount: 100,
        payment_method_types: ['card'],
        metadata: { order_id: 'A&B' },
        skipped: undefined,
      })
    ).toBe('amount=100&payment_method_types%5B0%5D=card&metadata%5Border_id%5D=A%26B');
  });

  it('maps PaymentIntent statuses', () => {
    expect(mapStripeStatus(stripeIntent() as any)).toBe(PaymentStatus.SUCCESS);
    expect(mapStripeStatus(stripeIntent({ status: 'requires_capture' }) as any)).toBe(
      PaymentStatus.SUCCESS
    );
    expect(mapStripeStatus(stripeIntent({ status: 'canceled' }) as any)).toBe(
      PaymentStatus.CANCELLED
    );
    expect(mapStripeStatus(stripeIntent({ status: 'requires_action' }) as any)).toBe(
      PaymentStatus.PENDING
    );
    expect(
      mapStripeStatus(
        stripeIntent({
          status: 'requires_payment_method',
          last_payment_error: { code: 'x' },
        }) as any
      )
    ).toBe(PaymentStatus.FAILURE);
  });

  it('treats refunds as cancelled, but not the release after a partial capture', () => {
    const charge = (amount_captured: number, amount_refunded: number) =>
      stripeIntent({
        latest_charge: { id: 'ch_1', amount: 10000, amount_captured, amount_refunded },
      }) as any;
    // Values seen in test mode: capturing 60 of 100 releases 40 into amount_refunded
    expect(refundedAmount(charge(6000, 4000))).toBe(0);
    expect(mapStripeStatus(charge(6000, 4000))).toBe(PaymentStatus.SUCCESS);
    expect(refundedAmount(charge(6000, 5000))).toBe(1000);
    expect(mapStripeStatus(charge(10000, 3000))).toBe(PaymentStatus.CANCELLED);
  });
});

describe('Stripe provider', () => {
  let provider: Stripe;
  let request: ReturnType<typeof vi.fn>;

  const create = (overrides: Partial<ConstructorParameters<typeof Stripe>[0]> = {}) => {
    const instance = new Stripe({
      ...STRIPE_TEST,
      baseUrl: 'https://api.stripe.com',
      ...overrides,
    });
    (instance as any).client.request = request;
    return instance;
  };
  const sent = (call = 0) => request.mock.calls[call][0];
  const sentParams = (call = 0) => new URLSearchParams(sent(call).data);

  beforeEach(() => {
    request = vi.fn();
    provider = create();
  });

  it('validates the keys', () => {
    expect(() => create({ secretKey: '' })).toThrow(/secretKey/);
    expect(() => create({ secretKey: 'pk_test_x' })).toThrow(/secret/);
    expect(() => create({ publishableKey: 'sk_test_x' })).toThrow(/pk_/);
  });

  it('sends the secret key and pinned API version', () => {
    const headers = (provider as any).client.options.headers;
    expect(headers.Authorization).toBe(`Bearer ${STRIPE_TEST.secretKey}`);
    expect(headers['Stripe-Version']).toBe('2024-06-20');
  });

  describe('createPayment', () => {
    it('confirms a PaymentIntent with a PaymentMethod id', async () => {
      request.mockResolvedValue(ok(stripeIntent()));

      const result = await provider.createPayment({ ...order, paymentToken: 'pm_card_visa' });

      expect(sent()).toMatchObject({
        method: 'POST',
        url: '/v1/payment_intents',
        retryable: false,
      });
      const params = sentParams();
      expect(params.get('amount')).toBe('10000');
      expect(params.get('currency')).toBe('try');
      expect(params.get('confirm')).toBe('true');
      expect(params.get('payment_method')).toBe('pm_card_visa');
      expect(params.get('payment_method_types[0]')).toBe('card');
      expect(params.get('error_on_requires_action')).toBe('true');
      expect(params.get('metadata[order_id]')).toBe('ORDER1');
      expect(params.has('capture_method')).toBe(false);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('pi_3TEST000000000001');
      expect(result.conversationId).toBe('ORDER1');
    });

    it('sends a ConfirmationToken as confirmation_token', async () => {
      request.mockResolvedValue(ok(stripeIntent()));
      await provider.createPayment({ ...order, paymentToken: 'ctoken_123' });
      expect(sentParams().get('confirmation_token')).toBe('ctoken_123');
      expect(sentParams().has('payment_method')).toBe(false);
    });

    it('charges a stored card with its customer', async () => {
      request.mockResolvedValue(ok(stripeIntent()));
      await provider.createPayment({
        ...order,
        storedCard: { customerToken: 'cus_1', cardToken: 'pm_1' },
      });
      expect(sentParams().get('customer')).toBe('cus_1');
      expect(sentParams().get('payment_method')).toBe('pm_1');
    });

    it('refuses card numbers without calling Stripe', async () => {
      const result = await provider.createPayment(mockPaymentRequest);
      expect(request).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toMatch(/Stripe\.js/);
    });

    it.each([
      [{ paymentToken: 'tok_123' }, /ctoken_/],
      [{ paymentToken: 'pm_1', installment: 3 }, /Installments/],
      [
        { storedCard: { customerToken: 'cus_1', cardToken: 'pm_1' }, saveCard: true },
        /saveCard needs/,
      ],
      [{}, /paymentToken/],
    ])('rejects %o', async (extra, message) => {
      const result = await provider.createPayment({ ...order, ...extra } as any);
      expect(request).not.toHaveBeenCalled();
      expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
      expect(result.errorMessage).toMatch(message);
    });

    it('maps a card decline', async () => {
      request.mockResolvedValue(fail(stripeCardError()));
      const result = await provider.createPayment({ ...order, paymentToken: 'pm_1' });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('insufficient_funds');
      expect(result.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
      expect(result.paymentId).toBe('pi_3TEST000000000001');
    });

    it('fails with THREEDS_FAILED when the card needs 3D Secure', async () => {
      request.mockResolvedValue(
        fail(
          stripeCardError({
            type: 'invalid_request_error',
            code: 'authentication_not_handled',
            decline_code: undefined,
          }),
          400
        )
      );
      const result = await provider.createPayment({ ...order, paymentToken: 'pm_1' });
      expect(result.code).toBe(PaymentErrorCode.THREEDS_FAILED);
    });

    it('returns pending on a timeout', async () => {
      request.mockRejectedValue(timeout());
      const result = await provider.createPayment({ ...order, paymentToken: 'pm_1' });
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.code).toBe(PaymentErrorCode.NETWORK_ERROR);
    });

    it('authorize() blocks the amount with capture_method manual', async () => {
      request.mockResolvedValue(ok(stripeIntent({ status: 'requires_capture' })));
      const result = await provider.authorize({ ...order, paymentToken: 'pm_1' });
      expect(sentParams().get('capture_method')).toBe('manual');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });
  });

  describe('initThreeDSPayment', () => {
    const threeDS = {
      ...order,
      callbackUrl: mockThreeDSPaymentRequest.callbackUrl,
      paymentToken: 'pm_1',
    };

    it('returns a page that runs handleNextAction and POSTs to callbackUrl', async () => {
      request.mockResolvedValue(
        ok(stripeIntent({ status: 'requires_action', next_action: { type: 'use_stripe_sdk' } }))
      );

      const result = await provider.initThreeDSPayment(threeDS);

      expect(sentParams().has('error_on_requires_action')).toBe(false);
      expect(sentParams().has('return_url')).toBe(false);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.paymentId).toBe('pi_3TEST000000000001');
      const html = result.threeDSHtmlContent!;
      expect(html).toContain('<script src="https://js.stripe.com/v3/"></script>');
      expect(html).toContain(`action="${threeDS.callbackUrl}"`);
      expect(html).toContain('name="payment_intent" value="pi_3TEST000000000001"');
      expect(html).toContain('handleNextAction({clientSecret:"pi_3TEST000000000001_secret_abc"})');
      expect(html).toContain(`Stripe("${STRIPE_TEST.publishableKey}"`);
      expect(html).not.toContain(STRIPE_TEST.secretKey);
    });

    it('POSTs right away when no 3D Secure step is needed', async () => {
      request.mockResolvedValue(ok(stripeIntent()));
      const result = await provider.initThreeDSPayment(threeDS);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.threeDSHtmlContent).not.toContain('handleNextAction');
      expect(result.threeDSHtmlContent).toContain('done();');
    });

    it('escapes values put in the page script', async () => {
      request.mockResolvedValue(
        ok(stripeIntent({ status: 'requires_action', client_secret: 'x</script><script>alert(1)' }))
      );
      const result = await provider.initThreeDSPayment(threeDS);
      expect(result.threeDSHtmlContent).not.toContain('</script><script>alert');
    });

    it('fails on a decline, and without a publishable key', async () => {
      request.mockResolvedValue(fail(stripeCardError()));
      expect((await provider.initThreeDSPayment(threeDS)).status).toBe(PaymentStatus.FAILURE);

      const result = await create({ publishableKey: undefined }).initThreeDSPayment(threeDS);
      expect(result.errorMessage).toMatch(/publishableKey/);
    });

    it('initThreeDSAuthorize() uses capture_method manual', async () => {
      request.mockResolvedValue(ok(stripeIntent({ status: 'requires_action' })));
      await provider.initThreeDSAuthorize(threeDS);
      expect(sentParams().get('capture_method')).toBe('manual');
    });
  });

  describe('completeThreeDSPayment', () => {
    it('reads the status from Stripe, not from the POST', async () => {
      request.mockResolvedValue(ok(stripeIntent()));

      const result = await provider.completeThreeDSPayment({
        payment_intent: 'pi_3TEST000000000001',
        status: 'failed',
      });

      expect(sent()).toMatchObject({
        method: 'GET',
        url: '/v1/payment_intents/pi_3TEST000000000001?expand%5B0%5D=latest_charge',
        retryable: true,
      });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('pi_3TEST000000000001');
      expect(result.conversationId).toBe('ORDER1');
    });

    it('fails without ids when 3D Secure failed', async () => {
      request.mockResolvedValue(
        ok(
          stripeIntent({
            status: 'requires_payment_method',
            last_payment_error: {
              code: 'payment_intent_authentication_failure',
              message: 'failed',
            },
          })
        )
      );
      const result = await provider.completeThreeDSPayment({
        payment_intent: 'pi_3TEST000000000001',
      });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.code).toBe(PaymentErrorCode.THREEDS_FAILED);
      expect(result.paymentId).toBeUndefined();
      expect(result.conversationId).toBeUndefined();
    });

    it('fails when 3D Secure was not completed', async () => {
      request.mockResolvedValue(ok(stripeIntent({ status: 'requires_action' })));
      const result = await provider.completeThreeDSPayment({
        payment_intent: 'pi_3TEST000000000001',
      });
      expect(result.errorCode).toBe('authentication_required');
      expect(result.paymentId).toBeUndefined();
    });

    it('keeps the ids while the payment is processing', async () => {
      request.mockResolvedValue(ok(stripeIntent({ status: 'processing' })));
      const result = await provider.completeThreeDSPayment({
        payment_intent: 'pi_3TEST000000000001',
      });
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.paymentId).toBe('pi_3TEST000000000001');
    });

    it('rejects a POST without a PaymentIntent id', async () => {
      const result = await provider.completeThreeDSPayment({ payment_intent: '../v1/refunds' });
      expect(request).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
    });

    it('maps an unknown PaymentIntent', async () => {
      request.mockResolvedValue(
        fail(
          {
            error: {
              type: 'invalid_request_error',
              code: 'resource_missing',
              message: 'No such payment_intent',
            },
          },
          404
        )
      );
      const result = await provider.completeThreeDSPayment({ payment_intent: 'pi_missing' });
      expect(result.errorCode).toBe('resource_missing');
    });
  });

  describe('refund, cancel, capture, getPayment', () => {
    it('refunds part of a payment', async () => {
      request.mockResolvedValue(ok(stripeRefund()));
      const result = await provider.refund({
        paymentId: 'pi_3TEST000000000001',
        price: '30',
        currency: 'TRY',
        ip: '1.1.1.1',
      });
      expect(sent().url).toBe('/v1/refunds');
      expect(sentParams().get('payment_intent')).toBe('pi_3TEST000000000001');
      expect(sentParams().get('amount')).toBe('3000');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.refundId).toBe('re_3TEST000000000001');
    });

    it('maps pending and failed refunds', async () => {
      const refund = (status: string) =>
        provider
          .refund({ paymentId: 'pi_1', price: '1', currency: 'TRY', ip: '1.1.1.1' })
          .then((r) => (request.mockReset(), r));
      request.mockResolvedValue(ok(stripeRefund({ status: 'pending' })));
      expect((await refund('pending')).status).toBe(PaymentStatus.PENDING);
      request.mockResolvedValue(
        ok(stripeRefund({ status: 'failed', failure_reason: 'expired_or_canceled_card' }))
      );
      const failed = await refund('failed');
      expect(failed.status).toBe(PaymentStatus.FAILURE);
      expect(failed.errorCode).toBe('expired_or_canceled_card');
    });

    it('cancel() refunds a charged payment in full', async () => {
      request
        .mockResolvedValueOnce(ok(stripeIntent()))
        .mockResolvedValueOnce(ok(stripeRefund({ amount: 10000 })));
      const result = await provider.cancel({ paymentId: 'pi_3TEST000000000001', ip: '1.1.1.1' });
      expect(sent(1).url).toBe('/v1/refunds');
      expect(sentParams(1).has('amount')).toBe(false);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.transactionId).toBe('re_3TEST000000000001');
    });

    it('cancel() cancels a PaymentIntent that was not charged', async () => {
      request
        .mockResolvedValueOnce(ok(stripeIntent({ status: 'requires_capture' })))
        .mockResolvedValueOnce(ok(stripeIntent({ status: 'canceled' })));
      const result = await provider.cancel({ paymentId: 'pi_3TEST000000000001', ip: '1.1.1.1' });
      expect(sent(1).url).toBe('/v1/payment_intents/pi_3TEST000000000001/cancel');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('cancel() fails for a payment that is already canceled', async () => {
      request.mockResolvedValueOnce(ok(stripeIntent({ status: 'canceled' })));
      const result = await provider.cancel({ paymentId: 'pi_3TEST000000000001', ip: '1.1.1.1' });
      expect(request).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(PaymentStatus.FAILURE);
    });

    it('captures part of a pre-authorization', async () => {
      request
        .mockResolvedValueOnce(ok(stripeIntent({ status: 'requires_capture' })))
        .mockResolvedValueOnce(
          ok(
            stripeIntent({
              latest_charge: {
                id: 'ch_1',
                amount: 10000,
                amount_captured: 6000,
                amount_refunded: 4000,
              },
            })
          )
        );
      const result = await provider.capture({
        paymentId: 'pi_3TEST000000000001',
        amount: '60',
        ip: '1.1.1.1',
      });
      expect(sent(1).url).toBe('/v1/payment_intents/pi_3TEST000000000001/capture');
      expect(sentParams(1).get('amount_to_capture')).toBe('6000');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.conversationId).toBe('ORDER1');
    });

    it('voids a pre-authorization', async () => {
      request.mockResolvedValue(ok(stripeIntent({ status: 'canceled' })));
      const result = await provider.voidAuthorization({
        paymentId: 'pi_3TEST000000000001',
        ip: '1.1.1.1',
      });
      expect(sent().url).toBe('/v1/payment_intents/pi_3TEST000000000001/cancel');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('getPayment() maps the status and returns the order id', async () => {
      request.mockResolvedValue(ok(stripeIntent()));
      const result = await provider.getPayment('pi_3TEST000000000001');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.conversationId).toBe('ORDER1');
    });
  });

  describe('saved cards', () => {
    it('saves the card during a payment on a new Customer', async () => {
      request
        .mockResolvedValueOnce(ok({ id: 'cus_NEW' }))
        .mockResolvedValueOnce(
          ok(
            stripeIntent({
              customer: 'cus_NEW',
              payment_method: 'pm_SAVED',
              setup_future_usage: 'off_session',
            })
          )
        );

      const result = await provider.createPayment({
        ...order,
        paymentToken: 'pm_card_visa',
        saveCard: true,
      });

      expect(sent(0).url).toBe('/v1/customers');
      expect(sentParams(0).get('email')).toBe(mockPaymentRequest.buyer.email);
      expect(sentParams(1).get('customer')).toBe('cus_NEW');
      expect(sentParams(1).get('setup_future_usage')).toBe('off_session');
      expect(result.storedCard).toEqual({ customerToken: 'cus_NEW', cardToken: 'pm_SAVED' });
    });

    it('adds the card to an existing Customer', async () => {
      request.mockResolvedValueOnce(
        ok(
          stripeIntent({
            customer: 'cus_OLD',
            payment_method: 'pm_SAVED',
            setup_future_usage: 'off_session',
          })
        )
      );
      await provider.createPayment({
        ...order,
        paymentToken: 'pm_card_visa',
        saveCard: { customerToken: 'cus_OLD' },
      });
      expect(request).toHaveBeenCalledTimes(1);
      expect(sentParams().get('customer')).toBe('cus_OLD');
    });

    it('lists the cards of a Customer', async () => {
      request.mockResolvedValue(
        ok({
          data: [
            {
              id: 'pm_1',
              customer: 'cus_1',
              card: {
                brand: 'mastercard',
                last4: '4444',
                exp_month: 3,
                exp_year: 2031,
                funding: 'debit',
              },
            },
          ],
        })
      );
      const result = await provider.listCards({ customerToken: 'cus_1' });
      expect(sent().url).toBe('/v1/customers/cus_1/payment_methods?type=card&limit=100');
      expect(result.cards).toEqual([
        {
          cardToken: 'pm_1',
          lastFourDigits: '4444',
          expireMonth: '03',
          expireYear: '2031',
          cardType: 'DEBIT_CARD',
          cardAssociation: 'MASTER_CARD',
        },
      ]);
    });

    it('deletes a card only from its own Customer', async () => {
      request
        .mockResolvedValueOnce(ok({ id: 'pm_1', customer: 'cus_1' }))
        .mockResolvedValueOnce(ok({ id: 'pm_1', customer: null }));
      const deleted = await provider.deleteCard({ customerToken: 'cus_1', cardToken: 'pm_1' });
      expect(sent(1).url).toBe('/v1/payment_methods/pm_1/detach');
      expect(deleted.status).toBe(PaymentStatus.SUCCESS);

      request.mockReset();
      request.mockResolvedValueOnce(ok({ id: 'pm_1', customer: 'cus_OTHER' }));
      const refused = await provider.deleteCard({ customerToken: 'cus_1', cardToken: 'pm_1' });
      expect(request).toHaveBeenCalledTimes(1);
      expect(refused.errorCode).toBe('card_not_found');
    });

    it('saveCard() without a payment is not supported', async () => {
      await expect(provider.saveCard({} as any)).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    });
  });

  describe('stripe()', () => {
    it('uses the Stripe API host in both modes', () => {
      const bp = betterPayment({ mode: 'sandbox', providers: { stripe: stripe(STRIPE_TEST) } });
      expect((bp.stripe as any).config.baseUrl).toBe('https://api.stripe.com');
      expect(PROVIDER_DEFAULT_URLS[ProviderType.STRIPE].production).toBe('https://api.stripe.com');
    });

    it('refuses live keys in sandbox mode', () => {
      expect(() =>
        betterPayment({
          mode: 'sandbox',
          providers: { stripe: stripe({ ...STRIPE_TEST, secretKey: 'sk_live_x' }) },
        })
      ).toThrow(/live keys/);
      expect(() =>
        betterPayment({ providers: { stripe: stripe({ ...STRIPE_TEST, secretKey: 'sk_live_x' }) } })
      ).not.toThrow();
    });
  });
});
