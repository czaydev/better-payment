/**
 * Parampos Utility Functions
 *
 * Hash generation, verification, formatting and SOAP helpers for the Param (TurkPOS) API
 */

import { safeEqual, formatDecimal } from '../../core/utils';
import { digest, toBase64 } from '../../core/crypto';
import { ValidationError } from '../../core/errors';

export const PARAMPOS_NAMESPACE = 'https://turkpos.com.tr/';

/**
 * The card storage (KS) service is a separate ASMX endpoint with its own
 * namespace. Its methods take no hash: only the G credentials and the GUID.
 */
export const PARAMPOS_KS_NAMESPACE = 'https://turkpara.com.tr/';

/** Card storage (Kart Saklama) service endpoints, as published by Param's SDK */
export const PARAMPOS_KS_URLS = {
  sandbox: 'https://testposws.param.com.tr/out.ws/service_ks.asmx',
  production: 'https://posws.param.com.tr/out.ws/service_ks.asmx',
} as const;

/** KS endpoint for a payment base URL; the test service has "test" in its host */
export function defaultParamposKsUrl(baseUrl: string | undefined): string {
  return baseUrl && /test/i.test(baseUrl) ? PARAMPOS_KS_URLS.sandbox : PARAMPOS_KS_URLS.production;
}

/**
 * Encodes a string as ISO-8859-9 (Turkish), the encoding Param uses for hash input.
 * Characters outside the charset are replaced with '?'.
 */
export function encodeIso88599(value: string): Uint8Array {
  const turkish: Record<string, number> = {
    Ğ: 0xd0,
    İ: 0xdd,
    Ş: 0xde,
    ğ: 0xf0,
    ı: 0xfd,
    ş: 0xfe,
  };
  const bytes: number[] = [];
  for (const char of value) {
    if (char in turkish) {
      bytes.push(turkish[char]);
      continue;
    }
    const code = char.codePointAt(0) ?? 0x3f;
    bytes.push(code < 0x100 ? code : 0x3f);
  }
  return Uint8Array.from(bytes);
}

/**
 * Islem_Hash for TP_WMD_UCD (TRY payments)
 *
 * Formula: base64(sha1(CLIENT_CODE + GUID + Taksit + Islem_Tutar + Toplam_Tutar + Siparis_ID))
 * Amounts must be in the same comma-decimal format sent in the request.
 */
export async function generateParamposPaymentHash(
  clientCode: string,
  guid: string,
  installment: number | string,
  transactionAmount: string,
  totalAmount: string,
  orderId: string
): Promise<string> {
  const hashString = `${clientCode}${guid}${installment}${transactionAmount}${totalAmount}${orderId}`;
  return toBase64(await digest('SHA-1', encodeIso88599(hashString)));
}

/**
 * Expected islemHash for the 3D callback
 *
 * Formula: base64(sha1(islemGUID + md + mdStatus + orderId + GUID))
 */
/**
 * Islem_Hash of a pre-authorization (TP_Islem_Odeme_OnProv_WMD):
 * base64(sha1(ISO-8859-9(CLIENT_CODE + GUID + Islem_Tutar + Toplam_Tutar +
 * Siparis_ID + Hata_URL + Basarili_URL))). Unlike a sale, the installment is
 * not part of it; the URLs are empty for non-3D pre-authorizations.
 */
export async function generateParamposPreAuthHash(
  clientCode: string,
  guid: string,
  transactionAmount: string,
  totalAmount: string,
  orderId: string,
  failUrl = '',
  successUrl = ''
): Promise<string> {
  const hashString = `${clientCode}${guid}${transactionAmount}${totalAmount}${orderId}${failUrl}${successUrl}`;
  return toBase64(await digest('SHA-1', encodeIso88599(hashString)));
}

export async function generateParampos3DSVerificationHash(
  islemGuid: string,
  md: string,
  mdStatus: string,
  orderId: string,
  guid: string
): Promise<string> {
  const hashString = `${islemGuid}${md}${mdStatus}${orderId}${guid}`;
  return toBase64(await digest('SHA-1', hashString));
}

/**
 * Verifies the 3D callback hash. `guid` MUST come from the merchant configuration,
 * never from the callback payload: the GUID is the only secret in the formula.
 */
export async function verifyParampos3DSCallback(
  callback: {
    islemGUID?: string;
    md?: string;
    mdStatus?: string;
    orderId?: string;
    islemHash?: string;
  },
  guid: string
): Promise<boolean> {
  const { islemGUID, md, mdStatus, orderId, islemHash } = callback;
  if (!islemGUID || !md || mdStatus === undefined || !orderId || !islemHash) {
    return false;
  }
  const expected = await generateParampos3DSVerificationHash(
    islemGUID,
    md,
    mdStatus,
    orderId,
    guid
  );
  return safeEqual(expected, islemHash);
}

/**
 * Payment amount format: 2 decimals, comma separator ("1000,50")
 */
export function formatParamposAmount(amount: string | number): string {
  return formatDecimal(amount, ',');
}

/**
 * Refund/cancel amount format (Tutar): 2 decimals, dot separator ("1000.50")
 */
export function formatParamposRefundAmount(amount: string | number): string {
  return formatDecimal(amount);
}

/**
 * Converts a Param amount ("1000,50" or "1000.50") to a number
 */
export function parseParamposAmount(amount: string | undefined): number | undefined {
  if (amount === undefined || amount === '') return undefined;
  const value = Number(amount.replace(',', '.'));
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Card expiry month (MM)
 */
export function formatParamposExpiryMonth(month: string | number): string {
  const monthStr = month.toString().padStart(2, '0');
  const monthNum = parseInt(monthStr, 10);
  if (!/^\d{2}$/.test(monthStr) || monthNum < 1 || monthNum > 12) {
    throw new ValidationError(`Invalid month: ${month}`);
  }
  return monthStr;
}

/**
 * Card expiry year (YYYY). Two-digit years are interpreted as 20YY.
 */
export function formatParamposExpiryYear(year: string | number): string {
  const yearStr = year.toString();
  if (/^\d{2}$/.test(yearStr)) {
    return `20${yearStr}`;
  }
  if (/^\d{4}$/.test(yearStr)) {
    return yearStr;
  }
  throw new ValidationError(`Invalid year format: ${year}`);
}

/**
 * KK_Sahibi_GSM: 10 digits, without country code or leading zero (5321234567)
 */
export function formatParamposGsm(gsm: string | undefined): string {
  if (!gsm) return '';
  const digits = gsm.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Escape XML special characters
 */
export function escapeXml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Decode XML entities (named and numeric)
 */
export function unescapeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export type XmlValue = string | number | undefined | null | { [key: string]: XmlValue };

/**
 * Serializes an ordered record into XML elements. Values are escaped.
 */
export function buildXmlFields(fields: Record<string, XmlValue>): string {
  return Object.entries(fields)
    .map(([key, value]) => {
      if (value !== null && typeof value === 'object') {
        return `<${key}>${buildXmlFields(value)}</${key}>`;
      }
      return `<${key}>${escapeXml(value)}</${key}>`;
    })
    .join('');
}

/**
 * Build SOAP envelope for a Parampos API request
 */
export function buildParamposSoapEnvelope(
  soapAction: string,
  fields: Record<string, XmlValue>,
  namespace = PARAMPOS_NAMESPACE
): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
    'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    '<soap:Body>' +
    `<${soapAction} xmlns="${namespace}">${buildXmlFields(fields)}</${soapAction}>` +
    '</soap:Body>' +
    '</soap:Envelope>'
  );
}

/**
 * The 3D form of KS_Tahsilat comes HTML-encoded in `UCD_URL`
 * (Param's sample decodes it before rendering).
 */
export function decodeParamposHtml(html: string): string {
  return unescapeXml(html.replace(/&nbsp;/gi, ' '));
}

/**
 * Content of DT_Bilgi, XML-unescaped when the service returns the DataSet as an
 * escaped string instead of inline XML. Row parsing works on either form.
 */
export function extractParamposDataSetXml(soapXml: string): string {
  const match = soapXml.match(/<DT_Bilgi(?:\s[^>]*)?>([\s\S]*?)<\/DT_Bilgi>/i);
  if (!match) return soapXml;
  return match[1].includes('&lt;') ? unescapeXml(match[1]) : match[1];
}

/**
 * Extracts the `<resultTagName>` element from a SOAP response and flattens all
 * leaf elements (including nested ones such as DT_Bilgi) into a record.
 * The first occurrence of a tag wins. Values are XML-unescaped.
 *
 * Throws on SOAP faults or when the result element is missing.
 */
export function parseParamposSoapResponse<T = Record<string, string>>(
  soapXml: string,
  resultTagName: string
): T {
  const fault = soapXml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
  if (fault) {
    throw new Error(`Parampos SOAP fault: ${unescapeXml(fault[1]).trim()}`);
  }

  const resultRegex = new RegExp(
    `<${resultTagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${resultTagName}>`,
    'i'
  );
  const resultMatch = soapXml.match(resultRegex);

  if (!resultMatch) {
    const selfClosing = new RegExp(`<${resultTagName}(?:\\s[^>]*)?/>`, 'i');
    if (selfClosing.test(soapXml)) return {} as T;
    throw new Error(`Could not find ${resultTagName} in SOAP response`);
  }

  const result: Record<string, string> = {};
  const content = resultMatch[1];

  const leafRegex = /<([\w:.-]+)(?:\s[^>]*)?>([^<]*)<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = leafRegex.exec(content)) !== null) {
    const [, rawTag, value] = match;
    const tag = rawTag.includes(':') ? rawTag.split(':').pop()! : rawTag;
    if (!(tag in result)) {
      result[tag] = unescapeXml(value);
    }
  }

  const emptyRegex = /<([\w:.-]+)(?:\s[^>]*)?\/>/g;
  while ((match = emptyRegex.exec(content)) !== null) {
    const tag = match[1].includes(':') ? match[1].split(':').pop()! : match[1];
    if (!(tag in result)) {
      result[tag] = '';
    }
  }

  return result as T;
}

/**
 * Param returns numeric result codes as strings; > 0 means success.
 */
export function isParamposSuccess(code: string | undefined): boolean {
  if (code === undefined) return false;
  const n = Number(code);
  return Number.isFinite(n) && n > 0;
}

/**
 * Validate Turkish identity number (TC Kimlik No)
 */
export function validateTurkishIdentityNumber(identityNumber: string): boolean {
  if (!/^\d{11}$/.test(identityNumber)) {
    return false;
  }

  const digits = identityNumber.split('').map(Number);

  if (digits[0] === 0) {
    return false;
  }

  const sum1 = (digits[0] + digits[2] + digits[4] + digits[6] + digits[8]) * 7;
  const sum2 = digits[1] + digits[3] + digits[5] + digits[7];
  const tenth = (((sum1 - sum2) % 10) + 10) % 10;

  if (tenth !== digits[9]) {
    return false;
  }

  const sum3 = digits.slice(0, 10).reduce((a, b) => a + b, 0);
  return sum3 % 10 === digits[10];
}

/**
 * Mask card number for display
 */
export function maskCardNumber(cardNumber: string): string {
  if (cardNumber.length < 10) {
    return cardNumber;
  }

  const first4 = cardNumber.slice(0, 4);
  const last4 = cardNumber.slice(-4);
  const masked = '*'.repeat(cardNumber.length - 8);

  return `${first4}${masked}${last4}`;
}

/**
 * Rows of a .NET DataSet in a SOAP response (`<RowTag diffgr:id=...>...</RowTag>`),
 * each as a flat record of its child elements.
 */
export function parseParamposDataSetRows(
  soapXml: string,
  rowTag: string
): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const rowRegex = new RegExp(`<${rowTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${rowTag}>`, 'gi');
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(soapXml)) !== null) {
    const row: Record<string, string> = {};
    const leafRegex = /<([\w:.-]+)(?:\s[^>]*)?>([^<]*)<\/\1>/g;
    let leaf: RegExpExecArray | null;
    while ((leaf = leafRegex.exec(rowMatch[1])) !== null) {
      const tag = leaf[1].includes(':') ? leaf[1].split(':').pop()! : leaf[1];
      row[tag] = unescapeXml(leaf[2]).trim();
    }
    rows.push(row);
  }
  return rows;
}

/** Highest installment count Param reports rates for (MO_01..MO_12) */
export const PARAMPOS_MAX_INSTALLMENTS = 12;

/**
 * Commission rates of a Param rate row, by installment count. Param marks an
 * unavailable installment with a negative rate (-1 / -2); those are omitted.
 */
export function paramposRatesOf(row: Record<string, string>): Map<number, number> {
  const rates = new Map<number, number>();
  for (let i = 1; i <= PARAMPOS_MAX_INSTALLMENTS; i++) {
    const raw = row[`MO_${String(i).padStart(2, '0')}`];
    if (raw === undefined || raw === '') continue;
    const rate = Number(raw.replace(',', '.'));
    if (Number.isFinite(rate) && rate >= 0) rates.set(i, rate);
  }
  return rates;
}

/**
 * Param's total: Toplam_Tutar = Islem_Tutar + Islem_Tutar × rate / 100,
 * rounded half up to kuruş. Computed in integers to avoid float drift.
 *
 * @returns the total in minor units (kuruş)
 */
export function calculateParamposTotalMinor(priceMinor: number, ratePercent: number): number {
  // rate with 4 decimals, as Param returns it (e.g. 1.7500)
  const rateScaled = BigInt(Math.round(ratePercent * 10000));
  // price × (100% + rate), scaled by 10^6; BigInt keeps large amounts exact
  const numerator = BigInt(priceMinor) * (1_000_000n + rateScaled);
  return Number((numerator + 500_000n) / 1_000_000n);
}
