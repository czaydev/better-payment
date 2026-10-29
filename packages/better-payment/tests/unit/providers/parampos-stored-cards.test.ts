import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Parampos } from '../../../src/providers/parampos';
import {
  buildParamposSoapEnvelope,
  decodeParamposHtml,
  defaultParamposKsUrl,
  escapeXml,
  extractParamposDataSetXml,
  parseParamposSoapResponse,
} from '../../../src/providers/parampos/utils';
import { PaymentStatus } from '../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../fixtures/payment-data';

// Reference values from Param's test environment
const GUID = '0c13d406-873b-403b-9c09-a5766840d98c';
const PAYMENT_URL = 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx';
const KS_URL = 'https://testposws.param.com.tr/out.ws/service_ks.asmx';
const STORED = { customerToken: 'CUST1', cardToken: 'KS-GUID-1', cvc: '123' };
const CARD = {
  cardHolderName: 'John Doe',
  cardNumber: '5528790000000008',
  expireMonth: '12',
  expireYear: '2030',
  cvc: '123',
};
const { paymentCard: _card, ...order } = mockPaymentRequest;

const fieldsXml = (fields: Record<string, string>): string =>
  Object.entries(fields)
    .map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`)
    .join('');

const soap = (action: string, inner: string, namespace = 'https://turkpara.com.tr/'): string =>
  '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
  `<${action}Response xmlns="${namespace}"><${action}Result>${inner}</${action}Result></${action}Response>` +
  '</soap:Body></soap:Envelope>';

const ksSoap = (action: string, fields: Record<string, string>): string =>
  soap(action, fieldsXml(fields));

/** KS_Kart_Liste response with a <Temp> row per card */
const ksListResponse = (rows: Record<string, string>[]): string => {
  const body = rows
    .map((row) => `<Temp>${fieldsXml(row)}</Temp>`)
    .join('');
  return soap(
    'KS_Kart_Liste',
    '<Sonuc>1</Sonuc><Sonuc_Str>Başarılı</Sonuc_Str><DT_Bilgi><diffgr:diffgram>' +
      `<NewDataSet>${body}</NewDataSet></diffgr:diffgram></DT_Bilgi>`
  );
};

const listRow = (overrides: Record<string, string> = {}): Record<string, string> => ({
  ID: '1',
  KK_GUID: 'KS-GUID-1',
  Tarih: '2025-01-17',
  KK_No: '552879',
  KK_Tip: 'VISA',
  KK_Banka: 'AKBANK T.A.Ş.',
  KK_Marka: 'Bonus',
  Kart_Adi: 'Work',
  KK_Hash: 'hash-of-the-card',
  KK_KD: 'Kredi Kartı',
  KK_SK: '203012',
  ...overrides,
});

describe('Parampos card storage', () => {
  let parampos: Parampos;
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    parampos = new Parampos({
      clientCode: '10738',
      clientUsername: 'Test',
      clientPassword: 'Test',
      guid: GUID,
      baseUrl: PAYMENT_URL,
    });
    post = vi.fn();
    (parampos as any).client.post = post;
  });

  const sentXml = (call = 0): string => post.mock.calls[call][1];
  const sentAction = (call = 0): string =>
    post.mock.calls[call][2].headers.SOAPAction as string;

  it('builds the KS envelope with its own namespace', async () => {
    const envelope = buildParamposSoapEnvelope(
      'KS_Kart_Sil',
      {
        G: { CLIENT_CODE: '10738', CLIENT_USERNAME: 'Test', CLIENT_PASSWORD: 'Test' },
        KS_GUID: 'KS-GUID-1',
        KK_Islem_ID: 'CUST1',
      },
      'https://turkpara.com.tr/'
    );

    expect(envelope).toContain('<KS_Kart_Sil xmlns="https://turkpara.com.tr/">');
    expect(envelope).toContain(
      '<G><CLIENT_CODE>10738</CLIENT_CODE><CLIENT_USERNAME>Test</CLIENT_USERNAME><CLIENT_PASSWORD>Test</CLIENT_PASSWORD></G>'
    );
    expect(envelope).not.toContain('Islem_Hash');
    expect(envelope).not.toContain('GUID>0c13d406');
  });

  it('defaults the KS endpoint from the environment', () => {
    expect(defaultParamposKsUrl(PAYMENT_URL)).toBe(KS_URL);
    expect(defaultParamposKsUrl('https://posws.param.com.tr/turkpos.ws/service_turkpos_prod.asmx')).toBe(
      'https://posws.param.com.tr/out.ws/service_ks.asmx'
    );
  });

  it('saves a card with KS_Kart_Ekle on the KS service, without hash or CVC', async () => {
    post.mockResolvedValue({
      data: ksSoap('KS_Kart_Ekle', {
        Sonuc: '1',
        Sonuc_Str: 'Başarılı',
        KS_GUID: 'KS-GUID-1',
      }),
    });

    const result = await parampos.saveCard({
      customerToken: 'CUST1',
      alias: 'Work',
      card: {
        cardHolderName: 'John Doe',
        cardNumber: CARD.cardNumber,
        expireMonth: '12',
        expireYear: '2030',
      },
    });

    expect(post.mock.calls[0][0]).toBe(KS_URL);
    expect(sentAction()).toBe('https://turkpara.com.tr/KS_Kart_Ekle');
    const xml = sentXml();
    expect(xml).toContain('<KS_Kart_Ekle xmlns="https://turkpara.com.tr/">');
    expect(xml).toContain(`<GUID>${GUID}</GUID>`);
    expect(xml).toContain('<KK_Sahibi>John Doe</KK_Sahibi>');
    expect(xml).toContain('<KK_No>5528790000000008</KK_No>');
    expect(xml).toContain('<KK_SK_Ay>12</KK_SK_Ay>');
    expect(xml).toContain('<KK_SK_Yil>2030</KK_SK_Yil>');
    expect(xml).toContain('<KK_Kart_Adi>Work</KK_Kart_Adi>');
    expect(xml).toContain('<KK_Islem_ID>CUST1</KK_Islem_ID>');
    expect(xml).not.toContain('Islem_Hash');
    expect(xml).not.toContain('KK_CVC');
    expect(result).toMatchObject({
      status: PaymentStatus.SUCCESS,
      customerToken: 'CUST1',
      card: { cardToken: 'KS-GUID-1', alias: 'Work' },
    });
  });

  it('generates the KK_Islem_ID when no customer token is given and reports storage errors', async () => {
    post.mockResolvedValue({
      data: ksSoap('KS_Kart_Ekle', { Sonuc: '-1', Sonuc_Str: 'Kart saklanamadı' }),
    });

    const result = await parampos.saveCard({ card: { ...CARD } });

    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorMessage).toBe('Kart saklanamadı');
    expect(result.card).toBeUndefined();
    expect(result.customerToken).toMatch(/^CARD\d+[A-F0-9]{8}$/);
    expect(sentXml()).toContain(`<KK_Islem_ID>${result.customerToken}</KK_Islem_ID>`);
  });

  it('lists a customer’s cards from the KS_Kart_Liste DataSet', async () => {
    post.mockResolvedValue({ data: ksListResponse([listRow()]) });

    const result = await parampos.listCards({ customerToken: 'CUST1' });

    expect(post.mock.calls[0][0]).toBe(KS_URL);
    expect(sentAction()).toBe('https://turkpara.com.tr/KS_Kart_Liste');
    expect(post.mock.calls[0][2].retryable).toBe(true);
    expect(sentXml()).toContain('<KK_Kart_Adi></KK_Kart_Adi>');
    expect(sentXml()).toContain('<KK_Islem_ID>CUST1</KK_Islem_ID>');
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.customerToken).toBe('CUST1');
    expect(result.cards).toEqual([
      {
        cardToken: 'KS-GUID-1',
        alias: 'Work',
        cardType: 'VISA',
        cardAssociation: 'Bonus',
        bankName: 'AKBANK T.A.Ş.',
      },
    ]);
    // Param's list does not expose reliable display digits or an expiry format
    expect(result.cards[0].lastFourDigits).toBeUndefined();
    expect(result.cards[0].expireMonth).toBeUndefined();
    expect(result.cards[0].binNumber).toBeUndefined();
  });

  it('lists an empty DataSet as no cards, and surfaces list errors', async () => {
    post.mockResolvedValueOnce({ data: ksListResponse([]) });
    const empty = await parampos.listCards({ customerToken: 'CUST1' });
    expect(empty).toMatchObject({ status: PaymentStatus.SUCCESS, cards: [] });

    post.mockResolvedValueOnce({
      data: ksSoap('KS_Kart_Liste', { Sonuc: '-1', Sonuc_Str: 'Kayıt bulunamadı' }),
    });
    const failed = await parampos.listCards({ customerToken: 'CUST2' });
    expect(failed.status).toBe(PaymentStatus.FAILURE);
    expect(failed.errorMessage).toBe('Kayıt bulunamadı');
    expect(failed.cards).toEqual([]);
  });

  it('requires a customer token to list cards', async () => {
    const result = await parampos.listCards({ customerToken: '' });
    expect(post).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: PaymentStatus.FAILURE, cards: [] });
    expect(result.errorMessage).toContain('customerToken');
  });

  it('deletes with KS_Kart_Sil (G, KS_GUID, KK_Islem_ID; no merchant GUID or hash)', async () => {
    post.mockResolvedValue({ data: ksSoap('KS_Kart_Sil', { Sonuc: '1' }) });

    const result = await parampos.deleteCard({
      customerToken: 'CUST1',
      cardToken: 'KS-GUID-1',
    });

    expect(post.mock.calls[0][0]).toBe(KS_URL);
    expect(sentAction()).toBe('https://turkpara.com.tr/KS_Kart_Sil');
    const xml = sentXml();
    expect(xml).toContain('<KS_Kart_Sil xmlns="https://turkpara.com.tr/">');
    expect(xml).toContain('<KS_GUID>KS-GUID-1</KS_GUID>');
    expect(xml).toContain('<KK_Islem_ID>CUST1</KK_Islem_ID>');
    expect(xml).not.toContain(`<GUID>${GUID}</GUID>`);
    expect(xml).not.toContain('Islem_Hash');
    expect(result.status).toBe(PaymentStatus.SUCCESS);
  });

  it('reports delete errors and requires both tokens', async () => {
    post.mockResolvedValue({
      data: ksSoap('KS_Kart_Sil', { Sonuc: '-1', Sonuc_Str: 'Kart silinemedi' }),
    });
    const failed = await parampos.deleteCard({
      customerToken: 'CUST1',
      cardToken: 'KS-GUID-1',
    });
    expect(failed.status).toBe(PaymentStatus.FAILURE);
    expect(failed.errorMessage).toBe('Kart silinemedi');

    post.mockClear();
    const invalid = await parampos.deleteCard({ customerToken: '', cardToken: '' });
    expect(post).not.toHaveBeenCalled();
    expect(invalid.errorMessage).toContain('customerToken');
  });

  it('charges a stored card with KS_Tahsilat (NS) without sending card data', async () => {
    post.mockResolvedValue({
      data: ksSoap('KS_Tahsilat', {
        Sonuc: '1',
        Sonuc_Str: 'Başarılı',
        UCD_URL: 'NONSECURE',
        Islem_ID: '3007296556',
      }),
    });

    const result = await parampos.createPayment({
      ...order,
      conversationId: 'ORDER1',
      storedCard: STORED,
    });

    expect(post.mock.calls[0][0]).toBe(KS_URL);
    expect(sentAction()).toBe('https://turkpara.com.tr/KS_Tahsilat');
    const xml = sentXml();
    expect(xml).toContain('<Islem_Guvenlik_Tip>NS</Islem_Guvenlik_Tip>');
    expect(xml).toContain('<KS_GUID>KS-GUID-1</KS_GUID>');
    expect(xml).toContain('<CVV>123</CVV>');
    expect(xml).toContain('<KK_Islem_ID>CUST1</KK_Islem_ID>');
    expect(xml).toContain('<Siparis_ID>ORDER1</Siparis_ID>');
    expect(xml).toContain('<Taksit>1</Taksit>');
    expect(xml).not.toContain('<KK_No>');
    expect(xml).not.toContain('Islem_Hash');
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.paymentId).toBe('ORDER1');
  });

  it('does not treat a non-NONSECURE KS_Tahsilat response as a successful payment', async () => {
    post.mockResolvedValue({
      data: ksSoap('KS_Tahsilat', {
        Sonuc: '1',
        Sonuc_Str: 'Ödeme başlatıldı',
        UCD_URL: '<form></form>',
        Islem_ID: '3007296556',
      }),
    });

    const result = await parampos.createPayment({ ...order, storedCard: STORED });

    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorMessage).toBe('Ödeme başlatıldı');
  });

  it('accepts an empty CVV: KS_Tahsilat documents CVV as optional', async () => {
    post.mockResolvedValue({
      data: ksSoap('KS_Tahsilat', {
        Sonuc: '1',
        UCD_URL: 'NONSECURE',
        Islem_ID: '1',
      }),
    });

    await parampos.createPayment({
      ...order,
      storedCard: { customerToken: 'CUST1', cardToken: 'KS-GUID-1' },
    });

    expect(sentXml()).toContain('<CVV></CVV>');
  });

  it('rejects storedCard together with saveCard', async () => {
    const result = await parampos.createPayment({
      ...order,
      storedCard: STORED,
      saveCard: true,
    });
    expect(post).not.toHaveBeenCalled();
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorMessage).toContain('saveCard requires paymentCard');
  });

  it('does not accept a stored card for pre-authorization', async () => {
    const result = await parampos.authorize({ ...order, storedCard: STORED });
    expect(post).not.toHaveBeenCalled();
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorMessage).toContain('storedCard is not supported');
  });

  it('initializes a stored-card 3D payment with KS_Tahsilat and decodes its form', async () => {
    post.mockResolvedValue({
      data: ksSoap('KS_Tahsilat', {
        Sonuc: '1',
        UCD_URL: '&lt;form action=&quot;https://bank.example&quot;&gt;&lt;/form&gt;',
      }),
    });

    const result = await parampos.initThreeDSPayment({
      ...mockThreeDSPaymentRequest,
      conversationId: 'ORDER1',
      storedCard: STORED,
    });

    expect(post.mock.calls[0][0]).toBe(KS_URL);
    expect(sentAction()).toBe('https://turkpara.com.tr/KS_Tahsilat');
    const xml = sentXml();
    expect(xml).toContain('<Islem_Guvenlik_Tip>3D</Islem_Guvenlik_Tip>');
    expect(xml).toContain('<KS_GUID>KS-GUID-1</KS_GUID>');
    expect(xml).toContain('<Basarili_URL>https://example.com/callback</Basarili_URL>');
    expect(xml).toContain('<Hata_URL>https://example.com/callback</Hata_URL>');
    expect(result.status).toBe(PaymentStatus.PENDING);
    expect(result.threeDSHtmlContent).toBe('<form action="https://bank.example"></form>');
    expect(result.paymentId).toBe('ORDER1');
  });

  it('saves the card during a card payment and returns its tokens', async () => {
    post
      .mockResolvedValueOnce({
        data: ksSoap('KS_Kart_Ekle', { Sonuc: '1', KS_GUID: 'KS-GUID-NEW' }),
      })
      .mockResolvedValueOnce({
        data: soap(
          'TP_WMD_UCD',
          fieldsXml({ Sonuc: '1', Islem_ID: '3007296556', UCD_HTML: 'NONSECURE' }),
          'https://turkpos.com.tr/'
        ),
      });

    const result = await parampos.createPayment({
      ...mockPaymentRequest,
      conversationId: 'ORDER1',
      saveCard: { customerToken: 'CUST1', alias: 'Work' },
    });

    expect(post.mock.calls[0][0]).toBe(KS_URL);
    expect(post.mock.calls[1][0]).toBe('');
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.storedCard).toEqual({ customerToken: 'CUST1', cardToken: 'KS-GUID-NEW' });
    // The card is charged through the usual payment service, with its own hash
    expect(sentXml(1)).toContain('<Islem_Hash>');
  });

  it('does not charge when the card cannot be saved', async () => {
    post.mockResolvedValue({
      data: ksSoap('KS_Kart_Ekle', { Sonuc: '-1', Sonuc_Str: 'Kart saklanamadı' }),
    });

    const result = await parampos.createPayment({
      ...mockPaymentRequest,
      saveCard: true,
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorMessage).toBe('Kart saklanamadı');
  });

  it('saves the card before a 3D payment and returns the tokens with the form', async () => {
    post
      .mockResolvedValueOnce({
        data: ksSoap('KS_Kart_Ekle', { Sonuc: '1', KS_GUID: 'KS-GUID-NEW' }),
      })
      .mockResolvedValueOnce({
        data: soap(
          'TP_WMD_UCD',
          fieldsXml({ Sonuc: '1', UCD_HTML: '<form id="3d"></form>' }),
          'https://turkpos.com.tr/'
        ),
      });

    const result = await parampos.initThreeDSPayment({
      ...mockThreeDSPaymentRequest,
      saveCard: true,
    });

    expect(result.status).toBe(PaymentStatus.PENDING);
    expect(result.threeDSHtmlContent).toBe('<form id="3d"></form>');
    expect(result.storedCard?.cardToken).toBe('KS-GUID-NEW');
  });

  describe('KS 3D callback (TURKPOS_RETVAL_*)', () => {
    const callback = {
      TURKPOS_RETVAL_Sonuc: '1',
      TURKPOS_RETVAL_Sonuc_Str: 'Başarılı',
      TURKPOS_RETVAL_Siparis_ID: 'ORDER1',
      TURKPOS_RETVAL_Dekont_ID: '3007295376',
      TURKPOS_RETVAL_Islem_ID: '3007296556',
    };

    it('confirms a successful payment with TP_Islem_Sorgulama4', async () => {
      post.mockResolvedValue({
        data: soap(
          'TP_Islem_Sorgulama4',
          fieldsXml({
            Sonuc: '1',
            Sonuc_Str: 'Başarılı',
            Durum: 'SUCCESS',
            Siparis_ID: 'ORDER1',
            Toplam_Tutar: '1.20',
          }),
          'https://turkpos.com.tr/'
        ),
      });

      const result = await parampos.completeThreeDSPayment(callback);

      expect(post.mock.calls[0][0]).toBe('');
      expect(sentAction()).toBe('https://turkpos.com.tr/TP_Islem_Sorgulama4');
      expect(sentXml()).toContain('<Siparis_ID>ORDER1</Siparis_ID>');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDER1');
    });

    it('fails a failed callback without querying the order', async () => {
      const result = await parampos.completeThreeDSPayment({
        ...callback,
        TURKPOS_RETVAL_Sonuc: '-1',
        TURKPOS_RETVAL_Sonuc_Str: '3D doğrulama başarısız',
      });

      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toBe('3D doğrulama başarısız');
    });

    it('rejects a callback without an order id', async () => {
      const result = await parampos.completeThreeDSPayment({
        TURKPOS_RETVAL_Sonuc: '1',
      });

      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('INVALID_CALLBACK');
    });

    it('does not trust a forged success callback for an unknown or failed order', async () => {
      post.mockResolvedValue({
        data: soap(
          'TP_Islem_Sorgulama4',
          fieldsXml({ Sonuc: '-1', Sonuc_Str: 'İşlem bulunamadı' }),
          'https://turkpos.com.tr/'
        ),
      });

      const result = await parampos.completeThreeDSPayment(callback);

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toBe('İşlem bulunamadı');
    });

    it('returns PENDING when the order is not confirmed yet, never FAILURE', async () => {
      post.mockResolvedValue({
        data: soap(
          'TP_Islem_Sorgulama4',
          fieldsXml({ Sonuc: '1', Durum: 'PENDING', Siparis_ID: 'ORDER1' }),
          'https://turkpos.com.tr/'
        ),
      });

      const result = await parampos.completeThreeDSPayment(callback);

      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.errorCode).toBe('PAYMENT_NOT_CONFIRMED');
    });

    it('fails when the order was cancelled or refunded', async () => {
      post.mockResolvedValue({
        data: soap(
          'TP_Islem_Sorgulama4',
          fieldsXml({ Sonuc: '1', Durum: 'CANCEL', Siparis_ID: 'ORDER1' }),
          'https://turkpos.com.tr/'
        ),
      });

      const result = await parampos.completeThreeDSPayment(callback);
      expect(result.status).toBe(PaymentStatus.FAILURE);
    });
  });

  describe('utilities', () => {
    it('decodes the HTML-encoded KS 3D form', () => {
      expect(decodeParamposHtml('&lt;form action=&quot;x&quot;&gt;&amp;&lt;/form&gt;')).toBe(
        '<form action="x">&</form>'
      );
    });

    it('parses inline and escaped DataSet XML', () => {
      const rows =
        '<diffgr:diffgram><NewDataSet>' +
        '<Temp><KK_GUID>a</KK_GUID><Kart_Adi>Work</Kart_Adi></Temp>' +
        '</NewDataSet></diffgr:diffgram>';
      const inline = `<KS_Kart_ListeResult><DT_Bilgi>${rows}</DT_Bilgi></KS_Kart_ListeResult>`;
      const escaped = `<KS_Kart_ListeResult><DT_Bilgi>${escapeXml(rows)}</DT_Bilgi></KS_Kart_ListeResult>`;
      expect(extractParamposDataSetXml(inline)).toContain('<Temp>');
      expect(extractParamposDataSetXml(escaped)).toContain('<Temp>');
    });

    it('keeps values XML-unescaped once (not twice)', () => {
      const result = parseParamposSoapResponse<{ Sonuc: string; Sonuc_Str: string }>(
        soap('KS_Tahsilat', '<Sonuc>1</Sonuc><Sonuc_Str>Kart &amp; ödeme</Sonuc_Str>'),
        'KS_TahsilatResult'
      );
      expect(result.Sonuc_Str).toBe('Kart & ödeme');
    });
  });

  it('never logs card data (PAN, CVC or the request body)', async () => {
    const debug = vi.fn();
    const info = vi.fn();
    const error = vi.fn();
    const fetch = vi.fn(async () =>
      new Response(
        soap(
          'TP_WMD_UCD',
          fieldsXml({ Sonuc: '1', Islem_ID: '3007296556' }),
          'https://turkpos.com.tr/'
        )
      )
    );
    const provider = new Parampos({
      clientCode: '10738',
      clientUsername: 'Test',
      clientPassword: 'Test',
      guid: GUID,
      baseUrl: PAYMENT_URL,
      logger: { debug, info, error },
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const result = await provider.createPayment({ ...mockPaymentRequest, conversationId: 'ORDER1' });
    expect(result.status).toBe(PaymentStatus.SUCCESS);

    const logged = JSON.stringify([...debug.mock.calls, ...info.mock.calls, ...error.mock.calls]);
    expect(logged).not.toContain(CARD.cardNumber);
    expect(logged).not.toContain(CARD.cvc);
    expect(logged).not.toContain('<KK_No>');
    expect(logged).not.toContain('CLIENT_PASSWORD');
    expect(logged).toContain('service_turkpos_test.asmx');
  });
});
