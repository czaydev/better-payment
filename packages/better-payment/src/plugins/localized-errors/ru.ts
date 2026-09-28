import type { PaymentErrorCode } from 'better-payment';

/** Customer-facing messages for the normalized error codes: Russian */
export const ru: Record<PaymentErrorCode, string> = {
  INSUFFICIENT_FUNDS: 'На карте недостаточно средств. Попробуйте другую карту.',
  CARD_DECLINED: 'Банк отклонил платеж. Свяжитесь с банком или попробуйте другую карту.',
  INVALID_CARD: 'Проверьте номер карты.',
  EXPIRED_CARD: 'Проверьте срок действия карты.',
  INVALID_CVC: 'Проверьте код на обороте карты.',
  THREEDS_FAILED: 'Ошибка подтверждения. Попробуйте снова и введите SMS-код.',
  FRAUD_SUSPECTED: 'Платеж отклонен. Свяжитесь с вашим банком.',
  LIMIT_EXCEEDED: 'Превышен лимит по карте. Попробуйте другую карту.',
  DUPLICATE_ORDER: 'Этот заказ уже оформлен.',
  CANCELLED_BY_CUSTOMER: 'Оплата отменена.',
  INVALID_REQUEST: 'Что-то пошло не так. Попробуйте еще раз.',
  NETWORK_ERROR: 'Проверяем платеж. Не оплачивайте повторно.',
  INVALID_HASH: 'Не удалось подтвердить платеж.',
  PROVIDER_ERROR: 'Оплата временно недоступна. Попробуйте позже.',
  UNKNOWN: 'Ошибка оплаты. Попробуйте снова или используйте другую карту.',
};
