import type { PaymentProviderConfig } from '../../core/PaymentProvider';

/**
 * Tosla İşim (AKÖde) virtual POS configuration
 *
 * Values come from the Tosla İşim merchant panel (API user information):
 * - clientId: merchant number
 * - apiUser / apiPass: API user and password, used to sign every request
 */
export interface ToslaConfig extends PaymentProviderConfig {
  clientId: string;
  apiUser: string;
  apiPass: string;
}

/** Fields of every Tosla JSON answer */
export interface ToslaResponse {
  /** 0 when the request succeeded */
  Code?: number;
  Message?: string;
  [key: string]: unknown;
}

/** threeDPayment answer */
export interface ToslaThreeDResponse extends ToslaResponse {
  ThreeDSessionId?: string | null;
  TransactionId?: string | null;
}

/** inquiry answer */
export interface ToslaInquiryResponse extends ToslaResponse {
  TransactionType?: number;
  CreateDate?: string | null;
  OrderId?: string | null;
  /** The bank's ISO 8583 code; "00" is approved */
  BankResponseCode?: string | null;
  BankResponseMessage?: string | null;
  AuthCode?: string | null;
  HostReferenceNumber?: string | null;
  /** In minor units (kuruş) */
  Amount?: number;
  Currency?: number;
  InstallmentCount?: number;
  RequestStatus?: number;
  /** In minor units */
  RefundedAmount?: number;
  TransactionId?: string | null;
}

/** void / refund answer */
export interface ToslaReversalResponse extends ToslaResponse {
  OrderId?: string | null;
  BankResponseCode?: string | null;
  BankResponseMessage?: string | null;
  TransactionId?: string | null;
}

/** GetCommissionAndInstallmentInfo answer */
export interface ToslaCommissionResponse extends ToslaResponse {
  CardPrefix?: number;
  BankId?: number;
  BankCode?: string | null;
  BankName?: string | null;
  CardName?: string | null;
  CardClass?: string | null;
  CardType?: string | null;
  Country?: string | null;
  /** Rates per installment count, keyed T1, T2, ... */
  CommissionPackages?: Array<{
    InstallmentRate?: Record<string, { Rate?: number } | null> | null;
    [key: string]: unknown;
  }> | null;
}

/**
 * Fields Tosla POSTs to callbackUrl after 3D Secure. They are not signed, so only the
 * order id is taken from them; the result comes from an inquiry.
 */
export interface Tosla3DCallbackData {
  OrderId?: string;
  BankResponseCode?: string;
  BankResponseMessage?: string;
  [key: string]: unknown;
}

/**
 * Values from your own records for `completeThreeDSPayment`, passed separately
 * from the callback body so that a POSTed field can never stand in for them.
 */
export interface ToslaCompleteContext {
  /** The order id you started; takes precedence over the callback's `OrderId` */
  orderId?: string;
  /** The amount you expect, checked against the bank's record when given */
  amount?: string | number;
}
