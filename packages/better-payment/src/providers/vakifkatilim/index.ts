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
  VAKIFKATILIM_ENDPOINTS,
  createVakifKatilimHash,
  formatVakifKatilimAmount,
  getVakifKatilimCurrencyCode,
  formatVakifKatilimInstallment,
  validateVakifKatilimOrderId,
  encodeVakifKatilimPaymentId,
  decodeVakifKatilimPaymentId,
  buildVakifKatilimXml,
  parseVakifKatilimResponse,
  isVakifKatilimApproved,
} from './utils';
import type { VakifKatilimConfig, VakifKatilimCompleteRequest } from './types';

/**
 * Vakıf Katılım virtual POS (BOA VirtualPOS.Gateway, XML)
 *
 * - createPayment():          `Non3DPayGate`
 * - initThreeDSPayment():     `ThreeDModelPayGate`, answered with the bank's 3D page
 * - completeThreeDSPayment(): `ThreeDModelProvisionGate` with the callback's MD; needs
 *                             the order values from your records
 * - cancel() `SaleReversal`, refund() `Drawback` / `PartialDrawback`
 *
 * `paymentId` is `<merchant order id>:<bank OrderId>` (cancel and refund need
 * both); `conversationId` is your order id.
 */
export class VakifKatilim extends PaymentProvider<VakifKatilimConfig> {
  private client: HttpClient;

  constructor(config: VakifKatilimConfig) {
    super(config);

    this.client = this.createHttpClient('vakifkatilim', {
      timeout: 30000,
      headers: { 'Content-Type': 'application/xml' },
    });
  }

  protected validateConfig(): void {
    const missing = (['merchantId', 'customerId', 'username', 'password'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(
        `Vakıf Katılım configuration is missing: ${missing.join(', ')}`,
        'vakifkatilim'
      );
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('Vakıf Katılım baseUrl is required', 'vakifkatilim');
    }
  }

  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return {
      ...ISO8583_ERROR_CODES,
      // Codes seen on the gateway
      MerchantNotDefined: PaymentErrorCode.PROVIDER_ERROR,
      TechnicalException: PaymentErrorCode.PROVIDER_ERROR,
      InvalidTransactionSecurity: PaymentErrorCode.INVALID_REQUEST,
      OriginalOrderIdZero: PaymentErrorCode.INVALID_REQUEST,
      EmptyParameterException: PaymentErrorCode.INVALID_REQUEST,
    };
  }

  private get credentials() {
    return {
      merchantId: this.config.merchantId,
      username: this.config.username,
      password: this.config.password,
    };
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('Vakıf Katılım', error, fallback, extra));
  }

  private static errorOf(fields: Record<string, string | undefined>) {
    return {
      errorCode: fields.ResponseCode || undefined,
      // TechnicalException messages carry a .NET stack trace; keep the first line
      errorMessage: fields.ResponseMessage?.split(/\r?\n/)[0] || undefined,
    };
  }

  private static paymentIdOf(merchantOrderId: string, fields: Record<string, string>): string {
    return encodeVakifKatilimPaymentId({
      merchantOrderId,
      orderId: fields.OrderId,
      provisionNumber: fields.ProvisionNumber || undefined,
      rrn: fields.RRN || undefined,
      stan: fields.Stan || undefined,
    });
  }

  private account(): Record<string, XmlValue> {
    return {
      MerchantId: this.config.merchantId,
      CustomerId: this.config.customerId,
      UserName: this.config.username,
    };
  }

  private async send(path: string, fields: Record<string, XmlValue>): Promise<string> {
    const response = await this.client.post<string>(path, buildVakifKatilimXml(fields), {
      responseType: 'text',
    });
    return typeof response.data === 'string' ? response.data : '';
  }

  private async api(
    path: string,
    fields: Record<string, XmlValue>
  ): Promise<Record<string, string>> {
    return parseVakifKatilimResponse(await this.send(path, fields));
  }

  /** The card fields of a payment request */
  private cardFields(request: PaymentRequest): Record<string, XmlValue> {
    const card = this.cardOf(request);
    const month = card.expireMonth.padStart(2, '0');
    const year = card.expireYear.slice(-2);
    if (!/^(0[1-9]|1[0-2])$/.test(month) || !/^\d{2}$/.test(year)) {
      throw new ValidationError(`Invalid card expiry: ${card.expireMonth}/${card.expireYear}`);
    }
    return {
      CardNumber: card.cardNumber.replace(/\s/g, ''),
      CardExpireDateYear: year,
      CardExpireDateMonth: month,
      CardCVV2: card.cvc,
      CardHolderName: card.cardHolderName,
    };
  }

  /**
   * Non-3D sale (`Non3DPayGate`, TransactionSecurity 1)
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      validateVakifKatilimOrderId(orderId);
      this.validatePayment(request, { card: true });
      const amount = formatVakifKatilimAmount(request.paidPrice ?? request.price);
      const fields = await this.api(VAKIFKATILIM_ENDPOINTS.NON_3D, {
        OkUrl: '',
        FailUrl: '',
        HashData: await createVakifKatilimHash(this.credentials, {
          merchantOrderId: orderId,
          amount,
        }),
        ...this.account(),
        MerchantOrderId: orderId,
        InstallmentCount: formatVakifKatilimInstallment(request.installment),
        Amount: amount,
        DisplayAmount: amount,
        FECCurrencyCode: getVakifKatilimCurrencyCode(request.currency),
        ...this.cardFields(request),
        TransactionSecurity: '1',
      });
      return this.paymentResult(fields, orderId);
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Payment failed', { conversationId: orderId });
    }
  }

  private paymentResult(fields: Record<string, string>, orderId: string): PaymentResponse {
    const approved = isVakifKatilimApproved(fields) && !!fields.OrderId && fields.OrderId !== '0';
    return this.withErrorCode({
      status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
      paymentId: approved ? VakifKatilim.paymentIdOf(orderId, fields) : undefined,
      conversationId: orderId,
      ...(approved ? {} : VakifKatilim.errorOf(fields)),
      rawResponse: fields,
    });
  }

  /**
   * 3D Secure payment: the card is sent to `ThreeDModelPayGate`, which answers
   * with the page that takes the customer to 3D Secure. The bank POSTs the
   * result to callbackUrl (or failUrl).
   */
  async initThreeDSPayment(
    request: ThreeDSPaymentRequest & { failUrl?: string }
  ): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      validateVakifKatilimOrderId(orderId);
      this.validatePayment(request, { card: true });
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }
      const okUrl = request.callbackUrl;
      const failUrl = request.failUrl || request.callbackUrl;
      const amount = formatVakifKatilimAmount(request.paidPrice ?? request.price);

      const html = await this.send(VAKIFKATILIM_ENDPOINTS.THREE_D, {
        OkUrl: okUrl,
        FailUrl: failUrl,
        HashData: await createVakifKatilimHash(this.credentials, {
          merchantOrderId: orderId,
          amount,
          okUrl,
          failUrl,
        }),
        ...this.account(),
        MerchantOrderId: orderId,
        InstallmentCount: formatVakifKatilimInstallment(request.installment),
        Amount: amount,
        DisplayAmount: amount,
        FECCurrencyCode: getVakifKatilimCurrencyCode(request.currency),
        ...this.cardFields(request),
        TransactionSecurity: '3',
      });
      if (!/<form|<html/i.test(html)) {
        throw new Error('Vakıf Katılım returned an unexpected 3D Secure page');
      }
      // A rejected request comes back as a form that posts the error to the callback
      const rejected = /name="ResponseCode"\s+value="([^"]+)"/.exec(html);
      if (rejected && rejected[1] !== '00') {
        const message = /name="ResponseMessage"\s+value="([^"]*)"/.exec(html)?.[1];
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          conversationId: orderId,
          errorCode: rejected[1],
          errorMessage: message || undefined,
          rawResponse: html,
        });
      }

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
   * Completes the payment after the OkUrl / FailUrl POST. The callback's hash
   * is not checked (its formula is not confirmed): when ResponseCode is 00, the
   * payment is charged with `ThreeDModelProvisionGate` and the callback's MD,
   * for the order values from your records, and the bank's answer decides.
   *
   * `completeThreeDSPayment({ ...callbackBody, orderId, amount, currency, callbackUrl })`
   *
   * `paymentId` and `conversationId` are set only for a payment the bank
   * approved, and on a timeout after the bank was reached; a failure carries no ids.
   */
  async completeThreeDSPayment(
    callbackData: VakifKatilimCompleteRequest
  ): Promise<PaymentResponse> {
    const data = callbackData ?? {};
    if (data.ResponseCode !== '00') {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: data.ResponseCode || 'INVALID_CALLBACK',
        errorMessage: data.ResponseMessage || '3D Secure authentication failed',
        rawResponse: data,
      });
    }

    let reached = false;
    const orderId = data.orderId ?? '';
    try {
      if (!data.orderId || !data.amount || !data.callbackUrl) {
        throw new ValidationError(
          'completeThreeDSPayment() needs orderId, amount and callbackUrl from your records: ' +
            'completeThreeDSPayment({ ...callbackBody, orderId, amount, currency, callbackUrl })'
        );
      }
      if (!data.MD) {
        throw new ValidationError('3D Secure callback is missing: MD');
      }
      validateVakifKatilimOrderId(data.orderId);
      if (data.MerchantOrderId && data.MerchantOrderId !== data.orderId) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          errorCode: 'INVALID_CALLBACK',
          errorMessage: 'Callback belongs to another order',
          rawResponse: data,
        });
      }

      const okUrl = data.callbackUrl;
      const failUrl = data.failUrl || data.callbackUrl;
      const amount = formatVakifKatilimAmount(data.amount);
      reached = true;
      const fields = await this.api(VAKIFKATILIM_ENDPOINTS.PROVISION, {
        OkUrl: okUrl,
        FailUrl: failUrl,
        HashData: await createVakifKatilimHash(this.credentials, {
          merchantOrderId: data.orderId,
          amount,
          okUrl,
          failUrl,
        }),
        ...this.account(),
        MerchantOrderId: data.orderId,
        InstallmentCount: formatVakifKatilimInstallment(data.installment),
        Amount: amount,
        DisplayAmount: amount,
        FECCurrencyCode: getVakifKatilimCurrencyCode(data.currency),
        TransactionSecurity: '3',
        AdditionalData: {
          AdditionalDataList: { VPosAdditionalData: { Key: 'MD', Data: data.MD } },
        },
      });

      const approved = isVakifKatilimApproved(fields) && !!fields.OrderId && fields.OrderId !== '0';
      if (!approved) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          ...VakifKatilim.errorOf(fields),
          rawResponse: { callback: data, payment: fields },
        });
      }
      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        paymentId: VakifKatilim.paymentIdOf(data.orderId, fields),
        conversationId: orderId,
        rawResponse: { callback: data, payment: fields },
      });
    } catch (error) {
      const result = this.failure<PaymentResponse>(error, '3D Secure completion failed');
      // A timeout after the bank was asked to charge: the outcome is unknown
      return reached && result.status === PaymentStatus.PENDING
        ? { ...result, conversationId: orderId }
        : result;
    }
  }

  /** SaleReversal / Drawback / PartialDrawback for a paymentId */
  private async reverse(
    path: string,
    paymentId: string,
    amount: string | undefined,
    currency: string | undefined
  ): Promise<Record<string, string>> {
    const ref = decodeVakifKatilimPaymentId(paymentId);
    if (amount === undefined) {
      // The hash covers the amount: send the payment's amount, never a blank one
      throw new ValidationError('Vakıf Katılım needs the payment amount as price');
    }
    const formatted = formatVakifKatilimAmount(amount);
    return this.api(path, {
      HashData: await createVakifKatilimHash(this.credentials, {
        merchantOrderId: ref.merchantOrderId,
        amount: formatted,
      }),
      ...this.account(),
      MerchantOrderId: ref.merchantOrderId,
      OrderId: ref.orderId,
      // Only sent when the payment returned them (empty elements are left out)
      ...(ref.provisionNumber ? { ProvisionNumber: ref.provisionNumber } : {}),
      ...(ref.rrn ? { RRN: ref.rrn } : {}),
      ...(ref.stan ? { Stan: ref.stan } : {}),
      Amount: formatted,
      DisplayAmount: formatted,
      FECCurrencyCode: getVakifKatilimCurrencyCode(currency),
    });
  }

  /**
   * Refund after end of day: `PartialDrawback` for `price`, or `Drawback` (the
   * whole payment) with `fullRefund: true`. `paymentId` is the one the payment returned.
   */
  async refund(request: RefundRequest & { fullRefund?: boolean }): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const path = request.fullRefund
        ? VAKIFKATILIM_ENDPOINTS.DRAWBACK
        : VAKIFKATILIM_ENDPOINTS.PARTIAL_DRAWBACK;
      const fields = await this.reverse(path, request.paymentId, request.price, request.currency);
      const approved = isVakifKatilimApproved(fields);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: approved ? fields.OrderId || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : VakifKatilim.errorOf(fields)),
        rawResponse: fields,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Same-day cancel (`SaleReversal`). `paymentId` is the one the payment returned,
   * and `price` the payment's amount (the hash covers it).
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const fields = await this.reverse(
        VAKIFKATILIM_ENDPOINTS.SALE_REVERSAL,
        request.paymentId,
        request.price,
        request.currency
      );
      const approved = isVakifKatilimApproved(fields);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        transactionId: approved ? fields.OrderId || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : VakifKatilim.errorOf(fields)),
        rawResponse: fields,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /** Not supported: no status query was found on the gateway */
  async getPayment(_paymentId: string): Promise<PaymentResponse> {
    throw new BetterPaymentError(
      'Payment status queries are not supported by the Vakıf Katılım provider yet',
      'NOT_SUPPORTED'
    );
  }
}

/**
 * The Vakıf Katılım provider, for
 * `betterPayment({ providers: { vakifkatilim: vakifKatilim({ merchantId, customerId, username, password }) } })`.
 */
export const vakifKatilim = (config: VakifKatilimConfig): ProviderDefinition<VakifKatilim> =>
  defineProvider(
    (ctx) => new VakifKatilim(withProviderDefaults(ProviderType.VAKIFKATILIM, config, ctx))
  );
