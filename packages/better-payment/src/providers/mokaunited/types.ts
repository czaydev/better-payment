import type { PaymentProviderConfig } from '../../core/PaymentProvider';
import type { ThreeDSInitResponse } from '../../types';

/**
 * Moka United configuration. Values come from Moka United (the dealer's API user):
 * - dealerCode: bayi kodu
 * - username / password: API user, used for the CheckKey of every request
 */
export interface MokaUnitedConfig extends PaymentProviderConfig {
  dealerCode: string;
  username: string;
  password: string;
  /**
   * `Software`: the name of your application, sent with payments (max 30
   * characters). Default: 'better-payment'.
   */
  software?: string;
}

/** The envelope of every Moka United answer */
export interface MokaUnitedResponse<T = Record<string, unknown>> {
  Data?: T | null;
  /** "Success", or an error code such as PaymentDealer.DoVoid.PaymentNotFound */
  ResultCode?: string;
  ResultMessage?: string;
  Exception?: unknown;
}

/** `Data` of payment, void, capture and refund answers */
export interface MokaUnitedOperationData {
  IsSuccessful?: boolean;
  /** The bank's or Moka United's code when IsSuccessful is false */
  ResultCode?: string;
  ResultMessage?: string;
  VirtualPosOrderId?: string;
  RefundRequestId?: string | number;
  [key: string]: unknown;
}

/** `Data` of DoDirectPaymentThreeD */
export interface MokaUnitedThreeDData {
  Url?: string;
  /** Secret of this payment: keep it with the order to check the callback */
  CodeForHash?: string;
}

/** `PaymentDetail` of GetDealerPaymentTrxDetailList */
export interface MokaUnitedPaymentDetail {
  DealerPaymentId?: number;
  OtherTrxCode?: string;
  Amount?: number;
  /** Total refunded */
  RefAmount?: number;
  CurrencyCode?: string;
  InstallmentNumber?: number;
  IsThreeD?: boolean;
  /** 0 waiting, 1 pre-authorization, 2 payment, 3 void, 4 full refund */
  PaymentStatus?: number;
  /** 0 waiting, 1 successful, 2 failed */
  TrxStatus?: number;
  [key: string]: unknown;
}

/** A transaction of GetDealerPaymentTrxDetailList */
export interface MokaUnitedPaymentTrx {
  TrxType?: number;
  TrxStatus?: number;
  Amount?: number;
  VirtualPosOrderId?: string;
  [key: string]: unknown;
}

/** `Data` of GetDealerPaymentTrxDetailList */
export interface MokaUnitedPaymentDetailData {
  IsSuccessful?: boolean;
  ResultCode?: string;
  ResultMessage?: string;
  PaymentDetail?: MokaUnitedPaymentDetail | null;
  PaymentTrxDetailList?: MokaUnitedPaymentTrx[] | null;
}

/** Card details of GetBankCardInformation and DoCalcPaymentAmount */
export interface MokaUnitedBankCard {
  BankName?: string;
  BankCode?: string;
  BinNumber?: string;
  CardName?: string;
  /** MASTER, VISA, MAESTRO, AMEX, TROY */
  CardType?: string;
  /** CreditCard or DebitCard */
  CreditType?: string;
  /** Ticari or Bireysel */
  ProductCategory?: string;
  /** Card program: BONUS, AXESS, WORLD, CARDFINANS, ... */
  GroupName?: string;
}

/** `Data` of DoCalcPaymentAmount */
export interface MokaUnitedAmountData {
  /** The amount to charge the card */
  PaymentAmount?: number;
  DealerCommissionRate?: number;
  BankCard?: MokaUnitedBankCard;
}

/** initThreeDSPayment() answer, with the secret that checks the callback */
export interface MokaUnitedThreeDSInitResponse extends ThreeDSInitResponse {
  /**
   * `CodeForHash` of this payment. Store it with the order, server side, and pass it
   * to completeThreeDSPayment(): the callback's `hashValue` is checked against it.
   */
  codeForHash?: string;
}

/** Fields Moka United POSTs to RedirectUrl after 3D Secure */
export interface MokaUnited3DCallbackData {
  hashValue?: string;
  resultCode?: string;
  resultMessage?: string;
  /** Moka United's order id (VirtualPosOrderId) */
  trxCode?: string;
  /** Your order id, as sent */
  OtherTrxCode?: string;
  /** `codeForHash` from initThreeDSPayment(), from your records (required) */
  codeForHash?: string;
  /** The order id from your records; takes precedence over OtherTrxCode */
  orderId?: string;
  /** The amount you expect, checked against Moka United's record when given */
  amount?: string | number;
  [key: string]: unknown;
}
