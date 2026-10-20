import type { PaymentProviderConfig } from '../../core/PaymentProvider';
import type { GarantiSecurityLevel } from './utils';

/**
 * Garanti BBVA virtual POS (GVP) configuration
 *
 * Values come from the Garanti BBVA virtual POS panel:
 * - merchantId / terminalId: üye işyeri and terminal numbers
 * - password: PROVAUT (provision user) password
 * - storeKey: 3D Secure store key
 * - refundPassword: PROVRFN (cancel/refund user) password, when it differs
 */
export interface GarantiConfig extends PaymentProviderConfig {
  merchantId: string;
  terminalId: string;
  password: string;
  storeKey: string;
  /** Provision user. Default: PROVAUT */
  provUserId?: string;
  /** Cancel and refund user. Default: PROVRFN */
  refundUserId?: string;
  /** Password of the cancel/refund user. Default: `password` */
  refundPassword?: string;
  /** Payment model: '3D', '3D_PAY' or 'GARANTI_PAY' (GarantiPay). Default: '3D' */
  securityLevel?: GarantiSecurityLevel;
  /** Company name shown on the GarantiPay page (`companyname`), for 'GARANTI_PAY' */
  companyName?: string;
  /**
   * `mdstatus` values that are provisioned in the 3D model. Default: ['1'] (full
   * 3D Secure authentication). 2, 3 and 4 are half-secure (the card or its bank is
   * not enrolled, or only an attempt was made); accepting them can leave chargeback
   * liability with the merchant.
   */
  acceptedMdStatuses?: string[];
  /**
   * Sends Mode TEST. betterPayment() sets this automatically when mode is 'sandbox'.
   */
  testMode?: boolean;
}

/**
 * Fields Garanti POSTs to successurl / errorurl. `hash` covers the fields named
 * in `hashparams`.
 */
export interface Garanti3DCallbackData {
  orderid?: string;
  oid?: string;
  terminalid?: string;
  terminalmerchantid?: string;
  txnamount?: string;
  txncurrencycode?: string;
  txninstallmentcount?: string;
  txntype?: string;
  customeripaddress?: string;
  /** 1 means the card was fully authenticated */
  mdstatus?: string;
  mderrormessage?: string;
  md?: string;
  xid?: string;
  eci?: string;
  cavv?: string;
  /** Set by the bank when it charged the card (3D_PAY) */
  procreturncode?: string;
  response?: string;
  errmsg?: string;
  hostmsg?: string;
  hash?: string;
  hashparams?: string;
  hashparamsval?: string;
  [key: string]: string | undefined;
}

/**
 * The order from your own records for `completeThreeDSPayment`, passed as a
 * separate second argument and never read from the callback body: the
 * callback's hash does not pin each value to its field.
 */
export interface GarantiCompleteContext {
  /** The order id you started; required for the 3D security level */
  orderId?: string;
  /** The order amount ("100.00"); required for 3D, checked against the bank for 3D_PAY */
  amount?: string | number;
  /** The order currency. Default: TRY */
  currency?: string;
  /** The installment count you started. Default: the callback's */
  installment?: number;
}
