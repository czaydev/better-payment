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
  PaymentStatus,
} from '../../types';
import {
  ALBARAKA_ENDPOINTS,
  createAlbarakaMac,
  formatAlbarakaAmount,
  getAlbarakaCurrencyCode,
  formatAlbarakaInstallment,
  formatAlbarakaExpiry,
  formatAlbarakaOrderId,
  isAlbarakaApproved,
} from './utils';
import type { AlbarakaConfig, AlbarakaCompleteRequest, AlbarakaResponse } from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Albaraka Türk virtual POS (e-POS, Posnet JSON API)
 *
 * - createPayment():          JSON `Sale` (non-3D)
 * - initThreeDSPayment():     auto-submitting form to the 3D verification page
 * - completeThreeDSPayment(): charges with JSON `Sale` and the 3D data; needs the
 *                             order id, amount and currency from your records
 * - refund() `Return`, cancel() `Reverse`, getPayment() `TransactionInquiry` (by order id)
 * - pre-authorization: authorize() / initThreeDSAuthorize() `Auth`, capture() `Capture`,
 *   voidAuthorization() `Reverse`
 *
 * `paymentId` is the bank's ReferenceCode, which refund() and cancel() take;
 * `conversationId` is your order id.
 */
export class Albaraka extends PaymentProvider<AlbarakaConfig> {
  private client: HttpClient;

  constructor(config: AlbarakaConfig) {
    super(config);

    this.client = this.createHttpClient('albaraka', {
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  protected validateConfig(): void {
    const missing = (['merchantId', 'terminalId', 'posnetId', 'encKey'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(
        `Albaraka configuration is missing: ${missing.join(', ')}`,
        'albaraka'
      );
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('Albaraka baseUrl is required', 'albaraka');
    }
  }

  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return {
      ...ISO8583_ERROR_CODES,
      // Codes seen on the test host
      '0148': PaymentErrorCode.PROVIDER_ERROR, // UNAUTHORIZED REQUEST
      '0355': PaymentErrorCode.INVALID_REQUEST, // a MACParams value is missing
      E219: PaymentErrorCode.INVALID_REQUEST, // record not found
      E999: PaymentErrorCode.PROVIDER_ERROR, // general error
    };
  }

  private get lang(): string {
    return (this.config.locale || 'tr').toLowerCase().startsWith('en') ? 'en' : 'tr';
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('Albaraka', error, fallback, extra));
  }

  private static errorOf(response: AlbarakaResponse) {
    return {
      errorCode: response.ServiceResponseData?.ResponseCode || undefined,
      errorMessage: response.ServiceResponseData?.ResponseDescription || undefined,
    };
  }

  /**
   * Calls a JSON API operation. The service rejects requests that leave out
   * any of its data members, so the callers send them, as null when unused.
   */
  private async api(operation: string, body: Record<string, unknown>): Promise<AlbarakaResponse> {
    const response = await this.client.post<AlbarakaResponse>(
      `${ALBARAKA_ENDPOINTS.API}/${operation}`,
      JSON.stringify(body)
    );
    const data = response.data;
    if (!data || typeof data !== 'object') {
      throw new Error('Albaraka returned an unexpected response');
    }
    return data;
  }

  private paymentResult(response: AlbarakaResponse, orderId: string): PaymentResponse {
    const approved = isAlbarakaApproved(response);
    return this.withErrorCode({
      status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
      paymentId: approved ? response.ReferenceCode || undefined : undefined,
      conversationId: orderId,
      ...(approved ? {} : Albaraka.errorOf(response)),
      rawResponse: response,
    });
  }

  /**
   * Non-3D sale (JSON `Sale`)
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    return this.pay(request, 'Sale');
  }

  /** Non-3D pre-authorization (JSON `Auth`) */
  async authorize(request: PaymentRequest): Promise<PaymentResponse> {
    return this.pay(request, 'Auth');
  }

  private async pay(request: PaymentRequest, operation: 'Sale' | 'Auth'): Promise<PaymentResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      const bankOrderId = formatAlbarakaOrderId(orderId);
      this.validatePayment(request, { card: true });
      const card = this.cardOf(request);
      const cardNo = card.cardNumber.replace(/\s/g, '');
      const expireDate = formatAlbarakaExpiry(card.expireMonth, card.expireYear);
      const amount = formatAlbarakaAmount(request.paidPrice ?? request.price);

      const response = await this.api(operation, {
        ApiType: 'JSON',
        ApiVersion: 'V100',
        MACParams: 'MerchantNo:TerminalNo:CardNo:Cvc2:ExpireDate:Amount',
        MerchantNo: this.config.merchantId,
        TerminalNo: this.config.terminalId,
        CipheredData: null,
        DealerData: null,
        IsEncrypted: null,
        PaymentFacilitatorData: null,
        AdditionalInfoData: null,
        CardInformationData: {
          CardNo: cardNo,
          ExpireDate: expireDate,
          Cvc2: card.cvc,
          CardHolderName: card.cardHolderName,
        },
        IsMailOrder: 'N',
        IsRecurring: null,
        IsTDSecureMerchant: null,
        PaymentInstrumentType: 'CARD',
        ThreeDSecureData: null,
        Amount: amount,
        CurrencyCode: getAlbarakaCurrencyCode(request.currency),
        OrderId: bankOrderId,
        ...formatAlbarakaInstallment(request.installment),
        KOICode: null,
        MerchantMessageData: null,
        PointAmount: null,
        MAC: await createAlbarakaMac(
          [
            this.config.merchantId,
            this.config.terminalId,
            cardNo,
            card.cvc,
            expireDate,
            String(amount),
          ],
          this.config.encKey
        ),
      });
      return this.paymentResult(response, orderId);
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Payment failed', { conversationId: orderId });
    }
  }

  /**
   * 3D Secure payment: an auto-submitting form to Albaraka's 3D verification
   * page. The bank POSTs the result to callbackUrl.
   */
  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    return this.payThreeDS(request, 'Sale');
  }

  /**
   * initThreeDSPayment() as a pre-authorization. Complete it with
   * `completeThreeDSPayment({ ...callbackBody, orderId, amount, currency, transactionType: 'Auth' })`.
   */
  async initThreeDSAuthorize(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    return this.payThreeDS(request, 'Auth');
  }

  private async payThreeDS(
    request: ThreeDSPaymentRequest,
    transactionType: 'Sale' | 'Auth'
  ): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      const bankOrderId = formatAlbarakaOrderId(orderId);
      this.validatePayment(request, { card: true });
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }
      const card = this.cardOf(request);
      const cardNo = card.cardNumber.replace(/\s/g, '');
      const expireDate = formatAlbarakaExpiry(card.expireMonth, card.expireYear);
      const amount = String(formatAlbarakaAmount(request.paidPrice ?? request.price));
      const installment = formatAlbarakaInstallment(request.installment);

      const fields: Record<string, string> = {
        MerchantNo: this.config.merchantId,
        TerminalNo: this.config.terminalId,
        PosnetID: this.config.posnetId,
        TransactionType: transactionType,
        OrderId: bankOrderId,
        Amount: amount,
        CurrencyCode: getAlbarakaCurrencyCode(request.currency),
        MerchantReturnURL: request.callbackUrl,
        InstallmentCount: String(installment.InstallmentCount),
        InstallmentType: installment.InstallmentType,
        Language: this.lang,
        TxnState: 'INITIAL',
        OpenNewWindow: '0',
        CardNo: cardNo,
        ExpiredDate: expireDate,
        Cvv: card.cvc,
        CardHolderName: card.cardHolderName,
        MacParams: 'MerchantNo:TerminalNo:CardNo:Cvc2:ExpireDate:Amount',
        UseOOS: '0',
      };
      fields.MAC = await createAlbarakaMac(
        [this.config.merchantId, this.config.terminalId, cardNo, card.cvc, expireDate, amount],
        this.config.encKey
      );

      const inputs = Object.entries(fields)
        .map(
          ([name, value]) =>
            `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
        )
        .join('');
      const action = `${this.config.baseUrl}${ALBARAKA_ENDPOINTS.GATE}`;
      const html =
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
        `<form id="albaraka-3d-form" method="POST" action="${escapeHtml(action)}">${inputs}</form>` +
        '<script>document.getElementById("albaraka-3d-form").submit();</script>' +
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
   * Completes the payment after the MerchantReturnURL POST. The callback is not
   * signed: when `MdStatus` is accepted, the payment is charged with JSON `Sale`
   * and the 3D data, for the order id, amount and currency from your records,
   * and the bank's answer decides.
   *
   * `completeThreeDSPayment({ ...callbackBody, orderId, amount, currency })`
   *
   * `paymentId` and `conversationId` are set only for a payment the bank
   * approved, and on a timeout after the bank was reached; a failure carries no ids.
   */
  async completeThreeDSPayment(callbackData: AlbarakaCompleteRequest): Promise<PaymentResponse> {
    const data = callbackData ?? {};
    const accepted = this.config.acceptedMdStatuses ?? ['1'];
    if (!data.MdStatus || !accepted.includes(data.MdStatus)) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: `MD_STATUS_${data.MdStatus ?? ''}`,
        errorMessage: data.MdErrorMessage || '3D Secure authentication failed',
        rawResponse: data,
      });
    }

    let reached = false;
    const orderId = data.orderId ?? '';
    try {
      if (!data.orderId || !data.amount) {
        throw new ValidationError(
          'completeThreeDSPayment() needs orderId and amount from your records: ' +
            'completeThreeDSPayment({ ...callbackBody, orderId, amount, currency })'
        );
      }
      const missing = (['SecureTransactionId', 'CAVV', 'ECI', 'MD'] as const).filter(
        (key) => !data[key]
      );
      if (missing.length > 0) {
        throw new ValidationError(`3D Secure callback is missing: ${missing.join(', ')}`);
      }

      const bankOrderId = formatAlbarakaOrderId(data.orderId);
      const mdStatus = data.MdStatus;
      reached = true;
      const response = await this.api(data.transactionType === 'Auth' ? 'Auth' : 'Sale', {
        ApiType: 'JSON',
        ApiVersion: 'V100',
        MerchantNo: this.config.merchantId,
        TerminalNo: this.config.terminalId,
        PaymentInstrumentType: 'CARD',
        IsEncrypted: 'N',
        IsTDSecureMerchant: 'Y',
        IsMailOrder: 'N',
        ThreeDSecureData: {
          SecureTransactionId: data.SecureTransactionId,
          CavvData: data.CAVV,
          Eci: data.ECI,
          MdStatus: Number(mdStatus),
          MD: data.MD,
        },
        MACParams: 'MerchantNo:TerminalNo:SecureTransactionId:CavvData:Eci:MdStatus',
        Amount: formatAlbarakaAmount(data.amount),
        CurrencyCode: getAlbarakaCurrencyCode(data.currency),
        PointAmount: 0,
        OrderId: bankOrderId,
        ...formatAlbarakaInstallment(data.installment),
        MAC: await createAlbarakaMac(
          [
            this.config.merchantId,
            this.config.terminalId,
            data.SecureTransactionId!,
            data.CAVV!,
            data.ECI!,
            mdStatus,
          ],
          this.config.encKey
        ),
      });

      if (!isAlbarakaApproved(response)) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          ...Albaraka.errorOf(response),
          rawResponse: { callback: data, payment: response },
        });
      }
      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        paymentId: response.ReferenceCode || undefined,
        conversationId: orderId,
        rawResponse: { callback: data, payment: response },
      });
    } catch (error) {
      const result = this.failure<PaymentResponse>(error, '3D Secure completion failed');
      // A timeout after the bank was asked to charge: the outcome is unknown
      return reached && result.status === PaymentStatus.PENDING
        ? { ...result, conversationId: orderId }
        : result;
    }
  }

  /** MAC of Return / Reverse: MerchantNo + TerminalNo + ReferenceCode (+ empty OrderId) */
  private referenceMac(referenceCode: string): Promise<string> {
    return createAlbarakaMac(
      [this.config.merchantId, this.config.terminalId, referenceCode],
      this.config.encKey
    );
  }

  /**
   * Refund (JSON `Return`); a lower amount is a partial refund. `paymentId` is
   * the ReferenceCode of the payment.
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const response = await this.api('Return', {
        ApiType: 'JSON',
        ApiVersion: 'v100',
        MACParams: 'MerchantNo:TerminalNo:ReferenceCode:OrderId',
        CipheredData: null,
        DealerData: null,
        IsEncrypted: null,
        PaymentFacilitatorData: null,
        OrderId: null,
        MerchantNo: this.config.merchantId,
        TerminalNo: this.config.terminalId,
        ReferenceCode: request.paymentId,
        TransactionType: 'Sale',
        Amount: formatAlbarakaAmount(request.price),
        CurrencyCode: getAlbarakaCurrencyCode(request.currency),
        MAC: await this.referenceMac(request.paymentId),
      });
      const approved = isAlbarakaApproved(response);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: approved ? response.ReferenceCode || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : Albaraka.errorOf(response)),
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  private async reverse(
    referenceCode: string,
    transactionType: 'Sale' | 'Auth',
    conversationId: string | undefined
  ): Promise<CancelResponse> {
    try {
      const response = await this.api('Reverse', {
        ApiType: 'JSON',
        ApiVersion: 'v100',
        MACParams: 'MerchantNo:TerminalNo:ReferenceCode:OrderId',
        CipheredData: null,
        DealerData: null,
        IsEncrypted: null,
        PaymentFacilitatorData: null,
        OrderId: null,
        MerchantNo: this.config.merchantId,
        TerminalNo: this.config.terminalId,
        ReferenceCode: referenceCode,
        TransactionType: transactionType,
        MAC: await this.referenceMac(referenceCode),
      });
      const approved = isAlbarakaApproved(response);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        transactionId: approved ? response.ReferenceCode || undefined : undefined,
        conversationId,
        ...(approved ? {} : Albaraka.errorOf(response)),
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', { conversationId });
    }
  }

  /**
   * Cancel (JSON `Reverse`), before end of day. `paymentId` is the ReferenceCode
   * of the payment.
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    return this.reverse(request.paymentId, 'Sale', request.conversationId);
  }

  /** Releases a pre-authorization (JSON `Reverse` of the `Auth`) */
  async voidAuthorization(request: VoidAuthorizationRequest): Promise<CancelResponse> {
    return this.reverse(request.paymentId, 'Auth', request.conversationId);
  }

  /**
   * Captures a pre-authorization (JSON `Capture`); a lower amount captures part
   * of it. `paymentId` is the ReferenceCode of the `Auth`.
   */
  async capture(request: CaptureRequest): Promise<PaymentResponse> {
    try {
      this.validateCapture(request);
      const response = await this.api('Capture', {
        ApiType: 'JSON',
        ApiVersion: 'V100',
        MACParams: 'MerchantNo:TerminalNo:ReferenceCode',
        CipheredData: null,
        DealerData: null,
        IsEncrypted: null,
        PaymentFacilitatorData: null,
        MerchantNo: this.config.merchantId,
        TerminalNo: this.config.terminalId,
        ReferenceCode: request.paymentId,
        Amount: formatAlbarakaAmount(request.amount),
        CurrencyCode: getAlbarakaCurrencyCode(request.currency),
        PointAmount: null,
        InstallmentCount: 0,
        InstallmentType: 'N',
        MAC: await this.referenceMac(request.paymentId),
      });
      const approved = isAlbarakaApproved(response);
      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: approved ? response.ReferenceCode || request.paymentId : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : Albaraka.errorOf(response)),
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Capture failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Looks the order up with JSON `TransactionInquiry`. Unlike refund() and
   * cancel(), it takes your **order id** (conversationId), as the bank does.
   *
   * An unknown order (E219) is a failure. For a found order the status is
   * `pending`: the answer's `TransactionData` is returned in `rawResponse`, but
   * its format has not been confirmed with a real merchant, so it is not mapped yet.
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const bankOrderId = formatAlbarakaOrderId(paymentId);
      const response = await this.api('TransactionInquiry', {
        ApiType: 'JSON',
        ApiVersion: 'V100',
        MACParams: 'MerchantNo:TerminalNo:OrderId',
        MerchantNo: this.config.merchantId,
        TerminalNo: this.config.terminalId,
        OrderId: bankOrderId,
        MAC: await createAlbarakaMac(
          [this.config.merchantId, this.config.terminalId, bankOrderId],
          this.config.encKey
        ),
      });
      const found = isAlbarakaApproved(response);
      return this.withErrorCode({
        status: found ? albarakaOrderStatus(response.TransactionData) : PaymentStatus.FAILURE,
        paymentId: found ? response.ReferenceCode || undefined : undefined,
        conversationId: paymentId,
        ...(found ? {} : Albaraka.errorOf(response)),
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Get payment failed', {
        conversationId: paymentId,
      });
    }
  }
}

/**
 * Maps TransactionInquiry's TransactionData the way Yapı Kredi's `agreement`
 * answer is read on the same Posnet platform: a successful (TxnStatus 1) sale
 * is success, a successful reverse or return makes it cancelled. Keys are
 * matched case-insensitively. When the transactions do not carry those fields,
 * the status stays pending: the answer format is not confirmed yet.
 */
export function albarakaOrderStatus(data: unknown): PaymentStatus {
  const list = (Array.isArray(data) ? data : data ? [data] : []).filter(
    (item): item is Record<string, unknown> => !!item && typeof item === 'object'
  );
  const field = (item: Record<string, unknown>, name: string) => {
    const key = Object.keys(item).find((k) => k.toLowerCase() === name);
    return key === undefined ? undefined : String(item[key] ?? '');
  };
  const known = list.filter(
    (item) => field(item, 'txnstatus') !== undefined && field(item, 'state') !== undefined
  );
  if (known.length === 0) return PaymentStatus.PENDING;

  const succeeded = known.filter((item) => field(item, 'txnstatus') === '1');
  const state = (item: Record<string, unknown>) => (field(item, 'state') ?? '').toLowerCase();
  const sale = succeeded.some((item) =>
    ['sale', 'vft_sale', 'capture', 'authorization'].includes(state(item))
  );
  const reversed = succeeded.some((item) => /(_reverse|^return$|^vft_return$)/.test(state(item)));
  if (reversed) return PaymentStatus.CANCELLED;
  return sale ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE;
}

/**
 * The Albaraka Türk provider, for
 * `betterPayment({ providers: { albaraka: albaraka({ merchantId, terminalId, posnetId, encKey }) } })`.
 * The base URL follows `mode` unless `baseUrl` is set.
 */
export const albaraka = (config: AlbarakaConfig): ProviderDefinition<Albaraka> =>
  defineProvider((ctx) => new Albaraka(withProviderDefaults(ProviderType.ALBARAKA, config, ctx)));
