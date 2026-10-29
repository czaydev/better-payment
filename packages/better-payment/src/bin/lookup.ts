import { BIN_TABLE } from './data';
import type { BinInfo } from './types';

/**
 * Looks up card and bank details for a 6 or 8 digit BIN offline.
 * Works without network calls or payment provider dependencies.
 *
 * @param bin Card number or BIN prefix (at least 6 digits)
 * @returns BinInfo if recognized, or undefined if unknown
 *
 * @example
 * ```ts
 * import { lookupBin } from 'better-payment/bin';
 *
 * const info = lookupBin('552879');
 * // {
 * //   binNumber: '552879',
 * //   bankName: 'Garanti BBVA',
 * //   bankCode: 62,
 * //   cardFamily: 'Bonus',
 * //   cardType: 'CREDIT_CARD',
 * //   cardAssociation: 'MASTER_CARD',
 * //   commercial: false
 * // }
 * ```
 */
export function lookupBin(bin: string): BinInfo | undefined {
  if (!bin || typeof bin !== 'string') return undefined;

  // Strip spaces, dashes and non-digit characters
  const digits = bin.replace(/\D/g, '');
  if (digits.length < 6) return undefined;

  // Try 8-digit match first, then 6-digit match
  const bin8 = digits.slice(0, 8);
  const bin6 = digits.slice(0, 6);

  const entry = BIN_TABLE[bin8] ?? BIN_TABLE[bin6];
  if (!entry) return undefined;

  const matchedBin = BIN_TABLE[bin8] ? bin8 : bin6;
  const [bankCode, bankName, cardFamily, cardType, cardAssociation, commercial] = entry;

  return {
    binNumber: matchedBin,
    bankName,
    bankCode,
    cardFamily,
    cardType,
    cardAssociation,
    commercial: Boolean(commercial),
  };
}
