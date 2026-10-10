import {
  defineProvider,
  withProviderDefaults,
  ProviderType,
  type ProviderDefinition,
} from '../../core/BetterPaymentConfig';
import type { HttpClient, HttpRequestConfig } from '../../core/http';
import { PaymentProvider } from '../../core/PaymentProvider';
import { BetterPaymentError, ConfigurationError, ValidationError } from '../../core/errors';
import { failureResult, FailureResult } from '../../core/failure';
import type { PaymentValidationRules } from '../../core/validation';
import { ISO8583_ERROR_CODES, PaymentErrorCode, resolveErrorCode } from '../../core/error-codes';
import { generateOrderId } from '../../core/utils';
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
  InstallmentInfoRequest,
  InstallmentInfoResponse,
  PaymentStatus,
} from '../../types';
import {
  AKBANK_API_VERSION,
  AKBANK_SUCCESS_CODE,
  AKBANK_TXN_CODES,
  AKBANK_3D_GATEWAYS,
  akbankSign,
  createAkbank3DFormHash,
  verifyAkbank3DCallback,
  generateAkbankRandomNumber,
  formatAkbankDateTime,
  formatAkbankAmount,
  formatAkbankExpiry,
  getAkbankCurrencyCode,
} from './utils';
import type {
  AkbankConfig,
  AkbankApiResponse,
  Akbank3DCallbackData,
  AkbankTxnDetail,
} from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const AKBANK_CARD_RULES: PaymentValidationRules = { card: true, required: ['buyer.ip'] };

/**
 * Akbank Sanal POS (JSON API, "yeni nesil" sanal POS)
 *
 * - createPayment():      txnCode 1000 (non-3D sale)
 * - initThreeDSPayment(): 3D_PAY model; returns an auto-submitting form to the
 *                         Akbank securepay gateway. Akbank authenticates and
 *                         charges, then POSTs the signed result to callbackUrl.
 * - completeThreeDSPayment(): verifies the callback signature and result.
 * - refund() 1002, cancel() 1003, getPayment() 1010 (order history)
 */
export class Akbank extends PaymentProvider<AkbankConfig> {
  private client: HttpClient;

  constructor(config: AkbankConfig) {
    super(config);

    this.client = this.createHttpClient('akbank', {
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  protected validateConfig(): void {
    const missing = (['merchantSafeId', 'terminalSafeId', 'secretKey'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(
        `Akbank configuration is missing: ${missing.join(', ')}`,
        'akbank'
      );
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('Akbank baseUrl is required', 'akbank');
    }
  }

  private get gateway3dUrl(): string {
    return (
      this.config.gateway3dUrl ||
      (this.config.testMode ? AKBANK_3D_GATEWAYS.test : AKBANK_3D_GATEWAYS.production)
    );
  }

  private get lang(): string {
    return (this.config.locale || 'tr').toLowerCase().startsWith('en') ? 'EN' : 'TR';
  }

  private baseRequest(txnCode: string): Record<string, unknown> {
    const request: Record<string, unknown> = {
      version: AKBANK_API_VERSION,
      txnCode,
      requestDateTime: formatAkbankDateTime(),
      randomNumber: generateAkbankRandomNumber(),
      terminal: {
        merchantSafeId: this.config.merchantSafeId,
        terminalSafeId: this.config.terminalSafeId,
      },
    };
    if (this.config.subMerchantId) {
      request.subMerchant = { subMerchantId: this.config.subMerchantId };
    }
    return request;
  }

  /**
   * POST /transaction/process with the auth-hash header
   * (base64(HMAC-SHA512(body, secretKey)))
   */
  private async process(
    body: Record<string, unknown>,
    retryable = false
  ): Promise<AkbankApiResponse> {
    const json = JSON.stringify(body);
    const config: HttpRequestConfig = {
      headers: {
        'Content-Type': 'application/json',
        'auth-hash': await akbankSign(json, this.config.secretKey),
      },
      retryable,
      // Akbank returns 4xx with a JSON body for validation errors
      validateStatus: (status) => status < 500,
    };
    const response = await this.client.post<AkbankApiResponse>(
      '/transaction/process',
      json,
      config
    );
    return response.data ?? {};
  }

  /**
   * The bank's ISO 8583 host response code is the most specific reason; the
   * Akbank response code (VPS-xxxx) is used when it is missing.
   */
  protected resolveErrorCode(result: FailureResult): PaymentErrorCode {
    const raw = result.rawResponse as { hostResponseCode?: unknown } | undefined;
    const host = typeof raw?.hostResponseCode === 'string' ? raw.hostResponseCode : undefined;
    if (host && ISO8583_ERROR_CODES[host]) return ISO8583_ERROR_CODES[host];
    return resolveErrorCode(result.errorCode, {
      TERMINAL_MISMATCH: PaymentErrorCode.INVALID_HASH,
    });
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('Akbank', error, fallback, extra));
  }

  private static errorOf(data: AkbankApiResponse): { errorCode?: string; errorMessage?: string } {
    return {
      errorCode: data.responseCode ?? (data.code !== undefined ? String(data.code) : undefined),
      errorMessage: data.hostMessage || data.responseMessage || data.message,
    };
  }

  /**
   * Non-3D sale (txnCode 1000)
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    return this.cardTransaction(AKBANK_TXN_CODES.SALE, request);
  }

  /** Pre-authorization (txnCode 1004): blocks the amount without charging it */
  async authorize(request: PaymentRequest): Promise<PaymentResponse> {
    return this.cardTransaction(AKBANK_TXN_CODES.PRE_AUTH, request);
  }

  private async cardTransaction(
    txnCode: string,
    request: PaymentRequest
  ): Promise<PaymentResponse> {
    const orderId = request.conversationId || generateOrderId();
    const preAuth = txnCode === AKBANK_TXN_CODES.PRE_AUTH;
    try {
      this.validatePayment(request, AKBANK_CARD_RULES);
      const card = this.cardOf(request);
      const body = {
        ...this.baseRequest(txnCode),
        card: {
          cardNumber: card.cardNumber,
          cvv2: card.cvc,
          expireDate: formatAkbankExpiry(card.expireMonth, card.expireYear),
        },
        transaction: {
          amount: formatAkbankAmount(request.paidPrice ?? request.price),
          currencyCode: getAkbankCurrencyCode(request.currency),
          motoInd: 0,
          installCount: Math.max(1, request.installment ?? 1),
        },
        customer: {
          ipAddress: request.buyer.ip,
        },
        order: { orderId },
      };

      const data = await this.process(body);
      const approved = data.responseCode === AKBANK_SUCCESS_CODE;

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: orderId,
        conversationId: orderId,
        ...(approved ? {} : Akbank.errorOf(data)),
        rawResponse: data,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(
        error,
        preAuth ? 'Pre-authorization failed' : 'Payment failed',
        { paymentId: orderId, conversationId: orderId }
      );
    }
  }

  /**
   * 3D Secure payment (3D_PAY model)
   *
   * Returns an auto-submitting HTML form to the Akbank gateway. Card data is
   * posted from the customer's browser directly to Akbank.
   */
  async initThreeDSPayment(
    request: ThreeDSPaymentRequest & { failUrl?: string }
  ): Promise<ThreeDSInitResponse> {
    return this.threeDSForm(AKBANK_TXN_CODES.SECURE_SALE, request);
  }

  /**
   * 3D Secure pre-authorization (txnCode 3004, 3D_PAY). The bank posts the
   * result to callbackUrl; completeThreeDSPayment() verifies it as usual.
   */
  async initThreeDSAuthorize(
    request: ThreeDSPaymentRequest & { failUrl?: string }
  ): Promise<ThreeDSInitResponse> {
    return this.threeDSForm(AKBANK_TXN_CODES.SECURE_PRE_AUTH, request);
  }

  private async threeDSForm(
    txnCode: string,
    request: ThreeDSPaymentRequest & { failUrl?: string }
  ): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, AKBANK_CARD_RULES);
      const card = this.cardOf(request);
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }

      const fields: Record<string, string> = {
        paymentModel: '3D_PAY',
        txnCode,
        merchantSafeId: this.config.merchantSafeId,
        terminalSafeId: this.config.terminalSafeId,
        orderId,
        lang: this.lang,
        amount: formatAkbankAmount(request.paidPrice ?? request.price),
        currencyCode: String(getAkbankCurrencyCode(request.currency)),
        installCount: String(Math.max(1, request.installment ?? 1)),
        okUrl: request.callbackUrl,
        failUrl: request.failUrl || request.callbackUrl,
        emailAddress: request.buyer?.email ?? '',
        creditCard: card.cardNumber,
        expiredDate: formatAkbankExpiry(card.expireMonth, card.expireYear),
        cvv: card.cvc,
        randomNumber: generateAkbankRandomNumber(),
        requestDateTime: formatAkbankDateTime(),
      };
      if (this.config.subMerchantId) {
        fields.subMerchantId = this.config.subMerchantId;
      }
      fields.hash = await createAkbank3DFormHash(fields, this.config.secretKey);

      const inputs = Object.entries(fields)
        .map(
          ([name, value]) =>
            `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
        )
        .join('');

      const html =
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
        `<form id="akbank-3d-form" method="POST" action="${escapeHtml(this.gateway3dUrl)}">${inputs}</form>` +
        '<script>document.getElementById("akbank-3d-form").submit();</script>' +
        '</body></html>';

      return this.withErrorCode({
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: html,
        paymentId: orderId,
        conversationId: orderId,
      });
    } catch (error) {
      return this.failure<ThreeDSInitResponse>(error, '3DS initialization failed', {
        paymentId: orderId,
        conversationId: orderId,
      });
    }
  }

  /**
   * Verifies the okUrl/failUrl POST from Akbank.
   *
   * 1. The HMAC signature must be valid and cover responseCode, orderId and the
   *    terminal ids.
   * 2. The signed values are concatenated without a separator, so a signature
   *    alone does not pin which value is the orderId. The outcome is therefore
   *    confirmed with an order history query (txnCode 1010): a callback whose
   *    result does not match Akbank's record for that order is rejected as
   *    INVALID_HASH.
   *
   * Payment succeeded only when the callback and the query both report an
   * approved transaction for the order.
   */
  async completeThreeDSPayment(callbackData: Akbank3DCallbackData): Promise<PaymentResponse> {
    const orderId = callbackData?.orderId;
    const untrusted = (errorMessage: string, rawResponse: unknown): PaymentResponse =>
      this.withErrorCode({
        status: PaymentStatus.FAILURE,
        paymentId: orderId,
        conversationId: orderId,
        errorCode: 'INVALID_HASH',
        errorMessage,
        rawResponse,
      });

    if (!(await verifyAkbank3DCallback(callbackData ?? {}, this.config.secretKey))) {
      return untrusted('Invalid 3D Secure callback signature', callbackData);
    }

    if (
      callbackData.merchantSafeId !== this.config.merchantSafeId ||
      callbackData.terminalSafeId !== this.config.terminalSafeId
    ) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        paymentId: orderId,
        conversationId: orderId,
        errorCode: 'TERMINAL_MISMATCH',
        errorMessage: 'Callback belongs to a different terminal',
        rawResponse: callbackData,
      });
    }

    const approved = callbackData.responseCode === AKBANK_SUCCESS_CODE;

    let inquiry: AkbankApiResponse;
    try {
      inquiry = await this.process(
        {
          ...this.baseRequest(AKBANK_TXN_CODES.ORDER_HISTORY),
          order: { orderId },
        },
        true
      );
    } catch (error) {
      return this.failure<PaymentResponse>(error, '3D Secure result could not be confirmed', {
        paymentId: orderId,
        conversationId: orderId,
      });
    }

    const confirmed = (inquiry.txnDetailList ?? []).find((tx) => isApprovedPayment(tx, orderId));
    if (approved !== Boolean(confirmed)) {
      return untrusted('3D Secure callback does not match the order at Akbank', {
        callback: callbackData,
        inquiry,
      });
    }

    return this.withErrorCode({
      status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
      paymentId: orderId,
      conversationId: orderId,
      errorCode: approved ? undefined : callbackData.responseCode,
      errorMessage: approved ? undefined : callbackData.hostMessage || callbackData.responseMessage,
      rawResponse: callbackData,
    });
  }

  /**
   * Refund (txnCode 1002). `paymentId` is the order id.
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const data = await this.process({
        ...this.baseRequest(AKBANK_TXN_CODES.REFUND),
        transaction: {
          amount: formatAkbankAmount(request.price),
          currencyCode: getAkbankCurrencyCode(request.currency),
        },
        order: { orderId: request.paymentId },
      });
      const approved = data.responseCode === AKBANK_SUCCESS_CODE;

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: approved ? data.transaction?.rrn || data.transaction?.authCode : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : Akbank.errorOf(data)),
        rawResponse: data,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Void (txnCode 1003). `paymentId` is the order id.
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const data = await this.process({
        ...this.baseRequest(AKBANK_TXN_CODES.VOID),
        order: { orderId: request.paymentId },
      });
      const approved = data.responseCode === AKBANK_SUCCESS_CODE;

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        transactionId: approved ? data.transaction?.rrn : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : Akbank.errorOf(data)),
        rawResponse: data,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', {
        conversationId: request.conversationId,
      });
    }
  }
  /**
   * Capture of a pre-authorization (txnCode 1005). `amount` may be lower than
   * the authorized amount (partial capture).
   */
  async capture(request: CaptureRequest): Promise<PaymentResponse> {
    try {
      this.validateCapture(request);
      const data = await this.process({
        ...this.baseRequest(AKBANK_TXN_CODES.POST_AUTH),
        order: { orderId: request.paymentId },
        transaction: {
          amount: formatAkbankAmount(request.amount),
          currencyCode: getAkbankCurrencyCode(request.currency),
        },
        customer: { ipAddress: request.ip },
      });
      const approved = data.responseCode === AKBANK_SUCCESS_CODE;

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: request.paymentId,
        conversationId: request.conversationId ?? request.paymentId,
        ...(approved ? {} : Akbank.errorOf(data)),
        rawResponse: data,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Capture failed', {
        paymentId: request.paymentId,
        conversationId: request.conversationId ?? request.paymentId,
      });
    }
  }

  /** Releases a pre-authorization: Akbank voids it like any other transaction (txnCode 1003) */
  async voidAuthorization(request: VoidAuthorizationRequest): Promise<CancelResponse> {
    return this.cancel(request);
  }

  /**
   * Order status via order history (txnCode 1010)
   */
  /**
   * Not available: Akbank's Sanal POS API has no installment-rate query.
   * Installment plans come from your Akbank agreement; send `installment` in
   * the payment request and set `paidPrice` from your contracted rates.
   */
  async installmentInfo(_request: InstallmentInfoRequest): Promise<InstallmentInfoResponse> {
    throw new BetterPaymentError(
      "Akbank's Sanal POS API has no installment-rate query. Installment plans come from your Akbank agreement: send `installment` in the payment request and compute `paidPrice` from your contracted rates.",
      'NOT_SUPPORTED',
      'akbank'
    );
  }

  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const data = await this.process(
        {
          ...this.baseRequest(AKBANK_TXN_CODES.ORDER_HISTORY),
          order: { orderId: paymentId },
        },
        true
      );

      if (data.responseCode !== AKBANK_SUCCESS_CODE) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          paymentId,
          conversationId: paymentId,
          ...Akbank.errorOf(data),
          rawResponse: data,
        });
      }

      const list: AkbankTxnDetail[] = data.txnDetailList ?? [];
      const sale =
        list.find(
          (tx) =>
            tx.txnCode === AKBANK_TXN_CODES.SALE || tx.txnCode === AKBANK_TXN_CODES.SECURE_SALE
        ) ?? list[0];

      return this.withErrorCode({
        status: mapAkbankTxnStatus(sale),
        paymentId,
        conversationId: paymentId,
        errorMessage:
          sale && sale.responseCode !== AKBANK_SUCCESS_CODE ? sale.responseMessage : undefined,
        rawResponse: data,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Get payment failed', {
        paymentId,
        conversationId: paymentId,
      });
    }
  }
}

const PAYMENT_TXN_CODES: string[] = [
  AKBANK_TXN_CODES.SALE,
  AKBANK_TXN_CODES.SECURE_SALE,
  AKBANK_TXN_CODES.PRE_AUTH,
  AKBANK_TXN_CODES.SECURE_PRE_AUTH,
];

/** An approved, not reversed sale or pre-authorization of this order */
function isApprovedPayment(tx: AkbankTxnDetail, orderId: string | undefined): boolean {
  return (
    !!orderId &&
    (tx.orderId === undefined || tx.orderId === orderId) &&
    (tx.txnCode === undefined || PAYMENT_TXN_CODES.includes(tx.txnCode)) &&
    mapAkbankTxnStatus(tx) === PaymentStatus.SUCCESS
  );
}

/**
 * txnStatus: N = completed, V = voided, R = refunded, S = failed
 */
export function mapAkbankTxnStatus(tx: AkbankTxnDetail | undefined): PaymentStatus {
  if (!tx) return PaymentStatus.PENDING;
  if (tx.responseCode && tx.responseCode !== AKBANK_SUCCESS_CODE) return PaymentStatus.FAILURE;
  switch (tx.txnStatus) {
    case 'N':
      return PaymentStatus.SUCCESS;
    case 'V':
    case 'R':
      return PaymentStatus.CANCELLED;
    case 'S':
      return PaymentStatus.FAILURE;
    default:
      return tx.responseCode === AKBANK_SUCCESS_CODE
        ? PaymentStatus.SUCCESS
        : PaymentStatus.PENDING;
  }
}

/**
 * The Akbank provider, for `betterPayment({ providers: { akbank: akbank({ merchantSafeId, terminalSafeId, secretKey }) } })`.
 * The base URL follows `mode` unless `baseUrl` is set.
 */
export const akbank = (config: AkbankConfig): ProviderDefinition<Akbank> =>
  defineProvider((ctx) => {
    const options = withProviderDefaults(ProviderType.AKBANK, config, ctx);
    return new Akbank({ ...options, testMode: config.testMode ?? ctx.mode === 'sandbox' });
  });
