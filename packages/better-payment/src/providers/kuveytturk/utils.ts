import { toMinorUnits } from '../../core/utils';
import { digest, hmac, toBase64 } from '../../core/crypto';
import { ValidationError } from '../../core/errors';

/**
 * KT Pay Gate endpoints, relative to the provider base URL
 */
export const KUVEYTTURK_ENDPOINTS = {
  PAYMENT: '/KTPay/Payment',
  PROVISION: '/KTPay/Provision',
  SALE_REVERSAL: '/KTPay/SaleReversal',
  GET_TRANSACTION: '/KTPay/GetTransaction',
  GET_TRANSACTIONS: '/KTPay/GetTransactions',
} as const;

export const KUVEYTTURK_SALE_REVERSAL_TYPES = {
  /** Same-day void, before end of day */
  CANCEL: 'Cancel',
  /** Full refund after end of day */
  DRAWBACK: 'Drawback',
  /** Partial refund after end of day */
  PARTIAL_DRAWBACK: 'PartialDrawback',
} as const;

export type KuveytTurkSaleReversalType =
  (typeof KUVEYTTURK_SALE_REVERSAL_TYPES)[keyof typeof KUVEYTTURK_SALE_REVERSAL_TYPES];

/**
 * hashPassword = base64(SHA1(password))
 */
export async function kuveytTurkHashPassword(password: string): Promise<string> {
  return toBase64(await digest('SHA-1', password));
}

/**
 * base64(HMAC-SHA512(data, key)), key being the hashed password
 */
export async function kuveytTurkComputeHash(data: string, key: string): Promise<string> {
  return toBase64(await hmac('SHA-512', key, data));
}

export interface KuveytTurkHashCredentials {
  merchantId: string;
  username: string;
  password: string;
}

async function sign(parts: string[], password: string): Promise<string> {
  const hashPassword = await kuveytTurkHashPassword(password);
  return kuveytTurkComputeHash(parts.join('') + hashPassword, hashPassword);
}

/**
 * Payment (card verification): MerchantId + MerchantOrderId + Amount + SuccessUrl + FailUrl + UserName + hashPassword
 */
export function createKuveytTurkPaymentHash(
  credentials: KuveytTurkHashCredentials,
  fields: { merchantOrderId: string; amount: string; successUrl: string; failUrl: string }
): Promise<string> {
  return sign(
    [
      credentials.merchantId,
      fields.merchantOrderId,
      fields.amount,
      fields.successUrl,
      fields.failUrl,
      credentials.username,
    ],
    credentials.password
  );
}

/**
 * Provision: MerchantId + MerchantOrderId + Amount + UserName + hashPassword
 */
export function createKuveytTurkProvisionHash(
  credentials: KuveytTurkHashCredentials,
  fields: { merchantOrderId: string; amount: string }
): Promise<string> {
  return sign(
    [credentials.merchantId, fields.merchantOrderId, fields.amount, credentials.username],
    credentials.password
  );
}

/**
 * Sale reversal: MerchantId + MerchantOrderId + Amount + UserName + hashPassword.
 * Amount is signed as "0" for Cancel and Drawback; only PartialDrawback signs the amount.
 */
export function createKuveytTurkSaleReversalHash(
  credentials: KuveytTurkHashCredentials,
  fields: { merchantOrderId: string; type: KuveytTurkSaleReversalType; amount?: string }
): Promise<string> {
  const amount =
    fields.type !== KUVEYTTURK_SALE_REVERSAL_TYPES.PARTIAL_DRAWBACK || !fields.amount
      ? '0'
      : fields.amount;
  return sign(
    [credentials.merchantId, fields.merchantOrderId, amount, credentials.username],
    credentials.password
  );
}

/**
 * GetTransaction: MerchantId + UserName + hashPassword
 */
export function createKuveytTurkGetTransactionHash(
  credentials: KuveytTurkHashCredentials
): Promise<string> {
  return sign([credentials.merchantId, credentials.username], credentials.password);
}

/**
 * GetTransactions: MerchantId + MerchantOrderId + UserName + hashPassword
 */
export function createKuveytTurkGetTransactionsHash(
  credentials: KuveytTurkHashCredentials,
  fields: { merchantOrderId: string }
): Promise<string> {
  return sign(
    [credentials.merchantId, fields.merchantOrderId, credentials.username],
    credentials.password
  );
}

/**
 * Amount in minor units without separators: 102.65 TL -> "10265", 1 TL -> "100"
 */
export function formatKuveytTurkAmount(amount: string | number): string {
  return String(toMinorUnits(amount));
}

/**
 * Four-digit currency code: TRY "0949", USD "0840", EUR "0978"
 */
export function getKuveytTurkCurrencyCode(currency: string | undefined): string {
  const map: Record<string, string> = {
    TRY: '0949',
    TL: '0949',
    USD: '0840',
    EUR: '0978',
  };
  const code = map[(currency || 'TRY').toUpperCase()];
  if (!code) {
    throw new ValidationError(`Currency ${currency} is not supported by Kuveyt Türk`);
  }
  return code;
}

/**
 * Card expiry as two-digit month and year ("01", "25")
 */
export function formatKuveytTurkExpiry(
  month: string,
  year: string
): { expireMonth: string; expireYear: string } {
  const mm = month.padStart(2, '0');
  const yy = year.length === 4 ? year.slice(-2) : year.padStart(2, '0');
  if (!/^\d{2}$/.test(mm) || Number(mm) < 1 || Number(mm) > 12 || !/^\d{2}$/.test(yy)) {
    throw new ValidationError(`Invalid card expiry: ${month}/${year}`);
  }
  return { expireMonth: mm, expireYear: yy };
}

/**
 * Installment count, 1 to 12 (1 for single payment)
 */
export function formatKuveytTurkInstallment(installment: number | undefined): number {
  const count = Math.max(1, installment ?? 1);
  if (!Number.isInteger(count) || count > 12) {
    throw new ValidationError(`Kuveyt Türk supports 1 to 12 installments, got ${installment}`);
  }
  return count;
}

/**
 * Language code: TR 1, EN 2
 */
export function getKuveytTurkLanguage(locale: string | undefined): number {
  return (locale || 'tr').toLowerCase().startsWith('en') ? 2 : 1;
}

/**
 * Splits a Turkish GSM number into country code and subscriber number:
 * "+905350000000", "05350000000" or "5350000000" -> { cc: "90", subscriber: "5350000000" }.
 * Other countries' numbers cannot be split reliably and are rejected.
 */
export function parseKuveytTurkPhone(gsmNumber: string): { cc: string; subscriber: string } {
  const digits = (gsmNumber || '').replace(/\D/g, '');
  if (digits.length === 10) return { cc: '90', subscriber: digits };
  if (digits.length === 11 && digits.startsWith('0'))
    return { cc: '90', subscriber: digits.slice(1) };
  if (digits.length === 12 && digits.startsWith('90'))
    return { cc: '90', subscriber: digits.slice(2) };
  throw new ValidationError(
    `Kuveyt Türk needs a Turkish GSM number (+90 5xx xxx xx xx), got: ${gsmNumber}`
  );
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Hidden inputs of the auto-submitting form returned by the Payment endpoint
 */
export function parseKuveytTurkForm(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [tag] of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = tag.match(/\bname\s*=\s*"([^"]*)"/i)?.[1];
    if (!name) continue;
    fields[decodeHtml(name)] = decodeHtml(tag.match(/\bvalue\s*=\s*"([^"]*)"/i)?.[1] ?? '');
  }
  return fields;
}

/**
 * Number in a status label such as "Başarısız (2)"
 */
export function kuveytTurkStatusCode(label: string | undefined): number | undefined {
  const match = label?.match(/\((\d+)\)\s*$/);
  return match ? Number(match[1]) : undefined;
}
