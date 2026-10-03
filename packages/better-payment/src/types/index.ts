import type { PaymentErrorCode } from '../core/error-codes';
export { PaymentStatus } from './common';
export type { PaymentCard, Address } from './common';
import { PaymentStatus, PaymentCard, Address } from './common';

/**
 * Para birimi
 */
export enum Currency {
  TRY = 'TRY',
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
}

/**
 * Alıcı bilgileri
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
 * Sepet item tipi
 */
export enum BasketItemType {
  PHYSICAL = 'PHYSICAL',
  VIRTUAL = 'VIRTUAL',
}

/**
 * Sepet item
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
 * Ödeme isteği parametreleri
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
   * Sipariş/işlem numarası. Banka ve PayTR entegrasyonlarında sipariş numarası
   * olarak kullanılır; verilmezse otomatik (alfanümerik) üretilir ve yanıtta döner.
   */
  conversationId?: string;
  /** Taksit sayısı (1 = tek çekim) */
  installment?: number;
}

/**
 * Ödeme yanıtı
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
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
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
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
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
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
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
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

/**
 * 3D Secure ödeme isteği
 */
export interface ThreeDSPaymentRequest extends PaymentRequest {
  callbackUrl: string;
}

/**
 * 3D Secure ödeme başlatma yanıtı
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
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

/**
 * İade isteği
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
 * İade yanıtı
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
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

/**
 * İptal isteği
 */
export interface CancelRequest {
  paymentId: string;
  ip: string;
  conversationId?: string;
  /**
   * İşlemin toplam tutarı. İptal için tutar isteyen sağlayıcılarda (Parampos,
   * Akbank) kullanılır; verilmezse mümkünse sorgulanır.
   */
  price?: string;
  currency?: Currency | string;
}

/**
 * İptal yanıtı
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
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

/**
 * BIN sorgulama yanıtı
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
 * Checkout Form isteği
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
}

/**
 * Checkout Form başlatma yanıtı
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
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

/**
 * Checkout Form sonuç yanıtı
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
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
  providerMessage?: string;
  rawResponse?: unknown;
}

/**
 * PWI (Payment With IBAN - Korumalı Havale/EFT) İsteği
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
 * PWI Ödeme Başlatma Yanıtı
 */
export interface PWIPaymentInitResponse {
  status: PaymentStatus;
  htmlContent?: string; // Müşteriye gösterilecek HTML içeriği
  token?: string;
  tokenExpireTime?: number;
  paymentPageUrl?: string; // Ödeme sayfası URL'i
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
 * PWI Ödeme Durumu
 */
export enum PWIPaymentStatus {
  WAITING = 'WAITING', // Havale bekleniyor
  SUCCESS = 'SUCCESS', // Havale başarılı
  FAILURE = 'FAILURE', // Havale başarısız/iptal edildi
}

/**
 * PWI Ödeme Sorgulama Yanıtı
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
  iban?: string; // Havale yapılacak IBAN
  bankName?: string; // Banka adı
  buyerName?: string;
  buyerSurname?: string;
  buyerEmail?: string;
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
 * Taksit Detay Bilgisi
 */
export interface InstallmentDetail {
  installmentNumber: number; // Taksit sayısı (1 = tek çekim)
  totalPrice: number; // Toplam tutar
  installmentPrice: number; // Taksit başına tutar
  /** Commission rate in percent that produced totalPrice, when the provider reports it */
  commissionRate?: number;
}

/**
 * Taksit Bilgisi (Banka Bazında)
 */
export interface InstallmentPrice {
  binNumber: string; // Kart BIN numarası
  price: number; // Fiyat
  cardType: string; // Kart tipi (CREDIT_CARD, DEBIT_CARD)
  cardAssociation: string; // Kart kuruluşu (VISA, MASTER_CARD, TROY, AMEX)
  cardFamilyName: string; // Kart ailesi adı (Bonus, Maximum, Axess, World, vb.)
  force3ds?: number; // 3DS zorunluluğu (0: hayır, 1: evet)
  bankCode: number; // Banka kodu
  bankName: string; // Banka adı
  forceCvc?: number; // CVC zorunluluğu (0: hayır, 1: evet)
  commercial: number; // Ticari kart mı (0: hayır, 1: evet)
  installmentPrices: InstallmentDetail[]; // Taksit detayları
}

/**
 * Taksit Sorgulama İsteği
 */
export interface InstallmentInfoRequest {
  binNumber: string; // Kredi kartı BIN numarası (ilk 6-8 hane)
  price: string; // Ödeme tutarı
  conversationId?: string; // İsteğe bağlı conversation ID
}

/**
 * Taksit Sorgulama Yanıtı
 */
export interface InstallmentInfoResponse {
  status: PaymentStatus;
  installmentDetails?: InstallmentPrice[]; // Taksit detayları
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

// Export subscription types
export * from './subscription';
