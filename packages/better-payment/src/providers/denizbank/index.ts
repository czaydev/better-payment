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
import { ISO8583_ERROR_CODES, PaymentErrorCode } from '../../core/error-codes';
import { generateOrderId } from '../../core/utils';
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
  PaymentStatus,
} from '../../types';
import {
  DENIZBANK_ENDPOINT,
  createDenizbank3DHash,
  verifyDenizbankCallback,
  formatDenizbankAmount,
  getDenizbankCurrencyCode,
  formatDenizbankInstallment,
  formatDenizbankExpiry,
  getDenizbankCardType,
  parseDenizbankResponse,
  isDenizbankApproved,
} from './utils';
import type { DenizbankConfig, Denizbank3DCallbackData } from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Denizbank virtual POS (InterVPos), 3D Model
 *
 * - createPayment():          `Auth` (NonSecure)
 * - initThreeDSPayment():     auto-submitting form to InterVPos (SecureType 3DModel)
 * - completeThreeDSPayment(): verifies the callback HASH, then charges with `Auth`
 *                             carrying the 3D Secure data (the bank's answer decides)
 * - refund() `Refund`, cancel() `Void`
 *
 * `paymentId` is your order id: the `conversationId` you pass, or a generated one.
 */
export class Denizbank extends PaymentProvider<DenizbankConfig> {
  private client: HttpClient;

  constructor(config: DenizbankConfig) {
    super(config);

    this.client = this.createHttpClient('denizbank', {
      timeout: 30000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }

  protected validateConfig(): void {
    const missing = (['shopCode', 'userCode', 'userPass', 'merchantPass'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(
        `Denizbank configuration is missing: ${missing.join(', ')}`,
        'denizbank'
      );
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('Denizbank baseUrl is required', 'denizbank');
    }
    // 3D Pay is not supported: its callback would be the only proof of payment, and
    // the HASH joins the values without separators, so it cannot bind the order
    const secureType = (this.config as { secureType?: string }).secureType;
    if (secureType !== undefined && secureType !== '3DModel') {
      throw new ConfigurationError(
        `Denizbank secureType ${secureType} is not supported; only the 3D Model is`,
        'denizbank'
      );
    }
  }

  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return ISO8583_ERROR_CODES;
  }

  private get lang(): string {
    return (this.config.locale || 'tr').toLowerCase().startsWith('en') ? 'EN' : 'TR';
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('Denizbank', error, fallback, extra));
  }

  private static errorOf(fields: Record<string, string | undefined>) {
    return {
      errorCode: fields.ProcReturnCode || undefined,
      errorMessage: fields.ErrorMessage || fields.ErrMsg || undefined,
    };
  }

  /** Form POST to InterVPos with the API user */
  private async api(fields: Record<string, string>): Promise<Record<string, string>> {
    const body = new URLSearchParams({
      ShopCode: this.config.shopCode,
      UserCode: this.config.userCode,
      UserPass: this.config.userPass,
      ...fields,
      Lang: this.lang,
    });
    const response = await this.client.post<string>(DENIZBANK_ENDPOINT, body.toString(), {
      responseType: 'text',
    });
    return parseDenizbankResponse(typeof response.data === 'string' ? response.data : '');
  }

  /**
   * Non-3D sale (`Auth`, NonSecure)
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, { card: true });
      const card = this.cardOf(request);
      const cardNumber = card.cardNumber.replace(/\s/g, '');
      const fields = await this.api({
        TxnType: 'Auth',
        SecureType: 'NonSecure',
        OrderId: orderId,
        PurchAmount: formatDenizbankAmount(request.paidPrice ?? request.price),
        Currency: getDenizbankCurrencyCode(request.currency),
        InstallmentCount: formatDenizbankInstallment(request.installment),
        CardType: getDenizbankCardType(cardNumber),
        Pan: cardNumber,
        Expiry: formatDenizbankExpiry(card.expireMonth, card.expireYear),
        Cvv2: card.cvc,
        MOTO: '0',
      });
      const approved = isDenizbankApproved(fields);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: orderId,
        conversationId: orderId,
        ...(approved ? {} : Denizbank.errorOf(fields)),
        rawResponse: fields,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Payment failed', {
        paymentId: orderId,
        conversationId: orderId,
      });
    }
  }

  /**
   * 3D Secure payment (3D Model): an auto-submitting form to InterVPos, signed
   * with the store key hash. The API password is not put in the form.
   */
  async initThreeDSPayment(
    request: ThreeDSPaymentRequest & { failUrl?: string }
  ): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, { card: true });
      const card = this.cardOf(request);
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }
      const cardNumber = card.cardNumber.replace(/\s/g, '');

      const fields: Record<string, string> = {
        Version3D: '2.0',
        ShopCode: this.config.shopCode,
        TxnType: 'Auth',
        SecureType: '3DModel',
        PurchAmount: formatDenizbankAmount(request.paidPrice ?? request.price),
        OrderId: orderId,
        OkUrl: request.callbackUrl,
        FailUrl: request.failUrl || request.callbackUrl,
        Rnd: randomHex(16),
        Lang: this.lang,
        Currency: getDenizbankCurrencyCode(request.currency),
        InstallmentCount: formatDenizbankInstallment(request.installment),
        CardType: getDenizbankCardType(cardNumber),
        Pan: cardNumber,
        Expiry: formatDenizbankExpiry(card.expireMonth, card.expireYear),
        Cvv2: card.cvc,
      };
      fields.Hash = await createDenizbank3DHash({
        shopCode: this.config.shopCode,
        orderId,
        amount: fields.PurchAmount,
        okUrl: fields.OkUrl,
        failUrl: fields.FailUrl,
        txnType: fields.TxnType,
        installment: fields.InstallmentCount,
        rnd: fields.Rnd,
        merchantPass: this.config.merchantPass,
      });

      const inputs = Object.entries(fields)
        .map(
          ([name, value]) =>
            `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
        )
        .join('');
      const action = `${this.config.baseUrl}${DENIZBANK_ENDPOINT}`;
      const html =
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
        `<form id="denizbank-3d-form" method="POST" action="${escapeHtml(action)}">${inputs}</form>` +
        '<script>document.getElementById("denizbank-3d-form").submit();</script>' +
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
   * Completes the payment after the OkUrl / FailUrl POST.
   *
   * The HASH is rebuilt from the fields named in HASHPARAMS and must cover
   * OrderId. Its values are joined without a separator, so a valid hash alone
   * does not pin each value: the card is charged with `Auth` carrying the
   * callback's 3D Secure data (MD, PayerTxnId, Eci, PayerAuthenticationCode),
   * and the bank's answer decides. A callback with an invalid hash or for
   * another shop is rejected as INVALID_HASH.
   *
   * `paymentId` and `conversationId` are set only for a payment the bank
   * approved, and on a timeout after the bank was reached.
   */
  async completeThreeDSPayment(callbackData: Denizbank3DCallbackData): Promise<PaymentResponse> {
    const untrusted = (errorMessage: string): PaymentResponse =>
      this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'INVALID_HASH',
        errorMessage,
        rawResponse: callbackData,
      });

    if (!(await verifyDenizbankCallback(callbackData ?? {}, this.config.merchantPass))) {
      return untrusted('Invalid 3D Secure callback hash');
    }
    const orderId = callbackData.OrderId!;
    if (callbackData.ShopCode !== undefined && callbackData.ShopCode !== this.config.shopCode) {
      return untrusted('Callback belongs to a different shop');
    }
    if (
      (callbackData['3DStatus'] !== undefined && callbackData['3DStatus'] !== '1') ||
      !callbackData.MD
    ) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: callbackData.ProcReturnCode || `MD_STATUS_${callbackData['3DStatus'] ?? ''}`,
        errorMessage: callbackData.ErrorMessage || '3D Secure authentication failed',
        rawResponse: callbackData,
      });
    }

    let reached = false;
    try {
      reached = true;
      const payment = await this.api({
        TxnType: 'Auth',
        SecureType: 'NonSecure',
        OrderId: orderId,
        PurchAmount: callbackData.PurchAmount ?? '',
        Currency: callbackData.Currency ?? '',
        InstallmentCount: callbackData.InstallmentCount ?? '',
        MD: callbackData.MD,
        PayerTxnId: callbackData.PayerTxnId ?? '',
        Eci: callbackData.Eci ?? '',
        PayerAuthenticationCode: callbackData.PayerAuthenticationCode ?? '',
        MOTO: '0',
      });
      if (!isDenizbankApproved(payment)) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          ...Denizbank.errorOf(payment),
          rawResponse: { callback: callbackData, payment },
        });
      }
      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        paymentId: orderId,
        conversationId: orderId,
        rawResponse: { callback: callbackData, payment },
      });
    } catch (error) {
      const result = this.failure<PaymentResponse>(error, '3D Secure completion failed');
      return reached && result.status === PaymentStatus.PENDING
        ? { ...result, paymentId: orderId, conversationId: orderId }
        : result;
    }
  }

  /**
   * Refund (`Refund`); a lower amount is a partial refund. `paymentId` is the order id.
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const fields = await this.api({
        TxnType: 'Refund',
        SecureType: 'NonSecure',
        orgOrderId: request.paymentId,
        PurchAmount: formatDenizbankAmount(request.price),
        Currency: getDenizbankCurrencyCode(request.currency),
        MOTO: '0',
      });
      const approved = isDenizbankApproved(fields);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: approved ? fields.TransId || fields.HostRefNum || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : Denizbank.errorOf(fields)),
        rawResponse: fields,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Same-day cancel (`Void`). `paymentId` is the order id.
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const fields = await this.api({
        TxnType: 'Void',
        SecureType: 'NonSecure',
        orgOrderId: request.paymentId,
      });
      const approved = isDenizbankApproved(fields);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        transactionId: approved ? fields.TransId || fields.HostRefNum || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : Denizbank.errorOf(fields)),
        rawResponse: fields,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Not available yet: the InterVPos status query (`StatusHistory`) answer
   * could not be verified.
   */
  async getPayment(_paymentId: string): Promise<PaymentResponse> {
    throw new BetterPaymentError(
      'Order status queries are not supported for Denizbank yet.',
      'NOT_SUPPORTED',
      'denizbank'
    );
  }
}

/**
 * The Denizbank provider, for
 * `betterPayment({ providers: { denizbank: denizbank({ shopCode, userCode, userPass, merchantPass }) } })`.
 * The base URL follows `mode` unless `baseUrl` is set.
 */
export const denizbank = (config: DenizbankConfig): ProviderDefinition<Denizbank> =>
  defineProvider((ctx) => new Denizbank(withProviderDefaults(ProviderType.DENIZBANK, config, ctx)));
