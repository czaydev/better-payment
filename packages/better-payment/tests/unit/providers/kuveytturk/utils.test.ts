import { describe, it, expect } from 'vitest';
import {
  kuveytTurkHashPassword,
  createKuveytTurkPaymentHash,
  createKuveytTurkProvisionHash,
  createKuveytTurkSaleReversalHash,
  createKuveytTurkGetTransactionHash,
  createKuveytTurkGetTransactionsHash,
  formatKuveytTurkAmount,
  getKuveytTurkCurrencyCode,
  formatKuveytTurkExpiry,
  formatKuveytTurkInstallment,
  getKuveytTurkLanguage,
  parseKuveytTurkPhone,
  parseKuveytTurkForm,
  kuveytTurkStatusCode,
} from '../../../../src/providers/kuveytturk/utils';

// Vectors computed independently with node:crypto (SHA1 / HMAC-SHA512, base64)
// following the field order in the KT Pay Gate integration document.
const CREDENTIALS = { merchantId: '12345', username: 'apiuser', password: 'secret123' };
const ORDER = 'ORDER-1001';

describe('Kuveyt Türk utils', () => {
  describe('hash', () => {
    it('hashes the password as base64(SHA1)', async () => {
      expect(await kuveytTurkHashPassword('secret123')).toBe('8rFPaOuZX6yzocNSh7d41b14VRE=');
    });

    it('hashes a password with Turkish characters as UTF-8', async () => {
      expect(await kuveytTurkHashPassword('şifreĞü')).toBe('9S86Z+hsqFqyJIMxH5M5Ad8Yw4c=');
    });

    it('signs Payment with the success and fail URLs', async () => {
      const hash = await createKuveytTurkPaymentHash(CREDENTIALS, {
        merchantOrderId: ORDER,
        amount: '10265',
        successUrl: 'https://shop.test/ok',
        failUrl: 'https://shop.test/fail',
      });
      expect(hash).toBe(
        'i9V7jBEhV7XYid0Qf7X9ApZXb6klrUlF+cy88TrBG9rsBuxaKmKqw1wGVohS4BHqEBuWCc1G8C7nR0ZsuT7pkQ=='
      );
    });

    it('signs Provision without the URLs', async () => {
      const hash = await createKuveytTurkProvisionHash(CREDENTIALS, {
        merchantOrderId: ORDER,
        amount: '10265',
      });
      expect(hash).toBe(
        '2v6YPkkDQwcqtbDi/HX0NhqLhLrTzAQSSBohxubY2uhggHBhL21jNbyjJs+ze+59cwR+d8qCn+gdF2BTfcyJlg=='
      );
    });

    it('signs Cancel and Drawback with amount 0, whatever amount is passed', async () => {
      const expected =
        '34HOIOjh36XJo/pRPiIGFMa8MC6F1AANxus3SC3F6G5icEibuwkcOvN2sBzQ2FFjGRu64KvrR1AqaL6N5jhjBg==';
      expect(
        await createKuveytTurkSaleReversalHash(CREDENTIALS, {
          merchantOrderId: ORDER,
          type: 'Cancel',
          amount: '10265',
        })
      ).toBe(expected);
      expect(
        await createKuveytTurkSaleReversalHash(CREDENTIALS, {
          merchantOrderId: ORDER,
          type: 'Drawback',
          amount: '10265',
        })
      ).toBe(expected);
    });

    it('signs PartialDrawback with the refunded amount', async () => {
      const hash = await createKuveytTurkSaleReversalHash(CREDENTIALS, {
        merchantOrderId: ORDER,
        type: 'PartialDrawback',
        amount: '5000',
      });
      expect(hash).toBe(
        'GQ2V/7auVPqxqs6LKs0xpi41HwSWtkifKTF3/0497Wgce/VLsxx8AIAO5ge5PLN48QZKi2qGWVti8FJad5ZndA=='
      );
    });

    it('signs GetTransaction and GetTransactions', async () => {
      expect(await createKuveytTurkGetTransactionHash(CREDENTIALS)).toBe(
        '/QK7PRM8CziWRK84/q+sIrtmPgH12J/6+n+oRJ4Py0b8zWSi/fsW4nPaGANjnTt00VVoM4a1LsYi0TvTILqzgA=='
      );
      expect(
        await createKuveytTurkGetTransactionsHash(CREDENTIALS, { merchantOrderId: ORDER })
      ).toBe(
        '96DoN27bamxnJhs+EKsss7Y4hRzQ2M2tpUM+udeTHHV32ZCk6cvPtYnPrH5uO7SkwlQQUl8rNFnfAjOzXUxVkg=='
      );
    });

    it('changes when the password is wrong', async () => {
      const hash = await createKuveytTurkProvisionHash(
        { ...CREDENTIALS, password: 'other' },
        { merchantOrderId: ORDER, amount: '10265' }
      );
      expect(hash).not.toBe(
        '2v6YPkkDQwcqtbDi/HX0NhqLhLrTzAQSSBohxubY2uhggHBhL21jNbyjJs+ze+59cwR+d8qCn+gdF2BTfcyJlg=='
      );
    });
  });

  describe('formatKuveytTurkAmount', () => {
    it('sends 100 times the amount without separators', () => {
      expect(formatKuveytTurkAmount('102.65')).toBe('10265');
      expect(formatKuveytTurkAmount(1)).toBe('100');
      expect(formatKuveytTurkAmount('1234.50')).toBe('123450');
    });

    it('avoids float multiplication errors', () => {
      expect(formatKuveytTurkAmount(0.29)).toBe('29');
      expect(formatKuveytTurkAmount('19.99')).toBe('1999');
    });
  });

  describe('getKuveytTurkCurrencyCode', () => {
    it('maps supported currencies to four-digit codes', () => {
      expect(getKuveytTurkCurrencyCode(undefined)).toBe('0949');
      expect(getKuveytTurkCurrencyCode('TRY')).toBe('0949');
      expect(getKuveytTurkCurrencyCode('usd')).toBe('0840');
      expect(getKuveytTurkCurrencyCode('EUR')).toBe('0978');
    });

    it('rejects unsupported currencies instead of falling back to TRY', () => {
      expect(() => getKuveytTurkCurrencyCode('GBP')).toThrow(/not supported/);
    });
  });

  describe('formatKuveytTurkExpiry', () => {
    it('returns two-digit month and year', () => {
      expect(formatKuveytTurkExpiry('1', '2025')).toEqual({ expireMonth: '01', expireYear: '25' });
      expect(formatKuveytTurkExpiry('12', '33')).toEqual({ expireMonth: '12', expireYear: '33' });
    });

    it('rejects invalid months', () => {
      expect(() => formatKuveytTurkExpiry('13', '25')).toThrow(/Invalid card expiry/);
    });
  });

  describe('formatKuveytTurkInstallment', () => {
    it('defaults to 1 and accepts up to 12', () => {
      expect(formatKuveytTurkInstallment(undefined)).toBe(1);
      expect(formatKuveytTurkInstallment(0)).toBe(1);
      expect(formatKuveytTurkInstallment(12)).toBe(12);
    });

    it('rejects more than 12 installments', () => {
      expect(() => formatKuveytTurkInstallment(13)).toThrow(/1 to 12/);
    });
  });

  it('maps the locale to the language code', () => {
    expect(getKuveytTurkLanguage(undefined)).toBe(1);
    expect(getKuveytTurkLanguage('tr')).toBe(1);
    expect(getKuveytTurkLanguage('en-US')).toBe(2);
  });

  describe('parseKuveytTurkPhone', () => {
    it.each([
      ['+905350000000', '90', '5350000000'],
      ['905350000000', '90', '5350000000'],
      ['05350000000', '90', '5350000000'],
      ['535 000 00 00', '90', '5350000000'],
    ])('%s', (input, cc, subscriber) => {
      expect(parseKuveytTurkPhone(input)).toEqual({ cc, subscriber });
    });

    it.each(['12345', '+4915112345678'])('rejects %s', (input) => {
      expect(() => parseKuveytTurkPhone(input)).toThrow(/Turkish GSM number/);
    });
  });

  it('parses the hidden inputs of the Payment response form', () => {
    const fields = parseKuveytTurkForm(
      '<form><input type="hidden" name="Success" value="False" />' +
        '<input name="ResponseMessage" type="hidden" value="Hata &amp; uyar&#305;" /></form>'
    );
    expect(fields).toEqual({ Success: 'False', ResponseMessage: 'Hata & uyarı' });
  });

  it('reads the number of a status label', () => {
    expect(kuveytTurkStatusCode('Basarısız (2)')).toBe(2);
    expect(kuveytTurkStatusCode('Zaman Aşımı (3)')).toBe(3);
    expect(kuveytTurkStatusCode('Bilinmiyor')).toBeUndefined();
    expect(kuveytTurkStatusCode(undefined)).toBeUndefined();
  });
});
