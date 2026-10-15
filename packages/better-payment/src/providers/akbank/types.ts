import type { PaymentProviderConfig } from '../../core/PaymentProvider';

/**
 * Akbank Sanal POS (JSON API) configuration
 *
 * Values come from the Akbank Sanal POS panel:
 * - merchantSafeId: Merchant safe ID
 * - terminalSafeId: Terminal safe ID
 * - secretKey: Secret key (used for HMAC-SHA512 signatures)
 */
export interface AkbankConfig extends PaymentProviderConfig {
  merchantSafeId: string;
  terminalSafeId: string;
  secretKey: string;
  subMerchantId?: string;
  /**
   * Selects the test 3D gateway. betterPayment() sets this automatically when
   * mode is 'sandbox'.
   */
  testMode?: boolean;
  /** Override the 3D gateway URL (securepay) */
  gateway3dUrl?: string;
}

export interface AkbankTerminal {
  merchantSafeId: string;
  terminalSafeId: string;
}

/**
 * Common response envelope
 */
export interface AkbankApiResponse {
  txnCode?: string;
  responseCode?: string;
  responseMessage?: string;
  hostResponseCode?: string;
  hostMessage?: string;
  txnDateTime?: string;
  terminal?: AkbankTerminal;
  order?: { orderId?: string; orderTrackId?: string };
  transaction?: {
    amount?: number | string;
    currencyCode?: number | string;
    authCode?: string;
    rrn?: string;
    batchNumber?: number | string;
    stan?: number | string;
    [key: string]: unknown;
  };
  txnDetailList?: AkbankTxnDetail[];
  code?: number | string;
  message?: string;
  [key: string]: unknown;
}

export interface AkbankTxnDetail {
  txnCode?: string;
  responseCode?: string;
  responseMessage?: string;
  txnStatus?: string;
  orderId?: string;
  orgOrderId?: string;
  amount?: number | string;
  currencyCode?: number | string;
  installCount?: number | string;
  authCode?: string;
  rrn?: string;
  txnDateTime?: string;
  maskedCardNumber?: string;
  [key: string]: unknown;
}

/**
 * Fields Akbank POSTs to okUrl / failUrl after a 3D_PAY transaction.
 * The `hash` covers the fields listed in `hashParams` ('+' separated).
 */
export interface Akbank3DCallbackData {
  txnCode?: string;
  responseCode?: string;
  responseMessage?: string;
  hostResponseCode?: string;
  hostMessage?: string;
  txnDateTime?: string;
  merchantSafeId?: string;
  terminalSafeId?: string;
  orderId?: string;
  authCode?: string;
  rrn?: string;
  batchNumber?: string;
  stan?: string;
  hashParams?: string;
  hash?: string;
  [key: string]: string | undefined;
}
