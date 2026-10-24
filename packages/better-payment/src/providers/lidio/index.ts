import {
  defineProvider,
  withProviderDefaults,
  ProviderType,
  type ProviderDefinition,
} from '../../core/BetterPaymentConfig';
import type { HttpClient } from '../../core/http';
import { PaymentProvider } from '../../core/PaymentProvider';
import { BetterPaymentError, ConfigurationError, ValidationError } from '../../core/errors';
import { failureResult, type FailureResult } from '../../core/failure';
import { ISO8583_ERROR_CODES, PaymentErrorCode } from '../../core/error-codes';
import { generateOrderId, safeEqual, toMinorUnits } from '../../core/utils';
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
  InstallmentDetail,
  PaymentStatus,
} from '../../types';
import {
  LIDIO_ENDPOINTS,
  createLidioReturnHash,
  formatLidioAmount,
  formatLidioInstallment,
  getLidioCurrency,
  lidioCardAssociation,
} from './utils';
import type {
  LidioBinResponse,
  LidioCompleteContext,
  LidioConfig,
  Lidio3DCallbackData,
  LidioInstallmentResponse,
  LidioPaymentResponse,
} from './types';

function nonEmpty(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

/** `result` values whose outcome is not known yet: ask again with getPayment() */
const UNKNOWN_RESULTS = ['SystemError', 'Pending', 'Waiting'];

/**
 * Maps a PaymentInquiry answer: a sale Lidio reports as successful is `success`,
 * or `cancelled` once it was voided or fully refunded (a partial refund keeps it
 * `success`); a refused one is `failure`; a waiting, pending or unknown one is
 * `pending`.
 */
export function lidioPaymentStatus(
  response: LidioPaymentResponse | null | undefined
): PaymentStatus {
  const result = response?.result;
  if (result === 'Success') {
    const info = response?.paymentInfo;
    return info?.isCancelled || info?.isFullRefunded
      ? PaymentStatus.CANCELLED
      : PaymentStatus.SUCCESS;
  }
  if (result && UNKNOWN_RESULTS.includes(result)) return PaymentStatus.PENDING;
  return PaymentStatus.FAILURE;
}

/**
 * Lidio (formerly Mobilexpress), REST/JSON
 *
 * - createPayment() / authorize():   ProcessPayment, NewCard (processType sales / preauth)
 * - initThreeDSPayment() / initThreeDSAuthorize(): ProcessPayment with use3DSecure;
 *   the answer's redirectForm takes the customer to 3D Secure
 * - completeThreeDSPayment():        checks the return URL's Hash, then FinishPaymentProcess
 * - capture() Postauth, cancel() / voidAuthorization() Cancel, refund() Refund
 * - getPayment(): PaymentInquiry
 * - binCheck() GetBankOfBINNumber, installmentInfo() GetInstallmentInfo
 *
 * `paymentId` is your order id: the `conversationId` you pass, or a generated one.
 * Lidio picks the bank POS from the card BIN.
 */
export class Lidio extends PaymentProvider<LidioConfig> {
  private client: HttpClient;

  constructor(config: LidioConfig) {
    super(config);

    this.client = this.createHttpClient('lidio', {
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `MxS2S ${config.apiKey}`,
        MerchantCode: config.merchantCode,
      },
    });
  }

  protected validateConfig(): void {
    const missing = (['merchantCode', 'apiKey', 'merchantKey'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(
        `Lidio configuration is missing: ${missing.join(', ')}`,
        'lidio'
      );
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('Lidio baseUrl is required', 'lidio');
    }
  }

  /** The bank's ISO 8583 codes, and Lidio's own `resultDetail` codes */
  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return {
      ...ISO8583_ERROR_CODES,
      Refused: PaymentErrorCode.CARD_DECLINED,
      InvalidCardNum: PaymentErrorCode.INVALID_CARD,
      InvalidMonth: PaymentErrorCode.INVALID_CARD,
      InvalidYear: PaymentErrorCode.EXPIRED_CARD,
      InvalidCVV: PaymentErrorCode.INVALID_CVC,
      InvalidAmount: PaymentErrorCode.INVALID_REQUEST,
      InvalidInstallment: PaymentErrorCode.INVALID_REQUEST,
      InvalidOrderId: PaymentErrorCode.INVALID_REQUEST,
      InvalidReturnURL: PaymentErrorCode.INVALID_REQUEST,
      DuplicateOrderId: PaymentErrorCode.DUPLICATE_ORDER,
      RefTransactionNotFound: PaymentErrorCode.INVALID_REQUEST,
      InvalidCredential: PaymentErrorCode.PROVIDER_ERROR,
      SystemError: PaymentErrorCode.PROVIDER_ERROR,
      '3DFailed': PaymentErrorCode.THREEDS_FAILED,
    };
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('Lidio', error, fallback, extra));
  }

  /**
   * The error of an answer: the bank's code when the bank refused, else Lidio's
   * `resultDetail` (or `result`)
   */
  private static errorOf(response: LidioPaymentResponse) {
    const pos = response.paymentInfo?.acquirerResultDetail?.pos;
    const bankCode = nonEmpty(pos?.returnCode);
    if (bankCode && bankCode !== '00') {
      return {
        errorCode: bankCode,
        errorMessage: nonEmpty(pos?.message) ?? nonEmpty(response.resultMessage),
      };
    }
    const code = nonEmpty(response.resultDetail) ?? nonEmpty(response.result) ?? 'PROVIDER_ERROR';
    return { errorCode: code, errorMessage: nonEmpty(response.resultMessage) ?? code };
  }

  private async post<T extends object>(
    endpoint: string,
    body: Record<string, unknown>,
    retryable = false
  ): Promise<T> {
    const response = await this.client.post<T>(endpoint, JSON.stringify(body), {
      retryable,
      validateStatus: (status) => status < 500,
    });
    const data = response.data as unknown;
    return (data && typeof data === 'object' ? data : {}) as T;
  }

  /** A payment answer as a result: SystemError and Pending are unknown, so pending */
  private paymentResult(response: LidioPaymentResponse, orderId: string): PaymentResponse {
    if (response.result === 'Success') {
      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        paymentId: orderId,
        conversationId: orderId,
        rawResponse: response,
      });
    }
    const unknown = !!response.result && UNKNOWN_RESULTS.includes(response.result);
    return this.withErrorCode({
      status: unknown ? PaymentStatus.PENDING : PaymentStatus.FAILURE,
      ...(unknown ? { paymentId: orderId, conversationId: orderId } : {}),
      ...Lidio.errorOf(response),
      rawResponse: response,
    });
  }

  /** ProcessPayment request of a new card */
  private paymentFields(
    request: PaymentRequest,
    orderId: string,
    options: { preAuth: boolean; threeDS: boolean; returnUrl?: string }
  ) {
    const card = this.cardOf(request);
    const year = card.expireYear.length === 2 ? `20${card.expireYear}` : card.expireYear;
    return {
      orderId,
      merchantProcessId: orderId,
      totalAmount: formatLidioAmount(request.paidPrice ?? request.price),
      currency: getLidioCurrency(request.currency),
      customerInfo: {
        email: request.buyer?.email ?? '',
        customerId: request.buyer?.id ?? '',
        name: [request.buyer?.name, request.buyer?.surname].filter(Boolean).join(' '),
        phone: (request.buyer?.gsmNumber ?? '').replace(/[^\d+]/g, ''),
      },
      paymentInstrument: 'NewCard',
      paymentInstrumentInfo: {
        newCard: {
          processType: options.preAuth ? 'preauth' : 'sales',
          cardInfo: {
            cardHolderName: card.cardHolderName,
            cardNumber: card.cardNumber.replace(/\s/g, ''),
            lastMonth: Number(card.expireMonth),
            lastYear: Number(year),
          },
          cvv: card.cvc,
          use3DSecure: options.threeDS,
          installmentCount: formatLidioInstallment(request.installment),
          loyaltyPointUsage: 'None',
        },
      },
      ...(options.returnUrl ? { returnUrl: options.returnUrl } : {}),
      clientIp: request.buyer?.ip ?? '',
    };
  }

  /** Non-3D payment (ProcessPayment, sales) */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    return this.directPayment(request, false);
  }

  /** Non-3D pre-authorization (ProcessPayment, preauth); capture() it later */
  async authorize(request: PaymentRequest): Promise<PaymentResponse> {
    return this.directPayment(request, true);
  }

  private async directPayment(request: PaymentRequest, preAuth: boolean): Promise<PaymentResponse> {
    const orderId = request.conversationId || generateOrderId();
    let reached = false;
    try {
      this.validatePayment(request, { card: true });
      const body = this.paymentFields(request, orderId, { preAuth, threeDS: false });
      reached = true;
      const response = await this.post<LidioPaymentResponse>(LIDIO_ENDPOINTS.PAYMENT, body);
      return this.paymentResult(response, orderId);
    } catch (error) {
      const result = this.failure<PaymentResponse>(error, 'Payment failed');
      return reached && result.status === PaymentStatus.PENDING
        ? { ...result, paymentId: orderId, conversationId: orderId }
        : result;
    }
  }

  /**
   * 3D Secure payment (ProcessPayment with use3DSecure). `threeDSHtmlContent` is
   * Lidio's redirect form; after 3D Secure, Lidio sends the customer back to
   * `callbackUrl` with the result in the query string.
   */
  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    return this.threeDSPayment(request, false);
  }

  /** 3D Secure pre-authorization; complete it with completeThreeDSPayment() */
  async initThreeDSAuthorize(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    return this.threeDSPayment(request, true);
  }

  private async threeDSPayment(
    request: ThreeDSPaymentRequest,
    preAuth: boolean
  ): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, { card: true });
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }
      const response = await this.post<LidioPaymentResponse>(
        LIDIO_ENDPOINTS.PAYMENT,
        this.paymentFields(request, orderId, {
          preAuth,
          threeDS: true,
          returnUrl: request.callbackUrl,
        })
      );
      const form = nonEmpty(response.redirectForm);
      if (response.result === 'RedirectFormCreated' && form) {
        return this.withErrorCode({
          status: PaymentStatus.PENDING,
          threeDSHtmlContent: response.redirectForm as string,
          paymentId: orderId,
          conversationId: orderId,
          rawResponse: { ...response, redirectForm: undefined },
        });
      }
      return this.paymentResult(response, orderId);
    } catch (error) {
      return this.failure<ThreeDSInitResponse>(error, '3DS initialization failed', {
        paymentId: orderId,
        conversationId: orderId,
      });
    }
  }

  /**
   * Completes a 3D Secure payment from the return URL's query string. The order
   * comes from your records, in `context` (a separate argument, never read from
   * the callback): `orderId`, `amount`, `currency` and `customer`, the email or
   * customer id your account identifies customers by.
   *
   * The return's `Hash` must be Base64(SHA-256(OrderId:MerchantKey:TotalAmount:Result:customer)),
   * its OrderId must be yours and its TotalAmount your amount, as Lidio's docs
   * require; anything else is INVALID_HASH. A 3DSuccess is then charged with
   * FinishPaymentProcess, for your order and amount, and Lidio's answer decides.
   *
   * `paymentId` and `conversationId` are your order id, set for a payment Lidio
   * confirmed and on a timeout or an unknown result (`pending`); a failure carries
   * no ids.
   */
  async completeThreeDSPayment(
    callbackData: Lidio3DCallbackData,
    context: LidioCompleteContext = {}
  ): Promise<PaymentResponse> {
    const data = callbackData ?? {};
    const untrusted = (errorMessage: string): PaymentResponse =>
      this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'INVALID_HASH',
        errorMessage,
        rawResponse: data,
      });

    const orderId = nonEmpty(context.orderId);
    const customer = nonEmpty(context.customer);
    if (!orderId || context.amount === undefined || !customer) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'VALIDATION_ERROR',
        errorMessage:
          'completeThreeDSPayment() needs the order from your records: ' +
          'completeThreeDSPayment(query, { orderId, amount, currency, customer })',
        rawResponse: data,
      });
    }

    const expected = await createLidioReturnHash({
      orderId: data.OrderId ?? '',
      merchantKey: this.config.merchantKey,
      totalAmount: data.TotalAmount ?? '',
      result: data.Result ?? '',
      customer,
    });
    if (!safeEqual(expected, data.Hash)) return untrusted('Invalid 3D Secure return hash');
    if (data.OrderId !== orderId) return untrusted('3D Secure return is for another order');

    if (data.Result !== '3DSuccess') {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: nonEmpty(data.Result) ?? '3DFailed',
        errorMessage: `3D Secure authentication failed (mdStatus ${data.MDStatus ?? ''})`,
        rawResponse: data,
      });
    }

    let reached = false;
    try {
      if (toMinorUnits(data.TotalAmount ?? NaN) !== toMinorUnits(context.amount)) {
        return untrusted('3D Secure return amount differs from the order');
      }
      const systemTransId = nonEmpty(data.SystemTransId);
      if (!systemTransId) throw new ValidationError('3D Secure return is missing SystemTransId');
      const body = {
        orderId,
        totalAmount: formatLidioAmount(context.amount),
        currency: getLidioCurrency(context.currency),
        systemTransId,
        paymentInstrument: 'NewCard',
        paymentInstrumentInfo: { newCard: { posAccount: { id: 0 } } },
      };
      reached = true;
      const response = await this.post<LidioPaymentResponse>(LIDIO_ENDPOINTS.FINISH, body);
      const finishedOrder = nonEmpty(response.paymentInfo?.orderId);
      if (
        response.result === 'Success' &&
        finishedOrder !== undefined &&
        finishedOrder !== orderId
      ) {
        return untrusted('Lidio finished another order than yours');
      }
      return this.paymentResult(response, orderId);
    } catch (error) {
      // A timeout after Lidio was asked to charge: the outcome is unknown. The ids
      // are your order's, so it can be checked with getPayment()
      const result = this.failure<PaymentResponse>(error, '3D Secure completion failed');
      return reached && result.status === PaymentStatus.PENDING
        ? { ...result, paymentId: orderId, conversationId: orderId }
        : result;
    }
  }

  /** Charges a pre-authorization (Postauth); any amount up to the authorized one */
  async capture(request: CaptureRequest): Promise<PaymentResponse> {
    try {
      this.validateCapture(request);
      const response = await this.post<LidioPaymentResponse>(LIDIO_ENDPOINTS.POSTAUTH, {
        orderId: request.paymentId,
        totalAmount: formatLidioAmount(request.amount),
        currency: getLidioCurrency(request.currency),
        paymentInstrument: 'NewCard',
        clientIp: request.ip ?? '',
      });
      const approved = response.result === 'Success';
      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: request.paymentId,
        conversationId: request.paymentId,
        ...(approved ? {} : Lidio.errorOf(response)),
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Capture failed', {
        paymentId: request.paymentId,
      });
    }
  }

  private async void(paymentId: string, ip: string | undefined, conversationId?: string) {
    try {
      if (!paymentId) throw new ValidationError('paymentId is required');
      const response = await this.post<LidioPaymentResponse>(LIDIO_ENDPOINTS.CANCEL, {
        orderId: paymentId,
        paymentInstrument: 'NewCard',
        clientIp: ip ?? '',
      });
      const approved = response.result === 'Success';
      return this.withErrorCode<CancelResponse>({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        conversationId,
        ...(approved ? {} : Lidio.errorOf(response)),
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', { conversationId });
    }
  }

  /** Void of a payment (Cancel), before end of day. `paymentId` is the order id. */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    return this.void(request.paymentId, request.ip, request.conversationId);
  }

  /** Releases a pre-authorization (Cancel) */
  async voidAuthorization(request: VoidAuthorizationRequest): Promise<CancelResponse> {
    return this.void(request.paymentId, request.ip);
  }

  /**
   * Refund (Refund), full or partial. Lidio also reports `DuplicateRequest` for a
   * refund that already succeeded; that counts as success.
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const response = await this.post<LidioPaymentResponse>(LIDIO_ENDPOINTS.REFUND, {
        orderId: request.paymentId,
        totalAmount: formatLidioAmount(request.price),
        currency: getLidioCurrency(request.currency),
        paymentInstrument: 'NewCard',
        clientIp: request.ip ?? '',
      });
      const approved = response.result === 'Success' || response.result === 'DuplicateRequest';
      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: approved ? nonEmpty(response.paymentInfo?.systemTransId) : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : Lidio.errorOf(response)),
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /** Status of a sale (PaymentInquiry) by order id; see lidioPaymentStatus() */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      if (!paymentId) throw new ValidationError('paymentId is required');
      const response = await this.post<LidioPaymentResponse>(
        LIDIO_ENDPOINTS.INQUIRY,
        {
          orderId: paymentId,
          paymentInstrument: 'NewCard',
          paymentInquiryInstrumentInfo: { card: { processType: 'sales' } },
        },
        true
      );
      const status = lidioPaymentStatus(response);
      return this.withErrorCode({
        status,
        paymentId,
        conversationId: paymentId,
        ...(status === PaymentStatus.FAILURE ? Lidio.errorOf(response) : {}),
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Get payment failed', {
        paymentId,
        conversationId: paymentId,
      });
    }
  }

  private static bin(binNumber: string): string {
    const bin = (binNumber || '').replace(/\s/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(bin)) throw new ValidationError('binNumber must be at least 6 digits');
    return bin;
  }

  /** Card details for a BIN (GetBankOfBINNumber) */
  async binCheck(binNumber: string): Promise<BinCheckResponse> {
    const response = await this.post<LidioBinResponse>(
      LIDIO_ENDPOINTS.BIN,
      { bin: Lidio.bin(binNumber) },
      true
    );
    if (response.result !== 'Success') {
      throw new BetterPaymentError(
        `Lidio BIN query failed: ${response.result || 'no answer'}`,
        'PROVIDER_ERROR',
        'lidio'
      );
    }
    return {
      binNumber,
      cardType: response.isDebitCard ? 'DEBIT_CARD' : 'CREDIT_CARD',
      cardAssociation: lidioCardAssociation(response.cardType),
      cardFamily: response.cardProgramName || '',
      bankName: '',
      bankCode: Number(response.bankCode) || 0,
      commercial: response.isBusinessCard === true,
      rawResponse: response,
    };
  }

  /**
   * Installment options for a card (GetInstallmentInfo with the BIN and amount):
   * the counts of the POS Lidio picks for that BIN, with the total your account
   * charges the customer (`interestRateToUser`). Options for business cards only,
   * or below their minimum amount, are left out.
   */
  async installmentInfo(request: InstallmentInfoRequest): Promise<InstallmentInfoResponse> {
    try {
      const priceMinor = toMinorUnits(request.price);
      if (!(priceMinor > 0)) throw new ValidationError('price must be greater than 0');
      const response = await this.post<LidioInstallmentResponse>(
        LIDIO_ENDPOINTS.INSTALLMENTS,
        { bin: Lidio.bin(request.binNumber), amount: priceMinor / 100 },
        true
      );
      const pos = response.posList?.[0];
      if (response.result !== 'Success' || !pos) {
        throw new BetterPaymentError(
          `Lidio installment query failed: ${response.result || 'no options'}`,
          'PROVIDER_ERROR',
          'lidio'
        );
      }
      const prices = new Map<number, InstallmentDetail>();
      for (const option of pos.installmentOptionList ?? []) {
        const count = Math.max(1, Number(option.installmentCount) || 0);
        if (option.installmentAppliesTo === 'BusinessCards') continue;
        if (Number(option.baseInstallmentMinAmount) > priceMinor / 100) continue;
        const rate = Number(option.interestRateToUser) || 0;
        const totalMinor =
          option.totalAmountWithInterest != null
            ? toMinorUnits(option.totalAmountWithInterest)
            : Math.round(priceMinor * (1 + rate / 100));
        if (prices.has(count)) continue;
        prices.set(count, {
          installmentNumber: count,
          totalPrice: totalMinor / 100,
          installmentPrice: Math.round(totalMinor / count) / 100,
          commissionRate: rate,
        });
      }
      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        installmentDetails: [
          {
            binNumber: request.binNumber,
            price: priceMinor / 100,
            cardType: '',
            cardAssociation: '',
            cardFamilyName: '',
            bankCode: Number(pos.posBankCode) || 0,
            bankName: pos.posBankName || '',
            commercial: 0,
            installmentPrices: [...prices.values()].sort(
              (a, b) => a.installmentNumber - b.installmentNumber
            ),
          },
        ],
        conversationId: request.conversationId,
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<InstallmentInfoResponse>(error, 'Installment info failed', {
        conversationId: request.conversationId,
      });
    }
  }
}

/**
 * The Lidio provider, for
 * `betterPayment({ providers: { lidio: lidio({ merchantCode, apiKey, merchantKey }) } })`.
 * The base URL follows `mode` unless `baseUrl` is set.
 */
export const lidio = (config: LidioConfig): ProviderDefinition<Lidio> =>
  defineProvider((ctx) => new Lidio(withProviderDefaults(ProviderType.LIDIO, config, ctx)));
