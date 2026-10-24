import type { PaymentErrorCode } from 'better-payment';

/** Customer-facing messages for the normalized error codes: English */
export const en: Record<PaymentErrorCode, string> = {
  INSUFFICIENT_FUNDS: 'Your card has insufficient funds. Try another card.',
  CARD_DECLINED: 'Your bank declined the payment. Contact your bank or try another card.',
  INVALID_CARD: 'Check your card number.',
  EXPIRED_CARD: "Check your card's expiry date.",
  INVALID_CVC: 'Check the security code on the back of your card.',
  THREEDS_FAILED: 'Verification failed. Try again and complete the SMS step.',
  FRAUD_SUSPECTED: "We couldn't complete this payment. Contact your bank.",
  LIMIT_EXCEEDED: "Your card's limit was exceeded. Try another card.",
  DUPLICATE_ORDER: 'This order was already submitted.',
  CANCELLED_BY_CUSTOMER: 'Payment was cancelled.',
  INVALID_REQUEST: 'Something went wrong. Please try again.',
  NETWORK_ERROR: "We're checking your payment. Don't pay again.",
  INVALID_HASH: 'Payment could not be verified.',
  PROVIDER_ERROR: 'Payment is temporarily unavailable. Please try again later.',
  UNKNOWN: 'Payment failed. Please try again or use another card.',
};
