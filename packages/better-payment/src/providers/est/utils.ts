import { formatDecimal, safeEqual } from '../../core/utils';
import { digest, randomHex, toBase64 } from '../../core/crypto';
import { ValidationError } from '../../core/errors';
import { buildXmlFields, unescapeXml, type XmlValue } from '../parampos/utils';

/**
 * Banks on the EST platform. Each is also a provider id (`ProviderType`) whose
 * default URLs are in `PROVIDER_DEFAULT_URLS`.
 */
export type EstBank =
  | 'isbank'
  | 'ziraat'
  | 'halkbank'
  | 'teb'
  | 'sekerbank'
  | 'akbankest'
  | 'halkbankmkd';

export const EST_ENDPOINTS = {
  /** 3D Secure form target (customer's browser) */
  GATE: '/fim/est3Dgate',
  /** XML API (CC5Request) */
  API: '/fim/api',
} as const;

/**
 * 3D models (`storetype`):
 * - `3d`: the bank verifies the card, you charge it with the XML API after the callback
 * - `3d_pay`: the bank verifies and charges the card
 * - `3d_pay_hosting` / `3d_host`: like 3d_pay, on the bank's hosted card page
 */
export const EST_STORE_TYPES = ['3d', '3d_pay', '3d_pay_hosting', '3d_host'] as const;

export type EstStoreType = (typeof EST_STORE_TYPES)[number];

/** Store types where the bank collects the card on its own page */
export function isEstHostedStoreType(storeType: EstStoreType): boolean {
  return storeType === '3d_pay_hosting' || storeType === '3d_host';
}

/**
 * Store types where the bank only authenticates the card and the merchant
 * charges it with XML `Auth` (using `md`). With 3d_pay / 3d_pay_hosting the
 * bank charges the card itself.
 */
export function isEstMerchantChargedStoreType(storeType: EstStoreType): boolean {
  return storeType === '3d' || storeType === '3d_host';
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

/**
 * Case-insensitive natural order: digit runs compare by value ("a2" < "a10")
 */
export function compareEstKeys(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (isDigit(x[i]) && isDigit(y[j])) {
      let endI = i;
      let endJ = j;
      while (endI < x.length && isDigit(x[endI])) endI++;
      while (endJ < y.length && isDigit(y[endJ])) endJ++;
      const diff = Number(x.slice(i, endI)) - Number(y.slice(j, endJ));
      if (diff !== 0) return diff;
      i = endI;
      j = endJ;
      continue;
    }
    if (x[i] !== y[j]) return x[i] < y[j] ? -1 : 1;
    i++;
    j++;
  }
  return x.length - i - (y.length - j);
}

/** Fields never covered by the hash */
const UNHASHED_FIELDS = new Set(['hash', 'encoding', 'countdown', 'nationalidno']);

function escapeHashValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/**
 * Hash version 3: base64(SHA-512(values sorted by field name, then the store key,
 * each with "\" and "|" escaped, joined with "|"))
 */
export async function createEstHash(
  fields: Record<string, string | undefined>,
  storeKey: string
): Promise<string> {
  const values = Object.keys(fields)
    .filter((key) => !UNHASHED_FIELDS.has(key.toLowerCase()))
    .sort(compareEstKeys)
    .map((key) => escapeHashValue(fields[key] ?? ''));
  values.push(escapeHashValue(storeKey));
  return toBase64(await digest('SHA-512', values.join('|')));
}

/**
 * Verifies the HASH of a 3D callback over all returned fields
 */
export async function verifyEstCallback(
  data: Record<string, string | undefined>,
  storeKey: string
): Promise<boolean> {
  if (!data || typeof data.HASH !== 'string' || !data.HASH) return false;
  return safeEqual(await createEstHash(data, storeKey), data.HASH);
}

/** Random value for `rnd` */
export function generateEstRandom(): string {
  return randomHex(16);
}

/** Amount with 2 decimals ("1.10") */
export function formatEstAmount(amount: string | number): string {
  return formatDecimal(amount);
}

/** ISO 4217 numeric currency code */
export function getEstCurrencyCode(currency: string | undefined): string {
  const map: Record<string, string> = {
    TRY: '949',
    TL: '949',
    USD: '840',
    EUR: '978',
    GBP: '826',
    // Macedonian denar, for Halkbank Macedonia
    MKD: '807',
  };
  const code = map[(currency || 'TRY').toUpperCase()];
  if (!code) {
    throw new ValidationError(`Currency ${currency} is not supported by EST`);
  }
  return code;
}

/** `taksit`: empty for a single payment */
export function formatEstInstallment(installment: number | undefined): string {
  const count = installment ?? 1;
  if (!Number.isInteger(count) || count < 1) {
    throw new ValidationError(`Invalid installment count: ${installment}`);
  }
  return count > 1 ? String(count) : '';
}

/** Expiry as two-digit month and year */
export function formatEstExpiry(month: string, year: string): { month: string; year: string } {
  const mm = month.padStart(2, '0');
  const yy = year.length === 4 ? year.slice(-2) : year.padStart(2, '0');
  if (!/^\d{2}$/.test(mm) || Number(mm) < 1 || Number(mm) > 12 || !/^\d{2}$/.test(yy)) {
    throw new ValidationError(`Invalid card expiry: ${month}/${year}`);
  }
  return { month: mm, year: yy };
}

/** `cardType` of the 3D form, from the card number */
export function estCardType(cardNumber: string): string {
  if (/^3[47]/.test(cardNumber)) return 'amex';
  if (/^(5[1-5]|2[2-7])/.test(cardNumber)) return 'mastercard';
  return 'visa';
}

/**
 * CC5Request XML. Characters outside ASCII are sent as character references,
 * so the body is valid whatever the declared encoding.
 */
export function buildEstXml(fields: Record<string, XmlValue>): string {
  const body = buildXmlFields(fields).replace(
    /[^\x20-\x7e]/gu,
    (char) => `&#${char.codePointAt(0)};`
  );
  return `<?xml version="1.0" encoding="ISO-8859-9"?><CC5Request>${body}</CC5Request>`;
}

export interface EstXmlResponse {
  /** Top-level fields of CC5Response (OrderId, ProcReturnCode, Response, ErrMsg, ...) */
  fields: Record<string, string>;
  /** Fields inside <Extra> */
  extra: Record<string, string>;
}

function leafFields(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [, tag, value] of xml.matchAll(/<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>([^<]*)<\/\1>/g)) {
    if (!(tag in result)) result[tag] = unescapeXml(value).trim();
  }
  for (const [, tag] of xml.matchAll(/<([A-Za-z_][\w.-]*)\s*\/>/g)) {
    if (!(tag in result)) result[tag] = '';
  }
  return result;
}

/**
 * Parses a CC5Response. Throws when the body is not one.
 */
export function parseEstXmlResponse(xml: string): EstXmlResponse {
  const start = xml.indexOf('<CC5Response');
  const end = xml.lastIndexOf('</CC5Response>');
  if (start === -1 || end === -1) {
    throw new Error('EST returned an unexpected response');
  }
  let content = xml.slice(start, end);
  let extra: Record<string, string> = {};
  const extraStart = content.indexOf('<Extra>');
  const extraEnd = content.indexOf('</Extra>');
  if (extraStart !== -1 && extraEnd > extraStart) {
    extra = leafFields(content.slice(extraStart + '<Extra>'.length, extraEnd));
    content = content.slice(0, extraStart) + content.slice(extraEnd + '</Extra>'.length);
  }
  return { fields: leafFields(content), extra };
}

/** ProcReturnCode 00 with Response "Approved" */
export function isEstApproved(fields: Record<string, string | undefined>): boolean {
  return fields.ProcReturnCode === '00' && fields.Response === 'Approved';
}
