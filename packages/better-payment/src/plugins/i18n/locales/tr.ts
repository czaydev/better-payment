import type { PaymentErrorCode } from 'better-payment';

/** Customer-facing messages for the normalized error codes: Turkish */
export const tr: Record<PaymentErrorCode, string> = {
  INSUFFICIENT_FUNDS: 'Kartınızın bakiyesi veya limiti yetersiz. Başka bir kart deneyin.',
  CARD_DECLINED: 'Bankanız ödemeyi onaylamadı. Bankanızla görüşün veya başka bir kart deneyin.',
  INVALID_CARD: 'Kart numaranızı kontrol edin.',
  EXPIRED_CARD: 'Kartınızın son kullanma tarihini kontrol edin.',
  INVALID_CVC: 'Kartınızın arkasındaki güvenlik kodunu kontrol edin.',
  THREEDS_FAILED: 'Doğrulama başarısız oldu. Tekrar deneyin ve SMS adımını tamamlayın.',
  FRAUD_SUSPECTED: 'Bu ödeme tamamlanamadı. Bankanızla görüşün.',
  LIMIT_EXCEEDED: 'Kartınızın işlem limiti aşıldı. Başka bir kart deneyin.',
  DUPLICATE_ORDER: 'Bu sipariş zaten gönderildi.',
  CANCELLED_BY_CUSTOMER: 'Ödeme iptal edildi.',
  INVALID_REQUEST: 'Bir sorun oluştu. Lütfen tekrar deneyin.',
  NETWORK_ERROR: 'Ödemeniz kontrol ediliyor. Lütfen tekrar ödeme yapmayın.',
  INVALID_HASH: 'Ödeme doğrulanamadı.',
  PROVIDER_ERROR: 'Ödeme geçici olarak yapılamıyor. Lütfen daha sonra tekrar deneyin.',
  UNKNOWN: 'Ödeme başarısız oldu. Tekrar deneyin veya başka bir kart kullanın.',
};
