import { formatDecimal } from '../../core/utils';
import { ValidationError } from '../../core/errors';
import { buildXmlFields, unescapeXml, type XmlValue } from '../parampos/utils';

export const VAKIFBANK_ENDPOINTS = {
  /** VPOS 7/24 (POX request), relative to the provider base URL */
  VPOS: '/VposService/v3/Vposreq.aspx',
  /** Record search, relative to the provider base URL */
  SEARCH: '/UIService/Search.aspx',
} as const;

/** MPI enrollment (3D Secure) service */
export const VAKIFBANK_MPI_URLS = {
  test: 'https://3dsecuretest.vakifbank.com.tr:4443/MPIAPI/MPI_Enrollment.aspx',
  production: 'https://3dsecure.vakifbank.com.tr:4443/MPIAPI/MPI_Enrollment.aspx',
};

export const VAKIFBANK_SUCCESS_CODE = '0000';

/** Amount with 2 decimals ("1.20") */
export function formatVakifBankAmount(amount: string | number): string {
  return formatDecimal(amount);
}

/** ISO 4217 numeric currency code */
export function getVakifBankCurrencyCode(currency: string | undefined): string {
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
    throw new ValidationError(`Currency ${currency} is not supported by VakıfBank`);
  }
  return code;
}

/** Installment count, sent only for 2 or more */
export function formatVakifBankInstallment(installment: number | undefined): number | undefined {
  const count = installment ?? 1;
  if (!Number.isInteger(count) || count < 1) {
    throw new ValidationError(`Invalid installment count: ${installment}`);
  }
  return count > 1 ? count : undefined;
}

function expiryParts(month: string, year: string): { mm: string; yyyy: string } {
  const mm = month.padStart(2, '0');
  const yyyy = year.length === 2 ? `20${year}` : year;
  if (!/^\d{2}$/.test(mm) || Number(mm) < 1 || Number(mm) > 12 || !/^\d{4}$/.test(yyyy)) {
    throw new ValidationError(`Invalid card expiry: ${month}/${year}`);
  }
  return { mm, yyyy };
}

/** Expiry for the MPI enrollment: YYMM */
export function formatVakifBankMpiExpiry(month: string, year: string): string {
  const { mm, yyyy } = expiryParts(month, year);
  return `${yyyy.slice(-2)}${mm}`;
}

/** Expiry for VPOS: YYYYMM */
export function formatVakifBankVposExpiry(month: string, year: string): string {
  const { mm, yyyy } = expiryParts(month, year);
  return `${yyyy}${mm}`;
}

/** BrandName: 100 Visa, 200 Mastercard, 300 Troy, 400 Amex */
export function getVakifBankBrandName(cardNumber: string): string {
  if (/^3[47]/.test(cardNumber)) return '400';
  if (/^(9792|65)/.test(cardNumber)) return '300';
  if (/^(5[1-5]|2[2-7])/.test(cardNumber)) return '200';
  return '100';
}

/**
 * Order ids double as the MPI VerifyEnrollmentRequestId and the VPOS
 * TransactionId: at most 40 letters, digits, "-" or "_"
 */
export function validateVakifBankOrderId(orderId: string): string {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(orderId)) {
    throw new ValidationError(
      `VakıfBank order ids must be 1 to 40 letters, digits, "-" or "_", got: ${orderId}`
    );
  }
  return orderId;
}

/** Root-wrapped XML, form-encoded as `prmstr` */
export function buildVakifBankRequestBody(root: string, fields: Record<string, XmlValue>): string {
  const xml = `<?xml version="1.0" encoding="utf-8"?><${root}>${buildXmlFields(fields)}</${root}>`;
  return `prmstr=${encodeURIComponent(xml)}`;
}

function leafFields(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [, tag, value] of xml.matchAll(/<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>([^<]*)<\/\1>/g)) {
    if (!(tag in result)) result[tag] = unescapeXml(value).trim();
  }
  return result;
}

/**
 * Fields of an XML answer (VposResponse, IPaySecure, SearchResponse). Throws
 * when the body is not the expected root element.
 */
export function parseVakifBankXml(xml: string, root: string): Record<string, string> {
  if (!xml.includes(`<${root}`)) {
    throw new Error('VakıfBank returned an unexpected response');
  }
  return leafFields(xml);
}

/** Each <TransactionSearchResultInfo> record of a search answer */
export function parseVakifBankSearchRecords(xml: string): Record<string, string>[] {
  const records: Record<string, string>[] = [];
  const open = '<TransactionSearchResultInfo>';
  const close = '</TransactionSearchResultInfo>';
  let index = xml.indexOf(open);
  while (index !== -1) {
    const next = xml.indexOf(open, index + open.length);
    const end = xml.indexOf(close, index + open.length);
    // The list and its records share the element name; a record holds no nested one
    if (end !== -1 && (next === -1 || end < next)) {
      const record = leafFields(xml.slice(index + open.length, end));
      if (record.TransactionId || record.ResultCode) records.push(record);
    }
    index = next;
  }
  return records;
}
