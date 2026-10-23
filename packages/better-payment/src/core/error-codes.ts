/**
 * Provider-independent error codes.
 *
 * Every failure result carries `code` (one of these values) next to `errorCode`,
 * the provider's raw code. Branch on `code`; log `errorCode`.
 */
export enum PaymentErrorCode {
  /** Not enough balance or credit limit */
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  /** The issuer declined without a more specific reason ("do not honour") */
  CARD_DECLINED = 'CARD_DECLINED',
  /** Card number, BIN or issuer is not valid */
  INVALID_CARD = 'INVALID_CARD',
  /** Card is expired or the expiry date is wrong */
  EXPIRED_CARD = 'EXPIRED_CARD',
  /** CVC/CVV is wrong */
  INVALID_CVC = 'INVALID_CVC',
  /** 3D Secure authentication failed or was not completed */
  THREEDS_FAILED = 'THREEDS_FAILED',
  /** Suspected fraud, or the card was reported lost or stolen */
  FRAUD_SUSPECTED = 'FRAUD_SUSPECTED',
  /** Amount or transaction-count limit exceeded */
  LIMIT_EXCEEDED = 'LIMIT_EXCEEDED',
  /** The order id was already used */
  DUPLICATE_ORDER = 'DUPLICATE_ORDER',
  /** The customer left the payment page */
  CANCELLED_BY_CUSTOMER = 'CANCELLED_BY_CUSTOMER',
  /** The request was rejected before reaching the provider (missing or invalid fields) */
  INVALID_REQUEST = 'INVALID_REQUEST',
  /** No response from the provider; the outcome is unknown (status is `pending`) */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** A callback's signature did not verify; treat it as forged */
  INVALID_HASH = 'INVALID_HASH',
  /** Provider, bank or merchant configuration problem (terminal, system error, timeout) */
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  /** The provider has no equivalent API (e.g. marketplace split payments on a bank POS) */
  NOT_SUPPORTED = 'NOT_SUPPORTED',
  /** Not mapped yet; see `errorCode` for the provider's raw code */
  UNKNOWN = 'UNKNOWN',
}

/** Codes set by better-payment itself (not by a provider) */
const INTERNAL_CODES: Record<string, PaymentErrorCode> = {
  NETWORK_ERROR: PaymentErrorCode.NETWORK_ERROR,
  INVALID_HASH: PaymentErrorCode.INVALID_HASH,
  INVALID_CALLBACK: PaymentErrorCode.THREEDS_FAILED,
  VALIDATION_ERROR: PaymentErrorCode.INVALID_REQUEST,
  NOT_SUPPORTED: PaymentErrorCode.NOT_SUPPORTED,
};

/**
 * ISO 8583 response codes, returned by Turkish bank virtual POS systems as
 * the host response code.
 */
export const ISO8583_ERROR_CODES: Record<string, PaymentErrorCode> = {
  '01': PaymentErrorCode.CARD_DECLINED, // refer to card issuer
  '02': PaymentErrorCode.CARD_DECLINED, // refer to card issuer, special condition
  '03': PaymentErrorCode.PROVIDER_ERROR, // invalid merchant
  '04': PaymentErrorCode.FRAUD_SUSPECTED, // pick up card
  '05': PaymentErrorCode.CARD_DECLINED, // do not honour
  '07': PaymentErrorCode.FRAUD_SUSPECTED, // pick up card, special condition
  '12': PaymentErrorCode.CARD_DECLINED, // invalid transaction
  '13': PaymentErrorCode.INVALID_REQUEST, // invalid amount
  '14': PaymentErrorCode.INVALID_CARD, // invalid card number
  '15': PaymentErrorCode.INVALID_CARD, // no such issuer
  '33': PaymentErrorCode.EXPIRED_CARD, // expired card, pick up
  '41': PaymentErrorCode.FRAUD_SUSPECTED, // lost card
  '43': PaymentErrorCode.FRAUD_SUSPECTED, // stolen card
  '51': PaymentErrorCode.INSUFFICIENT_FUNDS, // not sufficient funds
  '54': PaymentErrorCode.EXPIRED_CARD, // expired card
  '57': PaymentErrorCode.CARD_DECLINED, // transaction not permitted to cardholder
  '58': PaymentErrorCode.PROVIDER_ERROR, // transaction not permitted to terminal
  '59': PaymentErrorCode.FRAUD_SUSPECTED, // suspected fraud
  '61': PaymentErrorCode.LIMIT_EXCEEDED, // exceeds amount limit
  '62': PaymentErrorCode.CARD_DECLINED, // restricted card
  '65': PaymentErrorCode.LIMIT_EXCEEDED, // exceeds frequency limit
  '82': PaymentErrorCode.INVALID_CVC, // CVV verification failed
  '91': PaymentErrorCode.PROVIDER_ERROR, // issuer or switch inoperative
  '94': PaymentErrorCode.DUPLICATE_ORDER, // duplicate transmission
  '96': PaymentErrorCode.PROVIDER_ERROR, // system malfunction
};

/**
 * Resolves the normalized code for a raw error code: internal codes first, then
 * the provider's table, otherwise UNKNOWN.
 */
export function resolveErrorCode(
  raw: string | number | undefined,
  providerCodes: Record<string, PaymentErrorCode> = {}
): PaymentErrorCode {
  if (raw === undefined || raw === null || raw === '') return PaymentErrorCode.UNKNOWN;
  const key = String(raw).trim();
  if (key.startsWith('MD_STATUS_')) return PaymentErrorCode.THREEDS_FAILED;
  return INTERNAL_CODES[key] ?? providerCodes[key] ?? PaymentErrorCode.UNKNOWN;
}
