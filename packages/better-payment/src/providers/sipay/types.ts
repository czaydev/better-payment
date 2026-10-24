import type { PaymentProviderConfig } from '../../core/PaymentProvider';

/**
 * Sipay configuration
 *
 * Values come from the Sipay merchant panel (Settings > Integration & API):
 * - appId / appSecret: API credentials, used to get the Bearer token and to
 *   sign and verify hash keys
 * - merchantKey: the merchant key sent with every payment request
 */
/** Payment institutions on Sipay's platform */
export type SipayBrand = 'sipay' | 'qnbpay';

export interface SipayConfig extends PaymentProviderConfig {
  /**
   * The institution: `sipay` (default) or `qnbpay`, which runs the same API on its
   * own hosts. Selects the default URLs and the provider id.
   */
  brand?: SipayBrand;
  appId: string;
  appSecret: string;
  merchantKey: string;
  /**
   * `sale_web_hook_key` sent with payments. Set it to have Sipay notify the
   * sale webhook defined for this key in the merchant panel.
   */
  saleWebhookKey?: string;
}

/** Response of POST /api/token */
export interface SipayTokenResponse {
  status_code?: number;
  status_description?: string;
  data?: { token?: string; is_3d?: number; expires_at?: string };
}

/**
 * Payment result fields: the paySmart2D response `data`, and the fields Sipay
 * POSTs to return_url / cancel_url after a 3D Secure payment
 */
export interface SipayPaymentResult {
  sipay_status?: number | string;
  order_no?: string;
  order_id?: string;
  invoice_id?: string;
  status_code?: number | string;
  status_description?: string;
  credit_card_no?: string;
  /** "Auth" or "Pre-Authorization" */
  transaction_type?: string;
  /** 1 approved, 0 failed */
  payment_status?: number | string;
  /** The bank's ISO 8583 code on bank declines, otherwise a Sipay status code */
  error_code?: number | string;
  error?: string;
  auth_code?: string | null;
  installment?: number | string;
  amount?: number | string;
  /**
   * `status|total|invoice_id|order_id|currency_code`, encrypted with the app
   * secret: the only part of a 3D Secure callback that can be trusted
   */
  hash_key?: string;
  md_status?: number | string;
  original_bank_error_code?: string | null;
  original_bank_error_description?: string | null;
  [key: string]: unknown;
}

/** paySmart2D response */
export interface SipayPaymentResponse {
  status_code?: number | string;
  status_description?: string;
  data?: SipayPaymentResult;
  [key: string]: unknown;
}

/** Fields Sipay POSTs to return_url / cancel_url after a 3D Secure payment */
export type Sipay3DCallbackData = { [K in keyof SipayPaymentResult]?: string } & {
  [key: string]: string | undefined;
};

/** checkstatus response */
export interface SipayStatusResponse {
  status_code?: number | string;
  status_description?: string;
  /** "Completed", "Pending", "Failed", "Refunded", "Partial Refund", "Cancelled", "Pre-Authorization" */
  transaction_status?: string;
  order_id?: string;
  transaction_id?: string;
  message?: string;
  reason?: string;
  bank_status_description?: string;
  invoice_id?: string;
  total_refunded_amount?: number;
  product_price?: string | number;
  transaction_amount?: number | string;
  transaction_type?: string;
  original_bank_error_code?: string | null;
  original_bank_error_description?: string | null;
  md_status?: number | string;
  installment?: number;
  [key: string]: unknown;
}

/** refund and confirmPayment response */
export interface SipayOperationResponse {
  status_code?: number | string;
  status_description?: string;
  transaction_status?: string;
  order_no?: string;
  order_id?: string;
  invoice_id?: string;
  ref_no?: string;
  ref_number?: string;
  message?: string;
  [key: string]: unknown;
}

/** A row of the getpos response: one installment option for a card */
export interface SipayPosOption {
  pos_id?: number;
  installments_number?: number;
  card_type?: string;
  card_program?: string;
  card_scheme?: string;
  is_commercial?: string;
  payable_amount?: number;
  amount_to_be_paid?: string;
  currency_code?: string;
  title?: string;
  card_bank?: string;
  bank_code?: string;
  is_foreign_card?: boolean;
  [key: string]: unknown;
}

export interface SipayPosResponse {
  status_code?: number | string;
  status_description?: string;
  data?: SipayPosOption[];
  [key: string]: unknown;
}

/** The decrypted content of a Sipay hash key */
export interface SipayVerifiedHash {
  /** "1" approved, "0" failed */
  status: string;
  total: string;
  invoiceId: string;
  orderId: string;
  currency: string;
}
