import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  createToslaHash,
  formatToslaAmount,
  formatToslaExpiry,
  formatToslaInstallment,
  formatToslaTimeSpan,
  getToslaCurrencyCode,
  toslaCardAssociation,
  toslaInstallmentRates,
} from '../../../../src/providers/tosla/utils';

describe('Tosla utils', () => {
  it('formats timeSpan in Turkey time (UTC+3)', () => {
    expect(formatToslaTimeSpan(new Date('2026-10-12T21:30:05Z'))).toBe('20261013003005');
  });

  it('signs with base64(SHA-512(apiPass + clientId + apiUser + Rnd + timeSpan))', async () => {
    const expected = crypto
      .createHash('sha512')
      .update('PASS' + '1000000001' + 'USER' + 'abc123' + '20261012150000')
      .digest('base64');
    expect(
      await createToslaHash({
        apiPass: 'PASS',
        clientId: '1000000001',
        apiUser: 'USER',
        rnd: 'abc123',
        timeSpan: '20261012150000',
      })
    ).toBe(expected);
  });

  it('sends amounts in kuruş and currencies as ISO numbers', () => {
    expect(formatToslaAmount('1.20')).toBe(120);
    expect(formatToslaAmount(100)).toBe(10000);
    expect(getToslaCurrencyCode(undefined)).toBe(949);
    expect(getToslaCurrencyCode('eur')).toBe(978);
    expect(() => getToslaCurrencyCode('JPY')).toThrow(/not supported/);
  });

  it('formats the installment count and expiry', () => {
    expect(formatToslaInstallment(undefined)).toBe(1);
    expect(formatToslaInstallment(6)).toBe(6);
    expect(() => formatToslaInstallment(0)).toThrow();
    expect(formatToslaExpiry('3', '2030')).toBe('0330');
    expect(formatToslaExpiry('12', '30')).toBe('1230');
    expect(() => formatToslaExpiry('13', '30')).toThrow(/expiry/);
  });

  it('reads the card scheme from the BIN', () => {
    expect(toslaCardAssociation('454671')).toBe('VISA');
    expect(toslaCardAssociation('540667')).toBe('MASTER_CARD');
    expect(toslaCardAssociation('979203')).toBe('TROY');
    expect(toslaCardAssociation('374245')).toBe('AMEX');
    expect(toslaCardAssociation('111111')).toBe('');
  });

  it('reads the installment rates, skipping empty ones', () => {
    expect(
      toslaInstallmentRates({ T6: { Rate: 6 }, T1: { Rate: 0 }, T3: { Rate: 3.5 }, T9: null })
    ).toEqual([
      { count: 1, rate: 0 },
      { count: 3, rate: 3.5 },
      { count: 6, rate: 6 },
    ]);
    expect(toslaInstallmentRates(undefined)).toEqual([]);
  });
});
