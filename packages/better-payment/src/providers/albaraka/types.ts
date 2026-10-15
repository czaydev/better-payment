import type { PaymentProviderConfig } from '../../core/PaymentProvider';

/**
 * Albaraka Türk virtual POS (e-POS, Posnet JSON API) configuration
 *
 * Values come from Albaraka Türk:
 * - merchantId / terminalId: üye işyeri and terminal numbers
 * - posnetId: Posnet ID, used by 3D Secure
 * - encKey: ENC key, used for the MAC
 */
export interface AlbarakaConfig extends PaymentProviderConfig {
  merchantId: string;
  terminalId: string;
  posnetId: string;
  encKey: string;
  /**
   * `MdStatus` values that are charged after 3D Secure. Default: ['1'] (full
   * authentication). 2, 3 and 4 are half-secure; accepting them can leave
   * chargeback liability with the merchant.
   */
  acceptedMdStatuses?: string[];
}

/** Fields Albaraka POSTs to MerchantReturnURL after 3D Secure */
export interface AlbarakaCallbackFields {
  MdStatus?: string;
  MdErrorMessage?: string;
  SecureTransactionId?: string;
  CAVV?: string;
  ECI?: string;
  MD?: string;
  [key: string]: string | undefined;
}

/**
 * Input of completeThreeDSPayment(): the callback POST plus the order from your
 * own records. The bank charges the amount sent with the 3D data, so the order
 * id, amount and currency must come from your side, not from the POST.
 *
 * Spread the callback first so your values win:
 * `completeThreeDSPayment({ ...callbackBody, orderId, amount, currency })`
 */
export interface AlbarakaCompleteRequest extends AlbarakaCallbackFields {
  /** The order id (conversationId) used to start the payment */
  orderId?: string;
  /** The order amount, as in the payment request ("1.20") */
  amount?: string;
  /** The order currency (TRY, USD, ...). Default: TRY */
  currency?: string;
  /** The installment count used to start the payment. Default: 1 */
  installment?: string;
  /** 'Auth' when the payment was started with initThreeDSAuthorize(). Default: 'Sale' */
  transactionType?: 'Sale' | 'Auth';
}

/** Answer of the JSON API */
export interface AlbarakaResponse {
  ServiceResponseData?: { ResponseCode?: string; ResponseDescription?: string };
  AuthCode?: string | null;
  ReferenceCode?: string | null;
  /** TransactionInquiry: the order's transactions */
  TransactionData?: unknown;
  [key: string]: unknown;
}
