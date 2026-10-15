import type { PaymentProviderConfig } from '../../core/PaymentProvider';
import type { EstBank, EstStoreType } from './utils';

/**
 * EST (Asseco) virtual POS configuration: İş Bankası, Ziraat Bankası,
 * Halkbank, TEB and Şekerbank
 *
 * Values come from the bank's merchant panel:
 * - clientId: Merchant ID
 * - username / password: API user, used by the XML API
 * - storeKey: 3D Secure store key, used for the hash
 */
export interface EstConfig extends PaymentProviderConfig {
  /** Selects the bank's production host. `baseUrl` overrides it. */
  bank: EstBank;
  clientId: string;
  username: string;
  password: string;
  storeKey: string;
  /** 3D model of the store (`storetype`). Default: '3d' */
  storeType?: EstStoreType;
  /** Merchant department (`BOLUM`), when the bank assigned one */
  department?: number;
  /**
   * `mdStatus` values that are charged in the 3d and 3d_host models. Default: ['1']
   * (full 3D Secure authentication). 2, 3 and 4 are half-secure (the card or its bank
   * is not enrolled, or only an attempt was made); accepting them can leave chargeback
   * liability with the merchant.
   */
  acceptedMdStatuses?: string[];
}

/**
 * Fields EST POSTs to okUrl / failUrl. `HASH` (ver3) covers every other field.
 */
export interface Est3DCallbackData {
  clientid?: string;
  oid?: string;
  amount?: string;
  currency?: string;
  taksit?: string;
  storetype?: string;
  /** 1 means the card was fully authenticated */
  mdStatus?: string;
  mdErrorMsg?: string;
  md?: string;
  xid?: string;
  eci?: string;
  cavv?: string;
  /** Set by the bank when it charged the card (3d_pay, 3d_pay_hosting) */
  ProcReturnCode?: string;
  Response?: string;
  ErrMsg?: string;
  AuthCode?: string;
  TransId?: string;
  HASH?: string;
  [key: string]: string | undefined;
}
