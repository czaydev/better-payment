import { describe, it, expect } from 'vitest';
import { lookupBin } from '../../../src/bin';

describe('offline BIN lookup (better-payment/bin)', () => {
  it('returns correct bank and program for Garanti BBVA Bonus', () => {
    const info = lookupBin('552879');
    expect(info).toBeDefined();
    expect(info).toEqual({
      binNumber: '552879',
      bankName: 'Garanti BBVA',
      bankCode: 62,
      cardFamily: 'Bonus',
      cardType: 'CREDIT_CARD',
      cardAssociation: 'MASTER_CARD',
      commercial: false,
    });
  });

  it('returns correct details for Yapı Kredi Worldcard', () => {
    const info = lookupBin('450634');
    expect(info).toBeDefined();
    expect(info?.bankName).toBe('Yapı Kredi');
    expect(info?.bankCode).toBe(67);
    expect(info?.cardFamily).toBe('World');
    expect(info?.cardAssociation).toBe('VISA');
    expect(info?.commercial).toBe(false);
  });

  it('returns correct details for Türkiye İş Bankası Maximum', () => {
    const info = lookupBin('454358');
    expect(info).toBeDefined();
    expect(info?.bankName).toBe('Türkiye İş Bankası');
    expect(info?.bankCode).toBe(64);
    expect(info?.cardFamily).toBe('Maximum');
    expect(info?.cardAssociation).toBe('VISA');
  });

  it('returns correct details for Akbank Axess', () => {
    const info = lookupBin('540058');
    expect(info).toBeDefined();
    expect(info?.bankName).toBe('Akbank');
    expect(info?.bankCode).toBe(46);
    expect(info?.cardFamily).toBe('Axess');
    expect(info?.cardAssociation).toBe('MASTER_CARD');
  });

  it('returns correct details for Ziraat Bankkart Combo', () => {
    const info = lookupBin('454310');
    expect(info).toBeDefined();
    expect(info?.bankName).toBe('Ziraat Bankası');
    expect(info?.bankCode).toBe(10);
    expect(info?.cardFamily).toBe('Bankkart Combo');
  });

  it('identifies TROY association correctly', () => {
    const info = lookupBin('979201');
    expect(info).toBeDefined();
    expect(info?.cardAssociation).toBe('TROY');
    expect(info?.bankName).toBe('Ziraat Bankası');
  });

  it('identifies prepaid cards (Papara, ininal)', () => {
    const papara = lookupBin('418342');
    expect(papara?.cardType).toBe('PREPAID_CARD');
    expect(papara?.bankName).toBe('Papara');

    const ininal = lookupBin('540034');
    expect(ininal?.cardType).toBe('PREPAID_CARD');
    expect(ininal?.bankName).toBe('ininal');
  });

  it('identifies commercial cards (commercial: true)', () => {
    const commercial = lookupBin('450639');
    expect(commercial?.commercial).toBe(true);

    const consumer = lookupBin('450634');
    expect(consumer?.commercial).toBe(false);
  });

  it('returns undefined for unknown BIN', () => {
    expect(lookupBin('999999')).toBeUndefined();
    expect(lookupBin('123456')).toBeUndefined();
  });

  it('handles spaces, dashes and full 16-digit card numbers', () => {
    const info = lookupBin('5528 7912 3456 7890');
    expect(info).toBeDefined();
    expect(info?.bankName).toBe('Garanti BBVA');
    expect(info?.binNumber).toBe('552879');

    const dashed = lookupBin('4506-3400-1111-2222');
    expect(dashed).toBeDefined();
    expect(dashed?.bankName).toBe('Yapı Kredi');
  });

  it('returns undefined for invalid inputs or inputs shorter than 6 digits', () => {
    expect(lookupBin('')).toBeUndefined();
    expect(lookupBin('12345')).toBeUndefined();
    expect(lookupBin(null as unknown as string)).toBeUndefined();
    expect(lookupBin(undefined as unknown as string)).toBeUndefined();
  });
});
