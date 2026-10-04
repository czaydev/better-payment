import type { PaymentErrorCode } from 'better-payment';

/** Customer-facing messages for the normalized error codes: Arabic (Modern Standard Arabic) */
export const ar: Record<PaymentErrorCode, string> = {
  INSUFFICIENT_FUNDS: 'لا يوجد رصيد كافٍ في بطاقتك. جرّب بطاقة أخرى.',
  CARD_DECLINED: 'رفض البنك عملية الدفع. تواصل مع البنك أو جرّب بطاقة أخرى.',
  INVALID_CARD: 'تحقّق من رقم بطاقتك.',
  EXPIRED_CARD: 'تحقّق من تاريخ انتهاء صلاحية بطاقتك.',
  INVALID_CVC: 'تحقّق من رمز الأمان الموجود على ظهر بطاقتك.',
  THREEDS_FAILED: 'فشل التحقق. حاول مرة أخرى وأكمل خطوة الرسالة النصية.',
  FRAUD_SUSPECTED: 'تعذّر إتمام عملية الدفع هذه. تواصل مع البنك.',
  LIMIT_EXCEEDED: 'تم تجاوز حد بطاقتك. جرّب بطاقة أخرى.',
  DUPLICATE_ORDER: 'تم إرسال هذا الطلب مسبقًا.',
  CANCELLED_BY_CUSTOMER: 'تم إلغاء عملية الدفع.',
  INVALID_REQUEST: 'حدث خطأ ما. يُرجى المحاولة مرة أخرى.',
  NETWORK_ERROR: 'نتحقق من حالة الدفع. لا تدفع مرة أخرى.',
  INVALID_HASH: 'تعذّر التحقق من عملية الدفع.',
  PROVIDER_ERROR: 'الدفع غير متاح مؤقتًا. يُرجى المحاولة لاحقًا.',
  UNKNOWN: 'فشلت عملية الدفع. حاول مرة أخرى أو استخدم بطاقة أخرى.',
};
