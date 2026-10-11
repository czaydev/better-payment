import type { PaymentProviderConfig } from '../../core/PaymentProvider';

/**
 * Vakıf Katılım virtual POS (BOA VirtualPOS.Gateway, XML) configuration
 *
 * Values come from Vakıf Katılım:
 * - merchantId: üye işyeri numarası
 * - customerId: müşteri numarası
 * - username / password: API user; the password is only used for the hash
 */
export interface VakifKatilimConfig extends PaymentProviderConfig {
  merchantId: string;
  customerId: string;
  username: string;
  password: string;
}

/** Fields Vakıf Katılım POSTs to OkUrl / FailUrl after 3D Secure */
export interface VakifKatilimCallbackFields {
  ResponseCode?: string;
  ResponseMessage?: string;
  MerchantOrderId?: string;
  OrderId?: string;
  ProvisionNumber?: string;
  RRN?: string;
  Stan?: string;
  HashData?: string;
  MD?: string;
  [key: string]: string | undefined;
}

/**
 * Input of completeThreeDSPayment(): the callback POST plus the order from your
 * own records. The provision is signed over the amount and the return URLs, and
 * the callback carries neither, so they must come from your side.
 *
 * `completeThreeDSPayment({ ...callbackBody, orderId, amount, currency, callbackUrl })`
 */
export interface VakifKatilimCompleteRequest extends VakifKatilimCallbackFields {
  /** The order id (conversationId) used to start the payment */
  orderId?: string;
  /** The order amount, as in the payment request ("1.20") */
  amount?: string;
  /** The order currency (TRY, USD, EUR). Default: TRY */
  currency?: string;
  /** The installment count used to start the payment. Default: 1 */
  installment?: string;
  /** The callbackUrl used to start the payment */
  callbackUrl?: string;
  /** The failUrl used to start the payment. Default: callbackUrl */
  failUrl?: string;
}
