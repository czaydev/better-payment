import type { PaymentErrorCode } from 'better-payment';

/** Customer-facing messages for the normalized error codes: German */
export const de: Record<PaymentErrorCode, string> = {
  INSUFFICIENT_FUNDS: 'Ihre Karte ist nicht ausreichend gedeckt.',
  CARD_DECLINED:
    'Ihre Bank hat die Zahlung abgelehnt. Wenden Sie sich an Ihre Bank oder versuchen Sie eine andere Karte.',
  INVALID_CARD: 'Überprüfen Sie Ihre Kartennummer.',
  EXPIRED_CARD: 'Überprüfen Sie das Ablaufdatum Ihrer Karte.',
  INVALID_CVC: 'Überprüfen Sie den Sicherheitscode auf der Rückseite Ihrer Karte.',
  THREEDS_FAILED:
    'Verifizierung fehlgeschlagen. Versuchen Sie es erneut und schließen Sie den SMS-Schritt ab.',
  FRAUD_SUSPECTED: 'Diese Zahlung konnte nicht abgeschlossen werden. Wenden Sie sich an Ihre Bank.',
  LIMIT_EXCEEDED: 'Das Limit Ihrer Karte wurde überschritten. Versuchen Sie eine andere Karte.',
  DUPLICATE_ORDER: 'Diese Bestellung wurde bereits aufgegeben.',
  CANCELLED_BY_CUSTOMER: 'Die Zahlung wurde abgebrochen.',
  INVALID_REQUEST: 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',
  NETWORK_ERROR: 'Wir überprüfen Ihre Zahlung. Bitte zahlen Sie nicht erneut.',
  INVALID_HASH: 'Die Zahlung konnte nicht verifiziert werden.',
  PROVIDER_ERROR:
    'Die Zahlung ist vorübergehend nicht verfügbar. Bitte versuchen Sie es später erneut.',
  UNKNOWN:
    'Zahlung fehlgeschlagen. Bitte versuchen Sie es erneut oder verwenden Sie eine andere Karte.',
};
