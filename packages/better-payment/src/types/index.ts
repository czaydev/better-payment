import type { PaymentErrorCode } from '../core/error-codes';
export { PaymentStatus } from './common';
export type { PaymentCard, Address } from './common';
import { PaymentStatus, PaymentCard, Address } from './common';

/**
 * Currency
 */
export enum Currency {
  TRY = 'TRY',
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
}

/**
 * Buyer details
 */
export interface Buyer {
  id: string;
  name: string;
  surname: string;
  email: string;
  identityNumber: string;
  registrationAddress: string;
  city: string;
  country: string;
  zipCode?: string;
  ip: string;
  gsmNumber: string;
}

/**
 * Basket item type
 */
export enum BasketItemType {
  PHYSICAL = 'PHYSICAL',
  VIRTUAL = 'VIRTUAL',
}

/**
 * Basket item
 */
export interface BasketItem {
  id: string;
  name: string;
  category1: string;
  category2?: string;
  itemType: BasketItemType | string;
  price: string;
}

/**
 * Payment request parameters
 */
export interface PaymentRequest {
  price: string;
  paidPrice: string;
  currency: Currency | string;
  basketId: string;
  /** The card to charge. Omit it when paying with `storedCard`. */
  paymentCard?: PaymentCard;
  /** Pay with a card saved earlier (iyzico, PayTR) instead of `paymentCard` */
  storedCard?: StoredCardReference;
  /**
   * Save `paymentCard` with the provider during this payment (iyzico, PayTR
   * Direct API). The tokens come back in `storedCard` of the result, or of the
   * 3D Secure / notification result. Pass `customerToken` to add the card to an
   * existing customer.
   */
  saveCard?: boolean | { customerToken?: string; alias?: string };
  buyer: Buyer;
  shippingAddress: Address;
  billingAddress: Address;
  basketItems: BasketItem[];
  callbackUrl?: string;
  /**
   * Order/transaction ID. Used as the order ID by bank and PayTR integrations;
   * if omitted, an alphanumeric ID is generated and returned in the response.
   */
  conversationId?: string;
  /** Installment count (1 = single payment) */
  installment?: number;
}

/**
 * Payment response
 */
export interface PaymentResponse {
  status: PaymentStatus;
  paymentId?: string;
  conversationId?: string;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `i18n`) */
  providerMessage?: string;
  errorGroup?: string;
  /** Tokens of the card saved during this payment (`saveCard`) */
  storedCard?: SavedCardTokens;
  rawResponse?: unknown;
}

/** A card saved with the provider, referenced by its tokens */
export interface StoredCardReference {
  /** The provider's customer token (iyzico cardUserKey, PayTR utoken) */
  customerToken: string;
  /** The provider's card token (iyzico cardToken, PayTR ctoken) */
  cardToken: string;
  /** CVC, for providers or cards that require it on stored-card payments (PayTR require_cvv) */
  cvc?: string;
}

/** Tokens returned when a card is saved */
export interface SavedCardTokens {
  customerToken: string;
  /** Not every provider returns the card token with the payment result (PayTR: use listCards) */
  cardToken?: string;
}

/** A saved card as listed by the provider; never contains the full card number */
export interface StoredCard {
  cardToken: string;
  alias?: string;
  /** First digits of the card (BIN), when the provider returns them */
  binNumber?: string;
  lastFourDigits?: string;
  expireMonth?: string;
  expireYear?: string;
  cardType?: string;
  cardAssociation?: string;
  cardFamily?: string;
  bankName?: string;
  /** The card needs its CVC when charged (PayTR) */
  requiresCvc?: boolean;
}

export interface SaveCardRequest {
  /** Existing customer to add the card to; omit to create a new customer */
  customerToken?: string;
  /** Your own customer id (iyzico externalId) */
  externalId?: string;
  email?: string;
  alias?: string;
  card: Omit<PaymentCard, 'cvc' | 'registerCard'>;
  conversationId?: string;
}

export interface SaveCardResponse {
  status: PaymentStatus;
  customerToken?: string;
  card?: StoredCard;
  code?: PaymentErrorCode;
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `i18n`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

export interface ListCardsResponse {
  status: PaymentStatus;
  customerToken?: string;
  cards: StoredCard[];
  code?: PaymentErrorCode;
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `i18n`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

export interface DeleteCardRequest {
  customerToken: string;
  cardToken: string;
  conversationId?: string;
}

export interface DeleteCardResponse {
  status: PaymentStatus;
  code?: PaymentErrorCode;
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `i18n`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

/**
 * 3D Secure payment request
 */
export interface ThreeDSPaymentRequest extends PaymentRequest {
  callbackUrl: string;
}

/**
 * 3D Secure payment initialization response
 */
export interface ThreeDSInitResponse {
  status: PaymentStatus;
  /** HTML to render in the customer's browser (3D form, iframe page or auto-submit form) */
  threeDSHtmlContent?: string;
  /** Payment page URL when the provider supports redirecting instead of rendering HTML */
  redirectUrl?: string;
  paymentId?: string;
  conversationId?: string;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `i18n`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

/**
 * Refund request
 */
export interface RefundRequest {
  /** The paymentId returned by the payment (iyzico); the order id for other providers */
  paymentId: string;
  /**
   * iyzico only: refund one basket item by its `paymentTransactionId` (from
   * `itemTransactions`) instead of the payment as a whole.
   */
  paymentTransactionId?: string;
  price: string;
  currency: Currency | string;
  ip: string;
  conversationId?: string;
}

/**
 * Capture of a pre-authorization (post-auth): charges `amount` of the blocked
 * amount. A smaller amount is a partial capture where the provider allows it.
 */
export interface CaptureRequest {
  /** The paymentId returned by authorize() / the 3D Secure completion */
  paymentId: string;
  /** Amount to charge, at most the authorized amount */
  amount: string;
  currency?: Currency | string;
  ip: string;
  conversationId?: string;
}

/** Releases a pre-authorization without charging it */
export interface VoidAuthorizationRequest {
  paymentId: string;
  ip: string;
  conversationId?: string;
}

/**
 * Refund response
 */
export interface RefundResponse {
  status: PaymentStatus;
  refundId?: string;
  conversationId?: string;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `i18n`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

/**
 * Cancellation request
 */
export interface CancelRequest {
  paymentId: string;
  ip: string;
  conversationId?: string;
  /**
   * Total transaction amount. Used by providers that require an amount for
   * cancellation (Parampos, Akbank); queried when possible if omitted.
   */
  price?: string;
  currency?: Currency | string;
}

/**
 * Cancellation response
 */
export interface CancelResponse {
  status: PaymentStatus;
  transactionId?: string;
  voidId?: string;
  conversationId?: string;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `i18n`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

/**
 * BIN lookup response
 */
export interface BinCheckResponse {
  binNumber: string;
  cardType: string;
  cardAssociation: string;
  cardFamily: string;
  bankName: string;
  bankCode: number;
  commercial: boolean;
  rawResponse?: unknown;
}

/**
 * Checkout Form request
 */
export interface CheckoutFormRequest {
  price: string;
  paidPrice: string;
  currency: Currency | string;
  basketId: string;
  callbackUrl: string;
  enabledInstallments?: number[];
  buyer: Buyer;
  shippingAddress: Address;
  billingAddress: Address;
  basketItems: BasketItem[];
  conversationId?: string;
  /** Language of the checkout form. Default: the provider's configured locale. */
  locale?: string;
}

/**
 * Checkout Form initialization response
 */
export interface CheckoutFormInitResponse {
  status: PaymentStatus;
  checkoutFormContent?: string;
  paymentPageUrl?: string;
  token?: string;
  tokenExpireTime?: number;
  conversationId?: string;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `i18n`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

/**
 * Checkout Form result response
 */
export interface CheckoutFormRetrieveResponse {
  status: PaymentStatus;
  paymentId?: string;
  paymentStatus?: string;
  price?: number;
  paidPrice?: number;
  currency?: string;
  basketId?: string;
  installment?: number;
  binNumber?: string;
  lastFourDigits?: string;
  cardType?: string;
  cardAssociation?: string;
  cardFamily?: string;
  cardToken?: string;
  cardUserKey?: string;
  fraudStatus?: number;
  merchantCommissionRate?: number;
  merchantCommissionRateAmount?: number;
  iyziCommissionRateAmount?: number;
  iyziCommissionFee?: number;
  paymentTransactionId?: string;
  conversationId?: string;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `i18n`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

/**
 * Hosted checkout request (`createCheckout()`): the order without any card.
 * The customer enters the card on the provider's page, so no field here
 * accepts card data; card data never touches your server.
 *
 * Card storage is up to the hosted page: there is no `saveCard` field, because
 * the provider decides whether the customer can save the card. iyzico returns
 * the tokens of a card saved on its form in `getCheckoutResult().storedCard`.
 */
export interface CheckoutRequest extends Omit<
  PaymentRequest,
  'paymentCard' | 'storedCard' | 'saveCard' | 'callbackUrl'
> {
  /**
   * URL the customer's browser returns to (iyzico `callbackUrl`, PayTR
   * `merchant_ok_url`, EST `okUrl`). It is NOT a payment confirmation: the
   * query parameters of this redirect are not signed. Only a verified provider
   * callback (through `completeThreeDSPayment()`) or `getCheckoutResult()` may
   * mark an order as paid.
   */
  returnUrl: string;
  /** Fail return URL where the provider has a separate one (PayTR `merchant_fail_url`, EST `failUrl`). Default: `returnUrl` */
  failUrl?: string;
  /**
   * Allowed installment counts, e.g. `[1, 3, 6]` (iyzico `enabledInstallments`).
   * Providers that only support an installment maximum use the highest value.
   */
  installments?: number[];
  /** Language of the hosted page. Default: the provider's configured locale. */
  locale?: string;
}

/**
 * Hosted checkout initialization (`createCheckout()` result). Send the customer
 * to `redirectUrl`, embed `iframeUrl`, or render `html` (auto-submitting form).
 * `token` is the handle for `getCheckoutResult()`.
 *
 * A `pending` status means the page is ready; it does not mean the customer
 * paid. The payment is confirmed only by a verified provider callback or by a
 * `success` from `getCheckoutResult()`.
 */
export interface CheckoutInitResponse {
  status: PaymentStatus;
  /** Redirect the customer to this hosted payment page (iyzico, PayTR) */
  redirectUrl?: string;
  /** The same page for embedding in an iframe (iyzico, PayTR) */
  iframeUrl?: string;
  /** HTML to render in the customer's browser: an auto-submitting form to the bank's page (EST) or an iframe */
  html?: string;
  /**
   * Handle for `getCheckoutResult()`. iyzico: the checkout form token; PayTR and
   * EST: the order id (PayTR's iFrame token is only part of `redirectUrl`).
   */
  token?: string;
  /** Time the token expires, when the provider reports it (iyzico) */
  tokenExpireTime?: number;
  paymentId?: string;
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
 * PWI (Payment With IBAN - protected bank transfer) request
 */
export interface PWIPaymentRequest {
  price: string;
  paidPrice: string;
  currency: Currency | string;
  basketId: string;
  callbackUrl: string;
  buyer: Buyer;
  shippingAddress: Address;
  billingAddress: Address;
  basketItems: BasketItem[];
  conversationId?: string;
}

/**
 * PWI payment initialization response
 */
export interface PWIPaymentInitResponse {
  status: PaymentStatus;
  /** HTML content to display to the customer */
  htmlContent?: string;
  token?: string;
  tokenExpireTime?: number;
  /** Payment page URL */
  paymentPageUrl?: string;
  conversationId?: string;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `i18n`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

/**
 * PWI payment status
 */
export enum PWIPaymentStatus {
  WAITING = 'WAITING', // Awaiting bank transfer
  SUCCESS = 'SUCCESS', // Bank transfer succeeded
  FAILURE = 'FAILURE', // Bank transfer failed or was cancelled
}

/**
 * PWI payment query response
 */
export interface PWIPaymentRetrieveResponse {
  status: PaymentStatus;
  token?: string;
  callbackUrl?: string;
  paymentStatus?: PWIPaymentStatus | string;
  paymentId?: string;
  price?: number;
  paidPrice?: number;
  currency?: string;
  basketId?: string;
  merchantCommissionRate?: number;
  merchantCommissionRateAmount?: number;
  iyziCommissionRateAmount?: number;
  iyziCommissionFee?: number;
  /** Destination IBAN for the bank transfer */
  iban?: string;
  /** Bank name */
  bankName?: string;
  buyerName?: string;
  buyerSurname?: string;
  buyerEmail?: string;
  conversationId?: string;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `i18n`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

/**
 * Installment details
 */
export interface InstallmentDetail {
  /** Installment count (1 = single payment) */
  installmentNumber: number;
  /** Total amount */
  totalPrice: number;
  /** Amount per installment */
  installmentPrice: number;
  /** Commission rate in percent that produced totalPrice, when the provider reports it */
  commissionRate?: number;
}

/**
 * Installment options by bank
 */
export interface InstallmentPrice {
  /** Card BIN */
  binNumber: string;
  /** Price */
  price: number;
  /** Card type (CREDIT_CARD, DEBIT_CARD) */
  cardType: string;
  /** Card association (VISA, MASTER_CARD, TROY, AMEX) */
  cardAssociation: string;
  /** Card family name (Bonus, Maximum, Axess, World, etc.) */
  cardFamilyName: string;
  /** Whether 3DS is required (0: no, 1: yes) */
  force3ds?: number;
  /** Bank code */
  bankCode: number;
  /** Bank name */
  bankName: string;
  /** Whether CVC is required (0: no, 1: yes) */
  forceCvc?: number;
  /** Whether this is a commercial card (0: no, 1: yes) */
  commercial: number;
  /** Installment details */
  installmentPrices: InstallmentDetail[];
}

/**
 * Installment query request
 */
export interface InstallmentInfoRequest {
  /** Credit card BIN (first 6-8 digits) */
  binNumber: string;
  /** Payment amount */
  price: string;
  /** Optional conversation ID */
  conversationId?: string;
}

/**
 * Installment query response
 */
export interface InstallmentInfoResponse {
  status: PaymentStatus;
  /** Installment details */
  installmentDetails?: InstallmentPrice[];
  conversationId?: string;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `i18n`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

// Export subscription types
export * from './subscription';
