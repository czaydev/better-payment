import type { PaymentProviderConfig } from '../../core/PaymentProvider';

/**
 * Denizbank virtual POS (InterVPos) configuration
 *
 * Values come from Denizbank:
 * - shopCode: mağaza kodu
 * - userCode / userPass: API user
 * - merchantPass: 3D Secure store key, used for the hashes and never sent
 */
export interface DenizbankConfig extends PaymentProviderConfig {
  shopCode: string;
  userCode: string;
  userPass: string;
  merchantPass: string;
  /**
   * 3D model of the shop. Default: '3DModel' (the bank authenticates, you charge
   * with Auth). With '3DPay' the bank also charges the card.
   */
  secureType?: '3DModel' | '3DPay';
}

/**
 * Fields Denizbank POSTs to OkUrl / FailUrl. `HASH` covers the fields named
 * in `HASHPARAMS`.
 */
export interface Denizbank3DCallbackData {
  OrderId?: string;
  ShopCode?: string;
  PurchAmount?: string;
  Currency?: string;
  InstallmentCount?: string;
  '3DStatus'?: string;
  MD?: string;
  PayerTxnId?: string;
  Eci?: string;
  PayerAuthenticationCode?: string;
  ProcReturnCode?: string;
  ErrorMessage?: string;
  HASH?: string;
  HASHPARAMS?: string;
  HASHPARAMSVAL?: string;
  [key: string]: string | undefined;
}
