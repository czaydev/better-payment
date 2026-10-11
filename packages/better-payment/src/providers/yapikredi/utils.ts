import { toMinorUnits } from '../../core/utils';
import { digest, toBase64 } from '../../core/crypto';
import { ValidationError } from '../../core/errors';
import { buildXmlFields, unescapeXml, type XmlValue } from '../parampos/utils';

export const YAPIKREDI_ENDPOINTS = {
  /** XML API (posnetRequest), posted as the `xmldata` form field */
  API: '/PosnetWebService/XML',
  /** 3D Secure form target (customer's browser) */
  GATE: '/3DSWebService/YKBPaymentService',
} as const;

/** Amount in minor units ("120" for 1.20) */
export function formatYapiKrediAmount(amount: string | number): string {
  return String(toMinorUnits(amount));
}

/** Posnet currency codes (the guides list TL, US and EU) */
export function getYapiKrediCurrencyCode(currency: string | undefined): string {
  const map: Record<string, string> = { TRY: 'TL', TL: 'TL', USD: 'US', EUR: 'EU' };
  const code = map[(currency || 'TRY').toUpperCase()];
  if (!code) {
    throw new ValidationError(`Currency ${currency} is not supported by Yapı Kredi`);
  }
  return code;
}

/** Installment count as two digits, "00" for a single payment */
export function formatYapiKrediInstallment(installment: number | undefined): string {
  const count = installment ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 99) {
    throw new ValidationError(`Invalid installment count: ${installment}`);
  }
  return count > 1 ? String(count).padStart(2, '0') : '00';
}

/** Card expiry as YYMM */
export function formatYapiKrediExpiry(month: string, year: string): string {
  const mm = month.padStart(2, '0');
  const yy = year.length === 4 ? year.slice(-2) : year.padStart(2, '0');
  if (!/^\d{2}$/.test(mm) || Number(mm) < 1 || Number(mm) > 12 || !/^\d{2}$/.test(yy)) {
    throw new ValidationError(`Invalid card expiry: ${month}/${year}`);
  }
  return `${yy}${mm}`;
}

function padOrderId(orderId: string, length: number): string {
  if (!new RegExp(`^[A-Za-z0-9_]{1,${length}}$`).test(orderId)) {
    throw new ValidationError(
      `Yapı Kredi order ids must be 1 to ${length} letters, digits or "_", got: ${orderId}`
    );
  }
  return orderId.padStart(length, '0');
}

/** Order id as the 20-character XID of a 3D Secure payment, left-padded with zeros */
export function toYapiKrediXid(orderId: string): string {
  return padOrderId(orderId, 20);
}

/** Order id of a non-3D sale: 24 characters, left-padded with zeros */
export function toYapiKrediOrderId(orderId: string): string {
  return padOrderId(orderId, 24);
}

/** The order id the order inquiry knows a 3D Secure payment by: "TDS_" + XID */
export function toYapiKrediThreeDSOrderId(orderId: string): string {
  return `TDS_${toYapiKrediXid(orderId)}`;
}

async function sha256Base64(data: string): Promise<string> {
  return toBase64(await digest('SHA-256', data));
}

/**
 * The bank's MAC on its answers, which the 3D guide recommends checking:
 * base64(SHA256(first;xid;amount;currency;merchantId;base64(SHA256(encKey;terminalId)))),
 * where `first` is mdStatus (resolve answer) or hostlogkey (charge answer)
 */
export async function createYapiKrediResponseMac(fields: {
  first: string;
  xid: string;
  amount: string;
  currency: string;
  merchantId: string;
  terminalId: string;
  encKey: string;
}): Promise<string> {
  const firstHash = await sha256Base64(`${fields.encKey};${fields.terminalId}`);
  return sha256Base64(
    [fields.first, fields.xid, fields.amount, fields.currency, fields.merchantId, firstHash].join(
      ';'
    )
  );
}

/**
 * MAC of the 3D resolve and transaction requests:
 * base64(SHA256(XID;amount;currency;merchantId;base64(SHA256(encKey;terminalId))))
 */
export async function createYapiKrediMac(fields: {
  xid: string;
  amount: string;
  currency: string;
  merchantId: string;
  terminalId: string;
  encKey: string;
}): Promise<string> {
  const firstHash = await sha256Base64(`${fields.encKey};${fields.terminalId}`);
  return sha256Base64(
    [fields.xid, fields.amount, fields.currency, fields.merchantId, firstHash].join(';')
  );
}

/**
 * posnetRequest XML, sent form-encoded as `xmldata`
 */
export function buildYapiKrediRequestBody(fields: Record<string, XmlValue>): string {
  const xml = `<?xml version="1.0" encoding="ISO-8859-9"?><posnetRequest>${buildXmlFields(
    fields
  ).replace(/[^\x20-\x7e]/gu, (char) => `&#${char.codePointAt(0)};`)}</posnetRequest>`;
  return `xmldata=${encodeURIComponent(xml)}`;
}

function leafFields(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [, tag, value] of xml.matchAll(/<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>([^<]*)<\/\1>/g)) {
    if (!(tag in result)) result[tag] = unescapeXml(value).trim();
  }
  return result;
}

function block(xml: string, tag: string): string {
  const start = xml.indexOf(`<${tag}>`);
  if (start === -1) return '';
  const end = xml.indexOf(`</${tag}>`, start);
  return end === -1 ? '' : xml.slice(start + tag.length + 2, end);
}

export interface YapiKrediXmlResponse {
  /** Top-level fields: approved, respCode, respText, hostlogkey, authCode, mac, ... */
  fields: Record<string, string>;
  /** agreement (order inquiry): transactions/transaction */
  transactions: Record<string, string>[];
  /** oosRequestDataResponse: data1, data2, sign */
  oosRequestData: Record<string, string>;
  /** oosResolveMerchantDataResponse: xid, amount, currency, installment, mdStatus, ... */
  oosResolveMerchantData: Record<string, string>;
}

/**
 * Parses a posnetResponse. Throws when the body is not one.
 */
export function parseYapiKrediXmlResponse(body: string): YapiKrediXmlResponse {
  // The order inquiry declares utf-16; read as text, its ASCII comes with NULs
  const xml = body.split('\u0000').join('');
  if (!xml.includes('<posnetResponse')) {
    throw new Error('Yapı Kredi returned an unexpected response');
  }
  const request = block(xml, 'oosRequestDataResponse');
  const resolve = block(xml, 'oosResolveMerchantDataResponse');
  const list = block(xml, 'transactions');
  const top = xml
    .replace(`<oosRequestDataResponse>${request}</oosRequestDataResponse>`, '')
    .replace(`<oosResolveMerchantDataResponse>${resolve}</oosResolveMerchantDataResponse>`, '')
    .replace(`<transactions>${list}</transactions>`, '');
  return {
    fields: leafFields(top),
    transactions: [...list.matchAll(/<transaction>([\s\S]*?)<\/transaction>/g)].map((m) =>
      leafFields(m[1])
    ),
    oosRequestData: leafFields(request),
    oosResolveMerchantData: leafFields(resolve),
  };
}

/** approved = 1 */
export function isYapiKrediApproved(response: YapiKrediXmlResponse): boolean {
  return response.fields.approved === '1';
}
