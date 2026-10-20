import type { PaymentProviderConfig } from '../../core/PaymentProvider';
import type { ThreeDSInitResponse } from '../../types';

/**
 * Lemon Squeezy configuration (Settings → API and Settings → Webhooks in the
 * Lemon Squeezy dashboard). Lemon Squeezy is the merchant of record: it sells
 * on your behalf, collects the card on its own checkout and handles sales tax.
 */
export interface LemonSqueezyConfig extends PaymentProviderConfig {
  /** API key; a test-mode key creates test-mode checkouts */
  apiKey: string;
  /** Your store's id */
  storeId: string;
  /**
   * The product variant every checkout is created for. Each payment sets its
   * own price on it (`custom_price`), so one "payment" product is enough.
   */
  variantId: string;
  /** The signing secret of your webhook, for `X-Signature` */
  webhookSecret: string;
  /**
   * Your store's currency (ISO 4217). Lemon Squeezy reads every price in it, so
   * a payment in another currency is rejected. Default: USD.
   */
  currency?: string;
  /** Open the checkout as an overlay on your page (Lemon.js) instead of a full page */
  embed?: boolean;
}

/** A JSON:API resource */
export interface LemonSqueezyResource<A = Record<string, unknown>> {
  type?: string;
  id?: string;
  attributes?: A;
  [key: string]: unknown;
}

/** The fields of an order this provider reads */
export interface LemonSqueezyOrderAttributes {
  store_id?: number;
  identifier?: string;
  order_number?: number;
  currency?: string;
  /** In cents, in the order currency */
  total?: number;
  refunded_amount?: number;
  /** pending, failed, paid, refunded, partial_refund or fraudulent */
  status?: string;
  refunded?: boolean;
  test_mode?: boolean;
  first_order_item?: { variant_id?: number; [key: string]: unknown };
  [key: string]: unknown;
}

/** A webhook delivery (`order_created`, `order_refunded`, ...) */
export interface LemonSqueezyWebhookEvent {
  meta?: {
    event_name?: string;
    /** The `custom` data of the checkout: this provider sets `order_id` */
    custom_data?: Record<string, unknown>;
    [key: string]: unknown;
  };
  data?: LemonSqueezyResource<LemonSqueezyOrderAttributes>;
}

/**
 * A webhook as it arrived: the raw body and the `X-Signature` header. The
 * default handler passes this to `completeThreeDSPayment` for the
 * `/lemonsqueezy/callback` route; the signature decides whether it is trusted.
 */
export interface LemonSqueezyWebhookDelivery {
  rawBody: string;
  signature?: string;
}

/**
 * What your webhook route received, passed as the second argument of
 * `completeThreeDSPayment`: the raw body and the `X-Signature` header (the
 * signature covers the exact bytes), and optionally the order from your records.
 */
export interface LemonSqueezyCompleteContext {
  /** The raw request body, exactly as received */
  rawBody?: string;
  /** The `X-Signature` header */
  signature?: string;
  /** Your order id; an event for another order is rejected */
  orderId?: string;
  /** The order amount ("100.00"); checked against the order at Lemon Squeezy */
  amount?: string | number;
}

/** initThreeDSPayment() result */
export interface LemonSqueezyThreeDSInitResponse extends ThreeDSInitResponse {
  /** The checkout id */
  checkoutId?: string;
}
