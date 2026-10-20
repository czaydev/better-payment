import { describe, it, expect } from 'vitest';
import {
  betterPayment,
  definePlugin,
  ConfigurationError,
  PaymentErrorCode,
  PaymentStatus,
} from 'better-payment';
import { MockProvider, MOCK_CARDS } from 'better-payment/testing';
import {
  i18n,
  locales,
  type I18nOptions,
  localizedErrors,
  parseAcceptLanguage,
} from 'better-payment/plugins';
import { mockPaymentRequest } from '../../fixtures/payment-data';

const withCard = (cardNumber: string) => ({
  ...mockPaymentRequest,
  paymentCard: { ...mockPaymentRequest.paymentCard!, cardNumber },
});

const post = (url: string, body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  url,
  headers: { 'content-type': 'application/json', ...headers },
  body,
});

describe('i18n', () => {
  it('has a message for every error code in every built-in language', () => {
    for (const messages of Object.values(locales)) {
      expect(Object.keys(messages).sort()).toEqual(Object.values(PaymentErrorCode).sort());
      expect(Object.values(messages).every((m) => m.length > 0)).toBe(true);
    }
  });

  it('replaces the message of failures and keeps the provider message', async () => {
    const mock = new MockProvider();
    const payment = betterPayment({ providers: { mock }, plugins: [i18n({ translations: {} })] });

    const declined = await payment.createPayment(withCard(MOCK_CARDS.INSUFFICIENT_FUNDS));
    expect(declined.errorMessage).toBe(locales.en.INSUFFICIENT_FUNDS);
    expect(declined.providerMessage).toBeTruthy();
    expect(declined.providerMessage).not.toBe(declined.errorMessage);

    const lost = await payment.createPayment(withCard(MOCK_CARDS.NETWORK_ERROR));
    expect(lost.status).toBe(PaymentStatus.PENDING);
    expect(lost.errorMessage).toBe(locales.en.NETWORK_ERROR);

    const paid = await payment.createPayment(mockPaymentRequest);
    expect(paid.errorMessage).toBeUndefined();
    expect(paid.providerMessage).toBeUndefined();
  });

  it('uses the configured language, overrides and new languages with a fallback', async () => {
    const tr = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [i18n({ translations: { tr: locales.tr }, defaultLocale: 'tr' })],
    });
    expect((await tr.createPayment(withCard(MOCK_CARDS.EXPIRED_CARD))).errorMessage).toBe(
      locales.tr.EXPIRED_CARD
    );

    const es = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [
        i18n({
          translations: {
            es: { INSUFFICIENT_FUNDS: 'Fondos insuficientes.' },
            tr: { ...locales.tr, EXPIRED_CARD: 'Kartın süresi dolmuş.' },
          },
          defaultLocale: 'es',
        }),
      ],
    });
    expect((await es.createPayment(withCard(MOCK_CARDS.INSUFFICIENT_FUNDS))).errorMessage).toBe(
      'Fondos insuficientes.'
    );
    // Missing in Spanish: English
    expect((await es.createPayment(withCard(MOCK_CARDS.CARD_DECLINED))).errorMessage).toBe(
      locales.en.CARD_DECLINED
    );
    expect(es.errors.message('EXPIRED_CARD', 'tr')).toBe('Kartın süresi dolmuş.');
    expect(es.errors.message('LIMIT_EXCEEDED', 'tr-TR')).toBe(locales.tr.LIMIT_EXCEEDED);
    expect(es.errors.locales).toEqual(['en', 'es', 'tr']);
  });

  it('rejects a default language without translations', () => {
    expect(() => i18n({ translations: { tr: locales.tr }, defaultLocale: 'fr' as 'tr' })).toThrow(
      ConfigurationError
    );
    expect(() => i18n({ translations: {}, defaultLocale: 'tr' as 'en' })).toThrow(
      /translations\.tr/
    );
  });

  it('keeps English for codes missing in a language', async () => {
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [
        i18n({ translations: { tr: { EXPIRED_CARD: 'Süresi dolmuş.' } }, defaultLocale: 'tr' }),
      ],
    });
    expect((await payment.createPayment(withCard(MOCK_CARDS.EXPIRED_CARD))).errorMessage).toBe(
      'Süresi dolmuş.'
    );
    expect((await payment.createPayment(withCard(MOCK_CARDS.CARD_DECLINED))).errorMessage).toBe(
      locales.en.CARD_DECLINED
    );
  });

  it('translates error codes declared by other plugins', async () => {
    const blockList = definePlugin({
      id: 'block-list',
      hooks: {
        before: [
          {
            matcher: (ctx) => ctx.operation === 'createPayment',
            handler: () => ({
              result: {
                status: PaymentStatus.FAILURE,
                code: PaymentErrorCode.FRAUD_SUSPECTED,
                errorCode: 'BLOCKED_BIN',
                errorMessage: 'bin 400000 is blocked',
              },
            }),
          },
        ],
      },
      $ERROR_CODES: { BLOCKED_BIN: 'This card cannot be used.' },
    });
    const en = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [blockList, i18n({ translations: {} })],
    });
    expect((await en.createPayment(mockPaymentRequest)).errorMessage).toBe(
      'This card cannot be used.'
    );

    const tr = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [
        blockList,
        i18n({
          translations: { tr: { ...locales.tr, BLOCKED_BIN: 'Bu kart kullanılamaz.' } },
          defaultLocale: 'tr',
        }),
      ],
    });
    const result = await tr.createPayment(mockPaymentRequest);
    expect(result.errorMessage).toBe('Bu kart kullanılamaz.');
    expect(result.providerMessage).toBe('bin 400000 is blocked');
  });

  it('translates results of provider-specific methods with errors.translate', () => {
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [i18n({ translations: { tr: locales.tr }, defaultLocale: 'tr' })],
    });
    const result = payment.errors.translate({
      status: PaymentStatus.FAILURE,
      code: PaymentErrorCode.UNKNOWN,
      errorMessage: 'raw',
    });
    expect(result).toMatchObject({
      errorMessage: locales.tr.UNKNOWN,
      providerMessage: 'raw',
    });
    expect(payment.errors.translate({ status: 'success' })).toEqual({ status: 'success' });
  });

  describe('HTTP handler', () => {
    const setup = (options: Partial<I18nOptions> = {}) =>
      betterPayment({
        providers: { mock: new MockProvider() },
        plugins: [i18n({ translations: locales, ...options })],
        handler: { allowedActions: ['payment'], authorize: () => true },
      });
    const pay = (payment: ReturnType<typeof setup>, headers: Record<string, string> = {}) =>
      payment.handler.handle(
        post('/api/pay/mock/payment', withCard(MOCK_CARDS.INSUFFICIENT_FUNDS), headers)
      );
    const message = (res: { body: unknown }) => (res.body as { errorMessage: string }).errorMessage;

    it('answers in the language of Accept-Language', async () => {
      const payment = setup();
      expect(message(await pay(payment, { 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8' }))).toBe(
        locales.tr.INSUFFICIENT_FUNDS
      );
      expect(message(await pay(payment, { 'accept-language': 'de-DE,de;q=0.9,en;q=0.5' }))).toBe(
        locales.de.INSUFFICIENT_FUNDS
      );
      expect(message(await pay(payment, { 'accept-language': 'ru-RU,ru;q=0.9,en;q=0.5' }))).toBe(
        locales.ru.INSUFFICIENT_FUNDS
      );
      expect(message(await pay(payment, { 'accept-language': 'ar-SA,ar;q=0.9,en;q=0.5' }))).toBe(
        locales.ar.INSUFFICIENT_FUNDS
      );
      expect(message(await pay(payment, { 'accept-language': 'es-ES, en;q=0.5' }))).toBe(
        locales.en.INSUFFICIENT_FUNDS
      );
      expect(message(await pay(payment, { 'accept-language': 'fr' }))).toBe(
        locales.en.INSUFFICIENT_FUNDS
      );
      expect(message(await pay(payment))).toBe(locales.en.INSUFFICIENT_FUNDS);
    });

    it('detects the language from a cookie, a callback, or not at all', async () => {
      const cookie = setup({ detection: ['cookie', 'header'], localeCookie: 'lang' });
      expect(
        message(await pay(cookie, { Cookie: 'theme=dark; lang=de', 'accept-language': 'tr' }))
      ).toBe(locales.de.INSUFFICIENT_FUNDS);
      expect(message(await pay(cookie, { cookie: 'lang=fr', 'accept-language': 'tr' }))).toBe(
        locales.tr.INSUFFICIENT_FUNDS
      );

      const fromQuery = setup({
        detection: ['callback'],
        getLocale: async (request) => new URL(request.url, 'http://x').searchParams.get('lang'),
      });
      const res = await fromQuery.handler.handle(
        post('/api/pay/mock/payment?lang=tr', withCard(MOCK_CARDS.INSUFFICIENT_FUNDS))
      );
      expect(message(res)).toBe(locales.tr.INSUFFICIENT_FUNDS);
      expect(await fromQuery.errors.detectLocale(post('/x?lang=ru-RU', {}))).toBe('ru');
      expect(await fromQuery.errors.detectLocale(post('/x', {}))).toBe('en');

      const fixed = setup({ defaultLocale: 'tr', detection: [] });
      expect(message(await pay(fixed, { 'accept-language': 'en' }))).toBe(
        locales.tr.INSUFFICIENT_FUNDS
      );
    });

    it('translates replayed Idempotency-Key responses per request', async () => {
      const payment = setup();
      const first = await pay(payment, { 'Idempotency-Key': 'k1', 'accept-language': 'en' });
      const replay = await pay(payment, { 'Idempotency-Key': 'k1', 'accept-language': 'tr' });
      expect(replay.headers['Idempotent-Replayed']).toBe('true');
      expect(message(first)).toBe(locales.en.INSUFFICIENT_FUNDS);
      expect(message(replay)).toBe(locales.tr.INSUFFICIENT_FUNDS);
      expect((replay.body as { providerMessage: string }).providerMessage).toBe(
        (first.body as { providerMessage: string }).providerMessage
      );
    });
  });
});

describe('localizedErrors (deprecated name)', () => {
  it('works like before on top of i18n', async () => {
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [
        localizedErrors({ locale: 'es', messages: { es: { CARD_DECLINED: 'Rechazada.' } } }),
      ],
      handler: { allowedActions: ['payment'], authorize: () => true },
    });
    expect((await payment.createPayment(withCard(MOCK_CARDS.CARD_DECLINED))).errorMessage).toBe(
      'Rechazada.'
    );
    expect(payment.errors.locales).toEqual(['en', 'tr', 'de', 'ru', 'ar', 'es']);
    const res = await payment.handler.handle(
      post('/api/pay/mock/payment', withCard(MOCK_CARDS.EXPIRED_CARD), {
        'accept-language': 'tr-TR',
      })
    );
    expect((res.body as { errorMessage: string }).errorMessage).toBe(locales.tr.EXPIRED_CARD);
  });

  it('keeps fallbackLocale and detectLocale', async () => {
    expect(() => localizedErrors({ locale: 'fr' })).toThrow(ConfigurationError);
    expect(() => localizedErrors({ fallbackLocale: 'fr' })).toThrow(/translations\.fr/);
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [
        localizedErrors({
          locale: 'es',
          fallbackLocale: 'tr',
          messages: { es: {} },
          detectLocale: false,
        }),
      ],
    });
    expect(payment.errors.message('CARD_DECLINED')).toBe(locales.tr.CARD_DECLINED);
    expect(await payment.errors.detectLocale(post('/x', {}, { 'accept-language': 'de' }))).toBe(
      'es'
    );
  });
});

describe('parseAcceptLanguage', () => {
  it('orders languages by quality', () => {
    expect(parseAcceptLanguage('en;q=0.5, tr-TR, de;q=0.8, *;q=0.1, fr;q=0')).toEqual([
      'tr-tr',
      'de',
      'en',
    ]);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
  });
});
