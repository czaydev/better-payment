import type { PaymentErrorCode } from '../core/error-codes';
import { PaymentStatus } from './common';

/**
 * Marketplace (split payment) types.
 *
 * A marketplace charges the customer once and each basket item names the seller
 * (sub-merchant) that receives its share. Providers without a marketplace API
 * reject `BasketItem.subMerchant` with `NOT_SUPPORTED` instead of settling the
 * whole amount to the marketplace.
 */

/** iyzico sub-merchant types; the lowercase aliases are the portable names */
export type SubMerchantType =
  | 'individual'
  | 'private_company'
  | 'limited_or_joint_stock_company'
  | 'PERSONAL'
  | 'PRIVATE_COMPANY'
  | 'LIMITED_OR_JOINT_STOCK_COMPANY';

/** The seller's share of one basket item */
export interface BasketItemSubMerchant {
  /** The sub-merchant key returned when the seller was registered */
  key: string;
  /** Amount that settles to the seller; at most the item's `price` */
  price: string;
}

export interface CreateSubMerchantRequest {
  /** `individual` = iyzico PERSONAL, `private_company` = PRIVATE_COMPANY, ... */
  type: SubMerchantType;
  /**
   * Your own seller id (iyzico `subMerchantExternalId`). Required by iyzico:
   * it is how the seller is looked up and kept unique.
   */
  externalId: string;
  name: string;
  email: string;
  gsmNumber: string;
  address: string;
  /** Payout IBAN, e.g. `TR330006100519786457841326` (mod-97 checked) */
  iban: string;
  /** `TR` unless the sub-merchant settles in another supported currency */
  currency?: string;
  swiftCode?: string;
  /** `individual` sellers (TCKN) */
  identityNumber?: string;
  /** Companies: tax office, tax number and legal title */
  taxOffice?: string;
  taxNumber?: string;
  legalCompanyTitle?: string;
  contactName?: string;
  contactSurname?: string;
  conversationId?: string;
  locale?: string;
}

export interface UpdateSubMerchantRequest extends CreateSubMerchantRequest {
  /** iyzico sub-merchant key of the seller to update */
  subMerchantKey: string;
}

export interface RetrieveSubMerchantRequest {
  /** The `externalId` the seller was registered with (iyzico looks sellers up by it) */
  externalId: string;
  conversationId?: string;
  locale?: string;
}

/** A registered seller, as returned by the provider */
export interface SubMerchant {
  subMerchantKey: string;
  externalId?: string;
  type?: SubMerchantType | string;
  name?: string;
  email?: string;
  gsmNumber?: string;
  address?: string;
  iban?: string;
  currency?: string;
  identityNumber?: string;
  taxOffice?: string;
  taxNumber?: string;
  legalCompanyTitle?: string;
  contactName?: string;
  contactSurname?: string;
}

export interface SubMerchantResponse {
  status: PaymentStatus;
  /** The key to put in `BasketItem.subMerchant.key` */
  subMerchantKey?: string;
  /** Full seller record (retrieve; includes what the provider echoes on create/update) */
  subMerchant?: SubMerchant;
  conversationId?: string;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

/**
 * Releases (or takes back) one seller's share of a paid basket item.
 * The `paymentTransactionId` of an item comes from `itemTransactions` of the
 * payment; `getPayment()` returns the raw iyzico payment.
 */
export interface ApprovePayoutRequest {
  paymentTransactionId: string;
  conversationId?: string;
  locale?: string;
}

export interface PayoutResponse {
  status: PaymentStatus;
  paymentTransactionId?: string;
  conversationId?: string;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
  providerMessage?: string;
  rawResponse?: unknown;
}
