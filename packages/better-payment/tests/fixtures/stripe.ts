// Stripe fixtures. Keys and ids are made up; objects follow what the Stripe test
// mode returned for the same calls.
export const STRIPE_TEST = {
  secretKey: 'sk_test_fake',
  publishableKey: 'pk_test_fake',
};

export const stripeIntent = (fields: Record<string, unknown> = {}) => ({
  id: 'pi_3TEST000000000001',
  object: 'payment_intent',
  amount: 10000,
  currency: 'try',
  status: 'succeeded',
  capture_method: 'automatic',
  client_secret: 'pi_3TEST000000000001_secret_abc',
  livemode: false,
  metadata: { order_id: 'ORDER1', basket_id: 'B67832' },
  last_payment_error: null,
  next_action: null,
  latest_charge: {
    id: 'ch_3TEST000000000001',
    amount: 10000,
    amount_captured: 10000,
    amount_refunded: 0,
    refunded: false,
  },
  ...fields,
});

export const stripeCardError = (fields: Record<string, unknown> = {}) => ({
  error: {
    type: 'card_error',
    code: 'card_declined',
    decline_code: 'insufficient_funds',
    message: 'Your card has insufficient funds.',
    payment_intent: stripeIntent({ status: 'requires_payment_method', latest_charge: null }),
    ...fields,
  },
});

export const stripeRefund = (fields: Record<string, unknown> = {}) => ({
  id: 're_3TEST000000000001',
  object: 'refund',
  amount: 3000,
  status: 'succeeded',
  ...fields,
});
