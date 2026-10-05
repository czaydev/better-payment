import {
  defineProvider,
  withProviderDefaults,
  ProviderType,
  type ProviderDefinition,
} from '../../core/BetterPaymentConfig';
import type { HttpClient, HttpRequestConfig } from '../../core/http';
import { fromBase64, randomHex } from '../../core/crypto';
import { PaymentProvider, PaymentProviderConfig } from '../../core/PaymentProvider';
import { ConfigurationError } from '../../core/errors';
import { failureResult, FailureResult } from '../../core/failure';
import type { PaymentValidationRules } from '../../core/validation';
import { IYZICO_ERROR_CODES } from './error-codes';
import type { PaymentErrorCode } from '../../core/error-codes';
import {
  PaymentRequest,
  PaymentResponse,
  ThreeDSPaymentRequest,
  ThreeDSInitResponse,
  RefundRequest,
  RefundResponse,
  CancelRequest,
  CancelResponse,
  CaptureRequest,
  VoidAuthorizationRequest,
  SavedCardTokens,
  StoredCard,
  SaveCardRequest,
  SaveCardResponse,
  ListCardsResponse,
  DeleteCardRequest,
  DeleteCardResponse,
  PaymentStatus,
  CheckoutFormRequest,
  CheckoutFormInitResponse,
  CheckoutFormRetrieveResponse,
  BinCheckResponse,
  PWIPaymentRequest,
  PWIPaymentInitResponse,
  PWIPaymentRetrieveResponse,
  InstallmentInfoRequest,
  InstallmentInfoResponse,
  SubscriptionInitializeRequest,
  SubscriptionInitializeResponse,
  SubscriptionCancelRequest,
  SubscriptionCancelResponse,
  SubscriptionUpgradeRequest,
  SubscriptionUpgradeResponse,
  SubscriptionRetrieveRequest,
  SubscriptionRetrieveResponse,
  SubscriptionCardUpdateRequest,
  SubscriptionCardUpdateResponse,
  SubscriptionProductCreateRequest,
  SubscriptionProductResponse,
  PricingPlanCreateRequest,
  PricingPlanResponse,
} from '../../types';
import { createIyzicoHeaders } from './utils';
import {
  IyzicoPaymentRequest,
  IyzicoPaymentResponse,
  IyzicoThreeDSInitResponse,
  IyzicoRefundResponse,
  IyzicoCancelResponse,
  IyzicoCheckoutFormRequest,
  IyzicoCheckoutFormInitResponse,
  IyzicoCheckoutFormRetrieveResponse,
  IyzicoBinCheckRequest,
  IyzicoBinCheckResponse,
  IyzicoPWIPaymentRequest,
  IyzicoPWIPaymentInitResponse,
  IyzicoPWIPaymentRetrieveResponse,
  IyzicoInstallmentInfoRequest,
  IyzicoInstallmentInfoResponse,
  IyzicoSubscriptionResponse,
  IyzicoThreeDSCallbackData,
  IyzicoPaymentCard,
  IyzicoStoredCardDetails,
  IyzicoCardResponse,
  IyzicoCardListResponse,
  IyzicoResponse,
} from './types';

/**
 * iyzico configuration
 */
/** iyzico rejects requests without these fields */
const IYZICO_ORDER_RULES: PaymentValidationRules = {
  basketRequired: true,
  basketMatchesPrice: true,
  required: [
    'buyer.id',
    'buyer.name',
    'buyer.surname',
    'buyer.email',
    'buyer.identityNumber',
    'buyer.registrationAddress',
    'buyer.city',
    'buyer.country',
    'buyer.ip',
    'billingAddress.contactName',
    'billingAddress.city',
    'billingAddress.country',
    'billingAddress.address',
  ],
};

const IYZICO_CARD_PAYMENT_RULES: PaymentValidationRules = {
  ...IYZICO_ORDER_RULES,
  card: true,
  storedCard: true,
  saveCard: true,
};

export interface IyzicoConfig extends PaymentProviderConfig {
  apiKey: string;
  secretKey: string;
}

/**
 * iyzico checkout form / 3DS payment status -> unified status
 */
function mapIyzicoPaymentStatus(
  apiStatus: string | undefined,
  paymentStatus: string | undefined
): PaymentStatus {
  if (apiStatus !== 'success') return PaymentStatus.FAILURE;
  switch ((paymentStatus || '').toUpperCase()) {
    case 'SUCCESS':
      return PaymentStatus.SUCCESS;
    case 'FAILURE':
      return PaymentStatus.FAILURE;
    default:
      // INIT_THREEDS, CALLBACK_THREEDS, WAITING, BKM_POS_SELECTED, ...
      return PaymentStatus.PENDING;
  }
}

/**
 * İyzico ödeme sağlayıcısı
 */
export class Iyzico extends PaymentProvider<IyzicoConfig> {
  private client: HttpClient;

  constructor(config: IyzicoConfig) {
    super(config);
    this.client = this.createHttpClient('iyzico', { timeout: 30000 });
  }

  protected validateConfig(): void {
    const missing = (['apiKey', 'secretKey'] as const).filter((key) => !this.config[key]);
    if (missing.length > 0) {
      throw new ConfigurationError(
        `iyzico configuration is missing: ${missing.join(', ')}`,
        'iyzico'
      );
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('iyzico baseUrl is required', 'iyzico');
    }
  }

  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return IYZICO_ERROR_CODES;
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('iyzico', error, fallback, extra));
  }

  /**
   * İyzico status'ünü PaymentStatus'e çevir
   */
  private mapStatus(iyzicoStatus: string): PaymentStatus {
    switch (iyzicoStatus) {
      case 'success':
        return PaymentStatus.SUCCESS;
      case 'failure':
        return PaymentStatus.FAILURE;
      default:
        return PaymentStatus.PENDING;
    }
  }

  /**
   * Signed request (IYZWSv2). The signature covers the random key, the URI path
   * and the exact JSON body sent ("{}" for bodiless requests, as in the official SDK).
   */
  private async sendRequest<T>(
    endpoint: string,
    data: unknown,
    options: { method?: 'POST' | 'GET' | 'DELETE'; retryable?: boolean } = {}
  ): Promise<T> {
    const method = options.method ?? 'POST';
    const requestBody = JSON.stringify(data ?? {});
    const headers = await createIyzicoHeaders(
      this.config.apiKey,
      this.config.secretKey,
      endpoint,
      requestBody
    );

    const config: HttpRequestConfig = {
      method,
      url: endpoint,
      headers: { ...headers, 'Content-Type': 'application/json' },
      retryable: options.retryable,
    };
    if (method !== 'GET') {
      // İmza için kullanılan body ile gönderilen body'nin aynı olması gerekiyor
      config.data = requestBody;
    }

    const response = await this.client.request<T>(config);
    return response.data;
  }

  /**
   * Uygulama request'ini İyzico formatına çevir
   */
  /**
   * Card data, or a stored card's tokens (cardUserKey + cardToken). With
   * `saveCard`, iyzico registers the card and returns its tokens.
   */
  private mapPaymentCard(request: PaymentRequest): IyzicoPaymentCard {
    if (request.storedCard) {
      return {
        cardUserKey: request.storedCard.customerToken,
        cardToken: request.storedCard.cardToken,
      };
    }
    const card = this.cardOf(request);
    const save = request.saveCard || card.registerCard;
    const options = typeof request.saveCard === 'object' ? request.saveCard : {};
    return {
      cardHolderName: card.cardHolderName,
      cardNumber: card.cardNumber,
      expireMonth: card.expireMonth,
      expireYear: card.expireYear,
      cvc: card.cvc,
      registerCard: save ? 1 : 0,
      ...(save && options.alias ? { cardAlias: options.alias } : {}),
      ...(save && options.customerToken ? { cardUserKey: options.customerToken } : {}),
    };
  }

  /** Tokens of a card saved during a payment, when iyzico returns them */
  private static savedCardOf(response: { cardUserKey?: string; cardToken?: string }): {
    storedCard?: SavedCardTokens;
  } {
    return response.cardUserKey
      ? { storedCard: { customerToken: response.cardUserKey, cardToken: response.cardToken } }
      : {};
  }

  private mapToIyzicoRequest(request: PaymentRequest): IyzicoPaymentRequest {
    return {
      locale: this.config.locale || 'tr',
      conversationId: request.conversationId,
      price: request.price,
      paidPrice: request.paidPrice,
      currency: request.currency,
      installment: 1,
      basketId: request.basketId,
      paymentChannel: 'WEB',
      paymentGroup: 'PRODUCT',
      paymentCard: this.mapPaymentCard(request),
      buyer: {
        id: request.buyer.id,
        name: request.buyer.name,
        surname: request.buyer.surname,
        gsmNumber: request.buyer.gsmNumber,
        email: request.buyer.email,
        identityNumber: request.buyer.identityNumber,
        registrationAddress: request.buyer.registrationAddress,
        ip: request.buyer.ip,
        city: request.buyer.city,
        country: request.buyer.country,
        zipCode: request.buyer.zipCode,
      },
      shippingAddress: {
        contactName: request.shippingAddress.contactName,
        city: request.shippingAddress.city,
        country: request.shippingAddress.country,
        address: request.shippingAddress.address,
        zipCode: request.shippingAddress.zipCode,
      },
      billingAddress: {
        contactName: request.billingAddress.contactName,
        city: request.billingAddress.city,
        country: request.billingAddress.country,
        address: request.billingAddress.address,
        zipCode: request.billingAddress.zipCode,
      },
      basketItems: request.basketItems.map((item) => ({
        id: item.id,
        name: item.name,
        category1: item.category1,
        category2: item.category2,
        itemType: item.itemType,
        price: item.price,
      })),
    };
  }

  /**
   * Checkout Form request'ini İyzico formatına çevir
   */
  private mapToIyzicoCheckoutFormRequest(request: CheckoutFormRequest): IyzicoCheckoutFormRequest {
    return {
      locale: this.config.locale || 'tr',
      conversationId: request.conversationId,
      price: request.price,
      paidPrice: request.paidPrice,
      currency: request.currency,
      basketId: request.basketId,
      paymentGroup: 'PRODUCT',
      paymentChannel: 'WEB',
      callbackUrl: request.callbackUrl,
      enabledInstallments: request.enabledInstallments,
      buyer: {
        id: request.buyer.id,
        name: request.buyer.name,
        surname: request.buyer.surname,
        gsmNumber: request.buyer.gsmNumber,
        email: request.buyer.email,
        identityNumber: request.buyer.identityNumber,
        registrationAddress: request.buyer.registrationAddress,
        ip: request.buyer.ip,
        city: request.buyer.city,
        country: request.buyer.country,
        zipCode: request.buyer.zipCode,
      },
      shippingAddress: {
        contactName: request.shippingAddress.contactName,
        city: request.shippingAddress.city,
        country: request.shippingAddress.country,
        address: request.shippingAddress.address,
        zipCode: request.shippingAddress.zipCode,
      },
      billingAddress: {
        contactName: request.billingAddress.contactName,
        city: request.billingAddress.city,
        country: request.billingAddress.country,
        address: request.billingAddress.address,
        zipCode: request.billingAddress.zipCode,
      },
      basketItems: request.basketItems.map((item) => ({
        id: item.id,
        name: item.name,
        category1: item.category1,
        category2: item.category2,
        itemType: item.itemType,
        price: item.price,
      })),
    };
  }

  /**
   * Direkt ödeme (3D Secure olmadan)
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    return this.cardPayment('/payment/auth', request, 'Payment failed');
  }

  /** Pre-authorization (`/payment/preauth`): blocks the amount without charging it */
  async authorize(request: PaymentRequest): Promise<PaymentResponse> {
    return this.cardPayment('/payment/preauth', request, 'Pre-authorization failed');
  }

  private async cardPayment(
    path: string,
    request: PaymentRequest,
    fallback: string
  ): Promise<PaymentResponse> {
    try {
      this.validatePayment(request, IYZICO_CARD_PAYMENT_RULES);
      const iyzicoRequest = this.mapToIyzicoRequest(request);
      const response = await this.sendRequest<IyzicoPaymentResponse>(path, iyzicoRequest);

      return this.withErrorCode({
        status: this.mapStatus(response.status),
        paymentId: response.paymentId,
        conversationId: response.conversationId,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        errorGroup: response.errorGroup,
        ...Iyzico.savedCardOf(response),
        rawResponse: response,
      });
    } catch (error) {
      return this.failure(error, fallback);
    }
  }

  /**
   * 3D Secure ödeme başlat
   */
  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    return this.threeDSInit('/payment/3dsecure/initialize', request, '3DS initialization failed');
  }

  /**
   * 3D Secure pre-authorization (`/payment/3dsecure/initialize/preauth`).
   * Complete it with completeThreeDSPayment() as usual.
   */
  async initThreeDSAuthorize(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    return this.threeDSInit(
      '/payment/3dsecure/initialize/preauth',
      request,
      '3DS pre-authorization failed'
    );
  }

  private async threeDSInit(
    path: string,
    request: ThreeDSPaymentRequest,
    fallback: string
  ): Promise<ThreeDSInitResponse> {
    try {
      this.validatePayment(request, IYZICO_CARD_PAYMENT_RULES);
      const iyzicoRequest = {
        ...this.mapToIyzicoRequest(request),
        callbackUrl: request.callbackUrl,
      };

      const response = await this.sendRequest<IyzicoThreeDSInitResponse>(path, iyzicoRequest);

      // İyzico threeDSHtmlContent'i Base64 encoded olarak döndürür, decode edelim
      let decodedHtmlContent: string | undefined;
      if (response.threeDSHtmlContent) {
        try {
          decodedHtmlContent = fromBase64(response.threeDSHtmlContent);
        } catch (decodeError) {
          // Eğer decode edilemezse, raw halini kullan
          decodedHtmlContent = response.threeDSHtmlContent;
        }
      }

      return this.withErrorCode({
        status: this.mapStatus(response.status),
        threeDSHtmlContent: decodedHtmlContent,
        paymentId: response.paymentId,
        conversationId: response.conversationId,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        rawResponse: response,
      });
    } catch (error) {
      return this.failure(error, fallback);
    }
  }

  /**
   * 3D Secure ödeme tamamla
   */
  async completeThreeDSPayment(callbackData: IyzicoThreeDSCallbackData): Promise<PaymentResponse> {
    // iyzico posts status=success and mdStatus=1 only when 3D authentication
    // succeeded. Anything else must not be authorized.
    if (
      !callbackData?.paymentId ||
      callbackData.status !== 'success' ||
      String(callbackData.mdStatus) !== '1'
    ) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        paymentId: callbackData?.paymentId,
        conversationId: callbackData?.conversationId,
        errorCode:
          callbackData?.mdStatus !== undefined
            ? `MD_STATUS_${callbackData.mdStatus}`
            : 'INVALID_CALLBACK',
        errorMessage: '3D Secure authentication failed',
        rawResponse: callbackData,
      });
    }

    try {
      // Callback'ten gelen token ve conversationId ile ödemeyi tamamla
      const response = await this.sendRequest<IyzicoPaymentResponse>('/payment/3dsecure/auth', {
        locale: this.config.locale || 'tr',
        conversationId: callbackData.conversationId,
        paymentId: callbackData.paymentId,
        conversationData: callbackData.conversationData,
      });

      return this.withErrorCode({
        status: this.mapStatus(response.status),
        paymentId: response.paymentId,
        conversationId: response.conversationId,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        errorGroup: response.errorGroup,
        ...Iyzico.savedCardOf(response),
        rawResponse: response,
      });
    } catch (error) {
      return this.failure(error, '3DS completion failed');
    }
  }

  /**
   * Refund. With `paymentId` alone, refunds an amount of the whole payment
   * (`/v2/payment/refund`). With `paymentTransactionId`, refunds that basket
   * item (`/payment/refund`).
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const common = {
        locale: this.config.locale || 'tr',
        conversationId: request.conversationId,
        price: request.price,
        currency: request.currency,
        ip: request.ip,
      };
      const response = request.paymentTransactionId
        ? await this.sendRequest<IyzicoRefundResponse>('/payment/refund', {
            ...common,
            paymentTransactionId: request.paymentTransactionId,
          })
        : await this.sendRequest<IyzicoRefundResponse>('/v2/payment/refund', {
            ...common,
            paymentId: request.paymentId,
          });

      return this.withErrorCode({
        status: this.mapStatus(response.status),
        refundId: response.paymentTransactionId ?? response.paymentId,
        conversationId: response.conversationId,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        rawResponse: response,
      });
    } catch (error) {
      return this.failure(error, 'Refund failed');
    }
  }

  /**
   * İptal işlemi
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const response = await this.sendRequest<IyzicoCancelResponse>('/payment/cancel', {
        locale: this.config.locale || 'tr',
        conversationId: request.conversationId,
        paymentId: request.paymentId,
        ip: request.ip,
      });

      return this.withErrorCode({
        status: this.mapStatus(response.status),
        conversationId: response.conversationId,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        rawResponse: response,
      });
    } catch (error) {
      return this.failure(error, 'Cancel failed');
    }
  }
  /**
   * Capture of a pre-authorization (`/payment/postauth`). `amount` becomes the
   * charged `paidPrice`; a lower amount is a partial capture.
   */
  async capture(request: CaptureRequest): Promise<PaymentResponse> {
    try {
      this.validateCapture(request);
      const response = await this.sendRequest<IyzicoPaymentResponse>('/payment/postauth', {
        locale: this.config.locale || 'tr',
        conversationId: request.conversationId,
        paymentId: request.paymentId,
        ip: request.ip,
        paidPrice: request.amount,
        currency: request.currency || 'TRY',
      });

      return this.withErrorCode({
        status: this.mapStatus(response.status),
        paymentId: response.paymentId ?? request.paymentId,
        conversationId: response.conversationId,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        errorGroup: response.errorGroup,
        rawResponse: response,
      });
    } catch (error) {
      return this.failure(error, 'Capture failed');
    }
  }

  /** Releases a pre-authorization: iyzico voids it with `/payment/cancel` */
  async voidAuthorization(request: VoidAuthorizationRequest): Promise<CancelResponse> {
    return this.cancel(request);
  }

  /**
   * Ödeme sorgulama
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const response = await this.sendRequest<IyzicoPaymentResponse>(
        '/payment/detail',
        {
          locale: this.config.locale || 'tr',
          paymentId: paymentId,
        },
        { retryable: true }
      );

      return this.withErrorCode({
        status: this.mapStatus(response.status),
        paymentId: response.paymentId,
        conversationId: response.conversationId,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        errorGroup: response.errorGroup,
        rawResponse: response,
      });
    } catch (error) {
      return this.failure(error, 'Get payment failed');
    }
  }

  /**
   * Checkout Form başlat
   */
  async initCheckoutForm(request: CheckoutFormRequest): Promise<CheckoutFormInitResponse> {
    try {
      this.validatePayment(request as PaymentRequest, IYZICO_ORDER_RULES);
      const iyzicoRequest = this.mapToIyzicoCheckoutFormRequest(request);

      const response = await this.sendRequest<IyzicoCheckoutFormInitResponse>(
        '/payment/iyzipos/checkoutform/initialize/auth/ecom',
        iyzicoRequest
      );

      return this.withErrorCode({
        status: this.mapStatus(response.status),
        checkoutFormContent: response.checkoutFormContent,
        paymentPageUrl: response.paymentPageUrl,
        token: response.token,
        tokenExpireTime: response.tokenExpireTime,
        conversationId: response.conversationId,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        rawResponse: response,
      });
    } catch (error) {
      return this.failure(error, 'Checkout form initialization failed');
    }
  }

  /**
   * Checkout Form sonucunu sorgula
   */
  async retrieveCheckoutForm(
    token: string,
    conversationId?: string
  ): Promise<CheckoutFormRetrieveResponse> {
    try {
      const response = await this.sendRequest<IyzicoCheckoutFormRetrieveResponse>(
        '/payment/iyzipos/checkoutform/auth/ecom/detail',
        {
          locale: this.config.locale || 'tr',
          conversationId: conversationId,
          token: token,
        }
      );

      return this.withErrorCode({
        // status reflects the payment itself, not just the API call
        status: mapIyzicoPaymentStatus(response.status, response.paymentStatus),
        paymentId: response.paymentId,
        paymentStatus: response.paymentStatus,
        price: response.price,
        paidPrice: response.paidPrice,
        currency: response.currency,
        basketId: response.basketId,
        installment: response.installment,
        binNumber: response.binNumber,
        lastFourDigits: response.lastFourDigits,
        cardType: response.cardType,
        cardAssociation: response.cardAssociation,
        cardFamily: response.cardFamily,
        cardToken: response.cardToken,
        cardUserKey: response.cardUserKey,
        fraudStatus: response.fraudStatus,
        merchantCommissionRate: response.merchantCommissionRate,
        merchantCommissionRateAmount: response.merchantCommissionRateAmount,
        iyziCommissionRateAmount: response.iyziCommissionRateAmount,
        iyziCommissionFee: response.iyziCommissionFee,
        paymentTransactionId: response.paymentTransactionId,
        conversationId: response.conversationId,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        rawResponse: response,
      });
    } catch (error) {
      return this.failure(error, 'Retrieve checkout form failed');
    }
  }

  /**
   * ===================
   * SUBSCRIPTION METHODS
   * ===================
   */

  /**
   * Subscription API responses keep iyzico's shape; only `status` is mapped
   * to the unified PaymentStatus and the raw response is attached.
   */
  private mapSubscriptionResponse<T>(response: IyzicoSubscriptionResponse): T {
    return this.withErrorCode({
      ...response,
      status: this.mapStatus(response.status),
      rawResponse: response,
    }) as T;
  }

  async initializeSubscription(
    request: SubscriptionInitializeRequest
  ): Promise<SubscriptionInitializeResponse> {
    try {
      const iyzicoRequest = {
        locale: request.locale || this.config.locale || 'tr',
        conversationId: request.conversationId,
        pricingPlanReferenceCode: request.pricingPlanReferenceCode,
        subscriptionInitialStatus: request.subscriptionInitialStatus,
        customer: {
          name: request.customer.name,
          surname: request.customer.surname,
          email: request.customer.email,
          gsmNumber: request.customer.gsmNumber,
          identityNumber: request.customer.identityNumber,
          billingAddress: {
            contactName: request.customer.billingAddress.contactName,
            city: request.customer.billingAddress.city,
            country: request.customer.billingAddress.country,
            address: request.customer.billingAddress.address,
            zipCode: request.customer.billingAddress.zipCode,
          },
          shippingAddress: request.customer.shippingAddress
            ? {
                contactName: request.customer.shippingAddress.contactName,
                city: request.customer.shippingAddress.city,
                country: request.customer.shippingAddress.country,
                address: request.customer.shippingAddress.address,
                zipCode: request.customer.shippingAddress.zipCode,
              }
            : undefined,
        },
        paymentCard: {
          cardHolderName: request.paymentCard.cardHolderName,
          cardNumber: request.paymentCard.cardNumber,
          expireMonth: request.paymentCard.expireMonth,
          expireYear: request.paymentCard.expireYear,
          cvc: request.paymentCard.cvc,
        },
      };

      const response = await this.sendRequest<IyzicoSubscriptionResponse>(
        '/v2/subscription/initialize',
        iyzicoRequest
      );

      return this.mapSubscriptionResponse(response);
    } catch (error) {
      return this.failure(error, 'Subscription initialization failed');
    }
  }

  async cancelSubscription(
    request: SubscriptionCancelRequest
  ): Promise<SubscriptionCancelResponse> {
    try {
      const response = await this.sendRequest<IyzicoSubscriptionResponse>(
        `/v2/subscription/subscriptions/${encodeURIComponent(request.subscriptionReferenceCode)}/cancel`,
        {}
      );

      return this.mapSubscriptionResponse(response);
    } catch (error) {
      return this.failure(error, 'Subscription cancellation failed');
    }
  }

  async upgradeSubscription(
    request: SubscriptionUpgradeRequest
  ): Promise<SubscriptionUpgradeResponse> {
    try {
      const iyzicoRequest = {
        newPricingPlanReferenceCode: request.newPricingPlanReferenceCode,
        useTrial: request.useTrial,
        resetRecurrenceCount: request.resetRecurrenceCount,
      };

      const response = await this.sendRequest<IyzicoSubscriptionResponse>(
        `/v2/subscription/subscriptions/${encodeURIComponent(request.subscriptionReferenceCode)}/upgrade`,
        iyzicoRequest
      );

      return this.mapSubscriptionResponse(response);
    } catch (error) {
      return this.failure(error, 'Subscription upgrade failed');
    }
  }

  async retrieveSubscription(
    request: SubscriptionRetrieveRequest
  ): Promise<SubscriptionRetrieveResponse> {
    try {
      const response = await this.sendRequest<IyzicoSubscriptionResponse>(
        `/v2/subscription/subscriptions/${encodeURIComponent(request.subscriptionReferenceCode)}`,
        {},
        { method: 'GET', retryable: true }
      );

      return this.mapSubscriptionResponse(response);
    } catch (error) {
      return this.failure(error, 'Subscription retrieve failed');
    }
  }

  async updateSubscriptionCard(
    request: SubscriptionCardUpdateRequest
  ): Promise<SubscriptionCardUpdateResponse> {
    try {
      const iyzicoRequest = {
        locale: request.locale || this.config.locale || 'tr',
        conversationId: request.conversationId,
        subscriptionReferenceCode: request.subscriptionReferenceCode,
        callbackUrl: request.callbackUrl,
      };

      const response = await this.sendRequest<IyzicoSubscriptionResponse>(
        '/v2/subscription/card-update/checkoutform/initialize',
        iyzicoRequest
      );

      return this.mapSubscriptionResponse(response);
    } catch (error) {
      return this.failure(error, 'Card update initialization failed');
    }
  }

  async createSubscriptionProduct(
    request: SubscriptionProductCreateRequest
  ): Promise<SubscriptionProductResponse> {
    try {
      const iyzicoRequest = {
        locale: request.locale || this.config.locale || 'tr',
        conversationId: request.conversationId,
        name: request.name,
        description: request.description,
      };

      const response = await this.sendRequest<IyzicoSubscriptionResponse>(
        '/v2/subscription/products',
        iyzicoRequest
      );

      return this.mapSubscriptionResponse(response);
    } catch (error) {
      return this.failure(error, 'Product creation failed');
    }
  }

  async createPricingPlan(request: PricingPlanCreateRequest): Promise<PricingPlanResponse> {
    try {
      const iyzicoRequest = {
        locale: request.locale || this.config.locale || 'tr',
        conversationId: request.conversationId,
        productReferenceCode: request.productReferenceCode,
        name: request.name,
        price: request.price,
        currency: request.currency || 'TRY',
        paymentInterval: request.paymentInterval,
        paymentIntervalCount: request.paymentIntervalCount,
        trialPeriodDays: request.trialPeriodDays,
        recurrenceCount: request.recurrenceCount,
      };

      const response = await this.sendRequest<IyzicoSubscriptionResponse>(
        `/v2/subscription/products/${encodeURIComponent(request.productReferenceCode)}/pricing-plans`,
        iyzicoRequest
      );

      return this.mapSubscriptionResponse(response);
    } catch (error) {
      return this.failure(error, 'Pricing plan creation failed');
    }
  }

  /**
   * ===================
   * CARD STORAGE
   * ===================
   */

  private static storedCardOf(details: Partial<IyzicoStoredCardDetails>): StoredCard {
    return {
      cardToken: details.cardToken ?? '',
      alias: details.cardAlias,
      binNumber: details.binNumber,
      lastFourDigits: details.lastFourDigits,
      cardType: details.cardType,
      cardAssociation: details.cardAssociation,
      cardFamily: details.cardFamily,
      bankName: details.cardBankName,
    };
  }

  /**
   * Saves a card without charging it (`/cardstorage/card`). Omit
   * `customerToken` to create a new customer (cardUserKey).
   */
  async saveCard(request: SaveCardRequest): Promise<SaveCardResponse> {
    try {
      const response = await this.sendRequest<IyzicoCardResponse>('/cardstorage/card', {
        locale: this.config.locale || 'tr',
        conversationId: request.conversationId,
        externalId: request.externalId,
        email: request.email,
        cardUserKey: request.customerToken,
        card: {
          cardAlias: request.alias,
          cardHolderName: request.card.cardHolderName,
          cardNumber: request.card.cardNumber,
          expireMonth: request.card.expireMonth,
          expireYear: request.card.expireYear,
        },
      });
      const status = this.mapStatus(response.status);

      return this.withErrorCode({
        status,
        customerToken: response.cardUserKey,
        card: status === PaymentStatus.SUCCESS ? Iyzico.storedCardOf(response) : undefined,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<SaveCardResponse>(error, 'Saving the card failed');
    }
  }

  /** A customer's saved cards (`/cardstorage/cards`) */
  async listCards(request: {
    customerToken: string;
    conversationId?: string;
  }): Promise<ListCardsResponse> {
    try {
      const response = await this.sendRequest<IyzicoCardListResponse>(
        '/cardstorage/cards',
        {
          locale: this.config.locale || 'tr',
          conversationId: request.conversationId,
          cardUserKey: request.customerToken,
        },
        { retryable: true }
      );

      return this.withErrorCode({
        status: this.mapStatus(response.status),
        customerToken: response.cardUserKey ?? request.customerToken,
        cards: (response.cardDetails ?? []).map((d) => Iyzico.storedCardOf(d)),
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<ListCardsResponse>(error, 'Listing cards failed', { cards: [] });
    }
  }

  /** Deletes a saved card (`DELETE /cardstorage/card`) */
  async deleteCard(request: DeleteCardRequest): Promise<DeleteCardResponse> {
    try {
      const response = await this.sendRequest<IyzicoResponse>(
        '/cardstorage/card',
        {
          locale: this.config.locale || 'tr',
          conversationId: request.conversationId,
          cardUserKey: request.customerToken,
          cardToken: request.cardToken,
        },
        { method: 'DELETE' }
      );

      return this.withErrorCode({
        status: this.mapStatus(response.status),
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<DeleteCardResponse>(error, 'Deleting the card failed');
    }
  }

  /**
   * BIN sorgulama
   */
  async binCheck(binNumber: string): Promise<BinCheckResponse> {
    const request: IyzicoBinCheckRequest = {
      locale: this.config.locale,
      conversationId: randomHex(8),
      binNumber: binNumber,
    };

    const response = await this.sendRequest<IyzicoBinCheckResponse>('/payment/bin/check', request, {
      retryable: true,
    });

    if (response.status !== 'success') {
      throw new Error(response.errorMessage || 'BIN check failed');
    }

    return {
      binNumber: response.binNumber || binNumber,
      cardType: response.cardType || '',
      cardAssociation: response.cardAssociation || '',
      cardFamily: response.cardFamily || '',
      bankName: response.bankName || '',
      bankCode: response.bankCode || 0,
      commercial: response.commercial === 1,
      rawResponse: response,
    };
  }

  /**
   * ===================
   * PWI (Payment With IBAN - Korumalı Havale/EFT) METHODS
   * ===================
   */

  /**
   * PWI request'ini İyzico formatına çevir
   */
  private mapToPWIRequest(request: PWIPaymentRequest): IyzicoPWIPaymentRequest {
    return {
      locale: this.config.locale || 'tr',
      conversationId: request.conversationId,
      price: request.price,
      paidPrice: request.paidPrice,
      currency: request.currency,
      basketId: request.basketId,
      paymentGroup: 'PRODUCT',
      callbackUrl: request.callbackUrl,
      buyer: {
        id: request.buyer.id,
        name: request.buyer.name,
        surname: request.buyer.surname,
        gsmNumber: request.buyer.gsmNumber,
        email: request.buyer.email,
        identityNumber: request.buyer.identityNumber,
        registrationAddress: request.buyer.registrationAddress,
        ip: request.buyer.ip,
        city: request.buyer.city,
        country: request.buyer.country,
        zipCode: request.buyer.zipCode,
      },
      shippingAddress: {
        contactName: request.shippingAddress.contactName,
        city: request.shippingAddress.city,
        country: request.shippingAddress.country,
        address: request.shippingAddress.address,
        zipCode: request.shippingAddress.zipCode,
      },
      billingAddress: {
        contactName: request.billingAddress.contactName,
        city: request.billingAddress.city,
        country: request.billingAddress.country,
        address: request.billingAddress.address,
        zipCode: request.billingAddress.zipCode,
      },
      basketItems: request.basketItems.map((item) => ({
        id: item.id,
        name: item.name,
        category1: item.category1,
        category2: item.category2,
        itemType: item.itemType,
        price: item.price,
      })),
    };
  }

  /**
   * PWI Ödeme Başlat
   *
   * Korumalı havale/EFT ile ödeme başlatır. Kullanıcıya IBAN numarası ve ödeme bilgileri gösterilir.
   * Kullanıcı havale yaptıktan sonra, ödeme onaylandığında satıcıya aktarılır.
   *
   * @param request - PWI ödeme isteği parametreleri
   * @returns PWI ödeme başlatma yanıtı (HTML içeriği, token, ödeme sayfası URL'i)
   *
   * @example
   * ```typescript
   * const result = await iyzico.initPWIPayment({
   *   price: '100.00',
   *   paidPrice: '100.00',
   *   currency: Currency.TRY,
   *   basketId: 'B67832',
   *   callbackUrl: 'https://your-site.com/payment/callback',
   *   buyer: { ... },
   *   shippingAddress: { ... },
   *   billingAddress: { ... },
   *   basketItems: [ ... ]
   * });
   *
   * if (result.status === 'success') {
   *   // Option 1: HTML içeriğini göster
   *   document.body.innerHTML = result.htmlContent;
   *
   *   // Option 2: Ödeme sayfasına yönlendir
   *   window.location.href = result.paymentPageUrl;
   * }
   * ```
   */
  async initPWIPayment(request: PWIPaymentRequest): Promise<PWIPaymentInitResponse> {
    try {
      this.validatePayment(request as PaymentRequest, IYZICO_ORDER_RULES);
      const iyzicoRequest = this.mapToPWIRequest(request);

      const response = await this.sendRequest<IyzicoPWIPaymentInitResponse>(
        '/payment/iyzipos/item/initialize',
        iyzicoRequest
      );

      return this.withErrorCode({
        status: this.mapStatus(response.status),
        htmlContent: response.htmlContent,
        token: response.token,
        tokenExpireTime: response.tokenExpireTime,
        paymentPageUrl: response.paymentPageUrl,
        conversationId: response.conversationId,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        rawResponse: response,
      });
    } catch (error) {
      return this.failure(error, 'PWI payment initialization failed');
    }
  }

  /**
   * PWI Ödeme Sorgula
   *
   * Başlatılmış PWI ödemesinin durumunu sorgular.
   * Havale yapıldıysa ödeme bilgilerini, yapılmadıysa IBAN ve banka bilgilerini döndürür.
   *
   * @param token - PWI ödeme token'ı (initPWIPayment metodundan döner)
   * @param conversationId - Opsiyonel conversation ID
   * @returns PWI ödeme durumu ve detayları
   *
   * @example
   * ```typescript
   * const result = await iyzico.retrievePWIPayment(token);
   *
   * if (result.status === 'success') {
   *   if (result.paymentStatus === 'SUCCESS') {
   *     console.log('Ödeme başarılı:', result.paymentId);
   *   } else if (result.paymentStatus === 'WAITING') {
   *     console.log('Havale bekleniyor');
   *     console.log('IBAN:', result.iban);
   *     console.log('Banka:', result.bankName);
   *   }
   * }
   * ```
   */
  async retrievePWIPayment(
    token: string,
    conversationId?: string
  ): Promise<PWIPaymentRetrieveResponse> {
    try {
      const response = await this.sendRequest<IyzicoPWIPaymentRetrieveResponse>(
        '/payment/iyzipos/item/detail',
        {
          locale: this.config.locale || 'tr',
          conversationId: conversationId,
          token: token,
        }
      );

      return this.withErrorCode({
        // status reflects the transfer itself: WAITING -> pending, SUCCESS -> success
        status: mapIyzicoPaymentStatus(response.status, response.paymentStatus),
        token: response.token,
        callbackUrl: response.callbackUrl,
        paymentStatus: response.paymentStatus,
        paymentId: response.paymentId,
        price: response.price,
        paidPrice: response.paidPrice,
        currency: response.currency,
        basketId: response.basketId,
        merchantCommissionRate: response.merchantCommissionRate,
        merchantCommissionRateAmount: response.merchantCommissionRateAmount,
        iyziCommissionRateAmount: response.iyziCommissionRateAmount,
        iyziCommissionFee: response.iyziCommissionFee,
        iban: response.iban,
        bankName: response.bankName,
        buyerName: response.buyerName,
        buyerSurname: response.buyerSurname,
        buyerEmail: response.buyerEmail,
        conversationId: response.conversationId,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        rawResponse: response,
      });
    } catch (error) {
      return this.failure(error, 'PWI payment retrieve failed');
    }
  }

  /**
   * ===================
   * INSTALLMENT (Taksit) METHODS
   * ===================
   */

  /**
   * Taksit Sorgulama
   *
   * Belirli bir BIN numarası ve tutar için kullanılabilir taksit seçeneklerini sorgular.
   * Her banka için farklı taksit oranlarını ve toplam tutarları gösterir.
   *
   * @param request - Taksit sorgulama isteği (BIN numarası ve tutar)
   * @returns Taksit seçenekleri ve detayları
   *
   * @example
   * ```typescript
   * const result = await iyzico.installmentInfo({
   *   binNumber: '552879',
   *   price: '100.00'
   * });
   *
   * if (result.status === 'success' && result.installmentDetails) {
   *   result.installmentDetails.forEach(detail => {
   *     console.log(`Banka: ${detail.bankName}`);
   *     console.log(`Kart Ailesi: ${detail.cardFamilyName}`);
   *     detail.installmentPrices.forEach(installment => {
   *       console.log(`${installment.installmentNumber} taksit: ${installment.totalPrice} TL (Taksit başına: ${installment.installmentPrice} TL)`);
   *     });
   *   });
   * }
   * ```
   */
  async installmentInfo(request: InstallmentInfoRequest): Promise<InstallmentInfoResponse> {
    try {
      const iyzicoRequest: IyzicoInstallmentInfoRequest = {
        locale: this.config.locale || 'tr',
        conversationId: request.conversationId,
        binNumber: request.binNumber,
        price: request.price,
      };

      const response = await this.sendRequest<IyzicoInstallmentInfoResponse>(
        '/payment/iyzipos/installment',
        iyzicoRequest
      );

      return this.withErrorCode({
        status: this.mapStatus(response.status),
        installmentDetails: response.installmentDetails,
        conversationId: response.conversationId,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        rawResponse: response,
      });
    } catch (error) {
      return this.failure(error, 'Installment info request failed');
    }
  }
}

/**
 * The Iyzico provider, for `betterPayment({ providers: { iyzico: iyzico({ apiKey, secretKey }) } })`.
 * The base URL follows `mode` unless `baseUrl` is set.
 */
export const iyzico = (config: IyzicoConfig): ProviderDefinition<Iyzico> =>
  defineProvider((ctx) => new Iyzico(withProviderDefaults(ProviderType.IYZICO, config, ctx)));
