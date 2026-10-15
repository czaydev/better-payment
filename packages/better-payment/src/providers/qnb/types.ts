import type { PaymentProviderConfig } from '../../core/PaymentProvider';
import type { QnbSecureType } from './utils';

/**
 * QNB virtual POS (PayFor) configuration
 *
 * Values come from QNB:
 * - merchantId: üye işyeri numarası
 * - userCode / userPass: API user
 * - merchantPass: 3D Secure password (MerchantPass), used for the hashes and never sent
 */
export interface QnbConfig extends PaymentProviderConfig {
  merchantId: string;
  userCode: string;
  userPass: string;
  merchantPass: string;
  /** 3D model of the merchant. Default: '3DModel' */
  secureType?: QnbSecureType;
}

/**
 * The order from your own records for `completeThreeDSPayment`, passed as a
 * separate second argument and never read from the callback body: the
 * callback's hash joins its values without a separator.
 */
export interface QnbCompleteContext {
  /** The order id you started; a callback for another order is rejected */
  orderId?: string;
  /** The order amount ("100.00"); 3DPay checks the bank's record against it */
  amount?: string | number;
}

/**
 * Ziraat Katılım virtual POS (PayFor) configuration. The values come from
 * Ziraat Katılım, like QNB's, plus the institution code.
 */
export interface ZiraatKatilimConfig extends QnbConfig {
  /** Kurum kodu (`MbrId`) given by Ziraat Katılım */
  mbrId: string;
}

/**
 * Fields QNB POSTs to OkUrl / FailUrl. `ResponseHash` covers OrderId,
 * AuthCode, ProcReturnCode, 3DStatus and ResponseRnd.
 */
export interface Qnb3DCallbackData {
  OrderId?: string;
  MerchantID?: string;
  SecureType?: string;
  /** 1 means the card was authenticated */
  '3DStatus'?: string;
  /** Sent back with 3DModelPayment */
  RequestGuid?: string;
  PurchAmount?: string;
  Currency?: string;
  ProcReturnCode?: string;
  TxnResult?: string;
  ErrMsg?: string;
  AuthCode?: string;
  HostRefNum?: string;
  ResponseRnd?: string;
  ResponseHash?: string;
  [key: string]: string | undefined;
}
