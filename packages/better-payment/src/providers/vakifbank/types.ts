import type { PaymentProviderConfig } from '../../core/PaymentProvider';

/**
 * VakıfBank virtual POS (VPOS 7/24) configuration
 *
 * - merchantId: 15-digit üye işyeri numarası
 * - password: API password
 * - terminalNo: terminal number (e.g. VP000000)
 *
 * 3D Secure uses VakıfBank's 3DS product: ask VakıfBank to enable 3DS for the
 * merchant before going live.
 */
export interface VakifBankConfig extends PaymentProviderConfig {
  merchantId: string;
  password: string;
  terminalNo: string;
  /**
   * Selects the test MPI (3D Secure) service. betterPayment() sets this
   * automatically when mode is 'sandbox'.
   */
  testMode?: boolean;
  /** Override the MPI enrollment URL */
  mpiUrl?: string;
}

/**
 * Fields VakıfBank's MPI POSTs to SuccessUrl / FailureUrl. They are not signed:
 * VPOS checks the 3D Secure result of the MPI transaction itself.
 */
export interface VakifBank3DCallbackData {
  MerchantId?: string;
  /** The order id sent with the enrollment */
  VerifyEnrollmentRequestId?: string;
  /** Y: authenticated; A, U, E, N: not fully authenticated */
  Status?: string;
  Xid?: string;
  PurchAmount?: string;
  PurchCurrency?: string;
  ExpiryDate?: string;
  Eci?: string;
  Cavv?: string;
  InstallmentCount?: string;
  SessionInfo?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
  [key: string]: string | undefined;
}
