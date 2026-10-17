import type { PaymentProviderConfig } from '../../core/PaymentProvider';
import type { ParatikaBrand } from './utils';

/**
 * Paratika (Payten) configuration: Paratika, VakıfPay and ZiraatPay
 *
 * Values come from the merchant panel:
 * - merchant: üye iş yeri kodu (MERCHANT)
 * - merchantUser / merchantPassword: API user (an e-mail address) and its password
 * - secretKey: the merchant's secret key, used to verify the 3D callback hash
 */
export interface ParatikaConfig extends PaymentProviderConfig {
  /** Selects the hosts. Default: 'paratika' */
  brand?: ParatikaBrand;
  merchant: string;
  merchantUser: string;
  merchantPassword: string;
  /**
   * Verifies the callback's `sdSha512`. Without it the hash is not checked; the
   * result is always confirmed with QUERYTRANSACTION either way.
   */
  secretKey?: string;
  /**
   * `mdStatus` values that are pre-authorized after 3D authentication
   * (initThreeDSAuthorize()). Default: ['1']. 2, 3 and 4 are half-secure;
   * accepting them can leave chargeback liability with the merchant.
   */
  acceptedMdStatuses?: string[];
}

/** Fields Paratika POSTs to RETURNURL after a Direct POST 3D payment */
export interface Paratika3DCallbackData {
  responseCode?: string;
  responseMsg?: string;
  merchantPaymentId?: string;
  customerId?: string;
  sessionToken?: string;
  pgTranId?: string;
  random?: string;
  sdSha512?: string;
  errorCode?: string;
  errorMsg?: string;
  pgTranErrorText?: string;
  /** 3D authentication only (initThreeDSAuthorize()): the token PREAUTH takes */
  auth3DToken?: string;
  mdStatus?: string;
  mdErrorMsg?: string;
  [key: string]: string | undefined;
}

/**
 * Values from your own records for `completeThreeDSPayment`, passed separately
 * from the callback body so that a POSTed field can never stand in for them.
 */
export interface ParatikaCompleteContext {
  /** The merchantPaymentId you started; a callback for another order is rejected */
  orderId?: string;
}

/** Common fields of an API answer */
export interface ParatikaResponse {
  responseCode?: string;
  responseMsg?: string;
  errorCode?: string;
  errorMsg?: string;
  pgTranId?: string;
  merchantPaymentId?: string;
  sessionToken?: string;
  [key: string]: unknown;
}

/** One entry of QUERYTRANSACTION's transactionList */
export interface ParatikaTransaction {
  pgTranId?: string;
  merchantPaymentId?: string;
  transactionStatus?: string;
  transactionType?: string;
  amount?: number | string;
  currency?: string;
  [key: string]: unknown;
}
