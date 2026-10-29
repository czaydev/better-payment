import { digest, safeEqual, toHex } from '../../core/crypto';
import { ValidationError } from '../../core/errors';
import { formatDecimal } from '../../core/utils';
import type { BasketItem } from '../../types';

/**
 * Brands of the Payten (Paratika) platform. Each is also a provider id
 * (`ProviderType`) whose default URLs are in `PROVIDER_DEFAULT_URLS`.
 */
export type ParatikaBrand = 'paratika' | 'vakifpay' | 'ziraatpay';

/**
 * Verifies the callback's sdSha512:
 * hex(SHA512(merchantPaymentId|customerId|sessionToken|responseCode|random|secretKey))
 */
export async function verifyParatikaCallback(
  data: Record<string, string | undefined>,
  secretKey: string
): Promise<boolean> {
  if (!data?.sdSha512) return false;
  const expected = toHex(
    await digest(
      'SHA-512',
      [
        data.merchantPaymentId ?? '',
        data.customerId ?? '',
        data.sessionToken ?? '',
        data.responseCode ?? '',
        data.random ?? '',
        secretKey,
      ].join('|')
    )
  );
  return safeEqual(expected.toLowerCase(), data.sdSha512.toLowerCase());
}

/** Amount with 2 decimals ("1.20") */
export function formatParatikaAmount(amount: string | number): string {
  return formatDecimal(amount);
}

/** Currencies Paratika takes by ISO code */
export function getParatikaCurrency(currency: string | undefined): string {
  const code = (currency || 'TRY').toUpperCase();
  const normalized = code === 'TL' ? 'TRY' : code;
  if (!['TRY', 'USD', 'EUR', 'GBP'].includes(normalized)) {
    throw new ValidationError(`Currency ${currency} is not supported by Paratika`);
  }
  return normalized;
}

/** CARDEXPIRY for API calls: MM.YYYY */
export function formatParatikaExpiry(month: string, year: string): { month: string; year: string } {
  const mm = month.padStart(2, '0');
  const yyyy = year.length === 2 ? `20${year}` : year;
  if (!/^(0[1-9]|1[0-2])$/.test(mm) || !/^\d{4}$/.test(yyyy)) {
    throw new ValidationError(`Invalid card expiry: ${month}/${year}`);
  }
  return { month: mm, year: yyyy };
}

/**
 * ORDERITEMS: the basket when its prices add up to the amount, otherwise one
 * line for the whole order (Paratika rejects items that do not add up, ERR10022)
 */
export function buildParatikaOrderItems(items: BasketItem[] | undefined, amount: string): string {
  const total = (items ?? []).reduce((sum, item) => sum + Math.round(Number(item.price) * 100), 0);
  const lines =
    items && items.length > 0 && total === Math.round(Number(amount) * 100)
      ? items.map((item) => ({
          productCode: item.id,
          name: item.name,
          description: item.name,
          quantity: 1,
          amount: Number(formatDecimal(item.price)),
        }))
      : [
          {
            productCode: 'ORDER',
            name: 'Order',
            description: 'Order',
            quantity: 1,
            amount: Number(amount),
          },
        ];
  return JSON.stringify(lines);
}

/** responseCode 00 */
export function isParatikaApproved(response: { responseCode?: unknown }): boolean {
  return response?.responseCode === '00';
}
