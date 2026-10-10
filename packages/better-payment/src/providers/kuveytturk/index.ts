import {
  defineProvider,
  withProviderDefaults,
  ProviderType,
  type ProviderDefinition,
} from '../../core/BetterPaymentConfig';
import type { HttpClient } from '../../core/http';
import { PaymentProvider } from '../../core/PaymentProvider';
import { BetterPaymentError, ConfigurationError, ValidationError } from '../../core/errors';
import { failureResult, FailureResult } from '../../core/failure';
import type { PaymentValidationRules } from '../../core/validation';
import { ISO8583_ERROR_CODES, PaymentErrorCode } from '../../core/error-codes';
import { generateOrderId, toMinorUnits } from '../../core/utils';
import {
  PaymentRequest,
  PaymentResponse,
  ThreeDSPaymentRequest,
  ThreeDSInitResponse,
  RefundRequest,
  RefundResponse,
  CancelRequest,
  CancelResponse,
  PaymentStatus,
} from '../../types';
import {
  KUVEYTTURK_ENDPOINTS,
  KUVEYTTURK_SALE_REVERSAL_TYPES,
  type KuveytTurkSaleReversalType,
  createKuveytTurkPaymentHash,
  createKuveytTurkProvisionHash,
  createKuveytTurkSaleReversalHash,
  createKuveytTurkGetTransactionsHash,
  formatKuveytTurkAmount,
  formatKuveytTurkExpiry,
  formatKuveytTurkInstallment,
  getKuveytTurkCurrencyCode,
  getKuveytTurkLanguage,
  parseKuveytTurkPhone,
  parseKuveytTurkForm,
  kuveytTurkStatusCode,
} from './utils';
import type {
  KuveytTurkConfig,
  KuveytTurkApiResponse,
  KuveytTurkTransaction,
  KuveytTurkTransactionList,
  KuveytTurk3DCallbackData,
} from './types';

const KUVEYTTURK_CARD_RULES: PaymentValidationRules = {
  card: true,
  required: ['buyer.ip', 'buyer.email', 'buyer.gsmNumber'],
};

/**
 * Kuveyt Türk Sanal POS (KT Pay Gate, JSON API)
 *
 * - initThreeDSPayment():     Payment; returns the bank's 3D Secure page (HTML)
 * - completeThreeDSPayment(): checks the successUrl POST, then charges with Provision
 * - cancel():                 SaleReversal "Cancel" (same day, before end of day)
 * - refund():                 SaleReversal "Drawback" (full) or "PartialDrawback"
 * - getPayment():             GetTransactions by merchant order id
 *
 * `paymentId` is the merchant order id (`conversationId`, or a generated one).
 * The bank's own order id is looked up with GetTransactions where it is needed.
 */
export class KuveytTurk extends PaymentProvider<KuveytTurkConfig> {
  private client: HttpClient;

  constructor(config: KuveytTurkConfig) {
    super(config);

    this.client = this.createHttpClient('kuveytturk', {
      timeout: 30000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
  }

  protected validateConfig(): void {
    const missing = (['merchantId', 'customerId', 'username', 'password'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(
        `Kuveyt Türk configuration is missing: ${missing.join(', ')}`,
        'kuveytturk'
      );
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('Kuveyt Türk baseUrl is required', 'kuveytturk');
    }
  }

  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return {
      ...ISO8583_ERROR_CODES,
      RequestValidationError: PaymentErrorCode.INVALID_REQUEST,
      InvalidTransaction: PaymentErrorCode.INVALID_REQUEST,
      OrderIdNotFound: PaymentErrorCode.INVALID_REQUEST,
      MetaDataNotFound: PaymentErrorCode.THREEDS_FAILED,
      // A request signed with the wrong API password, not a forged callback
      HashDataError: PaymentErrorCode.PROVIDER_ERROR,
      ApiUserNotDefined: PaymentErrorCode.PROVIDER_ERROR,
      TechnicalException: PaymentErrorCode.PROVIDER_ERROR,
    };
  }

  private get credentials() {
    return {
      merchantId: this.config.merchantId,
      username: this.config.username,
      password: this.config.password,
    };
  }

  private get account() {
    return {
      merchantId: this.config.merchantId,
      customerId: this.config.customerId,
      username: this.config.username,
    };
  }

  private async post<T>(
    endpoint: string,
    body: Record<string, unknown>,
    retryable = false
  ): Promise<KuveytTurkApiResponse<T>> {
    const response = await this.client.post<KuveytTurkApiResponse<T>>(
      endpoint,
      JSON.stringify(body),
      { retryable, validateStatus: (status) => status < 500 }
    );
    return response.data ?? {};
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('Kuveyt Türk', error, fallback, extra));
  }

  private static errorOf(data: { ResponseCode?: string; ResponseMessage?: string }) {
    return { errorCode: data.ResponseCode, errorMessage: data.ResponseMessage };
  }

  /**
   * A transaction of a merchant order id. The bank's order id, amount and
   * status come from here: callbacks are not signed. With `orderId`, only the
   * transaction with that bank order id; otherwise the successful sale, if any.
   */
  private async findTransaction(
    merchantOrderId: string,
    orderId?: string
  ): Promise<{
    data: KuveytTurkApiResponse<KuveytTurkTransactionList>;
    tx?: KuveytTurkTransaction;
  }> {
    const data = await this.post<KuveytTurkTransactionList>(
      KUVEYTTURK_ENDPOINTS.GET_TRANSACTIONS,
      {
        ...this.account,
        merchantOrderId,
        hashData: await createKuveytTurkGetTransactionsHash(this.credentials, { merchantOrderId }),
      },
      true
    );
    // Guard against a response that ignores the filter: never pick another order
    const list = (data.Result?.Transactions ?? []).filter(
      (item) => item.MerchantOrderId === merchantOrderId
    );
    const tx =
      orderId !== undefined
        ? list.find((item) => String(item.OrderId) === orderId)
        : (list.find((item) => kuveytTurkStatusCode(item.TransactionStatus) === 1) ?? list[0]);
    return { data, tx };
  }

  /**
   * Not available: KT Pay Gate only processes 3D Secure payments.
   */
  async createPayment(_request: PaymentRequest): Promise<PaymentResponse> {
    throw new BetterPaymentError(
      'Kuveyt Türk KT Pay Gate only processes 3D Secure payments: use initThreeDSPayment().',
      'NOT_SUPPORTED',
      'kuveytturk'
    );
  }

  /**
   * 3D Secure payment: sends the card to the Payment endpoint and returns the
   * bank's verification page. The bank posts the result to callbackUrl
   * (successUrl) or failUrl; complete it with completeThreeDSPayment().
   */
  async initThreeDSPayment(
    request: ThreeDSPaymentRequest & { failUrl?: string }
  ): Promise<ThreeDSInitResponse> {
    const merchantOrderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, KUVEYTTURK_CARD_RULES);
      const card = this.cardOf(request);
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }
      const successUrl = request.callbackUrl;
      const failUrl = request.failUrl || request.callbackUrl;
      if (successUrl.includes('&') || failUrl.includes('&')) {
        throw new ValidationError(
          'Kuveyt Türk does not accept "&" in callback URLs; use a single query parameter or a path segment'
        );
      }

      const amount = formatKuveytTurkAmount(request.paidPrice ?? request.price);
      const phone = parseKuveytTurkPhone(request.buyer.gsmNumber);
      const body = {
        language: getKuveytTurkLanguage(this.config.locale),
        merchantOrderId,
        successUrl,
        failUrl,
        ...this.account,
        hashData: await createKuveytTurkPaymentHash(this.credentials, {
          merchantOrderId,
          amount,
          successUrl,
          failUrl,
        }),
        amount,
        currency: getKuveytTurkCurrencyCode(request.currency),
        installmentCount: formatKuveytTurkInstallment(request.installment),
        paymentType: this.config.paymentType ?? 1,
        customer: {
          fullName: `${request.buyer.name} ${request.buyer.surname}`.trim(),
          cc: phone.cc,
          subscriber: phone.subscriber,
          email: request.buyer.email,
          identityNumber: request.buyer.identityNumber || undefined,
          ipAddress: request.buyer.ip,
        },
        card: {
          cardHolderName: card.cardHolderName,
          cardNumber: card.cardNumber.replace(/\s/g, ''),
          ...formatKuveytTurkExpiry(card.expireMonth, card.expireYear),
          securityCode: card.cvc,
        },
      };

      // Payment answers with HTML: the 3D Secure page, or an auto-submitting
      // form to failUrl when the request is rejected
      const response = await this.client.post<string>(
        KUVEYTTURK_ENDPOINTS.PAYMENT,
        JSON.stringify(body),
        { responseType: 'text', validateStatus: (status) => status < 500 }
      );
      const html = typeof response.data === 'string' ? response.data : '';
      const fields = parseKuveytTurkForm(html);

      if (!html.trim() || fields.Success?.toLowerCase() === 'false') {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          paymentId: merchantOrderId,
          conversationId: merchantOrderId,
          errorCode: fields.ResponseCode || 'PROVIDER_ERROR',
          errorMessage: fields.ResponseMessage || 'Kuveyt Türk returned an empty response',
          rawResponse: fields,
        });
      }

      return this.withErrorCode({
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: html,
        paymentId: merchantOrderId,
        conversationId: merchantOrderId,
      });
    } catch (error) {
      return this.failure<ThreeDSInitResponse>(error, '3DS initialization failed', {
        paymentId: merchantOrderId,
        conversationId: merchantOrderId,
      });
    }
  }

  /**
   * Completes the payment after the successUrl POST.
   *
   * The callback is not signed, so it is never trusted on its own: the order is
   * looked up at the bank, the bank's order id must match, and the payment
   * succeeds only when Provision (which charges the card) succeeds. The amount
   * sent with Provision is the bank's recorded amount, not a callback field.
   *
   * `paymentId` and `conversationId` are set only once the order is confirmed
   * at the bank: on success, and on a timeout after the order was confirmed
   * (the outcome is then unknown). A failure never carries ids taken from the
   * callback, so a forged callback cannot name an existing order. A callback
   * that does not match an order at the bank is rejected as INVALID_HASH.
   */
  async completeThreeDSPayment(callbackData: KuveytTurk3DCallbackData): Promise<PaymentResponse> {
    const untrusted = (errorMessage: string, rawResponse: unknown): PaymentResponse =>
      this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'INVALID_HASH',
        errorMessage,
        rawResponse,
      });

    if (callbackData?.Success?.toLowerCase() !== 'true') {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: callbackData?.ResponseCode || 'INVALID_CALLBACK',
        errorMessage: callbackData?.ResponseMessage || '3D Secure verification failed',
        rawResponse: callbackData,
      });
    }

    const merchantOrderId = callbackData.MerchantOrderId;
    const orderId = callbackData.OrderId;
    const md = callbackData.MD;
    if (!merchantOrderId || !orderId || !md) {
      return untrusted('Callback is missing MerchantOrderId, OrderId or MD', callbackData);
    }

    let confirmed = false;
    try {
      const { data, tx } = await this.findTransaction(merchantOrderId, orderId);
      if (!tx || typeof tx.FirstAmount !== 'number') {
        return untrusted('The callback does not match a Kuveyt Türk transaction', {
          callback: callbackData,
          transactions: data,
        });
      }
      confirmed = true;

      const amount = String(Math.round(tx.FirstAmount));
      const provision = await this.post(KUVEYTTURK_ENDPOINTS.PROVISION, {
        ...this.account,
        merchantOrderId,
        orderId,
        amount,
        md,
        hashData: await createKuveytTurkProvisionHash(this.credentials, {
          merchantOrderId,
          amount,
        }),
      });

      if (provision.Success !== true) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          ...KuveytTurk.errorOf(provision),
          rawResponse: { callback: callbackData, provision },
        });
      }

      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        paymentId: merchantOrderId,
        conversationId: merchantOrderId,
        rawResponse: { callback: callbackData, provision },
      });
    } catch (error) {
      const result = this.failure<PaymentResponse>(error, '3D Secure completion failed');
      // A timeout after the order was confirmed leaves the outcome unknown:
      // keep the confirmed ids so the order can be checked with getPayment()
      return confirmed && result.status === PaymentStatus.PENDING
        ? { ...result, paymentId: merchantOrderId, conversationId: merchantOrderId }
        : result;
    }
  }

  private async saleReversal(
    merchantOrderId: string,
    type: KuveytTurkSaleReversalType,
    amount: string,
    tx: KuveytTurkTransaction
  ): Promise<KuveytTurkApiResponse> {
    return this.post(KUVEYTTURK_ENDPOINTS.SALE_REVERSAL, {
      ...this.account,
      merchantOrderId,
      orderId: String(tx.OrderId),
      saleReversalType: type,
      amount,
      hashData: await createKuveytTurkSaleReversalHash(this.credentials, {
        merchantOrderId,
        type,
        amount,
      }),
    });
  }

  private static notFound(data: KuveytTurkApiResponse) {
    return data.Success === false
      ? KuveytTurk.errorOf(data)
      : {
          errorCode: 'OrderIdNotFound',
          errorMessage: 'No Kuveyt Türk transaction for this order id',
        };
  }

  /**
   * Refund after end of day. `paymentId` is the merchant order id. Refunding
   * the whole amount sends "Drawback", a lower amount "PartialDrawback".
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const { data, tx } = await this.findTransaction(request.paymentId);
      if (!tx) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          conversationId: request.conversationId,
          ...KuveytTurk.notFound(data),
          rawResponse: data,
        });
      }

      const amount = toMinorUnits(request.price);
      const full = !tx.DrawbackAmount && amount === Math.round(tx.FirstAmount ?? NaN);
      const type = full
        ? KUVEYTTURK_SALE_REVERSAL_TYPES.DRAWBACK
        : KUVEYTTURK_SALE_REVERSAL_TYPES.PARTIAL_DRAWBACK;
      const result = await this.saleReversal(request.paymentId, type, String(amount), tx);
      const approved = result.Success === true;

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: approved ? result.BusinessKey || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : KuveytTurk.errorOf(result)),
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Same-day void ("Cancel"), before end of day. `paymentId` is the merchant order id.
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const { data, tx } = await this.findTransaction(request.paymentId);
      if (!tx) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          conversationId: request.conversationId,
          ...KuveytTurk.notFound(data),
          rawResponse: data,
        });
      }

      const amount = request.price
        ? formatKuveytTurkAmount(request.price)
        : String(Math.round(tx.FirstAmount ?? 0));
      const result = await this.saleReversal(
        request.paymentId,
        KUVEYTTURK_SALE_REVERSAL_TYPES.CANCEL,
        amount,
        tx
      );
      const approved = result.Success === true;

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        transactionId: approved ? result.BusinessKey || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : KuveytTurk.errorOf(result)),
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Order status via GetTransactions. `paymentId` is the merchant order id.
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const { data, tx } = await this.findTransaction(paymentId);

      if (data.Success !== true) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          paymentId,
          conversationId: paymentId,
          ...KuveytTurk.errorOf(data),
          rawResponse: data,
        });
      }

      const status = mapKuveytTurkTransactionStatus(tx);
      return this.withErrorCode({
        status,
        paymentId,
        conversationId: paymentId,
        ...(status === PaymentStatus.FAILURE
          ? { errorCode: tx?.ResponseCode || undefined, errorMessage: tx?.ResponseExplain }
          : {}),
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

/**
 * TransactionStatus: "Başarılı (1)", "Başarısız (2)", "Zaman Aşımı (3)".
 * A fully cancelled or refunded sale is reported as cancelled.
 */
export function mapKuveytTurkTransactionStatus(
  tx: KuveytTurkTransaction | undefined
): PaymentStatus {
  if (!tx) return PaymentStatus.PENDING;
  switch (kuveytTurkStatusCode(tx.TransactionStatus)) {
    case 1: {
      const first = tx.FirstAmount ?? 0;
      const reversed = (tx.CancelAmount ?? 0) + (tx.DrawbackAmount ?? 0);
      return first > 0 && reversed >= first ? PaymentStatus.CANCELLED : PaymentStatus.SUCCESS;
    }
    case 2:
    case 3:
      return PaymentStatus.FAILURE;
    default:
      return PaymentStatus.PENDING;
  }
}

/**
 * The Kuveyt Türk provider, for
 * `betterPayment({ providers: { kuveytturk: kuveytturk({ merchantId, customerId, username, password }) } })`.
 * The base URL follows `mode` unless `baseUrl` is set.
 */
export const kuveytturk = (config: KuveytTurkConfig): ProviderDefinition<KuveytTurk> =>
  defineProvider(
    (ctx) => new KuveytTurk(withProviderDefaults(ProviderType.KUVEYTTURK, config, ctx))
  );
