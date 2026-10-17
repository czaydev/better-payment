import { toMinorUnits } from '../../core/utils';
import { digest, randomHex, toBase64 } from '../../core/crypto';
import { ValidationError } from '../../core/errors';

export const TOSLA_ENDPOINTS = {
  THREE_D_PAYMENT: '/api/Payment/threeDPayment',
  /** Card form target (customer's browser) */
  PROCESS_CARD_FORM: '/api/Payment/ProcessCardForm',
  INQUIRY: '/api/Payment/inquiry',
  VOID: '/api/Payment/void',
  REFUND: '/api/Payment/refund',
  COMMISSION: '/api/Payment/GetCommissionAndInstallmentInfo',
} as const;

/** Tosla's clock: Turkey time (UTC+3, no daylight saving) */
const TURKEY_OFFSET_MS = 3 * 60 * 60 * 1000;

/** `timeSpan`: yyyyMMddHHmmss in Turkey time */
export function formatToslaTimeSpan(date: Date = new Date()): string {
  return new Date(date.getTime() + TURKEY_OFFSET_MS)
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14);
}

/** Random value for `Rnd` */
export function generateToslaRandom(): string {
  return randomHex(8);
}

/**
 * Hash of every request:
 * base64(SHA-512(apiPass + clientId + apiUser + Rnd + timeSpan))
 */
export async function createToslaHash(fields: {
  apiPass: string;
  clientId: string;
  apiUser: string;
  rnd: string;
  timeSpan: string;
}): Promise<string> {
  return toBase64(
    await digest(
      'SHA-512',
      fields.apiPass + fields.clientId + fields.apiUser + fields.rnd + fields.timeSpan
    )
  );
}

/** Amount in minor units (kuruş), as Tosla expects it */
export function formatToslaAmount(amount: string | number): number {
  return toMinorUnits(amount);
}

/** ISO 4217 numeric currency code */
export function getToslaCurrencyCode(currency: string | undefined): number {
  const map: Record<string, number> = { TRY: 949, TL: 949, USD: 840, EUR: 978, GBP: 826 };
  const code = map[(currency || 'TRY').toUpperCase()];
  if (!code) {
    throw new ValidationError(`Currency ${currency} is not supported by Tosla`);
  }
  return code;
}

/** Installment count: 1 for a single payment */
export function formatToslaInstallment(installment: number | undefined): number {
  const count = installment ?? 1;
  if (!Number.isInteger(count) || count < 1) {
    throw new ValidationError(`Invalid installment count: ${installment}`);
  }
  return count;
}

/** ExpireDate: MMYY */
export function formatToslaExpiry(month: string, year: string): string {
  const mm = month.padStart(2, '0');
  const yy = year.length === 4 ? year.slice(2) : year.padStart(2, '0');
  if (!/^(0[1-9]|1[0-2])$/.test(mm) || !/^\d{2}$/.test(yy)) {
    throw new ValidationError('Invalid card expiry date');
  }
  return mm + yy;
}

/** Card scheme from the BIN, for binCheck() */
export function toslaCardAssociation(bin: string): string {
  if (/^4/.test(bin)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(bin)) return 'MASTER_CARD';
  if (/^(9792|65)/.test(bin)) return 'TROY';
  if (/^3[47]/.test(bin)) return 'AMEX';
  return '';
}

/** Installment count → rate (percent) from CommissionPackages[0].InstallmentRate */
export function toslaInstallmentRates(
  rates: Record<string, { Rate?: number } | null> | null | undefined
): Array<{ count: number; rate: number }> {
  return Object.entries(rates ?? {})
    .map(([key, value]) => ({ count: Number(key.replace(/^T/i, '')), rate: Number(value?.Rate) }))
    .filter(({ count, rate }) => Number.isInteger(count) && count >= 1 && Number.isFinite(rate))
    .sort((a, b) => a.count - b.count);
}
