/**
 * Customer-facing error messages in the customer's language. CI typechecks it.
 */
import { betterPayment, iyzico, PaymentErrorCode } from 'better-payment';
import { localizedErrors, errorMessages } from 'better-payment/plugins';

export const payment = betterPayment({
  providers: { iyzico: iyzico({ apiKey: 'key', secretKey: 'secret' }) },
  plugins: [
    localizedErrors({
      locale: 'tr',
      messages: { tr: { INSUFFICIENT_FUNDS: 'Bakiyeniz yetersiz.' } },
    }),
  ],
});

export async function usage(): Promise<void> {
  const text: string | undefined = payment.errors.message(PaymentErrorCode.EXPIRED_CARD, 'en');
  const languages: string[] = payment.errors.locales;
  void text;
  void languages;

  // Every built-in language has every code
  const ru: Record<PaymentErrorCode, string> = errorMessages.ru;
  void ru;

  // @ts-expect-error the plugin adds `errors`, nothing else
  void payment.translations;
}
