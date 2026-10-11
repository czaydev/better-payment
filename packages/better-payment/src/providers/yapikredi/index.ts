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
  YAPIKREDI_ENDPOINTS,
  type YapiKrediXmlResponse,
  formatYapiKrediAmount,
  getYapiKrediCurrencyCode,
  formatYapiKrediInstallment,
  formatYapiKrediExpiry,
  toYapiKrediXid,
  createYapiKrediMac,
  buildYapiKrediRequestBody,
  parseYapiKrediXmlResponse,
  isYapiKrediApproved,
} from './utils';
import type { YapiKrediConfig, YapiKrediCompleteRequest } from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Yapı Kredi virtual POS (Posnet XML API)
 *
 * - createPayment():          XML `sale` (non-3D)
 * - initThreeDSPayment():     `oosRequestData`, then an auto-submitting form to the
 *                             3D service with the bank's encrypted data
 * - completeThreeDSPayment(): `oosResolveMerchantData` then `oosTranData`, both
 *                             signed with a MAC over your order id, amount and currency
 * - refund() `return`, cancel() `reverse`
 *
 * `paymentId` of a successful payment is the bank's host log key, which refund()
 * and cancel() take; `conversationId` is your order id (at most 20 letters or digits).
 */
export class YapiKredi extends PaymentProvider<YapiKrediConfig> {
  private client: HttpClient;

  constructor(config: YapiKrediConfig) {
    super(config);

    this.client = this.createHttpClient('yapikredi', {
      timeout: 30000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    });
  }

  protected validateConfig(): void {
    const missing = (['merchantId', 'terminalId', 'posnetId', 'encKey'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(
        `Yapı Kredi configuration is missing: ${missing.join(', ')}`,
        'yapikredi'
      );
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('Yapı Kredi baseUrl is required', 'yapikredi');
    }
  }

  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return ISO8583_ERROR_CODES;
  }

  private get lang(): string {
    return (this.config.locale || 'tr').toLowerCase().startsWith('en') ? 'en' : 'tr';
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('Yapı Kredi', error, fallback, extra));
  }

  private static errorOf(result: YapiKrediXmlResponse) {
    return {
      errorCode: result.fields.respCode || undefined,
      errorMessage: result.fields.respText || undefined,
    };
  }

  private async api(fields: Record<string, XmlValue>): Promise<YapiKrediXmlResponse> {
    const response = await this.client.post<string>(
      YAPIKREDI_ENDPOINTS.API,
      buildYapiKrediRequestBody({
        mid: this.config.merchantId,
        tid: this.config.terminalId,
        ...fields,
      }),
      { responseType: 'text' }
    );
    return parseYapiKrediXmlResponse(typeof response.data === 'string' ? response.data : '');
  }

  /**
   * Non-3D sale (XML `sale`)
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, { card: true });
      const card = this.cardOf(request);
      const result = await this.api({
        tranDateRequired: '1',
        sale: {
          amount: formatYapiKrediAmount(request.paidPrice ?? request.price),
          ccno: card.cardNumber.replace(/\s/g, ''),
          currencyCode: getYapiKrediCurrencyCode(request.currency),
          cvc: card.cvc,
          expDate: formatYapiKrediExpiry(card.expireMonth, card.expireYear),
          installment: formatYapiKrediInstallment(request.installment),
          orderID: toYapiKrediXid(orderId),
        },
      });
      const approved = isYapiKrediApproved(result);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: approved ? result.fields.hostlogkey : undefined,
        conversationId: orderId,
        ...(approved ? {} : YapiKredi.errorOf(result)),
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Payment failed', { conversationId: orderId });
    }
  }

  /**
   * 3D Secure payment: the card is sent to `oosRequestData`, and the bank's
   * encrypted answer is posted from the customer's browser to the 3D service.
   */
  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, { card: true });
      const card = this.cardOf(request);
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }

      const result = await this.api({
        oosRequestData: {
          posnetid: this.config.posnetId,
          ccno: card.cardNumber.replace(/\s/g, ''),
          expDate: formatYapiKrediExpiry(card.expireMonth, card.expireYear),
          cvc: card.cvc,
          amount: formatYapiKrediAmount(request.paidPrice ?? request.price),
          currencyCode: getYapiKrediCurrencyCode(request.currency),
          installment: formatYapiKrediInstallment(request.installment),
          XID: toYapiKrediXid(orderId),
          cardHolderName: card.cardHolderName,
          tranType: 'Sale',
        },
      });
      const { data1, data2, sign } = result.oosRequestData;
      if (!isYapiKrediApproved(result) || !data1 || !data2 || !sign) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          conversationId: orderId,
          ...YapiKredi.errorOf(result),
          rawResponse: result,
        });
      }

      const fields: Record<string, string> = {
        mid: this.config.merchantId,
        posnetID: this.config.posnetId,
        posnetData: data1,
        posnetData2: data2,
        digest: sign,
        merchantReturnURL: request.callbackUrl,
        lang: this.lang,
        url: '',
        vftCode: '',
        useJokerVadaa: '1',
      };
      const inputs = Object.entries(fields)
        .map(
          ([name, value]) =>
            `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
        )
        .join('');
      const action = `${this.config.baseUrl}${YAPIKREDI_ENDPOINTS.GATE}`;
      const html =
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
        `<form id="yapikredi-3d-form" method="POST" action="${escapeHtml(action)}">${inputs}</form>` +
        '<script>document.getElementById("yapikredi-3d-form").submit();</script>' +
        '</body></html>';

      return this.withErrorCode({
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: html,
        conversationId: orderId,
      });
    } catch (error) {
      return this.failure<ThreeDSInitResponse>(error, '3DS initialization failed', {
        conversationId: orderId,
      });
    }
  }

  /**
   * Completes the payment after the merchantReturnURL POST.
   *
   * Pass the callback together with the order from your own records:
   * `completeThreeDSPayment({ ...callbackBody, orderId, amount, currency })`.
   * The bank resolves its encrypted packets with `oosResolveMerchantData`; the
   * MAC over your order id, amount and currency must match, and the resolved
   * XID, amount and currency must equal your order. The card is charged with
   * `oosTranData` only when mdStatus is 1, and the bank's answer decides.
   *
   * `paymentId` (host log key) and `conversationId` are set only for a payment
   * the bank approved, and on a timeout after the bank was reached.
   */
  async completeThreeDSPayment(callbackData: YapiKrediCompleteRequest): Promise<PaymentResponse> {
    const { BankPacket, MerchantPacket, Sign, orderId, amount } = callbackData ?? {};
    if (!BankPacket || !MerchantPacket || !Sign) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'INVALID_HASH',
        errorMessage: 'Callback is missing BankPacket, MerchantPacket or Sign',
        rawResponse: callbackData,
      });
    }
    if (!orderId || !amount) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'VALIDATION_ERROR',
        errorMessage:
          'Yapı Kredi needs the order: call completeThreeDSPayment({ ...callbackBody, orderId, amount, currency }) with values from your records',
        rawResponse: callbackData,
      });
    }

    let reached = false;
    try {
      const xid = toYapiKrediXid(orderId);
      const minorAmount = formatYapiKrediAmount(amount);
      const currency = getYapiKrediCurrencyCode(callbackData.currency);
      const mac = await createYapiKrediMac({
        xid,
        amount: minorAmount,
        currency,
        merchantId: this.config.merchantId,
        terminalId: this.config.terminalId,
        encKey: this.config.encKey,
      });
      const packets = { bankData: BankPacket, merchantData: MerchantPacket, sign: Sign };

      const resolved = await this.api({
        oosResolveMerchantData: { ...packets, wpAmount: '0', mac },
      });
      const data = resolved.oosResolveMerchantData;
      if (
        !isYapiKrediApproved(resolved) ||
        data.xid !== xid ||
        data.amount !== minorAmount ||
        (data.currency !== undefined && data.currency !== currency)
      ) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          errorCode: 'INVALID_HASH',
          errorMessage: 'The 3D Secure result does not match the order',
          rawResponse: { callback: callbackData, resolve: resolved },
        });
      }
      if (data.mdStatus !== '1') {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          errorCode: `MD_STATUS_${data.mdStatus ?? ''}`,
          errorMessage: data.mdErrorMessage || '3D Secure authentication failed',
          rawResponse: { callback: callbackData, resolve: resolved },
        });
      }

      reached = true;
      const payment = await this.api({ oosTranData: { ...packets, wpAmount: '0', mac } });
      if (!isYapiKrediApproved(payment)) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          ...YapiKredi.errorOf(payment),
          rawResponse: { callback: callbackData, resolve: resolved, payment },
        });
      }
      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        paymentId: payment.fields.hostlogkey,
        conversationId: orderId,
        rawResponse: { callback: callbackData, resolve: resolved, payment },
      });
    } catch (error) {
      const result = this.failure<PaymentResponse>(error, '3D Secure completion failed');
      // A timeout while charging: the outcome is unknown
      return reached && result.status === PaymentStatus.PENDING
        ? { ...result, conversationId: orderId }
        : result;
    }
  }

  /**
   * Refund (XML `return`). `paymentId` is the host log key of the payment.
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const result = await this.api({
        tranDateRequired: '1',
        return: {
          amount: formatYapiKrediAmount(request.price),
          currencyCode: getYapiKrediCurrencyCode(request.currency),
          transaction: 'sale',
          hostLogKey: request.paymentId,
        },
      });
      const approved = isYapiKrediApproved(result);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: approved ? result.fields.hostlogkey || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : YapiKredi.errorOf(result)),
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Same-day cancel (XML `reverse`). `paymentId` is the host log key of the payment.
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const result = await this.api({
        tranDateRequired: '1',
        reverse: { transaction: 'sale', hostLogKey: request.paymentId },
      });
      const approved = isYapiKrediApproved(result);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        transactionId: approved ? result.fields.hostlogkey || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : YapiKredi.errorOf(result)),
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Not available yet: the order inquiry of the Posnet API is not implemented.
   */
  async getPayment(_paymentId: string): Promise<PaymentResponse> {
    throw new BetterPaymentError(
      'Order status queries are not supported for Yapı Kredi yet.',
      'NOT_SUPPORTED',
      'yapikredi'
    );
  }
}

/**
 * The Yapı Kredi provider, for
 * `betterPayment({ providers: { yapikredi: yapikredi({ merchantId, terminalId, posnetId, encKey }) } })`.
 * The base URL follows `mode` unless `baseUrl` is set.
 */
export const yapikredi = (config: YapiKrediConfig): ProviderDefinition<YapiKredi> =>
  defineProvider((ctx) => new YapiKredi(withProviderDefaults(ProviderType.YAPIKREDI, config, ctx)));
