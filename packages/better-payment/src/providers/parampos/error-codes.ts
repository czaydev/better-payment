import { PaymentErrorCode } from '../../core/error-codes';

/**
 * Param (TurkPOS) `Sonuc` values for failed requests. Successful results have a
 * positive `Sonuc`; failures are negative. A plain `-1` means the bank declined:
 * its ISO 8583 code in `Banka_Sonuc_Kod` decides `code` (see `ISO8583_ERROR_CODES`).
 */
export const PARAMPOS_ERROR_CODES: Record<string, PaymentErrorCode> = {
  '-100': PaymentErrorCode.PROVIDER_ERROR, // account not found
  '-101': PaymentErrorCode.PROVIDER_ERROR, // security error (credentials)
  '-102': PaymentErrorCode.PROVIDER_ERROR, // invalid request hash
  '-103': PaymentErrorCode.PROVIDER_ERROR, // invalid GUID length
  '-104': PaymentErrorCode.INVALID_REQUEST, // order id longer than 36 characters
  '-105': PaymentErrorCode.INVALID_CVC, // invalid CVC length
  '-106': PaymentErrorCode.EXPIRED_CARD, // invalid expiry year
  '-107': PaymentErrorCode.EXPIRED_CARD, // invalid expiry month
  '-108': PaymentErrorCode.INVALID_REQUEST, // invalid GSM number
  '-109': PaymentErrorCode.PROVIDER_ERROR, // invalid SanalPOS_ID length
  '-110': PaymentErrorCode.INVALID_REQUEST, // invalid installment
  '-111': PaymentErrorCode.INVALID_REQUEST, // invalid IP address
  '-112': PaymentErrorCode.INVALID_REQUEST, // invalid amount format
  '-113': PaymentErrorCode.INVALID_REQUEST, // amount must be greater than zero
  '-114': PaymentErrorCode.PROVIDER_ERROR, // test user cannot make transactions
  '-115': PaymentErrorCode.INVALID_REQUEST, // amount needs two decimals
  '-116': PaymentErrorCode.INVALID_REQUEST, // success or error URL is empty
  '-117': PaymentErrorCode.INVALID_REQUEST, // GSM number must be numeric
  '-118': PaymentErrorCode.INVALID_CARD, // invalid card number length
  '-119': PaymentErrorCode.INVALID_CARD, // invalid card number
  '-120': PaymentErrorCode.INVALID_REQUEST, // invalid date format
  '-121': PaymentErrorCode.INVALID_REQUEST, // cardholder details missing
  '-200': PaymentErrorCode.PROVIDER_ERROR, // commission settings not found
  '-201': PaymentErrorCode.INVALID_REQUEST, // installment not allowed for this POS
  '-202': PaymentErrorCode.INVALID_REQUEST, // wrong commission added to the total
  '-203': PaymentErrorCode.PROVIDER_ERROR, // commission calculation error
  '-204': PaymentErrorCode.PROVIDER_ERROR, // invalid SanalPOS type
  '-205': PaymentErrorCode.PROVIDER_ERROR, // payment could not be saved, retry
  '-206': PaymentErrorCode.PROVIDER_ERROR, // virtual POS transaction not saved
  '-207': PaymentErrorCode.PROVIDER_ERROR, // system error
  '-208': PaymentErrorCode.INVALID_CARD, // SanalPOS type or card number not found
  '-209': PaymentErrorCode.INVALID_REQUEST, // transaction not found
  '-210': PaymentErrorCode.INVALID_REQUEST, // nothing to cancel or refund
  '-211': PaymentErrorCode.INVALID_REQUEST, // already cancelled
  '-212': PaymentErrorCode.INVALID_REQUEST, // already refunded
  '-213': PaymentErrorCode.INVALID_REQUEST, // refundable transaction cannot be cancelled
  '-214': PaymentErrorCode.INVALID_REQUEST, // cancellable transaction cannot be refunded
  '-215': PaymentErrorCode.INVALID_CARD, // card BIN does not match SanalPOS_ID
  '-216': PaymentErrorCode.PROVIDER_ERROR, // GUID does not match the security object
  '-217': PaymentErrorCode.INVALID_REQUEST, // refund or cancel amount above the payment
  '-218': PaymentErrorCode.INVALID_REQUEST, // invalid cancel amount
  '-219': PaymentErrorCode.INVALID_REQUEST, // Durum must be IPTAL or IADE
  '-220': PaymentErrorCode.CARD_DECLINED, // debit cards cannot pay in installments
  '-221': PaymentErrorCode.INVALID_REQUEST, // refund above the refundable balance
  '-222': PaymentErrorCode.INVALID_REQUEST, // date range longer than 7 days
  '-223': PaymentErrorCode.INVALID_CARD, // test card used in production
  '-300': PaymentErrorCode.PROVIDER_ERROR, // card could not be stored
  '-301': PaymentErrorCode.PROVIDER_ERROR, // card could not be decrypted
};
