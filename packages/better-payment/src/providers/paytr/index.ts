import {
  defineProvider,
  withProviderDefaults,
  ProviderType,
  type ProviderDefinition,
} from '../../core/BetterPaymentConfig';
import type { HttpClient, HttpRequestConfig } from '../../core/http';
import { PaymentProvider } from '../../core/PaymentProvider';
import { ConfigurationError, ValidationError } from '../../core/errors';
import { failureResult, FailureResult } from '../../core/failure';
import type { PaymentValidationRules } from '../../core/validation';
import { PAYTR_ERROR_CODES } from './error-codes';
import type { PaymentErrorCode } from '../../core/error-codes';
import { generateOrderId, parseAmount } from '../../core/utils';
import { randomHex } from '../../core/crypto';
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
  BinCheckResponse,
  InstallmentInfoRequest,
  InstallmentInfoResponse,
  InstallmentPrice,
} from '../../types';
import {
  generatePayTRIframeToken,
  generatePayTRDirectToken,
  generatePayTRCardListToken,
  generatePayTRCardDeleteToken,
  generatePayTRRefundToken,
  generatePayTRStatusToken,
  generatePayTRBinToken,
  generatePayTRInstallmentRatesToken,
  verifyPayTRCallback,
  formatPayTRBasket,
  convertToKurus,
  formatPayTRAmount,
  mapPayTRCurrency,
  assertPayTRMerchantOid,
  createPayTRFormData,
  buildAutoSubmitForm,
  buildIframeHtml,
} from './utils';
import type {
  PayTRConfig,
  PayTRIframeResponse,
  PayTRCallbackData,
  PayTRRefundResponse,
  PayTRBasketItem,
  PayTRBinDetailResponse,
  PayTRTokenPaymentRequest,
  PayTRDirectPaymentResponse,
  PayTRStatusResponse,
  PayTRInstallmentRatesResponse,
} from './types';

const PAYTR_PREAUTH_NOTE =
  'PayTR pre-authorization is not implemented yet (https://github.com/czaydev/better-payment/issues/60)';

/** Fields PayTR requires for card and iFrame payments */
const PAYTR_ORDER_RULES: PaymentValidationRules = {
  basketRequired: true,
  required: ['buyer.email', 'buyer.ip', 'buyer.name', 'buyer.surname', 'buyer.gsmNumber'],
};

/**
 * PayTR ödeme sağlayıcısı
 *
 * - initThreeDSPayment(): iFrame API, or the Direct API with `threeDSMode: 'direct'`.
 *   The payment result is delivered to the notification (Bildirim) URL configured
 *   in the PayTR panel; pass that POST body to completeThreeDSPayment() and
 *   respond with plain text "OK".
 * - createPayment(): Direct API, non-3D, synchronous (requires the "Non-3D"
 *   permission on the PayTR account).
 */
export class PayTR extends PaymentProvider<PayTRConfig> {
  private client: HttpClient;

  constructor(config: PayTRConfig) {
    super(config);

    this.client = this.createHttpClient('paytr', {
      timeout: 30000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }

  protected validateConfig(): void {
    const missing = (['merchantId', 'merchantKey', 'merchantSalt'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(
        `PayTR configuration is missing: ${missing.join(', ')}`,
        'paytr'
      );
    }
    if (!this.config.baseUrl) {
      this.config.baseUrl = 'https://www.paytr.com';
    }
    if (this.config.threeDSMode && !['iframe', 'direct'].includes(this.config.threeDSMode)) {
      throw new ConfigurationError(
        `Unknown PayTR threeDSMode: ${this.config.threeDSMode}`,
        'paytr'
      );
    }
  }

  private get testMode(): string {
    return this.config.testMode ? '1' : '0';
  }

  private get lang(): string {
    return (this.config.locale || 'tr').toLowerCase().startsWith('en') ? 'en' : 'tr';
  }

  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return PAYTR_ERROR_CODES;
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('PayTR', error, fallback, extra));
  }

  private post<T>(path: string, data: Record<string, string>, retryable = false): Promise<T> {
    const config: HttpRequestConfig = { retryable };
    return this.client.post<T>(path, createPayTRFormData(data), config).then((res) => res.data);
  }

  private buildBasket(items: Array<{ name: string; price: string; quantity?: number }>): string {
    const basket: PayTRBasketItem[] = items.map((item) => ({
      name: item.name,
      price: formatPayTRAmount(item.price),
      quantity: item.quantity && item.quantity > 0 ? item.quantity : 1,
    }));
    return formatPayTRBasket(basket);
  }

  private resolveMerchantOid(conversationId?: string): string {
    const merchantOid = conversationId || generateOrderId();
    assertPayTRMerchantOid(merchantOid);
    return merchantOid;
  }

  /**
   * Non-3D direct payment (Direct API, sync_mode=1)
   *
   * Requires the PayTR account to be authorized for non-3D payments.
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    let merchantOid: string | undefined;
    try {
      this.validatePayment(request, {
        ...PAYTR_ORDER_RULES,
        card: true,
        storedCard: true,
        saveCard: true,
      });
      merchantOid = this.resolveMerchantOid(request.conversationId);
      const installmentCount =
        request.installment && request.installment > 1 ? String(request.installment) : '0';
      const paymentAmount = formatPayTRAmount(request.paidPrice ?? request.price);
      const currency = mapPayTRCurrency(request.currency);

      const params: Record<string, string> = {
        merchant_id: this.config.merchantId,
        user_ip: request.buyer.ip,
        merchant_oid: merchantOid,
        email: request.buyer.email,
        payment_amount: paymentAmount,
        payment_type: 'card',
        installment_count: installmentCount,
        currency,
        test_mode: this.testMode,
        non_3d: '1',
      };

      const body: Record<string, string> = {
        ...params,
        paytr_token: await generatePayTRDirectToken(
          {
            merchantId: params.merchant_id,
            userIp: params.user_ip,
            merchantOid,
            email: params.email,
            paymentAmount,
            paymentType: 'card',
            installmentCount,
            currency,
            testMode: params.test_mode,
            non3d: '1',
          },
          this.config.merchantSalt,
          this.config.merchantKey
        ),
        sync_mode: '1',
        debug_on: this.testMode,
        client_lang: this.lang,
        user_name: `${request.buyer.name} ${request.buyer.surname}`,
        user_address: request.billingAddress?.address || request.shippingAddress?.address || '',
        user_phone: request.buyer.gsmNumber,
        user_basket: this.buildBasket(request.basketItems),
        ...this.cardFields(request),
      };

      const data = await this.post<PayTRDirectPaymentResponse>('/odeme', body);
      const approved = data.status === 'success';

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: merchantOid,
        conversationId: merchantOid,
        errorCode: approved ? undefined : String(data.failed_reason_code ?? data.err_no ?? ''),
        errorMessage: approved
          ? undefined
          : String(data.failed_reason_msg ?? data.err_msg ?? data.msg ?? data.reason ?? ''),
        ...PayTR.savedCardOf(data),
        rawResponse: data,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Payment failed', {
        paymentId: merchantOid,
        conversationId: merchantOid,
      });
    }
  }

  /**
   * iFrame payment (3D Secure handled by PayTR)
   *
   * `callbackUrl` is where the customer's browser is redirected (merchant_ok_url /
   * merchant_fail_url). It does NOT carry the payment result: the result is sent
   * server-to-server to the notification URL configured in the PayTR panel.
   *
   * `installment`: undefined = customer can choose any installment, 1 = single
   * payment only, n > 1 = up to n installments.
   */
  async initThreeDSPayment(
    request: ThreeDSPaymentRequest & { failUrl?: string }
  ): Promise<ThreeDSInitResponse> {
    if (request.storedCard) {
      // Stored cards are charged through the Direct API (3D form), not the iFrame
      return this.initStoredCardPayment(request);
    }
    if (this.config.threeDSMode === 'direct') {
      return this.initDirectPayment(request);
    }
    let merchantOid: string | undefined;
    try {
      // iFrame flow: the card is entered on PayTR's page
      this.validatePayment(request, PAYTR_ORDER_RULES);
      merchantOid = this.resolveMerchantOid(request.conversationId);
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required');
      }

      const userBasket = this.buildBasket(request.basketItems);
      const paymentAmount = convertToKurus(request.paidPrice ?? request.price);
      const currency = mapPayTRCurrency(request.currency);
      const noInstallment = request.installment === 1 ? '1' : '0';
      const maxInstallment =
        request.installment && request.installment > 1 ? String(request.installment) : '0';

      const paytrToken = await generatePayTRIframeToken(
        {
          merchantId: this.config.merchantId,
          userIp: request.buyer.ip,
          merchantOid,
          email: request.buyer.email,
          paymentAmount,
          userBasket,
          noInstallment,
          maxInstallment,
          currency,
          testMode: this.testMode,
        },
        this.config.merchantSalt,
        this.config.merchantKey
      );

      const body: Record<string, string> = {
        merchant_id: this.config.merchantId,
        user_ip: request.buyer.ip,
        merchant_oid: merchantOid,
        email: request.buyer.email,
        payment_amount: paymentAmount,
        paytr_token: paytrToken,
        user_basket: userBasket,
        debug_on: this.testMode,
        no_installment: noInstallment,
        max_installment: maxInstallment,
        user_name: `${request.buyer.name} ${request.buyer.surname}`,
        user_address: request.billingAddress?.address || request.shippingAddress?.address || '',
        user_phone: request.buyer.gsmNumber,
        merchant_ok_url: request.callbackUrl,
        merchant_fail_url: request.failUrl || request.callbackUrl,
        timeout_limit: String(this.config.timeoutLimit ?? 30),
        currency,
        test_mode: this.testMode,
        lang: this.lang,
      };

      const data = await this.post<PayTRIframeResponse>('/odeme/api/get-token', body);

      if (data.status === 'success' && data.token) {
        const iframeUrl = `${this.config.baseUrl!.replace(/\/$/, '')}/odeme/guvenli/${data.token}`;
        return this.withErrorCode({
          status: PaymentStatus.PENDING,
          threeDSHtmlContent: buildIframeHtml(iframeUrl),
          redirectUrl: iframeUrl,
          paymentId: merchantOid,
          conversationId: merchantOid,
          rawResponse: data,
        });
      }

      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        paymentId: merchantOid,
        conversationId: merchantOid,
        errorMessage: data.reason || 'Payment initialization failed',
        rawResponse: data,
      });
    } catch (error) {
      return this.failure<ThreeDSInitResponse>(error, '3DS initialization failed', {
        paymentId: merchantOid,
        conversationId: merchantOid,
      });
    }
  }

  /**
   * Verifies and maps the notification (Bildirim URL) POST.
   *
   * After processing, the endpoint MUST respond with plain text "OK"; otherwise
   * PayTR keeps re-sending the notification. The built-in handler does this.
   * PayTR may send the same notification more than once: make order updates idempotent.
   */
  async completeThreeDSPayment(callbackData: PayTRCallbackData): Promise<PaymentResponse> {
    if (
      !(await verifyPayTRCallback(
        callbackData ?? ({} as PayTRCallbackData),
        this.config.merchantSalt,
        this.config.merchantKey
      ))
    ) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        paymentId: callbackData?.merchant_oid,
        conversationId: callbackData?.merchant_oid,
        errorCode: 'INVALID_HASH',
        errorMessage: 'Invalid callback signature',
        rawResponse: callbackData,
      });
    }

    const approved = callbackData.status === 'success';

    return this.withErrorCode({
      status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
      paymentId: callbackData.merchant_oid,
      conversationId: callbackData.merchant_oid,
      errorCode: approved ? undefined : callbackData.failed_reason_code,
      errorMessage: approved ? undefined : callbackData.failed_reason_msg,
      ...(approved ? PayTR.savedCardOf(callbackData) : {}),
      rawResponse: callbackData,
    });
  }

  /**
   * Refund (full or partial). `paymentId` is the merchant_oid; `price` is in TL.
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const returnAmount = formatPayTRAmount(request.price);

      const body: Record<string, string> = {
        merchant_id: this.config.merchantId,
        merchant_oid: request.paymentId,
        return_amount: returnAmount,
        paytr_token: await generatePayTRRefundToken(
          this.config.merchantId,
          request.paymentId,
          returnAmount,
          this.config.merchantSalt,
          this.config.merchantKey
        ),
      };

      const data = await this.post<PayTRRefundResponse>('/odeme/iade', body);

      if (data.status === 'success') {
        return this.withErrorCode({
          status: PaymentStatus.SUCCESS,
          refundId: data.reference_no || data.merchant_oid,
          conversationId: request.conversationId,
          rawResponse: data,
        });
      }

      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        conversationId: request.conversationId,
        errorCode: data.err_no,
        errorMessage: data.err_msg,
        rawResponse: data,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * PayTR has no void endpoint; a cancel is a full refund.
   * When `price` is not given, the paid amount is read with a status query.
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      let amount = request.price;
      if (!amount) {
        const status = await this.queryStatus(request.paymentId);
        if (status.status !== 'success' || !status.payment_amount) {
          return this.withErrorCode({
            status: PaymentStatus.FAILURE,
            conversationId: request.conversationId,
            errorMessage:
              status.err_msg || 'Could not determine payment amount for cancellation; pass price',
            rawResponse: status,
          });
        }
        amount = String(status.payment_amount).replace(',', '.');
      }

      const refund = await this.refund({
        paymentId: request.paymentId,
        price: amount,
        currency: request.currency || 'TRY',
        ip: request.ip,
        conversationId: request.conversationId,
      });

      return this.withErrorCode({
        status: refund.status,
        transactionId: refund.refundId,
        conversationId: refund.conversationId,
        errorCode: refund.errorCode,
        errorMessage: refund.errorMessage,
        rawResponse: refund.rawResponse,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Direct API card fields: the card, or a stored card (utoken + ctoken). With
   * `saveCard`, PayTR stores the card (store_card=1); the customer's utoken
   * comes back in the notification (and in the sync response when present).
   */
  private cardFields(request: PaymentRequest): Record<string, string> {
    if (request.storedCard) {
      return {
        utoken: request.storedCard.customerToken,
        ctoken: request.storedCard.cardToken,
        require_cvv: request.storedCard.cvc ? '1' : '0',
        ...(request.storedCard.cvc ? { cvv: request.storedCard.cvc } : {}),
      };
    }
    const card = this.cardOf(request);
    const fields: Record<string, string> = {
      cc_owner: card.cardHolderName,
      card_number: card.cardNumber,
      expiry_month: card.expireMonth.padStart(2, '0'),
      expiry_year: card.expireYear.slice(-2),
      cvv: card.cvc,
    };
    if (request.saveCard) {
      fields.store_card = '1';
      const customerToken =
        typeof request.saveCard === 'object' ? request.saveCard.customerToken : undefined;
      if (customerToken) fields.utoken = customerToken;
    }
    return fields;
  }

  /**
   * PayTR saves cards only during a Direct API payment: pass `saveCard` to
   * createPayment(), then read the utoken from the result or the notification.
   */
  async saveCard(_request: SaveCardRequest): Promise<SaveCardResponse> {
    throw this.notSupported(
      'Saving a card without a payment',
      'PayTR stores cards during a Direct API payment; pass `saveCard: true` to createPayment()'
    );
  }

  /** A customer's saved cards (Kart Saklama, `/odeme/capi/list`) */
  async listCards(request: { customerToken: string }): Promise<ListCardsResponse> {
    try {
      const data = await this.post<unknown>(
        '/odeme/capi/list',
        {
          merchant_id: this.config.merchantId,
          utoken: request.customerToken,
          paytr_token: await generatePayTRCardListToken(
            request.customerToken,
            this.config.merchantSalt,
            this.config.merchantKey
          ),
        },
        true
      );

      if (!Array.isArray(data)) {
        const error = (data ?? {}) as { err_no?: unknown; err_msg?: unknown; reason?: unknown };
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          customerToken: request.customerToken,
          cards: [],
          errorCode: error.err_no !== undefined ? String(error.err_no) : undefined,
          errorMessage: String(error.err_msg ?? error.reason ?? 'Could not list stored cards'),
          rawResponse: data,
        });
      }

      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        customerToken: request.customerToken,
        cards: data.map((raw) => PayTR.storedCardOf(raw as Record<string, unknown>)),
        rawResponse: data,
      });
    } catch (error) {
      return this.failure<ListCardsResponse>(error, 'Listing cards failed', { cards: [] });
    }
  }

  /** Deletes a saved card (`/odeme/capi/delete`) */
  async deleteCard(request: DeleteCardRequest): Promise<DeleteCardResponse> {
    try {
      const data = await this.post<{ status?: string; err_msg?: string; err_no?: unknown }>(
        '/odeme/capi/delete',
        {
          merchant_id: this.config.merchantId,
          ctoken: request.cardToken,
          utoken: request.customerToken,
          paytr_token: await generatePayTRCardDeleteToken(
            request.cardToken,
            request.customerToken,
            this.config.merchantSalt,
            this.config.merchantKey
          ),
        }
      );
      const ok = data?.status === 'success';

      return this.withErrorCode({
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        errorCode: ok || data?.err_no === undefined ? undefined : String(data.err_no),
        errorMessage: ok ? undefined : String(data?.err_msg ?? 'Could not delete the card'),
        rawResponse: data,
      });
    } catch (error) {
      return this.failure<DeleteCardResponse>(error, 'Deleting the card failed');
    }
  }

  /** The customer's utoken, when PayTR returns one after storing a card */
  private static savedCardOf(data: unknown): { storedCard?: SavedCardTokens } {
    const utoken = (data as { utoken?: unknown } | undefined)?.utoken;
    return typeof utoken === 'string' && utoken ? { storedCard: { customerToken: utoken } } : {};
  }

  private static storedCardOf(raw: Record<string, unknown>): StoredCard {
    const str = (key: string) =>
      raw[key] === undefined || raw[key] === null ? undefined : String(raw[key]);
    return {
      cardToken: str('ctoken') ?? '',
      lastFourDigits: str('last_4'),
      expireMonth: str('month'),
      expireYear: str('year'),
      bankName: str('c_bank'),
      cardFamily: str('c_brand'),
      cardType: str('c_type'),
      cardAssociation: str('schema'),
      requiresCvc: str('require_cvv') === '1',
    };
  }

  /**
   * 3D payment with a new card through the Direct API: an auto-submitting form
   * that the customer's browser posts to PayTR (the card never goes through
   * PayTR's iFrame page). PayTR then runs 3D Secure, redirects to callbackUrl /
   * failUrl, and sends the result to the notification URL.
   */
  private async initDirectPayment(
    request: ThreeDSPaymentRequest & { failUrl?: string }
  ): Promise<ThreeDSInitResponse> {
    let merchantOid: string | undefined;
    try {
      this.validatePayment(request, { ...PAYTR_ORDER_RULES, card: true, saveCard: true });
      merchantOid = this.resolveMerchantOid(request.conversationId);
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required');
      }
      const installmentCount =
        request.installment && request.installment > 1 ? String(request.installment) : '0';
      const paymentAmount = formatPayTRAmount(request.paidPrice ?? request.price);
      const currency = mapPayTRCurrency(request.currency);

      const fields: Record<string, string> = {
        merchant_id: this.config.merchantId,
        user_ip: request.buyer.ip,
        merchant_oid: merchantOid,
        email: request.buyer.email,
        payment_amount: paymentAmount,
        payment_type: 'card',
        installment_count: installmentCount,
        currency,
        test_mode: this.testMode,
        non_3d: '0',
      };
      fields.paytr_token = await generatePayTRDirectToken(
        {
          merchantId: fields.merchant_id,
          userIp: fields.user_ip,
          merchantOid,
          email: fields.email,
          paymentAmount,
          paymentType: 'card',
          installmentCount,
          currency,
          testMode: fields.test_mode,
          non3d: '0',
        },
        this.config.merchantSalt,
        this.config.merchantKey
      );
      Object.assign(fields, {
        client_lang: this.lang,
        debug_on: this.testMode,
        user_name: `${request.buyer.name} ${request.buyer.surname}`,
        user_address: request.billingAddress?.address || request.shippingAddress?.address || '',
        user_phone: request.buyer.gsmNumber,
        user_basket: this.buildBasket(request.basketItems),
        merchant_ok_url: request.callbackUrl,
        merchant_fail_url: request.failUrl || request.callbackUrl,
        ...this.cardFields(request),
      });

      const action = `${this.config.baseUrl!.replace(/\/$/, '')}/odeme`;
      return this.withErrorCode({
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: buildAutoSubmitForm(action, fields),
        paymentId: merchantOid,
        conversationId: merchantOid,
      });
    } catch (error) {
      return this.failure<ThreeDSInitResponse>(error, '3DS initialization failed', {
        paymentId: merchantOid,
        conversationId: merchantOid,
      });
    }
  }

  /** 3D payment with a stored card, via the Direct API form (createPaymentWithToken) */
  private async initStoredCardPayment(
    request: ThreeDSPaymentRequest & { failUrl?: string }
  ): Promise<ThreeDSInitResponse> {
    try {
      this.validatePayment(request, { ...PAYTR_ORDER_RULES, storedCard: true });
    } catch (error) {
      return this.failure<ThreeDSInitResponse>(error, '3DS initialization failed');
    }
    const stored = request.storedCard!;
    return this.createPaymentWithToken({
      utoken: stored.customerToken,
      ctoken: stored.cardToken,
      cvv: stored.cvc,
      price: request.paidPrice ?? request.price,
      callbackUrl: request.callbackUrl,
      failUrl: request.failUrl,
      conversationId: request.conversationId,
      buyer: {
        email: request.buyer.email ?? '',
        name: request.buyer.name,
        surname: request.buyer.surname,
        ip: request.buyer.ip ?? '',
        gsmNumber: request.buyer.gsmNumber ?? '',
        address: request.billingAddress?.address || request.shippingAddress?.address,
      },
      basketItems: request.basketItems,
      currency: request.currency,
      installment: request.installment,
    });
  }

  /**
   * Payment with a stored card (utoken + ctoken)
   *
   * Returns an auto-submitting HTML form that posts to the PayTR Direct API from
   * the customer's browser (3D Secure). The result is delivered to the
   * notification URL like any other payment.
   */
  async createPaymentWithToken(request: PayTRTokenPaymentRequest): Promise<ThreeDSInitResponse> {
    let merchantOid: string | undefined;
    try {
      merchantOid = this.resolveMerchantOid(request.conversationId);
      const paymentAmount = formatPayTRAmount(request.price);
      const currency = mapPayTRCurrency(request.currency);
      const installmentCount =
        request.installment && request.installment > 1 ? String(request.installment) : '0';

      const fields: Record<string, string> = {
        merchant_id: this.config.merchantId,
        user_ip: request.buyer.ip,
        merchant_oid: merchantOid,
        email: request.buyer.email,
        payment_amount: paymentAmount,
        payment_type: 'card',
        installment_count: installmentCount,
        currency,
        test_mode: this.testMode,
        non_3d: '0',
      };

      fields.paytr_token = await generatePayTRDirectToken(
        {
          merchantId: fields.merchant_id,
          userIp: fields.user_ip,
          merchantOid,
          email: fields.email,
          paymentAmount,
          paymentType: 'card',
          installmentCount,
          currency,
          testMode: fields.test_mode,
          non3d: '0',
        },
        this.config.merchantSalt,
        this.config.merchantKey
      );

      Object.assign(fields, {
        utoken: request.utoken,
        ctoken: request.ctoken,
        require_cvv: request.cvv ? '1' : '0',
        ...(request.cvv ? { cvv: request.cvv } : {}),
        client_lang: this.lang,
        debug_on: this.testMode,
        user_name: `${request.buyer.name} ${request.buyer.surname}`,
        user_address: request.buyer.address || '',
        user_phone: request.buyer.gsmNumber,
        user_basket: this.buildBasket(request.basketItems),
        merchant_ok_url: request.callbackUrl,
        merchant_fail_url: request.failUrl || request.callbackUrl,
      });

      const action = `${this.config.baseUrl!.replace(/\/$/, '')}/odeme`;

      return this.withErrorCode({
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: buildAutoSubmitForm(action, fields),
        paymentId: merchantOid,
        conversationId: merchantOid,
      });
    } catch (error) {
      return this.failure<ThreeDSInitResponse>(error, 'Token payment failed', {
        paymentId: merchantOid,
        conversationId: merchantOid,
      });
    }
  }

  private async queryStatus(merchantOid: string): Promise<PayTRStatusResponse> {
    return this.post<PayTRStatusResponse>(
      '/odeme/durum-sorgu',
      {
        merchant_id: this.config.merchantId,
        merchant_oid: merchantOid,
        paytr_token: await generatePayTRStatusToken(
          this.config.merchantId,
          merchantOid,
          this.config.merchantSalt,
          this.config.merchantKey
        ),
      },
      true
    );
  }

  /**
   * Payment status query (/odeme/durum-sorgu). `paymentId` is the merchant_oid.
   */
  /**
   * Pre-authorization is not implemented for PayTR yet (see
   * https://github.com/czaydev/better-payment/issues/60).
   */
  async authorize(_request: PaymentRequest): Promise<PaymentResponse> {
    throw this.notSupported('Pre-authorization', PAYTR_PREAUTH_NOTE);
  }

  async initThreeDSAuthorize(_request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    throw this.notSupported('Pre-authorization', PAYTR_PREAUTH_NOTE);
  }

  async capture(_request: CaptureRequest): Promise<PaymentResponse> {
    throw this.notSupported('Capture', PAYTR_PREAUTH_NOTE);
  }

  async voidAuthorization(_request: VoidAuthorizationRequest): Promise<CancelResponse> {
    throw this.notSupported('Voiding a pre-authorization', PAYTR_PREAUTH_NOTE);
  }

  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const data = await this.queryStatus(paymentId);

      if (data.status !== 'success') {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          paymentId,
          conversationId: paymentId,
          errorCode: data.err_no,
          errorMessage: data.err_msg,
          rawResponse: data,
        });
      }

      // Status query amounts are in TL and may use a decimal comma ("1,16")
      const toNumber = (v: unknown) => Number(String(v ?? 0).replace(',', '.')) || 0;
      const paid = toNumber(data.payment_amount ?? data.payment_total);
      const refunded = (data.returns ?? []).reduce(
        (sum, r) => sum + toNumber(r.return_amount ?? r.refund_amount),
        0
      );
      const fullyRefunded = paid > 0 && refunded >= paid;

      return this.withErrorCode({
        status: fullyRefunded ? PaymentStatus.CANCELLED : PaymentStatus.SUCCESS,
        paymentId,
        conversationId: paymentId,
        rawResponse: data,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Get payment failed', {
        paymentId,
        conversationId: paymentId,
      });
    }
  }

  /**
   * BIN query (/odeme/api/bin-detail)
   */
  async binCheck(binNumber: string): Promise<BinCheckResponse> {
    const data = await this.post<PayTRBinDetailResponse>(
      '/odeme/api/bin-detail',
      {
        merchant_id: this.config.merchantId,
        bin_number: binNumber,
        paytr_token: await generatePayTRBinToken(
          binNumber,
          this.config.merchantId,
          this.config.merchantSalt,
          this.config.merchantKey
        ),
      },
      true
    );

    if (data.status !== 'success') {
      throw new Error(data.err_msg || `BIN check failed (${data.status})`);
    }

    return {
      binNumber,
      cardType: data.cardType || '',
      cardAssociation: data.schema || '',
      cardFamily: data.brand || '',
      bankName: data.bank || '',
      bankCode: Number(data.bankCode) || 0,
      commercial: data.businessCard === 'y' || data.businessCard === '1',
      rawResponse: data,
    };
  }

  /**
   * Installment options for a card, computed from the commission rates defined
   * on the PayTR account (/odeme/taksit-oranlari) and the card family (BIN query).
   */
  async installmentInfo(request: InstallmentInfoRequest): Promise<InstallmentInfoResponse> {
    try {
      const price = parseAmount(request.price, 'price');
      const bin = await this.binCheck(request.binNumber);

      const requestId = randomHex(8);
      const rates = await this.post<PayTRInstallmentRatesResponse>(
        '/odeme/taksit-oranlari',
        {
          merchant_id: this.config.merchantId,
          request_id: requestId,
          paytr_token: await generatePayTRInstallmentRatesToken(
            this.config.merchantId,
            requestId,
            this.config.merchantSalt,
            this.config.merchantKey
          ),
        },
        true
      );

      if (rates.status !== 'success') {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          errorMessage: rates.err_msg || 'Installment rates query failed',
          rawResponse: rates,
        });
      }

      const family = (bin.cardFamily || '').toLowerCase();
      const familyRates = (rates.oranlar ?? {})[family] ?? {};
      const round = (n: number) => Math.round(n * 100) / 100;

      const installmentPrices = [
        { installmentNumber: 1, totalPrice: round(price), installmentPrice: round(price) },
      ];
      for (const [key, rate] of Object.entries(familyRates)) {
        const count = parseInt(key.replace('taksit_', ''), 10);
        const percent = Number(rate);
        if (!Number.isFinite(count) || count < 2 || !Number.isFinite(percent) || percent < 0)
          continue;
        const total = price * (1 + percent / 100);
        installmentPrices.push({
          installmentNumber: count,
          totalPrice: round(total),
          installmentPrice: round(total / count),
        });
      }
      installmentPrices.sort((a, b) => a.installmentNumber - b.installmentNumber);

      const detail: InstallmentPrice = {
        binNumber: request.binNumber,
        price,
        cardType: bin.cardType,
        cardAssociation: bin.cardAssociation,
        cardFamilyName: bin.cardFamily,
        bankCode: bin.bankCode,
        bankName: bin.bankName,
        commercial: bin.commercial ? 1 : 0,
        installmentPrices,
      };

      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        installmentDetails: [detail],
        conversationId: request.conversationId,
        rawResponse: { bin: bin.rawResponse, rates },
      });
    } catch (error) {
      return this.failure<InstallmentInfoResponse>(error, 'Installment info failed');
    }
  }
}

/**
 * The PayTR provider, for `betterPayment({ providers: { paytr: paytr({ merchantId, merchantKey, merchantSalt }) } })`.
 * The base URL follows `mode` unless `baseUrl` is set.
 */
export const paytr = (config: PayTRConfig): ProviderDefinition<PayTR> =>
  defineProvider((ctx) => {
    const options = withProviderDefaults(ProviderType.PAYTR, config, ctx);
    return new PayTR({ ...options, testMode: config.testMode ?? ctx.mode === 'sandbox' });
  });
