import { ValidationError } from '../../core/errors';
import { PaymentErrorCode } from '../../core/error-codes';
import { parseAmount } from '../../core/utils';
import { PaymentStatus } from '../../types';
import type { StripePaymentIntent } from './types';

/** API version the provider is written against, sent as `Stripe-Version` */
export const STRIPE_API_VERSION = '2024-06-20';

/** Stripe.js, loaded from Stripe's own host as Stripe requires */
export const STRIPE_JS_URL = 'https://js.stripe.com/v3/';

/** Currencies without minor units (amounts are sent as whole units) */
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

/** Currencies with three decimals; Stripe requires the last digit to be 0 */
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

/** Lowercase ISO currency code ("try") */
export function stripeCurrency(currency: string | undefined): string {
  const code = (currency || 'TRY').toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new ValidationError(`Invalid currency: ${currency}`);
  }
  return code.toLowerCase();
}

/**
 * Amount in the currency's smallest unit, as Stripe expects it: "100.50" TRY is
 * 10050, "1000" JPY is 1000, "1.5" KWD is 1500
 */
export function toStripeAmount(amount: string | number, currency: string | undefined): number {
  const code = (currency || 'TRY').toUpperCase();
  const value = parseAmount(amount);
  if (ZERO_DECIMAL.has(code)) return Math.round(value);
  if (THREE_DECIMAL.has(code)) return Math.round(value * 100) * 10;
  return Math.round(Number(`${value}e2`));
}

/** Decimal amount from Stripe's smallest unit (10050 TRY is "100.50") */
export function fromStripeAmount(amount: number, currency: string | undefined): string {
  const code = (currency || 'TRY').toUpperCase();
  if (ZERO_DECIMAL.has(code)) return String(amount);
  if (THREE_DECIMAL.has(code)) return (amount / 1000).toFixed(3);
  return (amount / 100).toFixed(2);
}

/**
 * Encodes nested parameters the way the Stripe API reads them:
 * `{ metadata: { order_id: 'A' }, payment_method_types: ['card'] }` becomes
 * `metadata[order_id]=A&payment_method_types[0]=card`. Undefined values are left out.
 */
export function encodeStripeForm(params: Record<string, unknown>): string {
  const pairs: string[] = [];
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => add(`${key}[${index}]`, item));
    } else if (typeof value === 'object') {
      for (const [child, childValue] of Object.entries(value as Record<string, unknown>)) {
        add(`${key}[${child}]`, childValue);
      }
    } else {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  };
  for (const [key, value] of Object.entries(params)) add(key, value);
  return pairs.join('&');
}

/**
 * Stripe error and decline codes (`decline_code`, else `code`), mapped to the
 * normalized codes
 */
export const STRIPE_ERROR_CODES: Record<string, PaymentErrorCode> = {
  insufficient_funds: PaymentErrorCode.INSUFFICIENT_FUNDS,
  card_declined: PaymentErrorCode.CARD_DECLINED,
  generic_decline: PaymentErrorCode.CARD_DECLINED,
  do_not_honor: PaymentErrorCode.CARD_DECLINED,
  transaction_not_allowed: PaymentErrorCode.CARD_DECLINED,
  card_not_supported: PaymentErrorCode.CARD_DECLINED,
  currency_not_supported: PaymentErrorCode.CARD_DECLINED,
  incorrect_number: PaymentErrorCode.INVALID_CARD,
  invalid_number: PaymentErrorCode.INVALID_CARD,
  invalid_account: PaymentErrorCode.INVALID_CARD,
  expired_card: PaymentErrorCode.EXPIRED_CARD,
  invalid_expiry_month: PaymentErrorCode.EXPIRED_CARD,
  invalid_expiry_year: PaymentErrorCode.EXPIRED_CARD,
  incorrect_cvc: PaymentErrorCode.INVALID_CVC,
  invalid_cvc: PaymentErrorCode.INVALID_CVC,
  fraudulent: PaymentErrorCode.FRAUD_SUSPECTED,
  lost_card: PaymentErrorCode.FRAUD_SUSPECTED,
  stolen_card: PaymentErrorCode.FRAUD_SUSPECTED,
  pickup_card: PaymentErrorCode.FRAUD_SUSPECTED,
  merchant_blacklist: PaymentErrorCode.FRAUD_SUSPECTED,
  card_velocity_exceeded: PaymentErrorCode.LIMIT_EXCEEDED,
  withdrawal_count_limit_exceeded: PaymentErrorCode.LIMIT_EXCEEDED,
  authentication_required: PaymentErrorCode.THREEDS_FAILED,
  // createPayment() on a card that needs 3D Secure
  authentication_not_handled: PaymentErrorCode.THREEDS_FAILED,
  payment_intent_authentication_failure: PaymentErrorCode.THREEDS_FAILED,
  processing_error: PaymentErrorCode.PROVIDER_ERROR,
  api_key_expired: PaymentErrorCode.PROVIDER_ERROR,
  amount_too_small: PaymentErrorCode.INVALID_REQUEST,
  amount_too_large: PaymentErrorCode.INVALID_REQUEST,
  parameter_invalid_integer: PaymentErrorCode.INVALID_REQUEST,
  parameter_missing: PaymentErrorCode.INVALID_REQUEST,
  resource_missing: PaymentErrorCode.INVALID_REQUEST,
  charge_already_refunded: PaymentErrorCode.INVALID_REQUEST,
  payment_intent_unexpected_state: PaymentErrorCode.INVALID_REQUEST,
};

/**
 * Status of a PaymentIntent:
 * - succeeded: success, or cancelled once (part of) it was refunded
 * - requires_capture: success (the amount is blocked, see authorize())
 * - canceled: cancelled
 * - requires_payment_method after an attempt: failure (declined or 3D Secure failed)
 * - anything else (requires_action, processing, ...): pending
 */
export function mapStripeStatus(intent: StripePaymentIntent): PaymentStatus {
  switch (intent.status) {
    case 'succeeded':
      return refundedAmount(intent) > 0 ? PaymentStatus.CANCELLED : PaymentStatus.SUCCESS;
    case 'requires_capture':
      return PaymentStatus.SUCCESS;
    case 'canceled':
      return PaymentStatus.CANCELLED;
    case 'requires_payment_method':
      return intent.last_payment_error ? PaymentStatus.FAILURE : PaymentStatus.PENDING;
    default:
      return PaymentStatus.PENDING;
  }
}

/**
 * Amount refunded by refunds. A partial capture releases the rest of the
 * authorization, and Stripe counts that release in `amount_refunded` too.
 */
export function refundedAmount(intent: StripePaymentIntent): number {
  const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : undefined;
  if (!charge) return 0;
  const released = (charge.amount ?? 0) - (charge.amount_captured ?? charge.amount ?? 0);
  return Math.max(0, (charge.amount_refunded ?? 0) - Math.max(0, released));
}

/** PaymentIntent ids look like `pi_...` */
export function validateStripeIntentId(id: unknown): string {
  if (typeof id !== 'string' || !/^pi_[A-Za-z0-9]+$/.test(id)) {
    throw new ValidationError('A PaymentIntent id (pi_...) is required');
  }
  return id;
}
