import { describe, it, expect } from 'vitest';
import { betterPayment, lemonSqueezy as createLemonSqueezy } from '../../src';
import { PaymentStatus } from '../../src/types';
import { describeResult, orderId, record, requireEnv, threeDSRequest } from './setup';

// Lemon Squeezy's test mode: any store's test-mode API key, with a variant of
// that store. Opt-in: these tests run only when the values are set.
const env = requireEnv(
  'LEMONSQUEEZY_SANDBOX_API_KEY',
  'LEMONSQUEEZY_SANDBOX_STORE_ID',
  'LEMONSQUEEZY_SANDBOX_VARIANT_ID'
);
// An order paid by hand on a test checkout, to read back (optional)
const paidOrder = process.env.LEMONSQUEEZY_SANDBOX_ORDER_ID;

describe.skipIf(!env)('Lemon Squeezy sandbox', () => {
  const lemonsqueezy = !env
    ? (undefined as never)
    : betterPayment({
        mode: 'sandbox',
        providers: {
          lemonsqueezy: createLemonSqueezy({
            apiKey: env.LEMONSQUEEZY_SANDBOX_API_KEY,
            storeId: env.LEMONSQUEEZY_SANDBOX_STORE_ID,
            variantId: env.LEMONSQUEEZY_SANDBOX_VARIANT_ID,
            webhookSecret: process.env.LEMONSQUEEZY_SANDBOX_WEBHOOK_SECRET || 'unused',
            currency: process.env.LEMONSQUEEZY_SANDBOX_CURRENCY || 'USD',
          }),
        },
      }).lemonsqueezy;

  it('creates a test-mode checkout at the order price', async () => {
    const { paymentCard: _card, ...request } = threeDSRequest(undefined as never, {
      conversationId: orderId('LS'),
      price: '1.00',
      paidPrice: '1.00',
      currency: process.env.LEMONSQUEEZY_SANDBOX_CURRENCY || 'USD',
    });
    const init = await lemonsqueezy.initThreeDSPayment(request as never);
    record('lemonsqueezy', 'checkout', init.rawResponse);
    expect(init.status, describeResult(init)).toBe(PaymentStatus.PENDING);
    expect(init.redirectUrl).toMatch(/^https:\/\//);
  });

  it.skipIf(!paidOrder)('reads a paid test order', async () => {
    const status = await lemonsqueezy.getPayment(paidOrder!);
    record('lemonsqueezy', 'order', status.rawResponse);
    expect([PaymentStatus.SUCCESS, PaymentStatus.CANCELLED], describeResult(status)).toContain(
      status.status
    );
  });
});
