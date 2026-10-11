import { digest, toBase64 } from '../../core/crypto';
import { ValidationError } from '../../core/errors';
import { toMinorUnits } from '../../core/utils';
import { buildXmlFields, encodeIso88599, unescapeXml, type XmlValue } from '../parampos/utils';

export const VAKIFKATILIM_ENDPOINTS = {
  /** Non-3D sale */
  NON_3D: '/Home/Non3DPayGate',
  /** 3D Secure: card verification, answered with the bank's 3D page */
  THREE_D: '/Home/ThreeDModelPayGate',
  /** 3D Secure: the charge after verification */
  PROVISION: '/Home/ThreeDModelProvisionGate',
  /** Same-day cancel */
  SALE_REVERSAL: '/Home/SaleReversal',
  /** Full refund */
  DRAWBACK: '/Home/Drawback',
  /** Partial refund */
  PARTIAL_DRAWBACK: '/Home/PartialDrawback',
} as const;

async function sha1Base64(value: string): Promise<string> {
  return toBase64(await digest('SHA-1', encodeIso88599(value)));
}

/**
 * HashData: base64(SHA1(MerchantId + MerchantOrderId + Amount + OkUrl + FailUrl +
 * UserName + base64(SHA1(password)))), over ISO-8859-9 bytes. Requests without
 * return URLs leave them empty.
 */
export async function createVakifKatilimHash(
  credentials: { merchantId: string; username: string; password: string },
  fields: { merchantOrderId: string; amount: string; okUrl?: string; failUrl?: string }
): Promise<string> {
  const hashedPassword = await sha1Base64(credentials.password);
  return sha1Base64(
    credentials.merchantId +
      fields.merchantOrderId +
      fields.amount +
      (fields.okUrl ?? '') +
      (fields.failUrl ?? '') +
      credentials.username +
      hashedPassword
  );
}

/** Amount in kuruş ("1.20" is "120") */
export function formatVakifKatilimAmount(amount: string | number): string {
  return String(toMinorUnits(amount));
}

/** FECCurrencyCode: ISO 4217 numeric with a leading zero ("0949") */
export function getVakifKatilimCurrencyCode(currency: string | undefined): string {
  const map: Record<string, string> = { TRY: '0949', TL: '0949', USD: '0840', EUR: '0978' };
  const code = map[(currency || 'TRY').toUpperCase()];
  if (!code) {
    throw new ValidationError(`Currency ${currency} is not supported by Vakıf Katılım`);
  }
  return code;
}

/** InstallmentCount: "0" for a single payment */
export function formatVakifKatilimInstallment(installment: number | string | undefined): string {
  const count = Number(installment ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > 36) {
    throw new ValidationError(`Invalid installment count: ${installment}`);
  }
  return count > 1 ? String(count) : '0';
}

/** Merchant order ids: letters, digits, "-" or "_" */
export function validateVakifKatilimOrderId(orderId: string): string {
  if (!/^[A-Za-z0-9_-]{1,50}$/.test(orderId)) {
    throw new ValidationError(
      `Vakıf Katılım order ids must be 1 to 50 letters, digits, "-" or "_", got: ${orderId}`
    );
  }
  return orderId;
}

/**
 * paymentId: the merchant order id and the bank's OrderId, which cancel and
 * refund both need
 */
export function encodeVakifKatilimPaymentId(merchantOrderId: string, orderId: string): string {
  return `${merchantOrderId}:${orderId}`;
}

export function decodeVakifKatilimPaymentId(paymentId: string): {
  merchantOrderId: string;
  orderId: string;
} {
  const index = paymentId.lastIndexOf(':');
  const merchantOrderId = paymentId.slice(0, index);
  const orderId = paymentId.slice(index + 1);
  if (index <= 0 || !/^\d+$/.test(orderId) || orderId === '0') {
    throw new ValidationError(
      'Vakıf Katılım paymentId must be the one returned by the payment ("<merchant order id>:<OrderId>")'
    );
  }
  return { merchantOrderId, orderId };
}

/**
 * A VPosMessageContract request. Non-ASCII characters (Turkish names) are sent
 * as character references, so the body is the same in any encoding.
 */
export function buildVakifKatilimXml(fields: Record<string, XmlValue>): string {
  const body = buildXmlFields(fields).replace(/[^ -~\t\n\r]/gu, (c) => `&#${c.codePointAt(0)};`);
  return `<?xml version="1.0" encoding="ISO-8859-1"?><VPosMessageContract>${body}</VPosMessageContract>`;
}

/**
 * Top-level fields of a VPosTransactionResponseContract (the echoed VPosMessage
 * is skipped). Throws when the body is not one.
 */
export function parseVakifKatilimResponse(xml: string): Record<string, string> {
  if (!xml.includes('VPosTransactionResponseContract')) {
    throw new Error('Vakıf Katılım returned an unexpected response');
  }
  const body = xml.replace(/<VPosMessage>[\s\S]*?<\/VPosMessage>/, '');
  const result: Record<string, string> = {};
  for (const [, tag, value] of body.matchAll(/<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>([^<]*)<\/\1>/g)) {
    if (!(tag in result)) result[tag] = unescapeXml(value).trim();
  }
  return result;
}

/** ResponseCode 00 */
export function isVakifKatilimApproved(fields: Record<string, string | undefined>): boolean {
  return fields.ResponseCode === '00';
}
