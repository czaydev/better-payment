import type { PaymentProviderConfig } from '../../core/PaymentProvider';

/**
 * Yapı Kredi virtual POS (Posnet XML) configuration
 *
 * Values come from Yapı Kredi:
 * - merchantId / terminalId: üye işyeri (mid) and terminal (tid) numbers
 * - posnetId: Posnet ID, used by 3D Secure
 * - encKey: Posnet ENC key, used for the MAC
 */
export interface YapiKrediConfig extends PaymentProviderConfig {
  merchantId: string;
  terminalId: string;
  posnetId: string;
  encKey: string;
}

/**
 * Fields Yapı Kredi POSTs to merchantReturnURL. The packets are encrypted by
 * the bank and resolved with the XML API.
 */
export interface YapiKrediCallbackFields {
  BankPacket?: string;
  MerchantPacket?: string;
  Sign?: string;
  [key: string]: string | undefined;
}

/**
 * Input of completeThreeDSPayment(): the callback POST plus the order from your
 * own records. The MAC covers the order id, amount and currency, and the
 * callback carries them only encrypted, so they must come from your side.
 *
 * Spread the callback first so your values win:
 * `completeThreeDSPayment({ ...callbackBody, orderId, amount, currency })`
 */
export interface YapiKrediCompleteRequest extends YapiKrediCallbackFields {
  /** The order id (conversationId) used to start the payment */
  orderId?: string;
  /** The order amount, as in the payment request ("1.20") */
  amount?: string;
  /** The order currency (TRY, USD, ...). Default: TRY */
  currency?: string;
}
