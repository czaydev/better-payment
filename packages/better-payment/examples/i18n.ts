/**
 * Customer-facing error messages in the customer's language. CI typechecks it.
 */
import { betterPayment, iyzico, PaymentErrorCode } from 'better-payment';
import { i18n, locales, localizedErrors, type TranslationDictionary } from 'better-payment/plugins';

const es: TranslationDictionary = { INSUFFICIENT_FUNDS: 'Fondos insuficientes.' };

export const payment = betterPayment({
  providers: { iyzico: iyzico({ apiKey: 'key', secretKey: 'secret' }) },
  plugins: [
    i18n({
      translations: {
        tr: { ...locales.tr, INSUFFICIENT_FUNDS: 'Bakiyeniz yetersiz.' },
        de: locales.de,
        es,
      },
      defaultLocale: 'tr',
      detection: ['cookie', 'header', 'callback'],
      localeCookie: 'lang',
      getLocale: (request) => new URL(request.url, 'http://localhost').searchParams.get('lang'),
    }),
  ],
});

export async function usage(): Promise<void> {
  const text: string | undefined = payment.errors.message(PaymentErrorCode.EXPIRED_CARD, 'en');
  const languages: string[] = payment.errors.locales;
  const language: string = await payment.errors.detectLocale({
    method: 'GET',
    url: '/',
    headers: { 'accept-language': 'de-DE' },
  });
  void text;
  void languages;
  void language;

  // Every built-in language has every code
  const ru: Record<PaymentErrorCode, string> = locales.ru;
  void ru;

  // @ts-expect-error the plugin adds `errors`, nothing else
  void payment.translations;

  // @ts-expect-error the default language must have translations
  i18n({ translations: { tr: locales.tr }, defaultLocale: 'fr' });

  // The old name still works
  void localizedErrors({ locale: 'tr' });
}
