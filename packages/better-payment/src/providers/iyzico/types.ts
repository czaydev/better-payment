import type { PaymentResponse } from '../../types';

/**
 * iyzico API response types
 */

export interface IyzicoResponse {
  status: string;
  locale: string;
  systemTime: number;
  conversationId?: string;
  errorCode?: string;
  errorMessage?: string;
  errorGroup?: string;
}

/**
 * Subscription API response. Fields vary per endpoint; they are passed through as-is.
 */
export interface IyzicoSubscriptionResponse extends IyzicoResponse {
  [key: string]: unknown;
}

/**
 * Body iyzico POSTs to the 3D Secure callbackUrl
 */
export interface IyzicoThreeDSCallbackData {
  status?: string;
  paymentId?: string;
  conversationId?: string;
  conversationData?: string;
  mdStatus?: string | number;
}

export interface IyzicoPaymentResponse extends IyzicoResponse {
  paymentId?: string;
  price?: number;
  paidPrice?: number;
  currency?: string;
  basketId?: string;
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
}

export interface IyzicoThreeDSInitResponse extends IyzicoResponse {
  threeDSHtmlContent?: string;
  paymentId?: string;
  token?: string;
}

export interface IyzicoRefundResponse extends IyzicoResponse {
  paymentId?: string;
  paymentTransactionId?: string;
  price?: number;
  currency?: string;
}

export interface IyzicoCancelResponse extends IyzicoResponse {
  paymentId?: string;
  price?: number;
  currency?: string;
}

/**
 * iyzico API request types
 */

export interface IyzicoPaymentCard {
  cardHolderName?: string;
  cardNumber?: string;
  expireMonth?: string;
  expireYear?: string;
  cvc?: string;
  registerCard?: number;
  cardAlias?: string;
  /** Stored card: customer key and card token instead of card data */
  cardUserKey?: string;
  cardToken?: string;
}

/** A card as returned by the card storage API */
export interface IyzicoStoredCardDetails {
  cardToken: string;
  cardAlias?: string;
  binNumber?: string;
  lastFourDigits?: string;
  cardType?: string;
  cardAssociation?: string;
  cardFamily?: string;
  cardBankName?: string;
  cardBankCode?: number;
}

export interface IyzicoCardResponse extends IyzicoResponse, Partial<IyzicoStoredCardDetails> {
  cardUserKey?: string;
  externalId?: string;
  email?: string;
}

export interface IyzicoCardListResponse extends IyzicoResponse {
  cardUserKey?: string;
  cardDetails?: IyzicoStoredCardDetails[];
}

export interface IyzicoBuyer {
  id: string;
  name: string;
  surname: string;
  gsmNumber: string;
  email: string;
  identityNumber: string;
  lastLoginDate?: string;
  registrationDate?: string;
  registrationAddress: string;
  ip: string;
  city: string;
  country: string;
  zipCode?: string;
}

export interface IyzicoAddress {
  contactName: string;
  city: string;
  country: string;
  address: string;
  zipCode?: string;
}

export interface IyzicoBasketItem {
  id: string;
  name: string;
  category1: string;
  category2?: string;
  itemType: string;
  price: string;
}

export interface IyzicoPaymentRequest {
  locale: string;
  conversationId?: string;
  price: string;
  paidPrice: string;
  currency: string;
  installment: number;
  basketId: string;
  paymentChannel: string;
  paymentGroup: string;
  paymentCard: IyzicoPaymentCard;
  buyer: IyzicoBuyer;
  shippingAddress: IyzicoAddress;
  billingAddress: IyzicoAddress;
  basketItems: IyzicoBasketItem[];
  callbackUrl?: string;
}

/**
 * iyzico Checkout Form request type
 */
export interface IyzicoCheckoutFormRequest {
  locale: string;
  conversationId?: string;
  price: string;
  paidPrice: string;
  currency: string;
  basketId: string;
  paymentGroup: string;
  callbackUrl: string;
  enabledInstallments?: number[];
  paymentChannel?: string;
  buyer: IyzicoBuyer;
  shippingAddress: IyzicoAddress;
  billingAddress: IyzicoAddress;
  basketItems: IyzicoBasketItem[];
}

/**
 * iyzico Checkout Form initialization response
 */
export interface IyzicoCheckoutFormInitResponse extends IyzicoResponse {
  checkoutFormContent?: string;
  paymentPageUrl?: string;
  token?: string;
  tokenExpireTime?: number;
}

/**
 * iyzico Checkout Form retrieval response
 */
export interface IyzicoCheckoutFormRetrieveResponse extends IyzicoResponse {
  paymentId?: string;
  paymentStatus?: string;
  fraudStatus?: number;
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
  merchantCommissionRate?: number;
  merchantCommissionRateAmount?: number;
  iyziCommissionRateAmount?: number;
  iyziCommissionFee?: number;
  paymentTransactionId?: string;
}

export interface IyzicoBinCheckRequest {
  locale?: string;
  conversationId?: string;
  binNumber: string;
}

export interface IyzicoBinCheckResponse extends IyzicoResponse {
  binNumber?: string;
  cardType?: string;
  cardAssociation?: string;
  cardFamily?: string;
  bankName?: string;
  bankCode?: number;
  commercial?: number;
}

/**
 * iyzico PWI (Payment With IBAN - protected bank transfer) types
 */

/**
 * PWI payment initialization request
 */
export interface IyzicoPWIPaymentRequest {
  locale: string;
  conversationId?: string;
  price: string;
  paidPrice: string;
  currency: string;
  basketId: string;
  paymentGroup: string;
  callbackUrl: string;
  buyer: IyzicoBuyer;
  shippingAddress: IyzicoAddress;
  billingAddress: IyzicoAddress;
  basketItems: IyzicoBasketItem[];
}

/**
 * PWI payment initialization response
 */
export interface IyzicoPWIPaymentInitResponse extends IyzicoResponse {
  /** HTML content to display to the customer */
  htmlContent?: string;
  /** PWI token */
  token?: string;
  tokenExpireTime?: number;
  /** Payment page URL */
  paymentPageUrl?: string;
}

/**
 * PWI payment query response
 */
export interface IyzicoPWIPaymentRetrieveResponse extends IyzicoResponse {
  token?: string;
  callbackUrl?: string;
  /** WAITING, SUCCESS, FAILURE */
  paymentStatus?: string;
  paymentId?: string;
  price?: number;
  paidPrice?: number;
  currency?: string;
  basketId?: string;
  merchantCommissionRate?: number;
  merchantCommissionRateAmount?: number;
  iyziCommissionRateAmount?: number;
  iyziCommissionFee?: number;
  iban?: string;
  bankName?: string;
  buyerName?: string;
  buyerSurname?: string;
  buyerEmail?: string;
}

/**
 * iyzico installment details
 */
export interface IyzicoInstallmentDetail {
  installmentNumber: number;
  totalPrice: number;
  installmentPrice: number;
}

/**
 * iyzico installment pricing
 */
export interface IyzicoInstallmentPrice {
  binNumber: string;
  price: number;
  cardType: string;
  cardAssociation: string;
  cardFamilyName: string;
  force3ds?: number;
  bankCode: number;
  bankName: string;
  forceCvc?: number;
  commercial: number;
  installmentPrices: IyzicoInstallmentDetail[];
}

/**
 * iyzico installment query request
 */
export interface IyzicoInstallmentInfoRequest {
  locale?: string;
  conversationId?: string;
  binNumber: string;
  price: string;
}

/**
 * iyzico installment query response
 */
export interface IyzicoInstallmentInfoResponse extends IyzicoResponse {
  installmentDetails?: IyzicoInstallmentPrice[];
}

/**
 * iyzico Webhook (Merchant Notification) Payload
 */
export interface IyzicoWebhookPayload {
  iyziEventType?: string;
  paymentId?: string;
  paymentConversationId?: string;
  status?: string;
  iyziReferenceCode?: string;
  price?: number | string;
  paidPrice?: number | string;
  currency?: string;
  errorCode?: string;
  errorMessage?: string;
  errorGroup?: string;
  [key: string]: unknown;
}

export interface IyzicoVerifyWebhookResult {
  valid: boolean;
  event?: IyzicoWebhookPayload;
  result?: PaymentResponse;
}
