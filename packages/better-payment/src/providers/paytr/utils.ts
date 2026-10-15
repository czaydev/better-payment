import { hmac, toBase64 } from '../../core/crypto';
import { safeEqual, toMinorUnits, formatDecimal } from '../../core/utils';
import type { PayTRBasketItem } from './types';
import { ValidationError } from '../../core/errors';

/**
 * PayTR signatures: base64(HMAC-SHA256(data + merchant_salt, merchant_key))
 */
export async function paytrSign(data: string, merchantKey: string): Promise<string> {
  return toBase64(await hmac('SHA-256', merchantKey, data));
}

/**
 * iFrame API token (paytr_token for /odeme/api/get-token)
 */
export async function generatePayTRIframeToken(
  params: {
    merchantId: string;
    userIp: string;
    merchantOid: string;
    email: string;
    paymentAmount: string;
    userBasket: string;
    noInstallment: string;
    maxInstallment: string;
    currency: string;
    testMode: string;
  },
  merchantSalt: string,
  merchantKey: string
): Promise<string> {
  const data =
    params.merchantId +
    params.userIp +
    params.merchantOid +
    params.email +
    params.paymentAmount +
    params.userBasket +
    params.noInstallment +
    params.maxInstallment +
    params.currency +
    params.testMode;
  return paytrSign(data + merchantSalt, merchantKey);
}

/**
 * Direct API token (paytr_token for /odeme)
 */
export async function generatePayTRDirectToken(
  params: {
    merchantId: string;
    userIp: string;
    merchantOid: string;
    email: string;
    paymentAmount: string;
    paymentType: string;
    installmentCount: string;
    currency: string;
    testMode: string;
    non3d: string;
  },
  merchantSalt: string,
  merchantKey: string
): Promise<string> {
  const data =
    params.merchantId +
    params.userIp +
    params.merchantOid +
    params.email +
    params.paymentAmount +
    params.paymentType +
    params.installmentCount +
    params.currency +
    params.testMode +
    params.non3d;
  return paytrSign(data + merchantSalt, merchantKey);
}

/**
 * Refund token: merchant_id + merchant_oid + return_amount + merchant_salt
 */
export async function generatePayTRRefundToken(
  merchantId: string,
  merchantOid: string,
  returnAmount: string,
  merchantSalt: string,
  merchantKey: string
): Promise<string> {
  return paytrSign(merchantId + merchantOid + returnAmount + merchantSalt, merchantKey);
}

/**
 * Status query token: merchant_id + merchant_oid + merchant_salt
 */
export async function generatePayTRStatusToken(
  merchantId: string,
  merchantOid: string,
  merchantSalt: string,
  merchantKey: string
): Promise<string> {
  return paytrSign(merchantId + merchantOid + merchantSalt, merchantKey);
}

/**
 * BIN query token: bin_number + merchant_id + merchant_salt
 */
export async function generatePayTRBinToken(
  binNumber: string,
  merchantId: string,
  merchantSalt: string,
  merchantKey: string
): Promise<string> {
  return paytrSign(binNumber + merchantId + merchantSalt, merchantKey);
}

/**
 * Installment rates token: merchant_id + request_id + merchant_salt
 */
export async function generatePayTRInstallmentRatesToken(
  merchantId: string,
  requestId: string,
  merchantSalt: string,
  merchantKey: string
): Promise<string> {
  return paytrSign(merchantId + requestId + merchantSalt, merchantKey);
}

/**
 * Stored card list token (Kart Saklama, capi/list): utoken + merchant_salt
 * (per PayTR's official Postman collection)
 */
export async function generatePayTRCardListToken(
  utoken: string,
  merchantSalt: string,
  merchantKey: string
): Promise<string> {
  return paytrSign(utoken + merchantSalt, merchantKey);
}

/**
 * Stored card delete token (capi/delete): ctoken + utoken + merchant_salt
 */
export async function generatePayTRCardDeleteToken(
  ctoken: string,
  utoken: string,
  merchantSalt: string,
  merchantKey: string
): Promise<string> {
  return paytrSign(ctoken + utoken + merchantSalt, merchantKey);
}

/**
 * Verifies the hash PayTR sends to the notification (Bildirim) URL:
 * base64(HMAC-SHA256(merchant_oid + merchant_salt + status + total_amount, merchant_key))
 */
export async function verifyPayTRCallback(
  data: { merchant_oid?: string; status?: string; total_amount?: string; hash?: string },
  merchantSalt: string,
  merchantKey: string
): Promise<boolean> {
  if (
    !data ||
    !data.merchant_oid ||
    !data.status ||
    data.total_amount === undefined ||
    !data.hash
  ) {
    return false;
  }
  const expected = await paytrSign(
    data.merchant_oid + merchantSalt + data.status + data.total_amount,
    merchantKey
  );
  return safeEqual(expected, data.hash);
}

/**
 * iFrame API user_basket: base64(JSON([[name, "unit price in TL", quantity], ...]))
 */
export function formatPayTRBasket(items: PayTRBasketItem[]): string {
  return toBase64(formatPayTRDirectBasket(items));
}

/**
 * Direct API user_basket: JSON only; URL/HTML escaping is handled by the transport.
 */
export function formatPayTRDirectBasket(items: PayTRBasketItem[]): string {
  const basket = items.map((item) => [item.name, formatPayTRAmount(item.price), item.quantity]);
  return JSON.stringify(basket);
}

/**
 * Amount in minor units (kuruş) as used by payment_amount in the iFrame API
 */
export function convertToKurus(amount: string | number): string {
  return toMinorUnits(amount).toString();
}

/**
 * Amount with 2 decimals and dot separator ("12.34"), used by the Direct API,
 * refunds and basket prices
 */
export function formatPayTRAmount(amount: string | number): string {
  return formatDecimal(amount);
}

/**
 * Kuruş -> TL ("1001" -> "10.01")
 */
export function convertFromKurus(kurus: string | number): string {
  const value = typeof kurus === 'number' ? kurus : parseInt(kurus, 10);
  return (value / 100).toFixed(2);
}

/**
 * PayTR currency codes
 */
export function mapPayTRCurrency(currency: string | undefined): string {
  const value = (currency || 'TRY').toUpperCase();
  const map: Record<string, string> = {
    TRY: 'TL',
    TL: 'TL',
    USD: 'USD',
    EUR: 'EUR',
    GBP: 'GBP',
    RUB: 'RUB',
  };
  const mapped = map[value];
  if (!mapped) {
    throw new ValidationError(`Currency ${currency} is not supported by PayTR`);
  }
  return mapped;
}

/**
 * merchant_oid must be alphanumeric (max 64 chars)
 */
export function assertPayTRMerchantOid(merchantOid: string): void {
  if (!/^[A-Za-z0-9]{1,64}$/.test(merchantOid)) {
    throw new ValidationError(
      `Invalid PayTR merchant_oid "${merchantOid}": only letters and digits are allowed (max 64 characters)`
    );
  }
}

/**
 * application/x-www-form-urlencoded body
 */
export function createPayTRFormData(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Auto-submitting HTML form (for browser POSTs to the Direct API)
 */
export function buildAutoSubmitForm(action: string, fields: Record<string, string>): string {
  const inputs = Object.entries(fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
    )
    .join('');
  return (
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
    `<form id="paytr-form" method="POST" action="${escapeHtml(action)}">${inputs}</form>` +
    '<script>document.getElementById("paytr-form").submit();</script>' +
    '</body></html>'
  );
}

/**
 * iFrame page wrapper
 */
export function buildIframeHtml(iframeUrl: string): string {
  return (
    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>PayTR</title>' +
    '<style>body{margin:0;padding:0;overflow:hidden}iframe{width:100%;height:100vh;border:none}</style>' +
    '</head><body>' +
    `<iframe src="${escapeHtml(iframeUrl)}" frameborder="0" scrolling="yes"></iframe>` +
    '</body></html>'
  );
}
