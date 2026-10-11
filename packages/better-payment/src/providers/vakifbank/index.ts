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
import { PaymentErrorCode } from '../../core/error-codes';
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
  VAKIFBANK_ENDPOINTS,
  VAKIFBANK_MPI_URLS,
  VAKIFBANK_SUCCESS_CODE,
  formatVakifBankAmount,
  getVakifBankCurrencyCode,
  formatVakifBankInstallment,
  formatVakifBankMpiExpiry,
  formatVakifBankVposExpiry,
  getVakifBankBrandName,
  validateVakifBankOrderId,
  buildVakifBankRequestBody,
  parseVakifBankXml,
  parseVakifBankSearchRecords,
} from './utils';
import type { VakifBankConfig, VakifBank3DCallbackData } from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isIp(value: string | undefined): value is string {
  return !!value && /^[0-9A-Fa-f:.]{3,45}$/.test(value);
}

/** Days back searched by getPayment() */
const SEARCH_DAYS = 90;

/**
 * VakıfBank virtual POS (VPOS 7/24)
 *
 * - createPayment():          VPOS `Sale` (non-3D)
 * - initThreeDSPayment():     MPI enrollment, then an auto-submitting form to the ACS
 * - completeThreeDSPayment(): VPOS `Sale` with `MpiTransactionId` (3DS product): the
 *                             card and amount come from the bank's MPI record
 * - refund() `Refund`, cancel() `Cancel`, getPayment() record search
 *
 * `paymentId` is your order id: the `conversationId` you pass, or a generated one.
 * It is the MPI VerifyEnrollmentRequestId and the VPOS TransactionId.
 */
export class VakifBank extends PaymentProvider<VakifBankConfig> {
  private client: HttpClient;

  constructor(config: VakifBankConfig) {
    super(config);

    this.client = this.createHttpClient('vakifbank', {
      timeout: 30000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }

  protected validateConfig(): void {
    const missing = (['merchantId', 'password', 'terminalNo'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(
        `VakıfBank configuration is missing: ${missing.join(', ')}`,
        'vakifbank'
      );
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('VakıfBank baseUrl is required', 'vakifbank');
    }
  }

  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return {
      '0001': PaymentErrorCode.CARD_DECLINED,
      '0005': PaymentErrorCode.CARD_DECLINED,
      '0051': PaymentErrorCode.INSUFFICIENT_FUNDS,
      '0054': PaymentErrorCode.EXPIRED_CARD,
      '0057': PaymentErrorCode.CARD_DECLINED,
      '0062': PaymentErrorCode.CARD_DECLINED,
      '9093': PaymentErrorCode.PROVIDER_ERROR,
    };
  }

  private get mpiUrl(): string {
    return (
      this.config.mpiUrl ||
      (this.config.testMode ? VAKIFBANK_MPI_URLS.test : VAKIFBANK_MPI_URLS.production)
    );
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('VakıfBank', error, fallback, extra));
  }

  private static errorOf(fields: Record<string, string>) {
    return {
      errorCode: fields.ResultCode || undefined,
      errorMessage: fields.ResultDetail || undefined,
    };
  }

  private static isApproved(fields: Record<string, string>): boolean {
    return fields.ResultCode === VAKIFBANK_SUCCESS_CODE;
  }

  private async vpos(fields: Record<string, XmlValue>): Promise<Record<string, string>> {
    const response = await this.client.post<string>(
      VAKIFBANK_ENDPOINTS.VPOS,
      buildVakifBankRequestBody('VposRequest', {
        MerchantId: this.config.merchantId,
        Password: this.config.password,
        TerminalNo: this.config.terminalNo,
        ...fields,
      }),
      { responseType: 'text' }
    );
    return parseVakifBankXml(
      typeof response.data === 'string' ? response.data : '',
      'VposResponse'
    );
  }

  /**
   * Non-3D sale (VPOS `Sale`)
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      validateVakifBankOrderId(orderId);
      this.validatePayment(request, { card: true, required: ['buyer.ip'] });
      const card = this.cardOf(request);
      const installment = formatVakifBankInstallment(request.installment);
      const fields = await this.vpos({
        TransactionType: 'Sale',
        TransactionId: orderId,
        OrderId: orderId,
        CurrencyAmount: formatVakifBankAmount(request.paidPrice ?? request.price),
        CurrencyCode: getVakifBankCurrencyCode(request.currency),
        Pan: card.cardNumber.replace(/\s/g, ''),
        Cvv: card.cvc,
        Expiry: formatVakifBankVposExpiry(card.expireMonth, card.expireYear),
        // Never sent empty: VPOS rejects an empty installment count
        ...(installment ? { NumberOfInstallments: installment } : {}),
        CardHoldersName: card.cardHolderName,
        ClientIp: request.buyer.ip,
        TransactionDeviceSource: '0',
      });
      const approved = VakifBank.isApproved(fields);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: orderId,
        conversationId: orderId,
        ...(approved ? {} : VakifBank.errorOf(fields)),
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
   * 3D Secure payment: MPI enrollment, then an auto-submitting form that sends
   * the customer's browser to the card issuer's ACS. Only enrolled cards
   * (VERes Status Y) continue.
   */
  async initThreeDSPayment(
    request: ThreeDSPaymentRequest & { failUrl?: string }
  ): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      validateVakifBankOrderId(orderId);
      this.validatePayment(request, { card: true });
      const card = this.cardOf(request);
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }
      const cardNumber = card.cardNumber.replace(/\s/g, '');
      const installment = formatVakifBankInstallment(request.installment);
      const form = new URLSearchParams({
        MerchantId: this.config.merchantId,
        MerchantPassword: this.config.password,
        VerifyEnrollmentRequestId: orderId,
        Pan: cardNumber,
        ExpiryDate: formatVakifBankMpiExpiry(card.expireMonth, card.expireYear),
        PurchaseAmount: formatVakifBankAmount(request.paidPrice ?? request.price),
        Currency: getVakifBankCurrencyCode(request.currency),
        BrandName: getVakifBankBrandName(cardNumber),
        SuccessUrl: request.callbackUrl,
        FailureUrl: request.failUrl || request.callbackUrl,
        ...(installment ? { InstallmentCount: String(installment) } : {}),
        // Returned unchanged with the callback; VPOS needs the customer IP then
        ...(isIp(request.buyer?.ip) ? { SessionInfo: request.buyer.ip } : {}),
      });

      const response = await this.client.post<string>(this.mpiUrl, form.toString(), {
        responseType: 'text',
      });
      const enrollment = parseVakifBankXml(
        typeof response.data === 'string' ? response.data : '',
        'IPaySecure'
      );
      const { Status, PaReq, PAReq, ACSUrl, TermUrl, MD } = enrollment;
      const paReq = PaReq ?? PAReq;
      if (Status !== 'Y' || !paReq || !ACSUrl || !TermUrl || !MD) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          paymentId: orderId,
          conversationId: orderId,
          errorCode:
            enrollment.MessageErrorCode && enrollment.MessageErrorCode !== '200'
              ? enrollment.MessageErrorCode
              : enrollment.ErrorCode || `VERES_${Status ?? ''}`,
          errorMessage:
            enrollment.ErrorMessage ||
            (Status === 'N' ? 'The card is not enrolled in 3D Secure' : 'MPI enrollment failed'),
          rawResponse: enrollment,
        });
      }

      const inputs = [
        ['PaReq', paReq],
        ['TermUrl', TermUrl],
        ['MD', MD],
      ]
        .map(
          ([name, value]) =>
            `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
        )
        .join('');
      const html =
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
        `<form id="vakifbank-3d-form" method="POST" action="${escapeHtml(ACSUrl)}">${inputs}</form>` +
        '<script>document.getElementById("vakifbank-3d-form").submit();</script>' +
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
   * Completes the payment after the SuccessUrl / FailureUrl POST.
   *
   * The POST is not signed. The card is charged with VPOS `Sale` carrying
   * `MpiTransactionId` (the order id sent with the enrollment); VPOS reads the
   * card, amount and 3D Secure result from its own MPI record, so callback
   * values cannot change them. Only Status Y is charged.
   *
   * `paymentId` and `conversationId` are set only for a payment VPOS approved,
   * and on a timeout after VPOS was reached; a failure never carries ids taken
   * from the callback.
   */
  async completeThreeDSPayment(callbackData: VakifBank3DCallbackData): Promise<PaymentResponse> {
    const data = callbackData ?? {};
    const orderId = data.VerifyEnrollmentRequestId;
    if (!orderId || (data.MerchantId !== undefined && data.MerchantId !== this.config.merchantId)) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'INVALID_HASH',
        errorMessage: 'Callback belongs to a different merchant or has no order id',
        rawResponse: data,
      });
    }
    if (data.Status !== 'Y') {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: data.ErrorCode || `MD_STATUS_${data.Status ?? ''}`,
        errorMessage: data.ErrorMessage || '3D Secure authentication failed',
        rawResponse: data,
      });
    }

    let reached = false;
    try {
      validateVakifBankOrderId(orderId);
      const eci = data.Eci ?? data.ECI;
      const cavv = data.Cavv ?? data.CAVV;
      const installment = Number(data.InstallmentCount);

      reached = true;
      const fields = await this.vpos({
        TransactionType: 'Sale',
        TransactionId: orderId,
        OrderId: orderId,
        MpiTransactionId: orderId,
        ...(eci ? { ECI: eci } : {}),
        ...(cavv ? { CAVV: cavv } : {}),
        ...(installment > 1 ? { NumberOfInstallments: installment } : {}),
        ClientIp: [data.SessionInfo, data.ClientIp].find(isIp) ?? '127.0.0.1',
        TransactionDeviceSource: '0',
      });

      if (!VakifBank.isApproved(fields)) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          ...VakifBank.errorOf(fields),
          rawResponse: { callback: data, payment: fields },
        });
      }
      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        paymentId: orderId,
        conversationId: orderId,
        rawResponse: { callback: data, payment: fields },
      });
    } catch (error) {
      const result = this.failure<PaymentResponse>(error, '3D Secure completion failed');
      // A timeout while charging: the outcome is unknown, check with getPayment()
      return reached && result.status === PaymentStatus.PENDING
        ? { ...result, paymentId: orderId, conversationId: orderId }
        : result;
    }
  }

  /**
   * Refund (VPOS `Refund`), full or partial. `paymentId` is the order id.
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const fields = await this.vpos({
        TransactionType: 'Refund',
        ReferenceTransactionId: request.paymentId,
        CurrencyAmount: formatVakifBankAmount(request.price),
        ClientIp: request.ip,
      });
      const approved = VakifBank.isApproved(fields);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: approved ? fields.TransactionId || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : VakifBank.errorOf(fields)),
        rawResponse: fields,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Cancel (VPOS `Cancel`) before end of day. `paymentId` is the order id.
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const fields = await this.vpos({
        TransactionType: 'Cancel',
        ReferenceTransactionId: request.paymentId,
        ClientIp: request.ip,
      });
      const approved = VakifBank.isApproved(fields);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        transactionId: approved ? fields.TransactionId || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : VakifBank.errorOf(fields)),
        rawResponse: fields,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Order status via record search by order id (last 90 days). The search
   * returns the successful sale of the order if there is one, otherwise its
   * latest attempt.
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const end = new Date();
      const start = new Date(end.getTime() - SEARCH_DAYS * 24 * 60 * 60 * 1000);
      const day = (date: Date) => date.toISOString().slice(0, 10);
      const response = await this.client.post<string>(
        VAKIFBANK_ENDPOINTS.SEARCH,
        buildVakifBankRequestBody('SearchRequest', {
          MerchantCriteria: {
            HostMerchantId: this.config.merchantId,
            MerchantPassword: this.config.password,
          },
          DateCriteria: { StartDate: day(start), EndDate: day(end) },
          TransactionCriteria: { TransactionId: '', OrderId: paymentId, AuthCode: '' },
        }),
        { responseType: 'text', retryable: true }
      );
      const xml = typeof response.data === 'string' ? response.data : '';
      const fields = parseVakifBankXml(xml, 'SearchResponse');
      const searchOk =
        fields.ResponseCode === VAKIFBANK_SUCCESS_CODE || fields.Status === 'Success';
      if (!searchOk) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          paymentId,
          conversationId: paymentId,
          errorCode: fields.ResultCode || fields.ResponseCode || undefined,
          errorMessage: fields.ResultDetail || fields.ResponseMessage || undefined,
          rawResponse: fields,
        });
      }

      const records = parseVakifBankSearchRecords(xml);
      const sale =
        records.find((r) => r.TransactionType === 'Sale' && VakifBank.isApproved(r)) ?? records[0];
      const status = !sale
        ? PaymentStatus.PENDING
        : VakifBank.isApproved(sale)
          ? PaymentStatus.SUCCESS
          : PaymentStatus.FAILURE;

      return this.withErrorCode({
        status,
        paymentId,
        conversationId: paymentId,
        ...(status === PaymentStatus.FAILURE
          ? { errorCode: sale?.ResultCode, errorMessage: sale?.ResponseMessage }
          : {}),
        rawResponse: { records },
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
 * The VakıfBank provider, for
 * `betterPayment({ providers: { vakifbank: vakifbank({ merchantId, password, terminalNo }) } })`.
 * The base URL and MPI service follow `mode` unless set.
 */
export const vakifbank = (config: VakifBankConfig): ProviderDefinition<VakifBank> =>
  defineProvider((ctx) => {
    const options = withProviderDefaults(ProviderType.VAKIFBANK, config, ctx);
    return new VakifBank({ ...options, testMode: config.testMode ?? ctx.mode === 'sandbox' });
  });
