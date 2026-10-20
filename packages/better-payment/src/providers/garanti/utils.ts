import { safeEqual, toMinorUnits } from '../../core/utils';
import { digest, toHex, type DigestAlgorithm } from '../../core/crypto';
import { ValidationError } from '../../core/errors';
import { buildXmlFields, encodeIso88599, unescapeXml, type XmlValue } from '../parampos/utils';

export const GARANTI_API_VERSION = '512';

export const GARANTI_ENDPOINTS = {
  /** XML API (GVPSRequest) */
  API: '/VPServlet',
  /** 3D Secure form target (customer's browser) */
  GATE: '/servlet/gt3dengine',
} as const;

/**
 * Payment models:
 * - `3D`: the bank verifies the card, you provision after the callback
 * - `3D_PAY`: the bank verifies and charges the card
 * - `GARANTI_PAY`: GarantiPay (`secure3dsecuritylevel` CUSTOM_PAY); the customer pays on
 *   Garanti's page with the Garanti BBVA Mobile or BonusFlaş app, without card details
 */
export const GARANTI_SECURITY_LEVELS = ['3D', '3D_PAY', 'GARANTI_PAY'] as const;

export type GarantiSecurityLevel = (typeof GARANTI_SECURITY_LEVELS)[number];

/** Uppercase hex digest over ISO-8859-9 bytes, as Garanti computes it */
async function upperHash(algorithm: DigestAlgorithm, data: string): Promise<string> {
  return toHex(await digest(algorithm, encodeIso88599(data))).toUpperCase();
}

/**
 * SecurityData = SHA1(password + terminal id left-padded to 9 digits)
 */
export function createGarantiSecurityData(password: string, terminalId: string): Promise<string> {
  return upperHash('SHA-1', password + terminalId.padStart(9, '0'));
}

/**
 * HashData of an XML API request:
 * SHA512(OrderID + TerminalID + card number (empty without a card) + Amount + CurrencyCode + SecurityData)
 */
export function createGarantiHashData(fields: {
  orderId: string;
  terminalId: string;
  cardNumber?: string;
  amount: string;
  currencyCode: string;
  securityData: string;
}): Promise<string> {
  return upperHash(
    'SHA-512',
    fields.orderId +
      fields.terminalId +
      (fields.cardNumber ?? '') +
      fields.amount +
      fields.currencyCode +
      fields.securityData
  );
}

/**
 * secure3dhash of the 3D form:
 * SHA512(terminalid + orderid + txnamount + txncurrencycode + successurl + errorurl + txntype
 *        + txninstallmentcount + store key + SecurityData)
 */
export function createGaranti3DHash(fields: {
  terminalId: string;
  orderId: string;
  amount: string;
  currencyCode: string;
  successUrl: string;
  errorUrl: string;
  type: string;
  installment: string;
  storeKey: string;
  securityData: string;
}): Promise<string> {
  return upperHash(
    'SHA-512',
    fields.terminalId +
      fields.orderId +
      fields.amount +
      fields.currencyCode +
      fields.successUrl +
      fields.errorUrl +
      fields.type +
      fields.installment +
      fields.storeKey +
      fields.securityData
  );
}

/**
 * Verifies the 3D callback `hash`. The value is rebuilt from the fields named in
 * `hashparams` (":"-separated), never taken from `hashparamsval`, then hashed
 * with the store key. `hashparams` must cover the order id and mdstatus.
 * SHA-512 (API version 512) and SHA-1 (older terminals) are accepted.
 */
export async function verifyGarantiCallback(
  data: Record<string, string | undefined>,
  storeKey: string
): Promise<boolean> {
  if (!data || !data.hash || !data.hashparams) return false;
  const names = data.hashparams.split(':').filter(Boolean);
  const coversOrder = names.includes('oid') || names.includes('orderid');
  if (!coversOrder || !names.includes('mdstatus')) return false;

  const value = names.map((name) => data[name] ?? '').join('');
  if (data.hashparamsval !== undefined && data.hashparamsval !== value) return false;

  const hash = data.hash.toUpperCase();
  for (const algorithm of ['SHA-512', 'SHA-1'] as const) {
    if (safeEqual(await upperHash(algorithm, value + storeKey), hash)) return true;
  }
  return false;
}

/** Amount in minor units ("100" for 1.00) */
export function formatGarantiAmount(amount: string | number): string {
  return String(toMinorUnits(amount));
}

/** ISO 4217 numeric currency code */
export function getGarantiCurrencyCode(currency: string | undefined): string {
  const map: Record<string, string> = {
    TRY: '949',
    TL: '949',
    USD: '840',
    EUR: '978',
    GBP: '826',
    JPY: '392',
  };
  const code = map[(currency || 'TRY').toUpperCase()];
  if (!code) {
    throw new ValidationError(`Currency ${currency} is not supported by Garanti BBVA`);
  }
  return code;
}

/** Installment count: empty for a single payment */
export function formatGarantiInstallment(installment: number | undefined): string {
  const count = installment ?? 1;
  if (!Number.isInteger(count) || count < 1) {
    throw new ValidationError(`Invalid installment count: ${installment}`);
  }
  return count > 1 ? String(count) : '';
}

/** Expiry as two-digit month and year */
export function formatGarantiExpiry(month: string, year: string): { month: string; year: string } {
  const mm = month.padStart(2, '0');
  const yy = year.length === 4 ? year.slice(-2) : year.padStart(2, '0');
  if (!/^\d{2}$/.test(mm) || Number(mm) < 1 || Number(mm) > 12 || !/^\d{2}$/.test(yy)) {
    throw new ValidationError(`Invalid card expiry: ${month}/${year}`);
  }
  return { month: mm, year: yy };
}

export function buildGarantiXml(fields: Record<string, XmlValue>): string {
  return `<?xml version="1.0" encoding="UTF-8"?><GVPSRequest>${buildXmlFields(fields)}</GVPSRequest>`;
}

/** Content of the first <tag>...</tag>, or '' */
function block(xml: string, tag: string): string {
  const start = xml.indexOf(`<${tag}>`);
  if (start === -1) return '';
  const end = xml.indexOf(`</${tag}>`, start);
  return end === -1 ? '' : xml.slice(start + tag.length + 2, end);
}

function leafFields(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [, tag, value] of xml.matchAll(/<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>([^<]*)<\/\1>/g)) {
    if (!(tag in result)) result[tag] = unescapeXml(value).trim();
  }
  return result;
}

export interface GarantiXmlResponse {
  /** Transaction/Response: Source, Code, ReasonCode, Message, ErrorMsg, SysErrMsg */
  response: Record<string, string>;
  /** Transaction fields: RetrefNum, AuthCode, ProvDate, ... */
  transaction: Record<string, string>;
  /** Order/OrderInqResult of an order inquiry: Status, AuthAmount, ChargeType, ... */
  orderInquiry: Record<string, string>;
}

/**
 * Parses a GVPSResponse. Throws when the body is not one.
 */
export function parseGarantiXmlResponse(xml: string): GarantiXmlResponse {
  if (!xml.includes('<GVPSResponse')) {
    throw new Error('Garanti BBVA returned an unexpected response');
  }
  const transactionXml = block(xml, 'Transaction');
  const responseXml = block(transactionXml, 'Response');
  return {
    response: leafFields(responseXml),
    transaction: leafFields(transactionXml.replace(`<Response>${responseXml}</Response>`, '')),
    orderInquiry: leafFields(block(block(xml, 'Order'), 'OrderInqResult')),
  };
}

/** Response code 00 */
export function isGarantiApproved(response: GarantiXmlResponse): boolean {
  return response.response.Code === '00';
}
