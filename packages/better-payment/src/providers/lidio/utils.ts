import { formatDecimal } from '../../core/utils';
import { digest, toBase64 } from '../../core/crypto';
import { ValidationError } from '../../core/errors';

export const LIDIO_ENDPOINTS = {
  PAYMENT: '/ProcessPayment',
  FINISH: '/FinishPaymentProcess',
  POSTAUTH: '/Postauth',
  CANCEL: '/Cancel',
  REFUND: '/Refund',
  INQUIRY: '/PaymentInquiry',
  BIN: '/GetBankOfBINNumber',
  INSTALLMENTS: '/GetInstallmentInfo',
} as const;

const CURRENCIES = [
  'TRY',
  'USD',
  'EUR',
  'GBP',
  'CHF',
  'JPY',
  'DKK',
  'NOK',
  'SEK',
  'RUB',
  'KZT',
  'KWD',
  'AED',
];

/** Amount with at most 2 decimals, as a JSON number (1.2 for "1.20") */
export function formatLidioAmount(amount: string | number): number {
  return Number(formatDecimal(amount));
}

/** Lidio's currency codes: ISO 4217 letters, TL as TRY */
export function getLidioCurrency(currency: string | undefined): string {
  const code = (currency || 'TRY').toUpperCase();
  const mapped = code === 'TL' ? 'TRY' : code;
  if (!CURRENCIES.includes(mapped)) {
    throw new ValidationError(`Currency ${currency} is not supported by Lidio`);
  }
  return mapped;
}

/** installmentCount: 0 for a single payment (not 1), else 2 to 12 */
export function formatLidioInstallment(installment: number | undefined): number {
  const count = installment ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 12) {
    throw new ValidationError(`Lidio supports 1 to 12 installments, got ${installment}`);
  }
  return count === 1 ? 0 : count;
}

/**
 * The 3D return's `Hash`: Base64(SHA-256(OrderId:MerchantKey:TotalAmount:Result:customer)),
 * where TotalAmount is "1.20" (en-US, 2 decimals) and customer is the email or
 * customer id, whichever the merchant account identifies customers by.
 */
export async function createLidioReturnHash(fields: {
  orderId: string;
  merchantKey: string;
  totalAmount: string;
  result: string;
  customer: string;
}): Promise<string> {
  const value = [
    fields.orderId,
    fields.merchantKey,
    fields.totalAmount,
    fields.result,
    fields.customer,
  ].join(':');
  return toBase64(await digest('SHA-256', value));
}

/** Card scheme names as the other providers return them */
export function lidioCardAssociation(cardType: string | undefined): string {
  const map: Record<string, string> = {
    MASTERCARD: 'MASTER_CARD',
    MAESTRO: 'MASTER_CARD',
    VISA: 'VISA',
    AMEX: 'AMEX',
    TROY: 'TROY',
  };
  return map[(cardType || '').toUpperCase()] ?? (cardType || '');
}
