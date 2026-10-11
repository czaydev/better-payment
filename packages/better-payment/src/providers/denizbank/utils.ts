import { formatDecimal, safeEqual } from '../../core/utils';
import { digest, toBase64 } from '../../core/crypto';
import { ValidationError } from '../../core/errors';

/** 3D form target and API (form POST), relative to the provider base URL */
export const DENIZBANK_ENDPOINT = '/mpi/Default.aspx';

async function sha1Base64(data: string): Promise<string> {
  return toBase64(await digest('SHA-1', data));
}

/**
 * Hash of the 3D form:
 * base64(SHA1(ShopCode + OrderId + PurchAmount + OkUrl + FailUrl + TxnType + InstallmentCount + Rnd + MerchantPass))
 */
export function createDenizbank3DHash(fields: {
  shopCode: string;
  orderId: string;
  amount: string;
  okUrl: string;
  failUrl: string;
  txnType: string;
  installment: string;
  rnd: string;
  merchantPass: string;
}): Promise<string> {
  return sha1Base64(
    fields.shopCode +
      fields.orderId +
      fields.amount +
      fields.okUrl +
      fields.failUrl +
      fields.txnType +
      fields.installment +
      fields.rnd +
      fields.merchantPass
  );
}

/**
 * Verifies the 3D callback HASH. The value is rebuilt from the fields named
 * in HASHPARAMS (":"-separated), never taken from HASHPARAMSVAL, and must
 * cover OrderId: HASH = base64(SHA1(values + MerchantPass)).
 */
export async function verifyDenizbankCallback(
  data: Record<string, string | undefined>,
  merchantPass: string,
  required: string[] = ['OrderId']
): Promise<boolean> {
  if (!data || !data.HASH || !data.HASHPARAMS) return false;
  const names = data.HASHPARAMS.split(':').filter(Boolean);
  if (!required.every((name) => names.includes(name))) return false;
  const value = names.map((name) => data[name] ?? '').join('');
  if (data.HASHPARAMSVAL !== undefined && data.HASHPARAMSVAL !== value) return false;
  return safeEqual(await sha1Base64(value + merchantPass), data.HASH);
}

/** Amount with 2 decimals ("1.20") */
export function formatDenizbankAmount(amount: string | number): string {
  return formatDecimal(amount);
}

/** ISO 4217 numeric currency code */
export function getDenizbankCurrencyCode(currency: string | undefined): string {
  const map: Record<string, string> = { TRY: '949', TL: '949', USD: '840', EUR: '978', GBP: '826' };
  const code = map[(currency || 'TRY').toUpperCase()];
  if (!code) {
    throw new ValidationError(`Currency ${currency} is not supported by Denizbank`);
  }
  return code;
}

/** InstallmentCount: empty for a single payment */
export function formatDenizbankInstallment(installment: number | undefined): string {
  const count = installment ?? 1;
  if (!Number.isInteger(count) || count < 1) {
    throw new ValidationError(`Invalid installment count: ${installment}`);
  }
  return count > 1 ? String(count) : '';
}

/** Card expiry as MMYY */
export function formatDenizbankExpiry(month: string, year: string): string {
  const mm = month.padStart(2, '0');
  const yy = year.length === 4 ? year.slice(-2) : year.padStart(2, '0');
  if (!/^\d{2}$/.test(mm) || Number(mm) < 1 || Number(mm) > 12 || !/^\d{2}$/.test(yy)) {
    throw new ValidationError(`Invalid card expiry: ${month}/${year}`);
  }
  return `${mm}${yy}`;
}

/** CardType of the 3D form: "visa", "mastercard" or "amex" ("visa" when unknown) */
export function getDenizbankCardType(cardNumber: string): string {
  if (/^3[47]/.test(cardNumber)) return 'amex';
  if (/^(5[1-5]|2[2-7])/.test(cardNumber)) return 'mastercard';
  return 'visa';
}

/**
 * Parses an InterVPos answer: "Key=Value;;Key=Value;;"
 */
export function parseDenizbankResponse(text: string): Record<string, string> {
  if (!text.includes('ProcReturnCode=')) {
    throw new Error('Denizbank returned an unexpected response');
  }
  const result: Record<string, string> = {};
  for (const pair of text.split(';;')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const key = pair.slice(0, index).replace(/^;+/, '').trim();
    if (key && !(key in result)) result[key] = pair.slice(index + 1).trim();
  }
  return result;
}

/** ProcReturnCode 00 */
export function isDenizbankApproved(fields: Record<string, string | undefined>): boolean {
  return fields.ProcReturnCode === '00';
}
