import { describe, it, expect, beforeEach, vi } from 'vitest';
import { betterPayment } from '../../../src';
import { BetterPaymentHandler } from '../../../src/core/BetterPaymentHandler';
import { Parampos, parampos as createParampos } from '../../../src/providers/parampos';
import {
  generateParamposPreAuthHash,
  generateParamposReturnHash,
} from '../../../src/providers/parampos/utils';
import { PaymentStatus } from '../../../src/types';
import { mockThreeDSPaymentRequest } from '../../fixtures/payment-data';

// Param's test account, also used by its published examples
const GUID = '0c13d406-873b-403b-9c09-a5766840d98c';
const CALLBACK_URL = 'https://example.com/callback';

function soap(action: string, fields: Record<string, string>): string {
  const inner = Object.entries(fields)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
    `<${action}Response xmlns="https://turkpos.com.tr/"><${action}Result>${inner}</${action}Result></${action}Response>` +
    '</soap:Body></soap:Envelope>'
  );
}

/**
 * A real TP_Islem_Odeme_WD return, published in mews/pos's ParamPosCryptTest:
 * https://github.com/mewebstudio/pos/blob/e074733bf556bfe844e4a5a370505ceb5267bace/tests/Unit/Crypt/ParamPosCryptTest.php
 */
const referenceCallback: Record<string, string> = {
  TURKPOS_RETVAL_Islem_ID: '21C152499BA0369D94028E30',
  TURKPOS_RETVAL_Sonuc: '1',
  TURKPOS_RETVAL_Sonuc_Str: 'Odeme Islemi Basarili',
  TURKPOS_RETVAL_GUID: GUID,
  TURKPOS_RETVAL_Islem_Tarih: '20.01.2025 17:30:41',
  TURKPOS_RETVAL_Dekont_ID: '3007301017',
  TURKPOS_RETVAL_Tahsilat_Tutari: '10,01',
  TURKPOS_RETVAL_Odeme_Tutari: '9,83',
  TURKPOS_RETVAL_Siparis_ID: '202501208059',
  TURKPOS_RETVAL_Ext_Data: '||||',
  TURKPOS_RETVAL_Banka_Sonuc_Kod: '0',
  TURKPOS_RETVAL_PB: 'EUR',
  TURKPOS_RETVAL_KK_No: '454671******7894',
  TURKPOS_RETVAL_Taksit: '0',
  TURKPOS_RETVAL_Hash: 'sUAKlp9jJ9lyDVV4C0+lAnkDC9I=',
  TURKPOS_RETVAL_Islem_GUID: 'a699b219-9e77-4fc4-b2e8-4fae3e0b0cd1',
  TURKPOS_RETVAL_SanalPOS_Islem_ID: '6021847384',
};

describe('Parampos foreign currency (TP_Islem_Odeme_WD)', () => {
  let parampos: Parampos;
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    parampos = new Parampos({
      clientCode: '10738',
      clientUsername: 'Test',
      clientPassword: 'Test',
      guid: GUID,
      baseUrl: 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx',
    });
    post = vi.fn();
    (parampos as any).client.post = post;
  });

  const sentXml = (call = 0): string => post.mock.calls[call][1];
  const sentAction = (call = 0): string => post.mock.calls[call][2].headers.SOAPAction;

  function foreignRequest(overrides: Record<string, unknown> = {}) {
    return {
      ...mockThreeDSPaymentRequest,
      conversationId: 'ORDER-USD',
      callbackUrl: CALLBACK_URL,
      currency: 'USD',
      price: '100',
      paidPrice: '100.00',
      ...overrides,
    };
  }

  it('keeps TRY on TP_WMD_UCD (no Doviz_Kodu, HTML form)', async () => {
    post.mockResolvedValue({
      data: soap('TP_WMD_UCD', { Sonuc: '1', UCD_HTML: 'BANK-FORM' }),
    });

    const result = await parampos.initThreeDSPayment({ ...mockThreeDSPaymentRequest });

    expect(sentAction()).toBe('https://turkpos.com.tr/TP_WMD_UCD');
    expect(sentXml()).not.toContain('<Doviz_Kodu>');
    expect(result.status).toBe(PaymentStatus.PENDING);
    expect(result.threeDSHtmlContent).toBe('BANK-FORM');
    expect(result.redirectUrl).toBeUndefined();
  });

  it.each([
    ['USD', '1001'],
    ['EUR', '1002'],
    ['GBP', '1003'],
  ])('starts a %s payment with TP_Islem_Odeme_WD and Doviz_Kodu %s', async (currency, code) => {
    post.mockResolvedValue({
      data: soap('TP_Islem_Odeme_WD', {
        Sonuc: '1',
        Islem_ID: '6044512345',
        UCD_URL: 'https://test-dmz.param.com.tr/3d/abc123',
      }),
    });

    const result = await parampos.initThreeDSPayment(
      foreignRequest({ currency, conversationId: `ORDER-${currency}` })
    );

    const xml = sentXml();
    expect(sentAction()).toBe('https://turkpos.com.tr/TP_Islem_Odeme_WD');
    expect(xml).toContain(`<Doviz_Kodu>${code}</Doviz_Kodu>`);
    expect(xml).toContain('<Islem_Guvenlik_Tip>3D</Islem_Guvenlik_Tip>');
    expect(xml).toContain('<Islem_Tutar>100,00</Islem_Tutar>');
    expect(xml).toContain('<Toplam_Tutar>100,00</Toplam_Tutar>');
    expect(xml).toContain(`<Hata_URL>${CALLBACK_URL}</Hata_URL>`);
    expect(xml).toContain(`<Basarili_URL>${CALLBACK_URL}</Basarili_URL>`);
    expect(xml).toContain(`<Siparis_ID>ORDER-${currency}</Siparis_ID>`);
    // The WD request model has no Taksit field
    expect(xml).not.toContain('<Taksit>');
    expect(xml).toContain(
      `<Islem_Hash>${await generateParamposPreAuthHash(
        '10738',
        GUID,
        '100,00',
        '100,00',
        `ORDER-${currency}`,
        CALLBACK_URL,
        CALLBACK_URL
      )}</Islem_Hash>`
    );
    expect(result.status).toBe(PaymentStatus.PENDING);
    expect(result.redirectUrl).toBe('https://test-dmz.param.com.tr/3d/abc123');
    expect(result.threeDSHtmlContent).toBeUndefined();
    expect(result.paymentId).toBe(`ORDER-${currency}`);
  });

  it("matches Param's published WD hash vector", async () => {
    // https://github.com/mewebstudio/pos/.../tests/Unit/Crypt/ParamPosCryptTest.php
    expect(
      await generateParamposPreAuthHash(
        '10738',
        GUID,
        '1000,25',
        '1000,25',
        'order222',
        'https://domain.com/fail',
        'https://domain.com/success'
      )
    ).toBe('LFZ+Sl0mW+ybGvLr1u0ehZoxhxM=');
  });

  it('canonicalises the amount once: 100 and 100.00 produce the same request', async () => {
    post.mockResolvedValue({
      data: soap('TP_Islem_Odeme_WD', { Sonuc: '1', UCD_URL: 'https://x' }),
    });

    await parampos.initThreeDSPayment(foreignRequest({ price: '100', paidPrice: '100.00' }));
    const first = sentXml();

    post.mockClear();
    await parampos.initThreeDSPayment(foreignRequest({ price: '100.00', paidPrice: '100' }));

    expect(sentXml()).toBe(first);
    expect(first).toContain('<Islem_Tutar>100,00</Islem_Tutar>');
    expect(first).toContain('<Toplam_Tutar>100,00</Toplam_Tutar>');
  });

  it('rejects currencies Param does not document for WD', async () => {
    const result = await parampos.initThreeDSPayment(foreignRequest({ currency: 'CHF' }));

    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorCode).toBe('VALIDATION_ERROR');
    expect(result.errorMessage).toMatch(/USD, EUR and GBP/);
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects installments, which the WD request model does not define', async () => {
    const result = await parampos.initThreeDSPayment(foreignRequest({ installment: 3 }));

    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorCode).toBe('VALIDATION_ERROR');
    expect(post).not.toHaveBeenCalled();
  });

  it('reports a declined init as failure', async () => {
    post.mockResolvedValue({
      data: soap('TP_Islem_Odeme_WD', { Sonuc: '-112', Sonuc_Str: 'Tutar formati hatali' }),
    });

    const result = await parampos.initThreeDSPayment(foreignRequest());

    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorCode).toBe('-112');
    expect(result.errorMessage).toBe('Tutar formati hatali');
  });

  it('does not claim a redirect when Sonuc is positive but UCD_URL is missing', async () => {
    post.mockResolvedValue({ data: soap('TP_Islem_Odeme_WD', { Sonuc: '1' }) });

    const result = await parampos.initThreeDSPayment(foreignRequest());

    expect(result.status).toBe(PaymentStatus.PENDING);
    expect(result.redirectUrl).toBeUndefined();
    expect(result.errorCode).toBe('MISSING_UCD_URL');
  });

  it('refuses non-TRY refunds and cancels instead of sending the TRY message', async () => {
    const refund = await parampos.refund({
      paymentId: 'ORDER-USD',
      price: '10.00',
      currency: 'USD',
      ip: '1.1.1.1',
    });
    const cancel = await parampos.cancel({
      paymentId: 'ORDER-USD',
      currency: 'EUR',
      ip: '1.1.1.1',
    });

    for (const result of [refund, cancel]) {
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect(result.errorMessage).toMatch(/no currency-aware refund message/);
    }
    expect(post).not.toHaveBeenCalled();
  });

  describe('TURKPOS_RETVAL_* callback', () => {
    it('verifies the published callback hash vector', async () => {
      expect(await generateParamposReturnHash('10738', referenceCallback)).toBe(
        'sUAKlp9jJ9lyDVV4C0+lAnkDC9I='
      );
    });

    it('completes a USD/EUR/GBP payment from the signed callback without a second request', async () => {
      const result = await parampos.completeThreeDSPayment(referenceCallback);

      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('202501208059');
      expect(result.conversationId).toBe('202501208059');
      expect(result.amount).toBe('10,01');
      expect(result.currency).toBe('EUR');
      expect(post).not.toHaveBeenCalled();
    });

    it('rejects a tampered amount even though the return URL was reached', async () => {
      const result = await parampos.completeThreeDSPayment({
        ...referenceCallback,
        TURKPOS_RETVAL_Tahsilat_Tutari: '99,99',
      });

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('INVALID_HASH');
      expect(post).not.toHaveBeenCalled();
    });

    it('rejects a hash computed with another client code', async () => {
      const forged = {
        ...referenceCallback,
        TURKPOS_RETVAL_Hash: await generateParamposReturnHash('99999', referenceCallback),
      };
      const result = await parampos.completeThreeDSPayment(forged);

      expect(result.errorCode).toBe('INVALID_HASH');
    });

    it('rejects an attacker-chosen GUID signed into the hash', async () => {
      const attackerGuid = '11111111-1111-1111-1111-111111111111';
      const forged: Record<string, string> = {
        ...referenceCallback,
        TURKPOS_RETVAL_GUID: attackerGuid,
      };
      forged.TURKPOS_RETVAL_Hash = await generateParamposReturnHash('10738', forged);
      const result = await parampos.completeThreeDSPayment(forged);

      expect(result.errorCode).toBe('INVALID_HASH');
    });

    it('rejects a callback without a hash', async () => {
      const { TURKPOS_RETVAL_Hash: _hash, ...withoutHash } = referenceCallback;
      const result = await parampos.completeThreeDSPayment(withoutHash);

      expect(result.errorCode).toBe('INVALID_HASH');
    });

    it('requires a non-zero Islem_ID and a positive Dekont_ID', async () => {
      const zeroDekont = {
        ...referenceCallback,
        TURKPOS_RETVAL_Dekont_ID: '0',
        TURKPOS_RETVAL_Hash: '',
      };
      zeroDekont.TURKPOS_RETVAL_Hash = await generateParamposReturnHash('10738', zeroDekont);
      const result = await parampos.completeThreeDSPayment(zeroDekont);

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).not.toBe('INVALID_HASH');

      const zeroIslem = {
        ...referenceCallback,
        TURKPOS_RETVAL_Islem_ID: '0',
        TURKPOS_RETVAL_Hash: '',
      };
      zeroIslem.TURKPOS_RETVAL_Hash = await generateParamposReturnHash('10738', zeroIslem);
      const islemResult = await parampos.completeThreeDSPayment(zeroIslem);

      expect(islemResult.status).toBe(PaymentStatus.FAILURE);
      expect(islemResult.errorCode).not.toBe('INVALID_HASH');
    });

    it('is idempotent for duplicate deliveries through the handler', async () => {
      const payment = betterPayment({
        providers: {
          parampos: createParampos({
            clientCode: '10738',
            clientUsername: 'Test',
            clientPassword: 'Test',
            guid: GUID,
          }),
        },
      });
      const onCallback = vi.fn();
      const handler = new BetterPaymentHandler(payment, { onCallback });
      const body = new URLSearchParams(referenceCallback).toString();
      const request = {
        method: 'POST',
        url: '/api/pay/parampos/callback',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      };

      const first = await handler.handle(request);
      const second = await handler.handle({ ...request, body });

      expect(first.status).toBe(200);
      expect(second.body).toEqual(first.body);
      expect(onCallback).toHaveBeenCalledTimes(1);
      expect(onCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PaymentStatus.SUCCESS,
          paymentId: '202501208059',
          amount: '10,01',
          currency: 'EUR',
        }),
        expect.objectContaining({ provider: 'parampos', action: 'callback' })
      );
    });
  });
});
