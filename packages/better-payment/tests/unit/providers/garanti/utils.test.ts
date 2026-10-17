import { describe, it, expect } from 'vitest';
import {
  createGarantiSecurityData,
  createGarantiHashData,
  createGaranti3DHash,
  verifyGarantiCallback,
  formatGarantiAmount,
  getGarantiCurrencyCode,
  formatGarantiInstallment,
  formatGarantiExpiry,
  buildGarantiXml,
  parseGarantiXmlResponse,
  isGarantiApproved,
} from '../../../../src/providers/garanti/utils';
import {
  GARANTI_TEST,
  GARANTI_SECURITY_DATA,
  GARANTI_3D_CALLBACK,
  GARANTI_3DPAY_CALLBACK,
  GARANTI_APPROVED_XML,
  garantiInquiryXml,
} from '../../../fixtures/garanti';

describe('Garanti BBVA utils', () => {
  describe('hashes (reference vectors, ISO-8859-9)', () => {
    it('SecurityData = SHA1(password + terminal id padded to 9 digits)', async () => {
      expect(await createGarantiSecurityData(GARANTI_TEST.password, GARANTI_TEST.terminalId)).toBe(
        GARANTI_SECURITY_DATA
      );
    });

    it('hashes Turkish characters as ISO-8859-9', async () => {
      expect(await createGarantiSecurityData('şifreĞİ', GARANTI_TEST.terminalId)).toBe(
        'BCC9B0D0F9453C13E524916372AA007A69161F09'
      );
    });

    it('HashData with and without a card number', async () => {
      const base = {
        orderId: 'ORDER1',
        terminalId: GARANTI_TEST.terminalId,
        currencyCode: '949',
        securityData: GARANTI_SECURITY_DATA,
      };
      expect(
        await createGarantiHashData({ ...base, cardNumber: '5549603469426017', amount: '120' })
      ).toBe(
        '18657F3D4D1050B859E84CAF55E143AADFB7D0C9C601636F8238A995A03E8190B97CD8B303BC3F4CC29A2F481787D978C4CC3EB5F0B828818AA13E6FD79534ED'
      );
      expect(await createGarantiHashData({ ...base, amount: '1' })).toBe(
        '6FA85DCF3C00DBFEED916BDADD37FBE30A6EF692B7D55919388C4513DA9689C031971BA744E896796B8A1FEC45B3673B6488C0BD3FB5F43DA271F0C1F8865FB7'
      );
    });

    it('secure3dhash of the 3D form', async () => {
      expect(
        await createGaranti3DHash({
          terminalId: GARANTI_TEST.terminalId,
          orderId: 'ORDER3D',
          amount: '120',
          currencyCode: '949',
          successUrl: 'https://example.com/callback',
          errorUrl: 'https://example.com/callback',
          type: 'sales',
          installment: '',
          storeKey: GARANTI_TEST.storeKey,
          securityData: GARANTI_SECURITY_DATA,
        })
      ).toBe(
        '88A915F7BF4F0BBE355EA7F34A7059D763A8406CDC8FDE9B2DF02C80BC1186F5C9E3FED0C322BE4E23466FED2067245BC7D002BADAE822AD3B28D1CAB3E6BB2D'
      );
    });
  });

  describe('verifyGarantiCallback', () => {
    it('accepts the reference 3D and 3D_PAY callbacks (SHA-512)', async () => {
      expect(await verifyGarantiCallback(GARANTI_3D_CALLBACK, GARANTI_TEST.storeKey)).toBe(true);
      expect(await verifyGarantiCallback(GARANTI_3DPAY_CALLBACK, GARANTI_TEST.storeKey)).toBe(true);
    });

    it('accepts a SHA-1 hash from older terminals', async () => {
      expect(
        await verifyGarantiCallback(
          { ...GARANTI_3D_CALLBACK, hash: '41BD05D37CE5E07D8425746C61F59F7DF2DDE008' },
          GARANTI_TEST.storeKey
        )
      ).toBe(true);
    });

    it('rebuilds the value from the fields, ignoring a forged hashparamsval', async () => {
      // The genuine hash and hashparamsval, with the order id changed
      const forged = { ...GARANTI_3D_CALLBACK, oid: 'OTHER', orderid: 'OTHER' };
      expect(await verifyGarantiCallback(forged, GARANTI_TEST.storeKey)).toBe(false);
    });

    it('rejects a tampered covered field', async () => {
      expect(
        await verifyGarantiCallback(
          { ...GARANTI_3D_CALLBACK, mdstatus: '0' },
          GARANTI_TEST.storeKey
        )
      ).toBe(false);
    });

    it('requires hashparams to cover the order id and mdstatus', async () => {
      expect(
        await verifyGarantiCallback(
          { ...GARANTI_3D_CALLBACK, hashparams: 'clientid:authcode:' },
          GARANTI_TEST.storeKey
        )
      ).toBe(false);
    });

    it('rejects a wrong store key or a missing hash', async () => {
      expect(await verifyGarantiCallback(GARANTI_3D_CALLBACK, 'other')).toBe(false);
      expect(
        await verifyGarantiCallback(
          { ...GARANTI_3D_CALLBACK, hash: undefined },
          GARANTI_TEST.storeKey
        )
      ).toBe(false);
    });
  });

  it('formats amounts in minor units', () => {
    expect(formatGarantiAmount('1.2')).toBe('120');
    expect(formatGarantiAmount('11.22')).toBe('1122');
    expect(formatGarantiAmount('0.01')).toBe('1');
  });

  it('maps currencies and rejects unsupported ones', () => {
    expect(getGarantiCurrencyCode(undefined)).toBe('949');
    expect(getGarantiCurrencyCode('usd')).toBe('840');
    expect(getGarantiCurrencyCode('JPY')).toBe('392');
    expect(() => getGarantiCurrencyCode('CHF')).toThrow(/not supported/);
  });

  it('leaves the installment count empty for a single payment', () => {
    expect(formatGarantiInstallment(undefined)).toBe('');
    expect(formatGarantiInstallment(1)).toBe('');
    expect(formatGarantiInstallment(3)).toBe('3');
    expect(() => formatGarantiInstallment(0)).toThrow();
  });

  it('formats the expiry as two digits', () => {
    expect(formatGarantiExpiry('1', '2027')).toEqual({ month: '01', year: '27' });
    expect(() => formatGarantiExpiry('13', '27')).toThrow(/Invalid card expiry/);
  });

  it('builds a GVPSRequest', () => {
    expect(buildGarantiXml({ Mode: 'TEST', Order: { OrderID: 'A&B' } })).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><GVPSRequest><Mode>TEST</Mode>' +
        '<Order><OrderID>A&amp;B</OrderID></Order></GVPSRequest>'
    );
  });

  describe('parseGarantiXmlResponse', () => {
    it('separates the response, transaction and order inquiry fields', () => {
      const parsed = parseGarantiXmlResponse(GARANTI_APPROVED_XML);
      expect(parsed.response).toMatchObject({ Source: 'HOST', Code: '00', Message: 'Approved' });
      expect(parsed.transaction).toMatchObject({ RetrefNum: '628408842186', AuthCode: '405119' });
      expect(parsed.transaction).not.toHaveProperty('Code');
      expect(isGarantiApproved(parsed)).toBe(true);
    });

    it('keeps the inquiry result Code apart from the response Code', () => {
      const parsed = parseGarantiXmlResponse(
        garantiInquiryXml({ Status: 'DECLINED', Code: '53', ReasonCode: '53' })
      );
      expect(parsed.response.Code).toBe('00');
      expect(parsed.orderInquiry).toMatchObject({ Status: 'DECLINED', Code: '53' });
    });

    it('throws on a body that is not a GVPSResponse', () => {
      expect(() => parseGarantiXmlResponse('<html/>')).toThrow(/unexpected response/);
    });
  });
});
