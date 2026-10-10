import type { PaymentProviderConfig } from '../../core/PaymentProvider';

/**
 * Kuveyt Türk Sanal POS (KT Pay Gate) configuration
 *
 * Values come from the Kuveyt Türk corporate panel (kurumsal.kuveytturk.com.tr):
 * - merchantId: Sanal POS mağaza numarası
 * - customerId: Müşteri (hesap) numarası
 * - username / password: the API role user (Yönetim - Kullanıcı İşlemleri)
 */
export interface KuveytTurkConfig extends PaymentProviderConfig {
  merchantId: string;
  customerId: string;
  username: string;
  password: string;
  /**
   * `paymentType` sent with the Payment request. The API requires it (1 or 2)
   * although the integration document does not describe it. Default: 1.
   */
  paymentType?: number;
}

/**
 * JSON envelope of every KT Pay Gate endpoint except Payment
 */
export interface KuveytTurkApiResponse<T = unknown> {
  Result?: T | null;
  Success?: boolean;
  ResponseCode?: string;
  ResponseMessage?: string;
  BusinessKey?: string | null;
  TransactionTime?: number | string;
  [key: string]: unknown;
}

/**
 * A transaction from GetTransactions
 */
export interface KuveytTurkTransaction {
  MerchantId?: number;
  PosTerminalId?: string;
  /** The bank's order id, needed for Provision, SaleReversal and GetTransaction */
  OrderId?: number | string;
  MerchantOrderId?: string;
  CardNumber?: string;
  CardType?: string;
  TransactionTime?: string;
  IsCancellable?: number;
  IsRefundable?: number;
  IsPartialRefundable?: number;
  /** For example "Satış (1)" */
  OrderStatus?: string;
  LastOrderStatus?: string;
  /** For example "Başarısız (2)", "Zaman Aşımı (3)" */
  TransactionStatus?: string;
  /** Amount in minor units, like the amount sent with the request */
  FirstAmount?: number;
  DrawbackAmount?: number;
  CancelAmount?: number;
  ClosedAmount?: number;
  /** For example "TRY (0949)" */
  FEC?: string;
  InstallmentCount?: number;
  TransactionSecurity?: string;
  ResponseCode?: string;
  ResponseExplain?: string;
  ProvisionNumber?: string;
  [key: string]: unknown;
}

export interface KuveytTurkTransactionList {
  Transactions?: KuveytTurkTransaction[];
}

/**
 * Fields Kuveyt Türk POSTs to successUrl / failUrl after card verification.
 * They are not signed: the result is confirmed with the Provision call.
 */
export interface KuveytTurk3DCallbackData {
  Success?: string;
  ResponseCode?: string;
  ResponseMessage?: string;
  /** Sent back with Provision */
  MD?: string;
  /** The bank's order id */
  OrderId?: string;
  MerchantOrderId?: string;
  BusinessKey?: string;
  TransactionTime?: string;
  [key: string]: string | undefined;
}
