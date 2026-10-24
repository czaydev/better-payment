import type { PaymentProviderConfig } from '../../core/PaymentProvider';

/**
 * Lidio configuration. Values come from Lidio (destek@lidio.com):
 * - merchantCode: sent as the `MerchantCode` header
 * - apiKey: the server-to-server API key, sent as `Authorization: MxS2S <apiKey>`
 * - merchantKey: signs the 3D Secure return (`Hash`)
 */
export interface LidioConfig extends PaymentProviderConfig {
  merchantCode: string;
  apiKey: string;
  merchantKey: string;
}

/** Fields every Lidio answer carries */
export interface LidioResponse {
  /** Success, Refused, RedirectFormCreated, VerificationRequired, SystemError, ... */
  result?: string;
  /** A finer code: Success, Refused, InvalidCardNum, ThreeDSRedirectFormCreated, ... */
  resultDetail?: string;
  resultMessage?: string;
  [key: string]: unknown;
}

/** `paymentInfo` of payment, inquiry, cancel and refund answers */
export interface LidioPaymentInfo {
  orderId?: string;
  systemTransId?: string;
  amountRequested?: number;
  amountProcessed?: number;
  installmentCount?: number;
  currency?: string;
  isCancelled?: boolean | null;
  isRefunded?: boolean | null;
  isFullRefunded?: boolean | null;
  totalRefundedAmount?: number | null;
  instrumentDetail?: {
    card?: {
      processType?: string;
      maskedCardNumber?: string;
      is3DSecure?: boolean;
      isAuthenticated?: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  acquirerResultDetail?: {
    pos?: {
      /** The bank's result code, e.g. "00" or "51" */
      returnCode?: string;
      message?: string;
      authCode?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Answer of ProcessPayment, FinishPaymentProcess, Postauth, Cancel, Refund, PaymentInquiry */
export interface LidioPaymentResponse extends LidioResponse {
  /** The page to write to the browser when `result` is RedirectFormCreated */
  redirectForm?: string;
  paymentInfo?: LidioPaymentInfo | null;
}

/**
 * Query string parameters Lidio adds when it sends the customer back to the
 * return URL after 3D Secure. `Hash` covers OrderId, TotalAmount and Result.
 */
export interface Lidio3DCallbackData {
  OrderId?: string;
  SystemTransId?: string;
  /** 3DSuccess or 3DFailed */
  Result?: string;
  /** "1.20": en-US, 2 decimals */
  TotalAmount?: string;
  InstallmentCount?: string;
  MDStatus?: string;
  Hash?: string;
  [key: string]: string | undefined;
}

/**
 * The order from your own records for `completeThreeDSPayment`, passed as a
 * separate second argument and never read from the callback.
 */
export interface LidioCompleteContext {
  /** The order id you started the payment with */
  orderId?: string;
  /** The order amount ("100.00") */
  amount?: string | number;
  /** The order currency. Default: TRY */
  currency?: string;
  /**
   * The customer's email or customer id, whichever your Lidio account uses to
   * identify customers: it is the last part of the return URL's `Hash`. Default:
   * the email.
   */
  customer?: string;
}

/** Answer of GetBankOfBINNumber */
export interface LidioBinResponse extends LidioResponse {
  bankCode?: string;
  cardType?: string;
  isDebitCard?: boolean;
  cardProgramName?: string;
  isBusinessCard?: boolean;
}

/** One installment option of GetInstallmentInfo */
export interface LidioInstallmentOption {
  /** 0 for a single payment */
  installmentCount?: number;
  extraInstallmentCount?: number;
  installmentAppliesTo?: string;
  baseInstallmentMinAmount?: number | null;
  /** The rate reflected to the customer, in percent */
  interestRateToUser?: number | null;
  /** Returned when the request has an amount */
  totalAmountWithInterest?: number | null;
  [key: string]: unknown;
}

/** Answer of GetInstallmentInfo */
export interface LidioInstallmentResponse extends LidioResponse {
  posList?: Array<{
    posId?: number;
    posBankCode?: string;
    posBankName?: string;
    installmentOptionList?: LidioInstallmentOption[] | null;
    [key: string]: unknown;
  }> | null;
}
