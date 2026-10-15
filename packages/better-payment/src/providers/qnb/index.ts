import {
  defineProvider,
  withProviderDefaults,
  ProviderType,
  type ProviderDefinition,
} from '../../core/BetterPaymentConfig';
import type { HttpClient } from '../../core/http';
import { PaymentProvider } from '../../core/PaymentProvider';
import { ConfigurationError, ValidationError } from '../../core/errors';
import { failureResult, FailureResult } from '../../core/failure';
import { ISO8583_ERROR_CODES, PaymentErrorCode } from '../../core/error-codes';
import { generateOrderId } from '../../core/utils';
import { randomHex } from '../../core/crypto';
import type { XmlValue } from '../parampos/utils';
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
  QNB_ENDPOINTS,
  QNB_MBR_ID,
  QNB_SECURE_TYPES,
  type QnbSecureType,
  createQnb3DHash,
  verifyQnbCallback,
  formatQnbAmount,
  getQnbCurrencyCode,
  formatQnbInstallment,
  formatQnbExpiry,
  validateQnbOrderId,
  buildQnbXml,
  parseQnbXmlResponse,
  isQnbApproved,
} from './utils';
import type { QnbConfig, Qnb3DCallbackData } from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * QNB virtual POS (PayFor)
 *
 * - createPayment():          XML `Auth` (NonSecure)
 * - initThreeDSPayment():     auto-submitting form to the 3D gateway (3DModel or 3DPay)
 * - completeThreeDSPayment(): verifies the ResponseHash; 3DModel charges with
 *                             `3DModelPayment`, 3DPay is confirmed with `OrderInquiry`
 * - refund() `Refund`, cancel() `Void`, getPayment() `OrderInquiry`
 *
 * `paymentId` is your order id: the `conversationId` you pass, or a generated one.
 */
export class Qnb extends PaymentProvider<QnbConfig> {
  private client: HttpClient;

  constructor(config: QnbConfig) {
    super(config);

    this.client = this.createHttpClient('qnb', {
      timeout: 30000,
      headers: { 'Content-Type': 'application/xml' },
    });
  }

  protected validateConfig(): void {
    const missing = (['merchantId', 'userCode', 'userPass', 'merchantPass'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(`QNB configuration is missing: ${missing.join(', ')}`, 'qnb');
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('QNB baseUrl is required', 'qnb');
    }
    if (this.config.secureType && !QNB_SECURE_TYPES.includes(this.config.secureType)) {
      throw new ConfigurationError(`Unknown QNB secureType: ${this.config.secureType}`, 'qnb');
    }
  }

  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return {
      ...ISO8583_ERROR_CODES,
      M030: PaymentErrorCode.PROVIDER_ERROR,
      V013: PaymentErrorCode.INVALID_REQUEST,
      V014: PaymentErrorCode.INVALID_REQUEST,
      V034: PaymentErrorCode.THREEDS_FAILED,
    };
  }

  private get secureType(): QnbSecureType {
    return this.config.secureType ?? '3DModel';
  }

  private get lang(): string {
    return (this.config.locale || 'tr').toLowerCase().startsWith('en') ? 'EN' : 'TR';
  }

  private get credentials() {
    return {
      merchantId: this.config.merchantId,
      merchantPass: this.config.merchantPass,
      userCode: this.config.userCode,
    };
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('QNB', error, fallback, extra));
  }

  private static errorOf(fields: Record<string, string | undefined>) {
    return {
      errorCode: fields.ProcReturnCode || undefined,
      errorMessage: fields.ErrMsg || undefined,
    };
  }

  private async api(
    fields: Record<string, XmlValue>,
    retryable = false
  ): Promise<Record<string, string>> {
    const response = await this.client.post<string>(
      QNB_ENDPOINTS.API,
      buildQnbXml({
        MbrId: QNB_MBR_ID,
        MerchantId: this.config.merchantId,
        UserCode: this.config.userCode,
        UserPass: this.config.userPass,
        ...fields,
        Lang: this.lang,
      }),
      { responseType: 'text', retryable }
    );
    return parseQnbXmlResponse(typeof response.data === 'string' ? response.data : '');
  }

  private orderInquiry(orderId: string): Promise<Record<string, string>> {
    return this.api(
      { OrgOrderId: orderId, SecureType: 'Inquiry', TxnType: 'OrderInquiry', Currency: '949' },
      true
    );
  }

  /**
   * Non-3D sale (XML `Auth`, NonSecure)
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      validateQnbOrderId(orderId);
      this.validatePayment(request, { card: true });
      const card = this.cardOf(request);
      const fields = await this.api({
        OrderId: orderId,
        SecureType: 'NonSecure',
        TxnType: 'Auth',
        InstallmentCount: formatQnbInstallment(request.installment),
        PurchAmount: formatQnbAmount(request.paidPrice ?? request.price),
        Currency: getQnbCurrencyCode(request.currency),
        CardHolderName: card.cardHolderName,
        Pan: card.cardNumber.replace(/\s/g, ''),
        Expiry: formatQnbExpiry(card.expireMonth, card.expireYear),
        Cvv2: card.cvc,
        MOTO: '0',
      });
      const approved = isQnbApproved(fields);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: orderId,
        conversationId: orderId,
        ...(approved ? {} : Qnb.errorOf(fields)),
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
   * 3D Secure payment: an auto-submitting form to the 3D gateway, signed with
   * the MerchantPass hash. The API password is never put in the form.
   */
  async initThreeDSPayment(
    request: ThreeDSPaymentRequest & { failUrl?: string }
  ): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      validateQnbOrderId(orderId);
      this.validatePayment(request, { card: true });
      const card = this.cardOf(request);
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }

      const fields: Record<string, string> = {
        MbrId: QNB_MBR_ID,
        MerchantID: this.config.merchantId,
        UserCode: this.config.userCode,
        SecureType: this.secureType,
        TxnType: 'Auth',
        InstallmentCount: formatQnbInstallment(request.installment),
        Currency: getQnbCurrencyCode(request.currency),
        OkUrl: request.callbackUrl,
        FailUrl: request.failUrl || request.callbackUrl,
        OrderId: orderId,
        PurchAmount: formatQnbAmount(request.paidPrice ?? request.price),
        Lang: this.lang,
        Rnd: randomHex(10),
        Pan: card.cardNumber.replace(/\s/g, ''),
        Expiry: formatQnbExpiry(card.expireMonth, card.expireYear),
        Cvv2: card.cvc,
        CardHolderName: card.cardHolderName,
      };
      fields.Hash = await createQnb3DHash({
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
      const action = `${this.config.baseUrl}${QNB_ENDPOINTS.GATE}`;
      const html =
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
        `<form id="qnb-3d-form" method="POST" action="${escapeHtml(action)}">${inputs}</form>` +
        '<script>document.getElementById("qnb-3d-form").submit();</script>' +
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
   * The ResponseHash joins its values without a separator, so a valid hash
   * alone does not pin each value; the result is confirmed with the bank:
   * 3DModel charges with `3DModelPayment` (the bank's answer decides), 3DPay
   * is checked with `OrderInquiry` (status Y, amount equal to the callback).
   * A callback with an invalid hash, for another merchant, or claiming a
   * payment the bank does not confirm is rejected as INVALID_HASH.
   *
   * `paymentId` and `conversationId` are set only for a payment the bank
   * confirmed, and on a timeout after the bank was reached for this order.
   */
  async completeThreeDSPayment(callbackData: Qnb3DCallbackData): Promise<PaymentResponse> {
    const untrusted = (errorMessage: string, rawResponse: unknown): PaymentResponse =>
      this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'INVALID_HASH',
        errorMessage,
        rawResponse,
      });

    if (!(await verifyQnbCallback(callbackData ?? {}, this.credentials))) {
      return untrusted('Invalid 3D Secure callback hash', callbackData);
    }
    const orderId = callbackData.OrderId!;
    if (
      callbackData.MerchantID !== undefined &&
      callbackData.MerchantID !== this.config.merchantId
    ) {
      return untrusted('Callback belongs to a different merchant', callbackData);
    }
    if (callbackData['3DStatus'] !== '1') {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: callbackData.ProcReturnCode || `MD_STATUS_${callbackData['3DStatus'] ?? ''}`,
        errorMessage: callbackData.ErrMsg || '3D Secure authentication failed',
        rawResponse: callbackData,
      });
    }

    let reached = false;
    try {
      validateQnbOrderId(orderId);

      if (this.secureType === '3DModel') {
        if (!callbackData.RequestGuid) {
          return untrusted('Callback has no RequestGuid', callbackData);
        }
        reached = true;
        const payment = await this.api({
          RequestGuid: callbackData.RequestGuid,
          OrderId: orderId,
          SecureType: '3DModelPayment',
        });
        if (!isQnbApproved(payment)) {
          return this.withErrorCode({
            status: PaymentStatus.FAILURE,
            ...Qnb.errorOf(payment),
            rawResponse: { callback: callbackData, payment },
          });
        }
        return this.withErrorCode({
          status: PaymentStatus.SUCCESS,
          paymentId: orderId,
          conversationId: orderId,
          rawResponse: { callback: callbackData, payment },
        });
      }

      // 3DPay: the bank already charged the card
      if (!isQnbApproved(callbackData)) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          ...Qnb.errorOf(callbackData),
          rawResponse: callbackData,
        });
      }
      reached = true;
      const inquiry = await this.orderInquiry(orderId);
      if (
        !isQnbCapturedSale(inquiry) ||
        (callbackData.PurchAmount !== undefined && inquiry.PurchAmount !== callbackData.PurchAmount)
      ) {
        return untrusted('3D Secure callback does not match the order at the bank', {
          callback: callbackData,
          inquiry,
        });
      }
      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        paymentId: orderId,
        conversationId: orderId,
        rawResponse: { callback: callbackData, inquiry },
      });
    } catch (error) {
      const result = this.failure<PaymentResponse>(error, '3D Secure completion failed');
      // A timeout after the bank was asked about this order: the outcome is
      // unknown, keep the ids so the order can be checked with getPayment()
      return reached && result.status === PaymentStatus.PENDING
        ? { ...result, paymentId: orderId, conversationId: orderId }
        : result;
    }
  }

  /**
   * Refund (XML `Refund`), for a sale of an earlier day; a lower amount is a
   * partial refund. `paymentId` is the order id.
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const fields = await this.api({
        OrgOrderId: request.paymentId,
        SecureType: 'NonSecure',
        TxnType: 'Refund',
        PurchAmount: formatQnbAmount(request.price),
        Currency: getQnbCurrencyCode(request.currency),
      });
      const approved = isQnbApproved(fields);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: approved ? fields.HostRefNum || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : Qnb.errorOf(fields)),
        rawResponse: fields,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Same-day cancel (XML `Void`). `paymentId` is the order id.
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const fields = await this.api({
        OrgOrderId: request.paymentId,
        SecureType: 'NonSecure',
        TxnType: 'Void',
        Currency: getQnbCurrencyCode(request.currency),
      });
      const approved = isQnbApproved(fields);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        transactionId: approved ? fields.HostRefNum || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : Qnb.errorOf(fields)),
        rawResponse: fields,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Order status via `OrderInquiry`. `paymentId` is the order id.
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const inquiry = await this.orderInquiry(paymentId);
      if (!isQnbApproved(inquiry)) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          paymentId,
          conversationId: paymentId,
          ...Qnb.errorOf(inquiry),
          rawResponse: inquiry,
        });
      }
      return this.withErrorCode({
        status: mapQnbOrderStatus(inquiry),
        paymentId,
        conversationId: paymentId,
        rawResponse: inquiry,
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
 * OrderInquiry: TxnStatus Y (approved), V (voided); IsVoided / IsRefunded mark
 * cancelled or refunded sales
 */
export function mapQnbOrderStatus(inquiry: Record<string, string | undefined>): PaymentStatus {
  if (inquiry.IsVoided === 'true' || inquiry.IsRefunded === 'true' || inquiry.TxnStatus === 'V') {
    return PaymentStatus.CANCELLED;
  }
  if (inquiry.TxnStatus === 'Y' && inquiry.TxnResult === 'Success') return PaymentStatus.SUCCESS;
  if (inquiry.TxnResult === 'Failed') return PaymentStatus.FAILURE;
  return PaymentStatus.PENDING;
}

/** An approved, not cancelled sale in an OrderInquiry answer */
export function isQnbCapturedSale(inquiry: Record<string, string | undefined>): boolean {
  return isQnbApproved(inquiry) && mapQnbOrderStatus(inquiry) === PaymentStatus.SUCCESS;
}

/**
 * The QNB provider, for
 * `betterPayment({ providers: { qnb: qnb({ merchantId, userCode, userPass, merchantPass }) } })`.
 * The base URL follows `mode` unless `baseUrl` is set.
 */
export const qnb = (config: QnbConfig): ProviderDefinition<Qnb> =>
  defineProvider((ctx) => new Qnb(withProviderDefaults(ProviderType.QNB, config, ctx)));
