// Rate-table types, validation and exact commission maths for the commission
// router. Amounts are decimal strings everywhere; commission costs are computed
// in integer minor units with BigInt, never with float multiplications.
import { ConfigurationError } from 'better-payment';

/**
 * A card classification as a BIN lookup returns it. Every field is optional so
 * that the `BinInfo` of `better-payment/bin` (issue #153, PR #252) and the
 * `BinCheckResponse` of any provider's `binCheck()` can be passed to
 * `binLookup` unchanged; a missing field simply cannot satisfy a filter.
 */
export interface RouterBinInfo {
  /** The 6 or 8 digit BIN prefix that matched */
  binNumber?: string;
  bankName?: string;
  bankCode?: number;
  /** Card family / program: Bonus, Maximum, Axess, World... */
  cardFamily?: string;
  /** CREDIT_CARD, DEBIT_CARD, PREPAID_CARD... */
  cardType?: string;
  /** VISA, MASTER_CARD, TROY, AMERICAN_EXPRESS... */
  cardAssociation?: string;
  /** Commercial/corporate card */
  commercial?: boolean;
}

/**
 * Injected BIN lookup: receives at most the first 8 digits of the card
 * (never a full PAN) and returns the classification, or nullish for unknown.
 */
export type BinLookup = (
  binPrefix: string
) => RouterBinInfo | null | undefined | Promise<RouterBinInfo | null | undefined>;

/**
 * One merchant contract line: what `provider` charges for such a card, such an
 * installment plan and such an amount. Rates are the merchant's real contract
 * values; the plugin never estimates them.
 */
export interface CommissionRate {
  /** Configured provider id this line belongs to */
  provider: string;
  /** Card family or families (case-insensitive); omit = any */
  cardFamily?: string | string[];
  /** Card association/network: VISA, MASTER_CARD, TROY... ; omit = any */
  cardAssociation?: string | string[];
  /** Card type: CREDIT_CARD, DEBIT_CARD, PREPAID_CARD; omit = any */
  cardType?: string | string[];
  /** Issuing bank name (case-insensitive); omit = any */
  bankName?: string | string[];
  /** Require a commercial (true) or consumer (false) card; omit = any */
  commercial?: boolean;
  /** Installment counts this line covers; omit = every count */
  installments?: number[];
  /**
   * Percentage commission, at most 4 decimals: `'2.49'` means 2.49%.
   * Prefer strings; numbers are converted with `String(value)`.
   */
  rate: string | number;
  /** Per-transaction fixed fee, at most 2 decimals. Default: none */
  fixed?: string | number;
  /** Inclusive lower bound of the paid amount, decimal string */
  minAmount?: string;
  /** Inclusive upper bound of the paid amount, decimal string */
  maxAmount?: string;
  /** Currencies this line applies to, e.g. `['TRY']`; omit = any */
  currencies?: string[];
  /** ISO date/datetime from which the line is valid (inclusive) */
  validFrom?: string;
  /** ISO date/datetime until which the line is valid (exclusive) */
  validTo?: string;
  /**
   * true: only for 3D Secure operations; false: only for non-3DS operations;
   * omit: for both.
   */
  threeDS?: boolean;
}

/**
 * Amounts up to 2 decimals, no sign, at most 13 integer digits. Capped at 13
 * digits because `13 digits * 100` is still a safe integer in minor units
 * (Number.MAX_SAFE_INTEGER), so every amount is compared exactly as an integer.
 */
const DECIMAL_2 = /^\d{1,13}(\.\d{1,2})?$/;
/** Percentages up to 4 decimals */
const DECIMAL_4 = /^\d{1,3}(\.\d{1,4})?$/;

/** `'2.49'` -> `249n`; the decimal is kept exact, never parsed as a float */
export function parseDecimal(value: string | number, maxDecimals: number, field: string): bigint {
  const text = typeof value === 'number' ? String(value) : String(value).trim();
  const pattern = maxDecimals === 4 ? DECIMAL_4 : DECIMAL_2;
  if (!pattern.test(text)) {
    throw new ConfigurationError(
      `${field} must be a positive decimal with at most ${maxDecimals} decimals, got '${text}'`
    );
  }
  const [whole, fraction = ''] = text.split('.');
  const padded = (fraction + '0'.repeat(maxDecimals)).slice(0, maxDecimals);
  return BigInt(whole + padded);
}

/**
 * Converts a 2-decimal amount to exact integer minor units (kuruş/cents).
 * Rejects values whose minor-unit form could not be represented exactly.
 */
export function amountMinor(value: string | number, field: string): number {
  const digits = parseDecimal(value, 2, field);
  if (digits > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ConfigurationError(`${field} is too large to be compared exactly`);
  }
  return Number(digits);
}

/**
 * Formats integer minor units as a 2-decimal string, using integer arithmetic
 * only ("1290" -> "12.90"). Locale-independent on purpose.
 */
export function formatMinor(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const absolute = Math.abs(minor);
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${sign}${whole}.${fraction}`;
}

/**
 * `amountMinor * ratePct / 100`, rounded half up, exactly. `scaledRate` is the
 * percentage multiplied by 10^4 (so `'2.49'` is `24_900n`); the result is in the
 * same minor units as the input and is compared as an integer.
 *
 * The rounding rule for a tie (exactly half a minor unit) is half up:
 * 0.5 kuruş becomes 1 kuruş. Used for ranking only: better-payment never
 * charges a price computed from a commission rate.
 */
export function percentCostMinorScaled(amountMinor: number, scaledRate: bigint): number {
  const numerator = BigInt(amountMinor) * scaledRate;
  const denominator = 100n * 10_000n;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return Number(remainder * 2n >= denominator ? quotient + 1n : quotient);
}

/** `percentCostMinorScaled` from a configured percentage ('2.49' -> 2.49%) */
export function percentCostMinor(amountMinor: number, rate: string | number): number {
  return percentCostMinorScaled(amountMinor, parseDecimal(rate, 4, 'rate'));
}

function checkList(value: string | string[] | undefined, field: string, index: number): void {
  const items = value === undefined ? [] : Array.isArray(value) ? value : [value];
  for (const item of items) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ConfigurationError(
        `rates[${index}].${field} must be a non-empty string or a list of them`
      );
    }
  }
}

function checkDate(value: string | undefined, field: string, index: number): number | undefined {
  if (value === undefined) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new ConfigurationError(`rates[${index}].${field} is not a valid ISO date: '${value}'`);
  }
  return time;
}

/**
 * Validates the whole table once, at plugin creation and init, so a bad
 * contract line can never reach a payment. With `providerIds` the provider of
 * every line must be configured; without it (before `betterPayment()`) only the
 * shape is checked. Bad decimals, empty filters and inverted ranges fail with
 * `ConfigurationError`.
 */
export function validateRateTable(
  rates: readonly CommissionRate[],
  providerIds?: readonly string[]
): void {
  if (!Array.isArray(rates))
    throw new ConfigurationError('commissionRouter: rates must be an array');
  rates.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new ConfigurationError(`rates[${index}] must be an object`);
    }
    if (typeof entry.provider !== 'string' || !entry.provider) {
      throw new ConfigurationError(`rates[${index}].provider must be a non-empty string`);
    }
    if (providerIds && !providerIds.includes(entry.provider)) {
      throw new ConfigurationError(
        `rates[${index}].provider '${entry.provider}' is not a configured provider (${providerIds.join(', ') || 'none'})`
      );
    }
    if (parseDecimal(entry.rate, 4, `rates[${index}].rate`) > 1_000_000n) {
      throw new ConfigurationError(`rates[${index}].rate must be at most 100 (percent)`);
    }
    if (entry.fixed !== undefined) parseDecimal(entry.fixed, 2, `rates[${index}].fixed`);
    if (entry.minAmount !== undefined)
      parseDecimal(entry.minAmount, 2, `rates[${index}].minAmount`);
    if (entry.maxAmount !== undefined)
      parseDecimal(entry.maxAmount, 2, `rates[${index}].maxAmount`);
    if (
      entry.minAmount !== undefined &&
      entry.maxAmount !== undefined &&
      parseDecimal(entry.minAmount, 2, 'minAmount') > parseDecimal(entry.maxAmount, 2, 'maxAmount')
    ) {
      throw new ConfigurationError(`rates[${index}]: minAmount is above maxAmount`);
    }
    if (entry.installments !== undefined) {
      if (!Array.isArray(entry.installments) || entry.installments.length === 0) {
        throw new ConfigurationError(
          `rates[${index}].installments must be a non-empty array of counts`
        );
      }
      for (const count of entry.installments) {
        if (!Number.isInteger(count) || count < 1 || count > 99) {
          throw new ConfigurationError(
            `rates[${index}].installments: every count must be an integer between 1 and 99`
          );
        }
      }
    }
    checkList(entry.cardFamily, 'cardFamily', index);
    checkList(entry.cardAssociation, 'cardAssociation', index);
    checkList(entry.cardType, 'cardType', index);
    checkList(entry.bankName, 'bankName', index);
    if (entry.commercial !== undefined && typeof entry.commercial !== 'boolean') {
      throw new ConfigurationError(`rates[${index}].commercial must be true or false`);
    }
    if (entry.currencies !== undefined) {
      if (!Array.isArray(entry.currencies) || entry.currencies.length === 0) {
        throw new ConfigurationError(`rates[${index}].currencies must be a non-empty array`);
      }
      for (const code of entry.currencies) {
        if (typeof code !== 'string' || !/^[A-Za-z]{3}$/.test(code)) {
          throw new ConfigurationError(
            `rates[${index}].currencies: '${code}' is not a 3-letter currency code`
          );
        }
      }
    }
    if (entry.threeDS !== undefined && typeof entry.threeDS !== 'boolean') {
      throw new ConfigurationError(`rates[${index}].threeDS must be true or false`);
    }
    const from = checkDate(entry.validFrom, 'validFrom', index);
    const to = checkDate(entry.validTo, 'validTo', index);
    if (from !== undefined && to !== undefined && from >= to) {
      throw new ConfigurationError(`rates[${index}]: validFrom is not before validTo`);
    }
  });
}
