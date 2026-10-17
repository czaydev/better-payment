import { formatDecimal } from '../../core/utils';
import { digest, toHex } from '../../core/crypto';
import { ValidationError } from '../../core/errors';

export const MOKAUNITED_ENDPOINTS = {
  PAYMENT: '/PaymentDealer/DoDirectPayment',
  PAYMENT_3D: '/PaymentDealer/DoDirectPaymentThreeD',
  CAPTURE: '/PaymentDealer/DoCapture',
  VOID: '/PaymentDealer/DoVoid',
  REFUND: '/PaymentDealer/DoCreateRefundRequest',
  DETAIL: '/PaymentDealer/GetDealerPaymentTrxDetailList',
  BIN: '/PaymentDealer/GetBankCardInformation',
  AMOUNT: '/PaymentDealer/DoCalcPaymentAmount',
} as const;

/** `ResultCode` of an answer whose request was processed */
export const MOKAUNITED_SUCCESS = 'Success';

async function sha256Hex(value: string): Promise<string> {
  return toHex(await digest('SHA-256', value));
}

/** CheckKey of every request: SHA-256 hex of DealerCode + "MK" + Username + "PD" + Password */
export function createMokaUnitedCheckKey(fields: {
  dealerCode: string;
  username: string;
  password: string;
}): Promise<string> {
  return sha256Hex(`${fields.dealerCode}MK${fields.username}PD${fields.password}`);
}

/**
 * The 3D callback's `hashValue` for a result: SHA-256 hex of the payment's
 * CodeForHash followed by "T" (successful) or "F" (failed)
 */
export function createMokaUnitedHashValue(
  codeForHash: string,
  successful: boolean
): Promise<string> {
  return sha256Hex(codeForHash + (successful ? 'T' : 'F'));
}

/** Amount with 2 decimals ("27.50") as a number, as Moka United expects it */
export function formatMokaUnitedAmount(amount: string | number): number {
  return Number(formatDecimal(amount));
}

/** Moka United's currency codes: TL, USD, EUR, GBP */
export function getMokaUnitedCurrency(currency: string | undefined): string {
  const code = (currency || 'TRY').toUpperCase();
  const map: Record<string, string> = { TRY: 'TL', TL: 'TL', USD: 'USD', EUR: 'EUR', GBP: 'GBP' };
  if (!map[code]) {
    throw new ValidationError(`Currency ${currency} is not supported by Moka United`);
  }
  return map[code];
}

/** InstallmentNumber: 1 for a single payment, 2 to 12 for installments */
export function formatMokaUnitedInstallment(installment: number | undefined): number {
  const count = installment ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 12) {
    throw new ValidationError(`Moka United supports 1 to 12 installments, got ${installment}`);
  }
  return count;
}

/** Card scheme names as the other providers return them */
export function mokaUnitedCardAssociation(cardType: string | undefined): string {
  const map: Record<string, string> = {
    MASTER: 'MASTER_CARD',
    MAESTRO: 'MASTER_CARD',
    VISA: 'VISA',
    AMEX: 'AMEX',
    TROY: 'TROY',
  };
  return map[(cardType || '').toUpperCase()] ?? (cardType || '');
}
