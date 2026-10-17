import type { PaymentProviderConfig } from '../../core/PaymentProvider';
import type { PaymentRequest, ThreeDSPaymentRequest } from '../../types';

/**
 * Stripe configuration. The keys come from the Stripe Dashboard (Developers >
 * API keys); test keys (`sk_test_`, `pk_test_`) run in test mode.
 */
export interface StripeConfig extends PaymentProviderConfig {
  /** Secret key (`sk_...`) or restricted key (`rk_...`), server side only */
  secretKey: string;
  /**
   * Publishable key (`pk_...`). Needed by initThreeDSPayment(), whose page runs
   * Stripe.js to show the 3D Secure step.
   */
  publishableKey?: string;
  /** Payment method types for the PaymentIntent. Default: ['card'] */
  paymentMethodTypes?: string[];
  /** `statement_descriptor_suffix`, shown on the customer's card statement */
  statementDescriptorSuffix?: string;
}

/**
 * A payment request for Stripe. The card is never sent to your server: collect
 * it with Stripe.js and pass what Stripe.js returns.
 */
export interface StripePaymentRequest extends PaymentRequest {
  /**
   * From Stripe.js: a ConfirmationToken id (`ctoken_...`, from
   * `stripe.createConfirmationToken()`) or a PaymentMethod id (`pm_...`, from
   * `stripe.createPaymentMethod()`). Use `storedCard` for a saved card instead.
   */
  paymentToken?: string;
}

export interface StripeThreeDSPaymentRequest extends ThreeDSPaymentRequest {
  paymentToken?: string;
}

/**
 * What the 3D Secure page POSTs to callbackUrl. Only the id is read; the
 * payment itself is always fetched from Stripe.
 */
export interface Stripe3DCallbackData {
  payment_intent?: string;
  [key: string]: unknown;
}

/** The fields of a PaymentIntent the provider reads */
export interface StripePaymentIntent {
  id: string;
  object?: 'payment_intent';
  status:
    | 'requires_payment_method'
    | 'requires_confirmation'
    | 'requires_action'
    | 'processing'
    | 'requires_capture'
    | 'canceled'
    | 'succeeded';
  amount: number;
  amount_received?: number;
  amount_capturable?: number;
  currency: string;
  client_secret?: string;
  capture_method?: string;
  livemode?: boolean;
  metadata?: Record<string, string>;
  customer?: string | { id: string } | null;
  payment_method?: string | { id: string } | null;
  setup_future_usage?: string | null;
  next_action?: { type?: string } | null;
  last_payment_error?: StripeError | null;
  latest_charge?: string | StripeCharge | null;
  [key: string]: unknown;
}

/** A saved card (PaymentMethod of type card) */
export interface StripePaymentMethod {
  id: string;
  customer?: string | null;
  card?: {
    brand?: string;
    last4?: string;
    exp_month?: number;
    exp_year?: number;
    funding?: string;
    country?: string;
  };
  [key: string]: unknown;
}

export interface StripeCharge {
  id: string;
  amount?: number;
  amount_captured?: number;
  refunded?: boolean;
  amount_refunded?: number;
  [key: string]: unknown;
}

export interface StripeRefund {
  id: string;
  status?: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled';
  amount?: number;
  failure_reason?: string;
  [key: string]: unknown;
}

export interface StripeError {
  type?: string;
  code?: string;
  decline_code?: string;
  message?: string;
  payment_intent?: StripePaymentIntent;
  [key: string]: unknown;
}
