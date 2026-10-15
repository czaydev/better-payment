import type { PaymentProviderConfig } from '../../core/PaymentProvider';

/**
 * PayTR configuration (Mağaza Paneli > Bilgi)
 */
export interface PayTRConfig extends PaymentProviderConfig {
  merchantId: string;
  merchantKey: string;
  merchantSalt: string;
  /** Sends test_mode=1. betterPayment() sets this automatically when mode is 'sandbox'. */
  testMode?: boolean;
  /** iFrame timeout in minutes (default 30) */
  timeoutLimit?: number;
  /**
   * How initThreeDSPayment() takes a new card:
   * - 'iframe' (default): PayTR's payment page in an iFrame (iFrame API)
   * - 'direct': the card comes in the request, and the customer's browser posts it
   *   to PayTR with your own checkout design (Direct API, 3D Secure). Needs the
   *   Direct API on your PayTR account.
   */
  threeDSMode?: 'iframe' | 'direct';
}

export interface PayTRIframeResponse {
  status: string;
  reason?: string;
  token?: string;
}

export interface PayTRRefundResponse {
  status: string;
  is_test?: string | number;
  merchant_oid?: string;
  return_amount?: string;
  reference_no?: string;
  err_no?: string;
  err_msg?: string;
}

export interface PayTRDirectPaymentResponse {
  status: string;
  msg?: string;
  reason?: string;
  merchant_oid?: string;
  total_amount?: string;
  failed_reason_code?: string;
  failed_reason_msg?: string;
  err_no?: string;
  err_msg?: string;
  [key: string]: unknown;
}

export interface PayTRStatusResponse {
  status: string;
  payment_amount?: string;
  payment_total?: string;
  payment_date?: string;
  currency?: string;
  taksit?: string;
  kart_marka?: string;
  masked_pan?: string;
  odeme_tipi?: string;
  test_mode?: string;
  returns?: Array<{
    return_amount?: string;
    refund_amount?: string;
    return_date?: string;
    [key: string]: unknown;
  }>;
  err_no?: string;
  err_msg?: string;
  [key: string]: unknown;
}

export interface PayTRBasketItem {
  name: string;
  /** Unit price in TL (e.g. "18.00") */
  price: string;
  quantity: number;
}

/**
 * Data PayTR POSTs to the notification (Bildirim) URL
 */
export interface PayTRCallbackData {
  merchant_oid: string;
  status: string;
  /** Total charged amount in kuruş */
  total_amount: string;
  hash: string;
  failed_reason_code?: string;
  failed_reason_msg?: string;
  test_mode?: string;
  payment_type?: string;
  currency?: string;
  /** Order amount in kuruş */
  payment_amount?: string;
  installment_count?: string;
  merchant_id?: string;
  utoken?: string;
  [key: string]: string | undefined;
}

/**
 * Payment with a stored card (Kart Saklama). Requires the feature to be enabled
 * on the PayTR account.
 */
export interface PayTRTokenPaymentRequest {
  /** User token returned in the first successful payment's notification */
  utoken: string;
  /** Card token from the stored card list */
  ctoken: string;
  /** CVV, when the stored card requires it (require_cvv = 1) */
  cvv?: string;
  price: string;
  callbackUrl: string;
  /** Redirect URL on failure (defaults to callbackUrl) */
  failUrl?: string;
  conversationId?: string;
  buyer: {
    email: string;
    name: string;
    surname: string;
    ip: string;
    gsmNumber: string;
    address?: string;
  };
  basketItems: Array<{ name: string; price: string; quantity?: number }>;
  currency?: string;
  installment?: number;
}

export interface PayTRBinDetailResponse {
  status: string;
  err_msg?: string;
  bank?: string;
  bankCode?: string | number;
  brand?: string;
  cardType?: string;
  schema?: string;
  businessCard?: string;
  [key: string]: unknown;
}

export interface PayTRInstallmentRatesResponse {
  status: string;
  err_msg?: string;
  /** { world: { taksit_2: 3.5, ... }, bonus: {...} } — commission percentages */
  oranlar?: Record<string, Record<string, number | string>>;
  max_inst_non_bus?: number;
  [key: string]: unknown;
}
