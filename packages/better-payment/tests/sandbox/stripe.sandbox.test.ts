import { describe, it, expect } from 'vitest';
import { betterPayment, stripe as createStripe } from '../../src';
import { PaymentStatus } from '../../src/types';
import { describeResult, orderId, order, record, requireEnv } from './setup';

// Any Stripe account's test mode works; the payments use Stripe's test
// PaymentMethods (pm_card_visa, ...), so no card variables are needed
const env = requireEnv('STRIPE_SANDBOX_SECRET_KEY', 'STRIPE_SANDBOX_PUBLISHABLE_KEY');
const IP = '85.34.78.112';

/** 100 TRY: Stripe's minimum is about 0.50 USD */
const request = (paymentToken: string) => ({
  ...order(),
  price: '100',
  paidPrice: '100',
  basketItems: [{ ...order().basketItems[0], price: '100' }],
  conversationId: orderId('STR'),
  paymentToken,
});

describe.skipIf(!env || !env.STRIPE_SANDBOX_SECRET_KEY.startsWith('sk_test_'))(
  'Stripe sandbox',
  () => {
    const stripe = !env
      ? (undefined as never)
      : betterPayment({
          mode: 'sandbox',
          providers: {
            stripe: createStripe({
              secretKey: env!.STRIPE_SANDBOX_SECRET_KEY,
              publishableKey: env!.STRIPE_SANDBOX_PUBLISHABLE_KEY,
            }),
          },
        }).stripe;

    it('reports an unknown PaymentIntent as failure', async () => {
      const result = await stripe.getPayment('pi_doesnotexist000');
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('resource_missing');
    });

    it('charges, refunds part, and cancels the rest', async () => {
      const payment = await stripe.createPayment(request('pm_card_visa'));
      record('stripe', 'create-payment', payment.rawResponse);
      expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);
      expect((await stripe.getPayment(payment.paymentId!)).status).toBe(PaymentStatus.SUCCESS);

      const refund = await stripe.refund({
        paymentId: payment.paymentId!,
        price: '30',
        currency: 'TRY',
        ip: IP,
      });
      expect(refund.status, describeResult(refund)).toBe(PaymentStatus.SUCCESS);
      expect((await stripe.getPayment(payment.paymentId!)).status).toBe(PaymentStatus.CANCELLED);

      const cancel = await stripe.cancel({ paymentId: payment.paymentId!, ip: IP });
      expect(cancel.status, describeResult(cancel)).toBe(PaymentStatus.SUCCESS);
    });

    it('maps a decline', async () => {
      const result = await stripe.createPayment(request('pm_card_chargeDeclinedInsufficientFunds'));
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.code).toBe('INSUFFICIENT_FUNDS');
    });

    it('captures part of a pre-authorization', async () => {
      const auth = await stripe.authorize(request('pm_card_visa'));
      expect(auth.status, describeResult(auth)).toBe(PaymentStatus.SUCCESS);
      const capture = await stripe.capture({ paymentId: auth.paymentId!, amount: '60', ip: IP });
      expect(capture.status, describeResult(capture)).toBe(PaymentStatus.SUCCESS);
    });

    it('returns the 3D Secure page and reports an unfinished authentication', async () => {
      const init = await stripe.initThreeDSPayment({
        ...request('pm_card_authenticationRequired'),
        callbackUrl: 'https://example.com/api/pay/stripe/payment/complete-3ds',
      });
      expect(init.status, describeResult(init)).toBe(PaymentStatus.PENDING);
      expect(init.threeDSHtmlContent).toContain('handleNextAction');

      // Without a browser the 3D Secure step is never completed
      const result = await stripe.completeThreeDSPayment({ payment_intent: init.paymentId });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('authentication_required');
    });
  }
);
