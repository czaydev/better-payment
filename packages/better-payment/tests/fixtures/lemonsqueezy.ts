/** Made-up Lemon Squeezy store for unit tests */
export const LEMONSQUEEZY_TEST = {
  apiKey: 'test_api_key',
  storeId: '4242',
  variantId: '777',
  webhookSecret: 'whsec_test_secret',
};

export const LEMONSQUEEZY_BASE_URL = 'https://api.lemonsqueezy.com';

/**
 * An `order_created` webhook body for ORDERLS (order 1001, 19.99), and its
 * `X-Signature`, computed independently with Python's hmac:
 * hmac.new(b'whsec_test_secret', body, sha256).hexdigest()
 */
export const LEMONSQUEEZY_WEBHOOK_BODY =
  '{"meta":{"event_name":"order_created","custom_data":{"order_id":"ORDERLS"}},"data":{"type":"orders","id":"1001","attributes":{"store_id":4242,"status":"paid","total":1999,"currency":"USD"}}}';
export const LEMONSQUEEZY_WEBHOOK_SIGNATURE =
  'f330ac2ca9b09c4ebe0c581b75410c199726c8cf498143e049956736f0cca603';

/** A GET /v1/orders/:id answer */
export const lemonSqueezyOrder = (attributes: Record<string, unknown> = {}, id = '1001') => ({
  data: {
    type: 'orders',
    id,
    attributes: {
      store_id: 4242,
      identifier: '104e18a2-d755-4d4b-80c4-a6c1dcbe1c10',
      order_number: 1,
      currency: 'USD',
      total: 1999,
      refunded_amount: 0,
      status: 'paid',
      refunded: false,
      test_mode: true,
      ...attributes,
    },
  },
});

/** A JSON:API error answer */
export const lemonSqueezyError = (status: string, detail: string) => ({
  errors: [{ status, title: 'Error', detail }],
});
