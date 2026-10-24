import {
  defineProvider,
  withProviderDefaults,
  ProviderType,
  type ProviderDefinition,
  type RemoteProviderType,
} from '../../core/BetterPaymentConfig';
import type { HttpClient, HttpResponse } from '../../core/http';
import { PaymentProvider } from '../../core/PaymentProvider';
import { BetterPaymentError, ConfigurationError, ValidationError } from '../../core/errors';
import { failureResult, type FailureResult } from '../../core/failure';
import type { PaymentValidationRules } from '../../core/validation';
import { ISO8583_ERROR_CODES, PaymentErrorCode, resolveErrorCode } from '../../core/error-codes';
import { generateOrderId, parseAmount, toMinorUnits } from '../../core/utils';
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
  BinCheckResponse,
  InstallmentInfoRequest,
  InstallmentInfoResponse,
  PaymentStatus,
} from '../../types';
import {
  SIPAY_ENDPOINTS,
  SIPAY_SUCCESS_CODE,
  SIPAY_CONFIRM_STATUS,
  buildSipayItems,
  createSipayConfirmHash,
  createSipayPaymentHash,
  createSipayRefundHash,
  createSipayStatusHash,
  formatSipayAmount,
  formatSipayExpiry,
  formatSipayInstallment,
  getSipayCurrency,
  getSipayLanguage,
  mapSipayTransactionStatus,
  parseSipayForm,
  verifySipayPaymentHash,
} from './utils';
import type {
  SipayBrand,
  SipayConfig,
  Sipay3DCallbackData,
  SipayOperationResponse,
  SipayPaymentResponse,
  SipayPaymentResult,
  SipayPosOption,
  SipayPosResponse,
  SipayStatusResponse,
  SipayTokenResponse,
} from './types';

const SIPAY_CARD_RULES: PaymentValidationRules = {
  card: true,
  required: [
    'buyer.name',
    'buyer.surname',
    'buyer.email',
    'buyer.gsmNumber',
    'buyer.ip',
    'billingAddress.address',
  ],
};

/** Tokens are valid for 2 hours; a new one is requested after 100 minutes */
const TOKEN_LIFETIME_MS = 100 * 60 * 1000;

/** Raised when Sipay refuses to issue a token (wrong app id or secret) */
class SipayTokenError extends BetterPaymentError {
  constructor(
    message: string,
    readonly statusCode: string | undefined,
    readonly response: unknown,
    provider: string
  ) {
    super(message, 'PROVIDER_ERROR', provider);
  }
}

/**
 * Payment institutions on Sipay's platform (the same ccpayment API on their own
 * hosts): each brand's display name and provider id with default URLs
 */
const SIPAY_BRANDS: Record<SipayBrand, { name: string; type: RemoteProviderType }> = {
  sipay: { name: 'Sipay', type: ProviderType.SIPAY },
  qnbpay: { name: 'QNBpay', type: ProviderType.QNBPAY },
};

type SipayResult = SipayPaymentResult | SipayStatusResponse | SipayOperationResponse;

/** "1", 1 and true are the same flag in Sipay responses */
function isOne(value: unknown): boolean {
  return value === 1 || value === '1' || value === true;
}

function isSuccessCode(value: unknown): boolean {
  return Number(value) === SIPAY_SUCCESS_CODE;
}

function nonEmpty(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

/** The bank's ISO 8583 code, wherever it sits in a raw response */
function bankCodeOf(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  return (
    nonEmpty(record.original_bank_error_code) ??
    bankCodeOf(record.data) ??
    bankCodeOf(record.callback)
  );
}

/**
 * Sipay (paySmart2D / paySmart3D)
 *
 * - createPayment():          paySmart2D (non-3D, if enabled for the merchant)
 * - initThreeDSPayment():     paySmart3D; returns the 3D Secure page (HTML)
 * - completeThreeDSPayment(): verifies the hash key Sipay posts to return_url / cancel_url
 * - refund() / cancel():      refund (same-day refunds are voids at Sipay)
 * - getPayment():             checkstatus
 * - authorize(), initThreeDSAuthorize(), capture(), voidAuthorization(): PreAuth + confirmPayment
 * - binCheck() / installmentInfo(): getpos
 *
 * `paymentId` is the invoice id (`conversationId`, or a generated one).
 * Requests carry a Bearer token, requested with appId / appSecret and reused
 * until it expires.
 */
export class Sipay extends PaymentProvider<SipayConfig> {
  private client: HttpClient;
  private token?: { value: string; expiresAt: number };
  private tokenRequest?: Promise<string>;

  constructor(config: SipayConfig) {
    super(config);

    this.client = this.createHttpClient(this.providerId, {
      timeout: 30000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
  }

  /** `brand` (default `sipay`): the institution and its provider id */
  private get providerId(): SipayBrand {
    return this.config.brand ?? 'sipay';
  }

  private get providerName(): string {
    return SIPAY_BRANDS[this.providerId]?.name ?? 'Sipay';
  }

  protected validateConfig(): void {
    if (!SIPAY_BRANDS[this.providerId]) {
      throw new ConfigurationError(`Unknown Sipay brand: ${this.config.brand}`, 'sipay');
    }
    const missing = (['appId', 'appSecret', 'merchantKey'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(
        `${this.providerName} configuration is missing: ${missing.join(', ')}`,
        this.providerId
      );
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError(`${this.providerName} baseUrl is required`, this.providerId);
    }
  }

  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return {
      '1': PaymentErrorCode.INVALID_REQUEST, // basic validation
      '3': PaymentErrorCode.DUPLICATE_ORDER, // invoice id already processed
      '12': PaymentErrorCode.INVALID_REQUEST, // items or currency invalid
      '13': PaymentErrorCode.INVALID_REQUEST, // items do not add up to total
      '14': PaymentErrorCode.PROVIDER_ERROR, // merchant not found
      '30': PaymentErrorCode.PROVIDER_ERROR, // invalid credentials
      '31': PaymentErrorCode.INVALID_REQUEST, // transaction not found
      '32': PaymentErrorCode.INVALID_REQUEST, // invalid invoice id
      '33': PaymentErrorCode.INVALID_REQUEST, // quantity must be an integer
      '34': PaymentErrorCode.PROVIDER_ERROR, // integration method not allowed
      '35': PaymentErrorCode.PROVIDER_ERROR, // no credit card payment option
      '36': PaymentErrorCode.PROVIDER_ERROR, // POS not found
      '37': PaymentErrorCode.PROVIDER_ERROR, // POS commission not set
      '38': PaymentErrorCode.PROVIDER_ERROR, // commission not set for currency
      '39': PaymentErrorCode.PROVIDER_ERROR, // commission not found
      '40': PaymentErrorCode.PROVIDER_ERROR, // installment not found, too many requests
      '41': PaymentErrorCode.CARD_DECLINED, // order or payment failed
      '42': PaymentErrorCode.INVALID_REQUEST, // price lower than commission
      '43': PaymentErrorCode.PROVIDER_ERROR, // payment term not set
      '44': PaymentErrorCode.LIMIT_EXCEEDED, // card blocked or daily limit
      '45': PaymentErrorCode.LIMIT_EXCEEDED,
      '46': PaymentErrorCode.LIMIT_EXCEEDED,
      '47': PaymentErrorCode.LIMIT_EXCEEDED,
      '48': PaymentErrorCode.LIMIT_EXCEEDED, // per-transaction minimum
      '49': PaymentErrorCode.PROVIDER_ERROR, // refund failed
      '60': PaymentErrorCode.CARD_DECLINED, // card not allowed for merchant
      '68': PaymentErrorCode.PROVIDER_ERROR, // request hash key mismatch
      '76': PaymentErrorCode.CARD_DECLINED, // foreign cards not allowed
      '77': PaymentErrorCode.CARD_DECLINED,
      '85': PaymentErrorCode.INVALID_REQUEST, // invalid character
      '90': PaymentErrorCode.PROVIDER_ERROR, // invalid hash key
      '99': PaymentErrorCode.PROVIDER_ERROR, // unknown error
      '101': PaymentErrorCode.PROVIDER_ERROR, // unauthenticated (expired token)
      '102': PaymentErrorCode.PROVIDER_ERROR, // POS not defined for installment
      '105': PaymentErrorCode.CARD_DECLINED, // transaction not approved
      '108': PaymentErrorCode.INVALID_CARD, // invalid card number
      '110': PaymentErrorCode.INVALID_REQUEST, // partial refund not allowed
      '117': PaymentErrorCode.DUPLICATE_ORDER, // invoice id already processed
      '119': PaymentErrorCode.FRAUD_SUSPECTED, // declined for security reasons
    };
  }

  /**
   * The bank's ISO 8583 code is the most specific reason; Sipay's own status
   * code is used when the bank did not answer.
   */
  protected resolveErrorCode(result: FailureResult): PaymentErrorCode {
    const bank = bankCodeOf(result.rawResponse);
    if (bank && ISO8583_ERROR_CODES[bank] && result.errorCode === bank) {
      return ISO8583_ERROR_CODES[bank];
    }
    return resolveErrorCode(result.errorCode, this.errorCodeTable());
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    if (error instanceof SipayTokenError) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: error.statusCode,
        errorMessage: error.message,
        rawResponse: error.response,
        ...extra,
      } as T);
    }
    return this.withErrorCode(failureResult<T>(this.providerName, error, fallback, extra));
  }

  /** errorCode / errorMessage of a failed result: the bank's code first, then Sipay's */
  private static errorOf(data: SipayResult | undefined, fallback?: SipayResult) {
    const source = data ?? fallback ?? {};
    const record = source as Record<string, unknown>;
    const outer = (fallback ?? {}) as Record<string, unknown>;
    const errorCode =
      nonEmpty(record.original_bank_error_code) ??
      nonEmpty(record.error_code) ??
      nonEmpty(record.status_code) ??
      nonEmpty(outer.status_code);
    const errorMessage =
      nonEmpty(record.original_bank_error_description) ??
      nonEmpty(record.error) ??
      nonEmpty(record.bank_status_description) ??
      nonEmpty(record.status_description) ??
      nonEmpty(record.message) ??
      nonEmpty(outer.status_description) ??
      nonEmpty(outer.message);
    return { errorCode, errorMessage };
  }

  private get language() {
    return getSipayLanguage(this.config.locale);
  }

  private async getToken(renew = false): Promise<string> {
    if (!renew && this.token && this.token.expiresAt > Date.now()) return this.token.value;
    if (!this.tokenRequest) {
      this.tokenRequest = this.requestToken().finally(() => {
        this.tokenRequest = undefined;
      });
    }
    return this.tokenRequest;
  }

  private async requestToken(): Promise<string> {
    const response = await this.client.post<SipayTokenResponse>(
      SIPAY_ENDPOINTS.TOKEN,
      JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
        app_lang: this.language,
      }),
      { retryable: true, validateStatus: (status) => status < 500 }
    );
    const data = response.data ?? {};
    const value = data.data?.token;
    if (!value) {
      throw new SipayTokenError(
        `${this.providerName} did not issue a token: ${data.status_description || 'unknown error'}`,
        nonEmpty(data.status_code),
        data,
        this.providerId
      );
    }
    this.token = { value, expiresAt: Date.now() + TOKEN_LIFETIME_MS };
    return value;
  }

  private static unauthenticated(response: HttpResponse<unknown>): boolean {
    if (response.status === 401) return true;
    const data = response.data;
    if (typeof data === 'string') return /"status_code"\s*:\s*101\b.*unauthenticated/i.test(data);
    const record = (data ?? {}) as { status_code?: unknown; status_description?: unknown };
    return (
      Number(record.status_code) === 101 &&
      /unauthenticated/i.test(String(record.status_description ?? ''))
    );
  }

  /**
   * POSTs JSON with the Bearer token. A request rejected as unauthenticated
   * (the token expired early) was not processed, so it is sent once more with
   * a new token.
   */
  private async request<T>(
    endpoint: string,
    body: Record<string, unknown>,
    options: { retryable?: boolean; responseType?: 'json' | 'text' } = {}
  ): Promise<T> {
    const send = async (token: string) =>
      this.client.post<T>(endpoint, JSON.stringify(body), {
        retryable: options.retryable,
        responseType: options.responseType,
        headers: { Authorization: `Bearer ${token}` },
        validateStatus: (status) => status < 500,
      });

    let response = await send(await this.getToken());
    if (Sipay.unauthenticated(response)) {
      response = await send(await this.getToken(true));
    }
    return response.data;
  }

  private async paymentBody(
    request: PaymentRequest,
    invoiceId: string,
    preAuth: boolean
  ): Promise<Record<string, unknown>> {
    const card = this.cardOf(request);
    const total = formatSipayAmount(request.paidPrice ?? request.price);
    const installment = formatSipayInstallment(request.installment);
    const currency = getSipayCurrency(request.currency);
    const description = `Order ${invoiceId}`;
    const billing = request.billingAddress;

    return {
      cc_holder_name: card.cardHolderName,
      cc_no: card.cardNumber.replace(/\s/g, ''),
      ...formatSipayExpiry(card.expireMonth, card.expireYear),
      cvv: card.cvc,
      currency_code: currency,
      installments_number: installment,
      invoice_id: invoiceId,
      invoice_description: description,
      name: request.buyer.name,
      surname: request.buyer.surname,
      total,
      merchant_key: this.config.merchantKey,
      items: buildSipayItems(request.basketItems, total, description),
      hash_key: await createSipayPaymentHash(
        { total, installment, currency, merchantKey: this.config.merchantKey, invoiceId },
        this.config.appSecret
      ),
      bill_address1: billing?.address,
      bill_city: billing?.city,
      bill_postcode: billing?.zipCode,
      bill_country: billing?.country,
      bill_email: request.buyer.email,
      bill_phone: request.buyer.gsmNumber,
      ip: request.buyer.ip,
      transaction_type: preAuth ? 'PreAuth' : 'Auth',
      ...(this.config.saleWebhookKey ? { sale_web_hook_key: this.config.saleWebhookKey } : {}),
      app_lang: this.language,
    };
  }

  /**
   * Non-3D payment (paySmart2D). Sipay enables non-3D payments per merchant.
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    return this.payNonSecure(request, false);
  }

  /** Non-3D pre-authorization: blocks the amount; charge it with capture() */
  async authorize(request: PaymentRequest): Promise<PaymentResponse> {
    return this.payNonSecure(request, true);
  }

  private async payNonSecure(request: PaymentRequest, preAuth: boolean): Promise<PaymentResponse> {
    const invoiceId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, SIPAY_CARD_RULES);
      const response = await this.request<SipayPaymentResponse>(
        SIPAY_ENDPOINTS.PAY_2D,
        await this.paymentBody(request, invoiceId, preAuth)
      );
      const approved =
        isSuccessCode(response?.status_code) && isOne(response?.data?.payment_status);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: invoiceId,
        conversationId: invoiceId,
        ...(approved ? {} : Sipay.errorOf(response?.data, response)),
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(
        error,
        preAuth ? 'Pre-authorization failed' : 'Payment failed',
        { paymentId: invoiceId, conversationId: invoiceId }
      );
    }
  }

  /**
   * 3D Secure payment (paySmart3D). Returns Sipay's 3D Secure page; Sipay
   * posts the result to callbackUrl (return_url) on success and to failUrl
   * (cancel_url, default: callbackUrl) on failure. Complete it with
   * completeThreeDSPayment().
   */
  async initThreeDSPayment(
    request: ThreeDSPaymentRequest & { failUrl?: string }
  ): Promise<ThreeDSInitResponse> {
    return this.payThreeDS(request, false);
  }

  /** 3D Secure pre-authorization; complete it with completeThreeDSPayment() */
  async initThreeDSAuthorize(
    request: ThreeDSPaymentRequest & { failUrl?: string }
  ): Promise<ThreeDSInitResponse> {
    return this.payThreeDS(request, true);
  }

  private async payThreeDS(
    request: ThreeDSPaymentRequest & { failUrl?: string },
    preAuth: boolean
  ): Promise<ThreeDSInitResponse> {
    const invoiceId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, SIPAY_CARD_RULES);
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }
      const body = {
        ...(await this.paymentBody(request, invoiceId, preAuth)),
        return_url: request.callbackUrl,
        cancel_url: request.failUrl || request.callbackUrl,
        response_method: 'POST',
      };

      // paySmart3D answers with HTML: the 3D Secure page, or a form posting the
      // error to cancel_url. Some errors come back as JSON.
      const data = await this.request<unknown>(SIPAY_ENDPOINTS.PAY_3D, body, {
        responseType: 'text',
      });
      const html = typeof data === 'string' ? data : JSON.stringify(data ?? '');
      const rejection = Sipay.rejectionOf(html, this.providerName);

      if (rejection) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          paymentId: invoiceId,
          conversationId: invoiceId,
          ...Sipay.errorOf(rejection),
          rawResponse: rejection,
        });
      }

      return this.withErrorCode({
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: html,
        paymentId: invoiceId,
        conversationId: invoiceId,
      });
    } catch (error) {
      return this.failure<ThreeDSInitResponse>(error, '3DS initialization failed', {
        paymentId: invoiceId,
        conversationId: invoiceId,
      });
    }
  }

  /** The error of a rejected paySmart3D request, or undefined for a 3D Secure page */
  private static rejectionOf(body: string, name: string): SipayResult | undefined {
    const text = body.trim();
    if (!text) return { status_description: `${name} returned an empty response` };
    if (text.startsWith('{')) {
      try {
        const json = JSON.parse(text) as SipayPaymentResponse;
        return { ...json, ...(json.data ?? {}) } as SipayResult;
      } catch {
        return { status_description: `${name} returned an invalid response` };
      }
    }
    const fields = parseSipayForm(text);
    const failed =
      ('status_code' in fields && !isSuccessCode(fields.status_code)) ||
      fields.sipay_status === '0' ||
      fields.payment_status === '0';
    return failed ? fields : undefined;
  }

  /**
   * Completes a 3D Secure payment from the fields Sipay POSTs to return_url or
   * cancel_url.
   *
   * Only the hash key is trusted: it is decrypted with the app secret and its
   * content (status, total, invoice id, order id, currency) decides the result.
   * A callback without a valid hash key, or whose invoice id or order id differs
   * from the hash key, is rejected as INVALID_HASH and carries no ids.
   * `rawResponse.verified` holds the verified values: compare `total` with
   * the amount of your order.
   */
  async completeThreeDSPayment(callbackData: Sipay3DCallbackData): Promise<PaymentResponse> {
    const verified = await verifySipayPaymentHash(callbackData?.hash_key, this.config.appSecret);
    const invoiceMatches = verified && callbackData.invoice_id === verified.invoiceId;
    const orderMatches =
      verified && (callbackData.order_id ?? verified.orderId) === verified.orderId;

    if (!verified || !verified.invoiceId || !invoiceMatches || !orderMatches) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'INVALID_HASH',
        errorMessage: verified
          ? `The callback does not match its ${this.providerName} hash key`
          : `The ${this.providerName} hash key is missing or invalid`,
        rawResponse: callbackData,
      });
    }

    const approved = verified.status === '1';
    return this.withErrorCode({
      status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
      paymentId: verified.invoiceId,
      conversationId: verified.invoiceId,
      ...(approved ? {} : Sipay.errorOf(callbackData)),
      rawResponse: { callback: callbackData, verified },
    });
  }

  private async checkStatus(invoiceId: string): Promise<SipayStatusResponse> {
    const data = await this.request<SipayStatusResponse>(
      SIPAY_ENDPOINTS.CHECK_STATUS,
      {
        merchant_key: this.config.merchantKey,
        invoice_id: invoiceId,
        include_pending_status: true,
        show_refund_info: 'Y',
        hash_key: await createSipayStatusHash(
          { invoiceId, merchantKey: this.config.merchantKey },
          this.config.appSecret
        ),
        app_lang: this.language,
      },
      { retryable: true }
    );
    return data ?? {};
  }

  /**
   * Payment status (checkstatus). `paymentId` is the invoice id.
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const data = await this.checkStatus(paymentId);
      const status = mapSipayTransactionStatus(data.transaction_status);
      return this.withErrorCode({
        status,
        paymentId,
        conversationId: paymentId,
        ...(status === PaymentStatus.FAILURE ? Sipay.errorOf(data) : {}),
        rawResponse: data,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Get payment failed', {
        paymentId,
        conversationId: paymentId,
      });
    }
  }

  private async refundAmount(invoiceId: string, amount: string): Promise<SipayOperationResponse> {
    const data = await this.request<SipayOperationResponse>(SIPAY_ENDPOINTS.REFUND, {
      invoice_id: invoiceId,
      amount,
      // The documentation lists app_id and app_secret too; the Bearer token and
      // hash key are enough, so the secret is not sent
      merchant_key: this.config.merchantKey,
      hash_key: await createSipayRefundHash(
        { amount, invoiceId, merchantKey: this.config.merchantKey },
        this.config.appSecret
      ),
      app_lang: this.language,
    });
    return data ?? {};
  }

  /**
   * Full or partial refund. Sipay voids a refund of a same-day payment, so no
   * separate cancel call is needed. `paymentId` is the invoice id.
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const data = await this.refundAmount(request.paymentId, formatSipayAmount(request.price));
      const approved = isSuccessCode(data.status_code);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: approved ? (nonEmpty(data.ref_no) ?? nonEmpty(data.ref_number)) : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : Sipay.errorOf(data)),
        rawResponse: data,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /** Amount still refundable: transaction amount minus refunds, in the major unit */
  private static remainingOf(data: SipayStatusResponse): string | undefined {
    const amount = Number(data.transaction_amount ?? data.product_price);
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    const refunded = Number(data.total_refunded_amount ?? 0) || 0;
    const remaining = (toMinorUnits(amount) - toMinorUnits(refunded)) / 100;
    return remaining > 0 ? formatSipayAmount(remaining) : undefined;
  }

  /**
   * Cancels a payment: refunds what is left of it (a void on the same day), or
   * releases it when it is an open pre-authorization. `paymentId` is the invoice id.
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const payment = await this.checkStatus(request.paymentId);
      if (Sipay.isOpenPreAuth(payment)) {
        return this.confirm(request.paymentId, SIPAY_CONFIRM_STATUS.VOID, payment, request);
      }

      const amount = request.price
        ? formatSipayAmount(parseAmount(request.price, 'price'))
        : Sipay.remainingOf(payment);
      if (
        mapSipayTransactionStatus(payment.transaction_status) !== PaymentStatus.SUCCESS ||
        !amount
      ) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          conversationId: request.conversationId,
          ...Sipay.errorOf(payment),
          ...(isSuccessCode(payment.status_code)
            ? {
                errorCode: 'NOT_CANCELLABLE',
                errorMessage: `${this.providerName} payment ${request.paymentId} is ${payment.transaction_status ?? 'not cancellable'}`,
              }
            : {}),
          rawResponse: payment,
        });
      }

      const data = await this.refundAmount(request.paymentId, amount);
      const approved = isSuccessCode(data.status_code);
      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        transactionId: approved ? (nonEmpty(data.ref_no) ?? nonEmpty(data.ref_number)) : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : Sipay.errorOf(data)),
        rawResponse: data,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', {
        conversationId: request.conversationId,
      });
    }
  }

  private static isOpenPreAuth(data: SipayStatusResponse): boolean {
    return (data.transaction_status || '').toLowerCase() === 'pre-authorization';
  }

  private async confirm(
    invoiceId: string,
    status: number,
    payment: SipayStatusResponse,
    request: { conversationId?: string },
    amount?: string
  ): Promise<CancelResponse> {
    const total = amount ?? formatSipayAmount(Number(payment.transaction_amount ?? 0));
    const data = await this.request<SipayOperationResponse>(SIPAY_ENDPOINTS.CONFIRM_PAYMENT, {
      invoice_id: invoiceId,
      merchant_key: this.config.merchantKey,
      status,
      total: Number(total),
      hash_key: await createSipayConfirmHash(
        { merchantKey: this.config.merchantKey, invoiceId, status },
        this.config.appSecret
      ),
      app_lang: this.language,
    });
    const approved = isSuccessCode(data?.status_code);
    return this.withErrorCode({
      status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
      conversationId: request.conversationId,
      ...(approved ? {} : Sipay.errorOf(data)),
      rawResponse: data,
    });
  }

  /**
   * Charges (all or part of) a pre-authorized amount (confirmPayment, status 1).
   * `paymentId` is the invoice id.
   */
  async capture(request: CaptureRequest): Promise<PaymentResponse> {
    try {
      this.validateCapture(request);
      const result = await this.confirm(
        request.paymentId,
        SIPAY_CONFIRM_STATUS.CAPTURE,
        {},
        request,
        formatSipayAmount(request.amount)
      );
      return {
        ...result,
        paymentId: request.paymentId,
        conversationId: request.conversationId ?? request.paymentId,
      };
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Capture failed', {
        paymentId: request.paymentId,
        conversationId: request.conversationId ?? request.paymentId,
      });
    }
  }

  /**
   * Releases a pre-authorization (confirmPayment, status 2). `paymentId` is the invoice id.
   */
  async voidAuthorization(request: VoidAuthorizationRequest): Promise<CancelResponse> {
    try {
      const payment = await this.checkStatus(request.paymentId);
      if (!Sipay.isOpenPreAuth(payment)) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          conversationId: request.conversationId,
          ...Sipay.errorOf(payment),
          ...(isSuccessCode(payment.status_code)
            ? {
                errorCode: 'NOT_CANCELLABLE',
                errorMessage: `${this.providerName} payment ${request.paymentId} is not an open pre-authorization`,
              }
            : {}),
          rawResponse: payment,
        });
      }
      return await this.confirm(request.paymentId, SIPAY_CONFIRM_STATUS.VOID, payment, request);
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Voiding the pre-authorization failed', {
        conversationId: request.conversationId,
      });
    }
  }

  private async getPos(binNumber: string, amount: string | number): Promise<SipayPosOption[]> {
    const bin = String(binNumber ?? '').replace(/\s/g, '');
    if (!/^\d{6,8}$/.test(bin)) {
      throw new ValidationError('binNumber must be the first 6 to 8 digits of the card');
    }
    const data = await this.request<SipayPosResponse>(
      SIPAY_ENDPOINTS.GET_POS,
      {
        credit_card: bin,
        amount: parseAmount(amount),
        currency_code: 'TRY',
        merchant_key: this.config.merchantKey,
        app_lang: this.language,
      },
      { retryable: true }
    );
    if (!isSuccessCode(data?.status_code) || !Array.isArray(data.data) || !data.data.length) {
      throw new BetterPaymentError(
        `${this.providerName} getpos failed: ${data?.status_description || 'no installment options'}`,
        'PROVIDER_ERROR',
        this.providerId
      );
    }
    return data.data;
  }

  /**
   * Card type, scheme, program and bank of a BIN (getpos).
   */
  async binCheck(binNumber: string): Promise<BinCheckResponse> {
    const options = await this.getPos(binNumber, 1);
    const card = options[0];
    return {
      binNumber,
      cardType: card.card_type || '',
      cardAssociation: (card.card_scheme || '').toUpperCase(),
      cardFamily: card.card_program || '',
      bankName: card.card_bank || '',
      bankCode: Number(card.bank_code) || 0,
      commercial: String(card.is_commercial).toUpperCase() === 'TRUE',
      rawResponse: options,
    };
  }

  /**
   * Installment options for a card (getpos), with the amount to charge for
   * each count as calculated by Sipay.
   */
  async installmentInfo(request: InstallmentInfoRequest): Promise<InstallmentInfoResponse> {
    try {
      const priceMinor = toMinorUnits(request.price);
      if (!(priceMinor > 0)) throw new ValidationError('price must be greater than 0');
      const options = await this.getPos(request.binNumber, priceMinor / 100);
      const card = options[0];

      const installmentPrices = options
        .map((option) => {
          const installmentNumber = Number(option.installments_number) || 1;
          const totalMinor = toMinorUnits(
            option.amount_to_be_paid ?? option.payable_amount ?? priceMinor / 100
          );
          return {
            installmentNumber,
            totalPrice: totalMinor / 100,
            installmentPrice: Math.round(totalMinor / installmentNumber) / 100,
          };
        })
        .sort((a, b) => a.installmentNumber - b.installmentNumber);

      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        installmentDetails: [
          {
            binNumber: request.binNumber,
            price: priceMinor / 100,
            cardType: card.card_type || '',
            cardAssociation: (card.card_scheme || '').toUpperCase(),
            cardFamilyName: card.card_program || '',
            bankCode: Number(card.bank_code) || 0,
            bankName: card.card_bank || '',
            commercial: String(card.is_commercial).toUpperCase() === 'TRUE' ? 1 : 0,
            installmentPrices,
          },
        ],
        conversationId: request.conversationId,
        rawResponse: options,
      });
    } catch (error) {
      return this.failure<InstallmentInfoResponse>(error, 'Installment info failed', {
        conversationId: request.conversationId,
      });
    }
  }
}

/**
 * The Sipay provider, for
 * `betterPayment({ providers: { sipay: sipay({ appId, appSecret, merchantKey }) } })`.
 * `brand` selects another institution on Sipay's platform (`qnbpay`). The base
 * URL follows `mode` unless `baseUrl` is set.
 */
export const sipay = (config: SipayConfig): ProviderDefinition<Sipay> =>
  defineProvider((ctx) => {
    const type = SIPAY_BRANDS[config.brand ?? 'sipay']?.type;
    if (type) return new Sipay(withProviderDefaults(type, config, ctx));
    // Unknown brand: validateConfig reports it
    return new Sipay({ ...withProviderDefaults(ProviderType.SIPAY, config, ctx) });
  });

/**
 * QNBpay, on Sipay's platform:
 * `betterPayment({ providers: { qnbpay: qnbpay({ appId, appSecret, merchantKey }) } })`.
 */
export const qnbpay = (config: Omit<SipayConfig, 'brand'>): ProviderDefinition<Sipay> =>
  sipay({ ...config, brand: 'qnbpay' });
