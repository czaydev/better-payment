import { ValidationError } from './errors';
import { randomHex, safeEqual } from './crypto';

export { safeEqual };

/**
 * Generates an alphanumeric order id (no separators), accepted by every
 * supported provider. Example: BP1727180000000A1B2C3D4
 */
export function generateOrderId(prefix = 'BP'): string {
  return `${prefix}${Date.now()}${randomHex(4).toUpperCase()}`;
}

/**
 * Parses a decimal amount given as string/number. Throws on invalid or negative input.
 */
export function parseAmount(amount: string | number, field = 'amount'): number {
  const value = typeof amount === 'number' ? amount : Number(String(amount).trim());
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationError(`Invalid ${field}: ${amount}`);
  }
  return value;
}

/**
 * Converts a decimal amount to minor units (kuruş/cents), rounding half up on the
 * decimal representation (1.005 -> 101) instead of the binary float (100.49999...).
 */
export function toMinorUnits(amount: string | number, field = 'amount'): number {
  const value = parseAmount(amount, field);
  const str = String(value);
  return str.includes('e') ? Math.round(value * 100) : Math.round(Number(`${str}e2`));
}

/**
 * Formats an amount with exactly 2 decimals ("1.01"), using decimal rounding.
 */
export function formatDecimal(
  amount: string | number,
  separator: '.' | ',' = '.',
  field = 'amount'
): string {
  const fixed = (toMinorUnits(amount, field) / 100).toFixed(2);
  return separator === '.' ? fixed : fixed.replace('.', ',');
}

/**
 * Highest allowed installment count from a list such as `[1, 3, 6]`
 * (providers that only take a maximum), or undefined when nothing is allowed.
 */
export function maxInstallment(installments?: number[]): number | undefined {
  if (!installments?.length) return undefined;
  return Math.max(1, ...installments.filter((n) => Number.isInteger(n) && n > 1));
}

/**
 * Returns an error message safe to expose (never undefined).
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
  }
  return fallback;
}

/**
 * True when the error is a transport-level failure (timeout, connection reset,
 * no response). In that case the provider may still have processed the request,
 * so the outcome is unknown and must be verified with a status query.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { isNetworkError?: unknown }).isNetworkError === true;
}
