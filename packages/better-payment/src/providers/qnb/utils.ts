import { formatDecimal, safeEqual } from '../../core/utils';
import { digest, toBase64 } from '../../core/crypto';
import { ValidationError } from '../../core/errors';
import { buildXmlFields, unescapeXml, type XmlValue } from '../parampos/utils';

export const QNB_ENDPOINTS = {
  /** 3D Secure form target (customer's browser) */
  GATE: '/Gateway/Default.aspx',
  /** XML API (PayforRequest) */
  API: '/Gateway/XmlGate.aspx',
} as const;

/** Institution code of QNB on the PayFor platform */
export const QNB_MBR_ID = '5';

/**
 * 3D models (`SecureType`):
 * - `3DModel`: the bank verifies the card, you charge it with `3DModelPayment`
 * - `3DPay`: the bank verifies and charges the card
 */
export const QNB_SECURE_TYPES = ['3DModel', '3DPay'] as const;

export type QnbSecureType = (typeof QNB_SECURE_TYPES)[number];

async function sha1Base64(data: string): Promise<string> {
  return toBase64(await digest('SHA-1', data));
}

/**
 * Hash of the 3D form:
 * base64(SHA1(MbrId + OrderId + PurchAmount + OkUrl + FailUrl + TxnType + InstallmentCount + Rnd + MerchantPass))
 */
export function createQnb3DHash(fields: {
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
    QNB_MBR_ID +
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
 * Verifies the ResponseHash of a 3D callback:
 * base64(SHA1(MerchantID + MerchantPass + OrderId + AuthCode + ProcReturnCode + 3DStatus + ResponseRnd + UserCode)),
 * with the merchant id and user code taken from your configuration
 */
export async function verifyQnbCallback(
  data: Record<string, string | undefined>,
  credentials: { merchantId: string; merchantPass: string; userCode: string }
): Promise<boolean> {
  if (!data || !data.ResponseHash || !data.ResponseRnd || !data.OrderId) return false;
  const expected = await sha1Base64(
    credentials.merchantId +
      credentials.merchantPass +
      data.OrderId +
      (data.AuthCode ?? '') +
      (data.ProcReturnCode ?? '') +
      (data['3DStatus'] ?? '') +
      data.ResponseRnd +
      credentials.userCode
  );
  return safeEqual(expected, data.ResponseHash);
}

/** Amount with 2 decimals ("1.20") */
export function formatQnbAmount(amount: string | number): string {
  return formatDecimal(amount);
}

/** ISO 4217 numeric currency code */
export function getQnbCurrencyCode(currency: string | undefined): string {
  const map: Record<string, string> = { TRY: '949', TL: '949', USD: '840', EUR: '978' };
  const code = map[(currency || 'TRY').toUpperCase()];
  if (!code) {
    throw new ValidationError(`Currency ${currency} is not supported by QNB`);
  }
  return code;
}

/** InstallmentCount: "0" for a single payment */
export function formatQnbInstallment(installment: number | undefined): string {
  const count = installment ?? 1;
  if (!Number.isInteger(count) || count < 1) {
    throw new ValidationError(`Invalid installment count: ${installment}`);
  }
  return count > 1 ? String(count) : '0';
}

/** Card expiry as MMYY */
export function formatQnbExpiry(month: string, year: string): string {
  const mm = month.padStart(2, '0');
  const yy = year.length === 4 ? year.slice(-2) : year.padStart(2, '0');
  if (!/^\d{2}$/.test(mm) || Number(mm) < 1 || Number(mm) > 12 || !/^\d{2}$/.test(yy)) {
    throw new ValidationError(`Invalid card expiry: ${month}/${year}`);
  }
  return `${mm}${yy}`;
}

/** Order ids: letters, digits, "-" or "_" (Turkish characters are rejected by the bank) */
export function validateQnbOrderId(orderId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(orderId)) {
    throw new ValidationError(
      `QNB order ids must be 1 to 64 letters, digits, "-" or "_", got: ${orderId}`
    );
  }
  return orderId;
}

export function buildQnbXml(fields: Record<string, XmlValue>): string {
  return `<?xml version="1.0" encoding="utf-8"?><PayforRequest>${buildXmlFields(fields)}</PayforRequest>`;
}

/**
 * Fields of a PayforResponse; empty elements become ''. Throws when the body
 * is not one.
 */
export function parseQnbXmlResponse(xml: string): Record<string, string> {
  if (!xml.includes('<PayforResponse')) {
    throw new Error('QNB returned an unexpected response');
  }
  const result: Record<string, string> = {};
  for (const [, tag, value] of xml.matchAll(/<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>([^<]*)<\/\1>/g)) {
    if (!(tag in result)) result[tag] = unescapeXml(value).trim();
  }
  return result;
}

/** ProcReturnCode 00 */
export function isQnbApproved(fields: Record<string, string | undefined>): boolean {
  return fields.ProcReturnCode === '00';
}
