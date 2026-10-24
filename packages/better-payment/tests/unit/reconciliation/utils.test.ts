import { describe, it, expect } from 'vitest';
import {
  addAmounts,
  currencyDecimals,
  decimalToMinor,
  minorToDecimal,
  normalizeAmountString,
  normalizeCurrency,
  normalizeDate,
  parseDecimalLike,
  ReconciliationError,
} from 'better-payment/reconciliation';
import {
  addIsoDays,
  assertQueryRange,
  chunkIsoRange,
  foldTurkish,
  formatDottedDateRange,
  isIsoDate,
  listIsoDays,
} from '../../../src/reconciliation/utils';

describe('reconciliation dates', () => {
  it('accepts only real YYYY-MM-DD calendar days', () => {
    expect(isIsoDate('2026-10-19')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('19.10.2026')).toBe(false);
    expect(isIsoDate(20261019)).toBe(false);
  });

  it('normalizes provider timestamps without Intl or a timezone', () => {
    expect(normalizeDate('2026-10-19T10:11:12.000')).toBe('2026-10-19T10:11:12');
    expect(normalizeDate('2026-10-19 10:11')).toBe('2026-10-19T10:11:00');
    expect(normalizeDate('19.10.2026 10:11:12')).toBe('2026-10-19T10:11:12');
    expect(normalizeDate('19.10.2026')).toBe('2026-10-19');
    // Epoch seconds and milliseconds both land on the same UTC instant
    expect(normalizeDate(1_791_000_000)).toBe('2026-10-03T04:00:00');
    expect(normalizeDate(1_791_000_000_000)).toBe('2026-10-03T04:00:00');
    expect(normalizeDate('not a date', '2026-10-01')).toBe('2026-10-01');
    expect(normalizeDate(undefined)).toBeUndefined();
  });

  it('lists, adds and chunks inclusive ranges', () => {
    expect(addIsoDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(listIsoDays('2026-10-01', '2026-10-03')).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
    expect(chunkIsoRange('2026-10-01', '2026-10-07', 3)).toEqual([
      { start: '2026-10-01', end: '2026-10-03' },
      { start: '2026-10-04', end: '2026-10-06' },
      { start: '2026-10-07', end: '2026-10-07' },
    ]);
    expect(formatDottedDateRange('2026-10-19', true)).toBe('19.10.2026 23:59:59');
    expect(formatDottedDateRange('2026-10-19', false)).toBe('19.10.2026 00:00:00');
  });

  it('validates ranges and caps them at the horizon', () => {
    expect(assertQueryRange({ from: '2026-10-01', to: '2026-10-02' }, 'test')).toEqual({
      from: '2026-10-01',
      to: '2026-10-02',
    });
    expect(() => assertQueryRange({ from: '2026-10-02', to: '2026-10-01' }, 'test')).toThrow(
      /is after/
    );
    expect(() => assertQueryRange({ from: '2026-01-01', to: '2026-12-31' }, 'test')).toThrow(
      /maximum is 92/
    );
    expect(assertQueryRange({ from: '2026-01-01', to: '2026-01-02' }, 'test', 2).to).toBe(
      '2026-01-02'
    );
  });
});

describe('reconciliation money', () => {
  it('parses documented decimal formats without float arithmetic', () => {
    expect(parseDecimalLike('100.50')).toBe('100.50');
    expect(parseDecimalLike('1.234,56')).toBe('1234.56');
    expect(parseDecimalLike('1,234.56')).toBe('1234.56');
    expect(parseDecimalLike('1.234.567')).toBe('1234567');
    expect(parseDecimalLike('100,50')).toBe('100.50');
    expect(parseDecimalLike(0.1)).toBe('0.1');
    expect(parseDecimalLike(1e-7)).toBe('0.0000001');
    expect(parseDecimalLike('1e3')).toBe('1000');
    expect(parseDecimalLike('abc')).toBeUndefined();
    expect(parseDecimalLike('')).toBeUndefined();
  });

  it('scales to minor units and back, rounding half up', () => {
    expect(decimalToMinor('10.505', 2)).toBe(1051n);
    expect(decimalToMinor('10.504', 2)).toBe(1050n);
    expect(decimalToMinor('-1.005', 2)).toBe(-101n);
    expect(decimalToMinor('1500', 0)).toBe(1500n);
    expect(minorToDecimal(1051n, 2)).toBe('10.51');
    expect(minorToDecimal(-101n, 2)).toBe('-1.01');
    expect(minorToDecimal(1500n, 0)).toBe('1500');
  });

  it('normalizes amounts to the currency canonical string', () => {
    expect(normalizeAmountString(100.5, 'TRY')).toBe('100.50');
    expect(normalizeAmountString('1.234,5', 'TRY')).toBe('1234.50');
    expect(normalizeAmountString('1500', 'JPY')).toBe('1500');
    expect(normalizeAmountString('10.50', 'TRY', { TRY: 3 })).toBe('10.500');
    expect(normalizeAmountString('', 'TRY')).toBeUndefined();
  });

  it('adds amounts exactly', () => {
    expect(addAmounts('0.10', '0.20', 'TRY')).toBe('0.30');
    expect(addAmounts('100.005', '100.005', 'TRY')).toBe('200.02');
    expect(addAmounts('1500', '500', 'JPY')).toBe('2000');
  });

  it('maps currencies and their exponents', () => {
    expect(normalizeCurrency('949')).toBe('TRY');
    expect(normalizeCurrency('tl')).toBe('TRY');
    expect(normalizeCurrency('usd')).toBe('USD');
    expect(normalizeCurrency('')).toBe('TRY');
    expect(normalizeCurrency('nonsense')).toBe('TRY');
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals('TRY')).toBe(2);
    expect(currencyDecimals('KWD')).toBe(2);
    expect(currencyDecimals('KWD', { KWD: 3 })).toBe(3);
    expect(currencyDecimals('KWD', { KWD: 9 })).toBe(2);
  });
});

describe('reconciliation field helpers', () => {
  it('folds Turkish keywords without locale APIs', () => {
    expect(foldTurkish('İade')).toBe('iade');
    expect(foldTurkish('SATIŞ')).toBe('satis');
    expect(foldTurkish('Başarılı')).toBe('basarili');
    expect(foldTurkish('Başarısız')).toBe('basarisiz');
  });

  it('uses a reconciliation-specific error code', () => {
    const error = new ReconciliationError('PayTR report failed (006)', 'paytr');
    expect(error.code).toBe('RECONCILIATION_ERROR');
    expect(error.provider).toBe('paytr');
    expect(error.message).not.toContain('customer');
  });
});
