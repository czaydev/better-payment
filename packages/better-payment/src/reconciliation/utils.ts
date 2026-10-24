import { BetterPaymentError, toBase64, hmac } from 'better-payment';
import type { ReconciliationFieldCandidates } from '../types/reconciliation';

/**
 * Error raised by reconciliation sources. The message never contains response
 * bodies: daily transaction lists carry customer order data (PII).
 */
export class ReconciliationError extends BetterPaymentError {
  constructor(message: string, provider: string, options: { cause?: unknown } = {}) {
    super(message, 'RECONCILIATION_ERROR', provider);
    this.name = 'ReconciliationError';
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Dates: string based, timezone free, edge-safe (no Intl, no node:*). */
/* ------------------------------------------------------------------ */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoToUtcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** True for a real calendar date in `YYYY-MM-DD`. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function assertIsoDate(value: string, field: string): string {
  if (!isIsoDate(value)) {
    throw new ReconciliationError(
      `Invalid ${field} '${value}': expected YYYY-MM-DD`,
      'reconciliation'
    );
  }
  return value;
}

/** Number of days from `a` to `b` (both `YYYY-MM-DD`); >= 0 when b >= a. */
export function isoDaysBetween(a: string, b: string): number {
  return Math.round((isoToUtcMs(b) - isoToUtcMs(a)) / 86_400_000);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function addIsoDays(date: string, days: number): string {
  const next = new Date(isoToUtcMs(date) + days * 86_400_000);
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

/** Every day of an inclusive range, as `YYYY-MM-DD` strings. */
export function listIsoDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; ; d = addIsoDays(d, 1)) {
    days.push(d);
    if (d === to) break;
  }
  return days;
}

/** Split an inclusive range into windows of at most `maxDays` days. */
export function chunkIsoRange(
  from: string,
  to: string,
  maxDays: number
): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  let start = from;
  while (isoDaysBetween(start, to) >= 0) {
    const remaining = isoDaysBetween(start, to) + 1;
    const end = remaining > maxDays ? addIsoDays(start, maxDays - 1) : to;
    chunks.push({ start, end });
    if (end === to) break;
    start = addIsoDays(end, 1);
  }
  return chunks;
}

/**
 * Normalize a provider timestamp into `YYYY-MM-DDTHH:mm:ss` (or `YYYY-MM-DD`
 * when there is no time part, or a plain year like `YYYY`). Accepts ISO-like
 * strings, `dd.MM.yyyy HH:mm:ss` (Param) and `yyyy-MM-dd HH:mm:ss` (iyzico,
 * PayTR); epoch numbers are converted in UTC. Unparseable values return
 * undefined and the caller falls back to the query day.
 */
export function normalizeDate(value: unknown, fallback?: string): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Epoch seconds vs milliseconds
    const ms = value > 1e11 ? value : value * 1000;
    return new Date(ms).toISOString().slice(0, 19);
  }
  if (typeof value !== 'string') return fallback;
  const raw = value.trim();
  if (raw === '') return fallback;

  // Day first: 2026-10-19[ T...]
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
  if (m) {
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    return m[4] ? `${date}T${m[4]}:${m[5]}:${m[6] ?? '00'}` : date;
  }

  // Day first with dots (Turkish): 19.10.2026[ ...]
  m = /^(\d{2})\.(\d{2})\.(\d{4})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
  if (m) {
    const date = `${m[3]}-${m[2]}-${m[1]}`;
    return m[4] ? `${date}T${m[4]}:${m[5]}:${m[6] ?? '00'}` : date;
  }

  return fallback;
}

/** Format for Param's `dd.MM.yyyy HH:mm:ss` window boundaries. */
export function formatDottedDateRange(date: string, endOfDay: boolean): string {
  const [y, mo, d] = date.split('-');
  return `${d}.${mo}.${y} ${endOfDay ? '23:59:59' : '00:00:00'}`;
}

/** Validate an inclusive `YYYY-MM-DD` range; the default horizon is 92 days. */
export function assertQueryRange(
  query: { from: string; to: string },
  provider: string,
  maxDays = 92
): { from: string; to: string } {
  const { from, to } = query ?? ({} as { from: string; to: string });
  assertIsoDate(from, 'from');
  assertIsoDate(to, 'to');
  const days = isoDaysBetween(from, to);
  if (days < 0) {
    throw new ReconciliationError(`Invalid range: from ${from} is after to ${to}`, provider);
  }
  if (days + 1 > maxDays) {
    throw new ReconciliationError(
      `Range ${from}..${to} is ${days + 1} days; the maximum is ${maxDays}`,
      provider
    );
  }
  return { from, to };
}

/* ------------------------------------------------------------------ */
/* Decimal strings: no floats on the money path.                       */
/* ------------------------------------------------------------------ */

/** Minor units per ISO currency code (0-decimal currencies stay 0-decimal). */
export const DEFAULT_CURRENCY_DECIMALS: Record<string, number> = {
  TRY: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  CHF: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  PLN: 2,
  AZN: 2,
  AED: 2,
  SAR: 2,
  RUB: 2,
  UAH: 2,
  CZK: 2,
  JPY: 0,
  KRW: 0,
  VND: 0,
  IDR: 0,
};

/** ISO 4217 numeric codes some reports carry instead of letters. */
const CURRENCY_BY_NUMERIC_CODE: Record<string, string> = {
  '949': 'TRY',
  '840': 'USD',
  '978': 'EUR',
  '826': 'GBP',
  '756': 'CHF',
  '752': 'SEK',
  '578': 'NOK',
  '208': 'DKK',
  '985': 'PLN',
  '944': 'AZN',
  '784': 'AED',
  '682': 'SAR',
  '643': 'RUB',
  '980': 'UAH',
  '203': 'CZK',
  '392': 'JPY',
  '410': 'KRW',
  '704': 'VND',
  '360': 'IDR',
};

export function normalizeCurrency(value: unknown, fallback = 'TRY'): string {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string') return fallback;
  const raw = value.trim().toUpperCase();
  if (raw === '') return fallback;
  if (raw === 'TL' || raw === 'LT') return 'TRY';
  const byCode = CURRENCY_BY_NUMERIC_CODE[raw];
  if (byCode) return byCode;
  return /^[A-Z]{3}$/.test(raw) ? raw : fallback;
}

export function currencyDecimals(currency: string, overrides?: Record<string, number>): number {
  const value = overrides?.[currency] ?? DEFAULT_CURRENCY_DECIMALS[currency] ?? 2;
  return Number.isInteger(value) && value >= 0 && value <= 4 ? value : 2;
}

function expandExponential(s: string): string | undefined {
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(s);
  if (!m) return undefined;
  const [, sign, int, frac = '', expRaw] = m;
  const digits = int + frac;
  const exp = Number(expRaw);
  const pointFrom = int.length + exp;
  if (pointFrom <= 0) return `${sign}0.${'0'.repeat(-pointFrom) + digits}`;
  if (pointFrom >= digits.length) return `${sign}${digits}${'0'.repeat(pointFrom - digits.length)}`;
  return `${sign}${digits.slice(0, pointFrom)}.${digits.slice(pointFrom)}`;
}

/**
 * Parse a provider amount into a plain decimal string. Accepts documented
 * decimal strings ("12.50", iyzico), JSON numbers (Akbank), Turkish grouping
 * ("1.234,56") and exponential notation. Never trusts a float: numbers are
 * re-expanded from their shortest decimal form.
 */
export function parseDecimalLike(value: unknown): string | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    const s = String(value);
    return s.includes('e') ? expandExponential(s) : s;
  }
  if (typeof value !== 'string') return undefined;
  let s = value.trim();
  if (s === '' || s === '-') return undefined;
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  if (s.includes('e') || s.includes('E')) {
    const expanded = expandExponential((negative ? '-' : '') + s);
    return expanded;
  }
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // The separator that comes last is the decimal separator; the other groups.
    const decimalSep = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const groupSep = decimalSep === ',' ? '.' : ',';
    s = s.split(groupSep).join('').split(decimalSep).join('.');
  } else if (hasComma) {
    // A comma alone is a decimal comma in the Turkish providers' formats.
    s = s.replace(',', '.');
  } else if (hasDot && s.split('.').length > 2) {
    // Several dots ("1.234.567") can only be grouping separators.
    s = s.split('.').join('');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  return (negative ? '-' : '') + s;
}

/**
 * A decimal string scaled to integer minor units for the currency's exponent,
 * rounded half up on the decimal representation (never on the float).
 */
export function decimalToMinor(value: string, decimals: number): bigint | undefined {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return undefined;
  const negative = value.startsWith('-');
  const [int, frac = ''] = (negative ? value.slice(1) : value).split('.');
  const scaled = frac.padEnd(decimals + 1, '0');
  let minor = BigInt(int + scaled.slice(0, decimals));
  if (scaled.length > decimals && scaled[decimals] >= '5') minor += 1n;
  return negative ? -minor : minor;
}

/** Integer minor units back to a decimal string for the currency's exponent. */
export function minorToDecimal(minor: bigint, decimals: number): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(decimals + 1, '0');
  if (decimals === 0) return `${negative ? '-' : ''}${digits}`;
  return `${negative ? '-' : ''}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

/**
 * Normalize an amount to the currency's canonical decimal string ("10.50" for
 * TRY, "1500" for JPY). undefined when the value is missing or not a number.
 */
export function normalizeAmountString(
  value: unknown,
  currency: string,
  overrides?: Record<string, number>
): string | undefined {
  const parsed = parseDecimalLike(value);
  if (parsed === undefined) return undefined;
  const minor = decimalToMinor(parsed, currencyDecimals(currency, overrides));
  return minor === undefined
    ? undefined
    : minorToDecimal(minor, currencyDecimals(currency, overrides));
}

/** Add two decimal strings in the same currency (integer math). */
export function addAmounts(
  a: string,
  b: string,
  currency: string,
  overrides?: Record<string, number>
): string {
  const decimals = currencyDecimals(currency, overrides);
  const ma = decimalToMinor(a, decimals) ?? 0n;
  const mb = decimalToMinor(b, decimals) ?? 0n;
  return minorToDecimal(ma + mb, decimals);
}

/* ------------------------------------------------------------------ */
/* Row field reading                                                   */
/* ------------------------------------------------------------------ */

export function fieldsOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Locale-free case/diacritic folding for Turkish keywords ("İade" -> "iade",
 * "SATIŞ" -> "satis"). Uses Unicode NFD, not Intl: edge runtimes do not have
 * locale-aware `toLocaleLowerCase('tr')` behaviour guaranteed.
 */
export function foldTurkish(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g');
}

/** First present, non-empty value among `keys` of a provider row, as a string. */
export function pickString(
  row: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value === undefined || value === null) continue;
    const s = typeof value === 'string' ? value.trim() : String(value);
    if (s !== '') return s;
  }
  return undefined;
}

/** Raw (typed) value of the first present, non-empty key — used for amounts. */
export function pickRaw(
  row: Record<string, unknown>,
  keys: readonly string[]
): string | number | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

export function mergeFieldCandidates(
  defaults: ReconciliationFieldCandidates,
  overrides?: Partial<ReconciliationFieldCandidates>
): ReconciliationFieldCandidates {
  const merged = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof ReconciliationFieldCandidates)[]) {
    const override = overrides?.[key];
    if (override && override.length > 0) merged[key] = [...override];
  }
  return merged;
}

/** PayTR-style signature: base64(HMAC-SHA256(data, key)). */
export async function signHmacBase64Sha256(data: string, key: string): Promise<string> {
  return toBase64(await hmac('SHA-256', key, data));
}
