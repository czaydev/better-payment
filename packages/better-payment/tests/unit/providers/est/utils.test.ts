import { describe, it, expect } from 'vitest';
import {
  compareEstKeys,
  createEstHash,
  verifyEstCallback,
  generateEstRandom,
  formatEstAmount,
  getEstCurrencyCode,
  formatEstInstallment,
  formatEstExpiry,
  estCardType,
  buildEstXml,
  parseEstXmlResponse,
  isEstApproved,
  isEstHostedStoreType,
} from '../../../../src/providers/est/utils';
import {
  EST_TEST,
  EST_FORM_FIELDS,
  EST_FORM_HASH,
  EST_3D_CALLBACK,
  EST_3DPAY_CALLBACK,
  EST_APPROVED_XML,
} from '../../../fixtures/est';

describe('EST utils', () => {
  describe('compareEstKeys', () => {
    it('sorts case-insensitively', () => {
      expect(['oid', 'Email', 'amount', 'TranType'].sort(compareEstKeys)).toEqual([
        'amount',
        'Email',
        'oid',
        'TranType',
      ]);
    });

    it('sorts digit runs by value', () => {
      expect(['a10', 'a2', 'a1'].sort(compareEstKeys)).toEqual(['a1', 'a2', 'a10']);
    });

    it('puts "_" before letters, like the bank', () => {
      expect(['ab', 'a_b'].sort(compareEstKeys)).toEqual(['a_b', 'ab']);
    });
  });

  describe('createEstHash (ver3)', () => {
    it('matches the reference vector for a 3D form', async () => {
      expect(await createEstHash(EST_FORM_FIELDS, EST_TEST.storeKey)).toBe(EST_FORM_HASH);
    });

    it('does not depend on field order', async () => {
      const reversed = Object.fromEntries(Object.entries(EST_FORM_FIELDS).reverse());
      expect(await createEstHash(reversed, EST_TEST.storeKey)).toBe(EST_FORM_HASH);
    });

    it('escapes "\\" and "|" in values and in the store key', async () => {
      expect(await createEstHash({ a: 'x|y', b: 'c\\d' }, 'k|e\\y')).toBe(
        '5lMnbi9fspFKYkvWgTCZWJhi/McRMhXM05sksD43DHr8U9+ZsUKG4+sDE5pubPkanDGyfGCXwPrRZTyNfBLiDA=='
      );
    });

    it('ignores hash, encoding, countdown and nationalidno', async () => {
      const withExtras = {
        ...EST_FORM_FIELDS,
        hash: 'x',
        Encoding: 'UTF-8',
        countdown: '5',
        NationalIdNo: '1',
      };
      expect(await createEstHash(withExtras, EST_TEST.storeKey)).toBe(EST_FORM_HASH);
    });
  });

  describe('verifyEstCallback', () => {
    it('accepts the reference 3d and 3d_pay callbacks', async () => {
      expect(await verifyEstCallback(EST_3D_CALLBACK, EST_TEST.storeKey)).toBe(true);
      expect(await verifyEstCallback(EST_3DPAY_CALLBACK, EST_TEST.storeKey)).toBe(true);
    });

    it('rejects a tampered field', async () => {
      expect(
        await verifyEstCallback({ ...EST_3DPAY_CALLBACK, amount: '0.01' }, EST_TEST.storeKey)
      ).toBe(false);
    });

    it('rejects an added field', async () => {
      expect(
        await verifyEstCallback({ ...EST_3DPAY_CALLBACK, extra: 'x' }, EST_TEST.storeKey)
      ).toBe(false);
    });

    it('rejects a wrong store key or a missing HASH', async () => {
      expect(await verifyEstCallback(EST_3DPAY_CALLBACK, 'other')).toBe(false);
      expect(
        await verifyEstCallback({ ...EST_3DPAY_CALLBACK, HASH: undefined }, EST_TEST.storeKey)
      ).toBe(false);
    });
  });

  it('generates a 32-character random value', () => {
    expect(generateEstRandom()).toMatch(/^[0-9a-f]{32}$/);
    expect(generateEstRandom()).not.toBe(generateEstRandom());
  });

  it('formats amounts with two decimals', () => {
    expect(formatEstAmount('1.2')).toBe('1.20');
    expect(formatEstAmount(100)).toBe('100.00');
  });

  describe('getEstCurrencyCode', () => {
    it('maps supported currencies', () => {
      expect(getEstCurrencyCode(undefined)).toBe('949');
      expect(getEstCurrencyCode('usd')).toBe('840');
      expect(getEstCurrencyCode('EUR')).toBe('978');
      expect(getEstCurrencyCode('GBP')).toBe('826');
      expect(getEstCurrencyCode('MKD')).toBe('807');
    });

    it('rejects unsupported currencies instead of falling back to TRY', () => {
      expect(() => getEstCurrencyCode('JPY')).toThrow(/not supported/);
    });
  });

  it('leaves taksit empty for a single payment', () => {
    expect(formatEstInstallment(undefined)).toBe('');
    expect(formatEstInstallment(1)).toBe('');
    expect(formatEstInstallment(6)).toBe('6');
    expect(() => formatEstInstallment(0)).toThrow();
    expect(() => formatEstInstallment(1.5)).toThrow();
  });

  it('formats the expiry as two digits', () => {
    expect(formatEstExpiry('1', '2030')).toEqual({ month: '01', year: '30' });
    expect(() => formatEstExpiry('13', '30')).toThrow(/Invalid card expiry/);
  });

  it('detects the card type', () => {
    expect(estCardType('4355084355084358')).toBe('visa');
    expect(estCardType('5528790000000008')).toBe('mastercard');
    expect(estCardType('2223000048400011')).toBe('mastercard');
    expect(estCardType('375987000000088')).toBe('amex');
    expect(estCardType('9792030000000000')).toBe('visa');
  });

  it('knows the hosted store types', () => {
    expect(isEstHostedStoreType('3d_host')).toBe(true);
    expect(isEstHostedStoreType('3d_pay_hosting')).toBe(true);
    expect(isEstHostedStoreType('3d')).toBe(false);
    expect(isEstHostedStoreType('3d_pay')).toBe(false);
  });

  describe('buildEstXml', () => {
    it('builds a CC5Request with nested elements', () => {
      const xml = buildEstXml({ Name: 'u', Type: 'Auth', Extra: { ORDERSTATUS: 'SOR' } });
      expect(xml).toBe(
        '<?xml version="1.0" encoding="ISO-8859-9"?><CC5Request><Name>u</Name><Type>Auth</Type>' +
          '<Extra><ORDERSTATUS>SOR</ORDERSTATUS></Extra></CC5Request>'
      );
    });

    it('escapes markup and sends non-ASCII characters as references', () => {
      const xml = buildEstXml({ Name: 'Ayşe & <Ç>' });
      expect(xml).toContain('<Name>Ay&#351;e &amp; &lt;&#199;&gt;</Name>');
      expect(/[^\x20-\x7e]/.test(xml)).toBe(false);
    });
  });

  describe('parseEstXmlResponse', () => {
    it('reads the top-level fields and Extra separately', () => {
      const { fields, extra } = parseEstXmlResponse(EST_APPROVED_XML);
      expect(fields).toMatchObject({
        OrderId: 'ORDER3D',
        Response: 'Approved',
        ProcReturnCode: '00',
        TransId: '26011AAAA1234',
        ErrMsg: '',
      });
      expect(extra).toMatchObject({ HOSTMSG: 'ONAY', SETTLEID: '' });
      expect(fields).not.toHaveProperty('HOSTMSG');
    });

    it('reads self-closing elements and entities', () => {
      const { fields } = parseEstXmlResponse(
        '<CC5Response><ErrMsg>A &amp; B</ErrMsg><AuthCode/></CC5Response>'
      );
      expect(fields).toEqual({ ErrMsg: 'A & B', AuthCode: '' });
    });

    it('throws on a body that is not a CC5Response', () => {
      expect(() => parseEstXmlResponse('<html>error</html>')).toThrow(/unexpected response/);
    });
  });

  it('approves only ProcReturnCode 00 with Response Approved', () => {
    expect(isEstApproved({ ProcReturnCode: '00', Response: 'Approved' })).toBe(true);
    expect(isEstApproved({ ProcReturnCode: '00', Response: 'Declined' })).toBe(false);
    expect(isEstApproved({ ProcReturnCode: '05', Response: 'Approved' })).toBe(false);
    expect(isEstApproved({})).toBe(false);
  });
});
