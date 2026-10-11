import {
  defineProvider,
  ProviderType,
  type ProviderDefinition,
  type RemoteProviderType,
  withProviderDefaults,
} from '../../core/BetterPaymentConfig';
import type { HttpClient } from '../../core/http';
import { PaymentProvider } from '../../core/PaymentProvider';
import { ConfigurationError, ValidationError } from '../../core/errors';
import { failureResult, FailureResult } from '../../core/failure';
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
  CaptureRequest,
  VoidAuthorizationRequest,
  BinCheckResponse,
  InstallmentInfoRequest,
  InstallmentInfoResponse,
  PaymentStatus,
} from '../../types';
import {
  type ParatikaBrand,
  verifyParatikaCallback,
  formatParatikaAmount,
  getParatikaCurrency,
  formatParatikaExpiry,
  buildParatikaOrderItems,
  isParatikaApproved,
} from './utils';
import type {
  ParatikaConfig,
  Paratika3DCallbackData,
  ParatikaResponse,
  ParatikaTransaction,
} from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Errors that mean "card or issuer declined" are mapped by the bank's code in the text */
const PARATIKA_ERROR_CODES: Record<string, PaymentErrorCode> = {
  ERR10010: PaymentErrorCode.INVALID_REQUEST,
  ERR10015: PaymentErrorCode.PROVIDER_ERROR,
  ERR10016: PaymentErrorCode.INVALID_REQUEST,
  ERR10017: PaymentErrorCode.INVALID_REQUEST,
  ERR10020: PaymentErrorCode.PROVIDER_ERROR,
  ERR10022: PaymentErrorCode.INVALID_REQUEST,
  ERR10030: PaymentErrorCode.INVALID_REQUEST,
  ERR10045: PaymentErrorCode.INVALID_CARD,
  ERR10046: PaymentErrorCode.EXPIRED_CARD,
  ERR10048: PaymentErrorCode.DUPLICATE_ORDER,
  ERR10050: PaymentErrorCode.INVALID_HASH,
  ERR20005: PaymentErrorCode.CARD_DECLINED,
  ERR20014: PaymentErrorCode.INVALID_CARD,
  ERR20033: PaymentErrorCode.EXPIRED_CARD,
  ERR20034: PaymentErrorCode.FRAUD_SUSPECTED,
  ERR20041: PaymentErrorCode.FRAUD_SUSPECTED,
  ERR20043: PaymentErrorCode.FRAUD_SUSPECTED,
  ERR20051: PaymentErrorCode.INSUFFICIENT_FUNDS,
  ERR20054: PaymentErrorCode.EXPIRED_CARD,
  ERR20057: PaymentErrorCode.CARD_DECLINED,
  ERR20061: PaymentErrorCode.LIMIT_EXCEEDED,
  ERR20065: PaymentErrorCode.LIMIT_EXCEEDED,
  ERR20082: PaymentErrorCode.INVALID_CVC,
  ERR20084: PaymentErrorCode.INVALID_CVC,
  ERR30002: PaymentErrorCode.THREEDS_FAILED,
};

/**
 * Paratika (Payten) API v2, also run as VakıfPay and ZiraatPay
 *
 * - createPayment():          `SALE`
 * - initThreeDSPayment():     `SESSIONTOKEN`, then a Direct POST 3D form that the
 *                             customer's browser posts to `/post/sale3d/{token}`
 * - completeThreeDSPayment(): checks `sdSha512` (with `secretKey`) and confirms the
 *                             payment with `QUERYTRANSACTION`
 * - refund() `REFUND`, cancel() `VOID`, getPayment() `QUERYTRANSACTION`
 * - pre-authorization: authorize() `PREAUTH`, initThreeDSAuthorize() (3D authentication on
 *   `/post/auth3d/{token}`, then `PREAUTH` with the auth3DToken), capture() `POSTAUTH`,
 *   voidAuthorization() `VOID`
 * - binCheck() `QUERYBIN`, installmentInfo() `QUERYINSTALLMENT`
 *
 * `paymentId` is Paratika's pgTranId; `conversationId` is your order id (MERCHANTPAYMENTID).
 */
export class Paratika extends PaymentProvider<ParatikaConfig> {
  private client: HttpClient;

  constructor(config: ParatikaConfig) {
    super(config);

    this.client = this.createHttpClient('paratika', {
      timeout: 30000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    });
  }

  protected validateConfig(): void {
    const missing = (['merchant', 'merchantUser', 'merchantPassword'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(
        `Paratika configuration is missing: ${missing.join(', ')}`,
        'paratika'
      );
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('Paratika baseUrl (or a known brand) is required', 'paratika');
    }
  }

  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return { ...ISO8583_ERROR_CODES, ...PARATIKA_ERROR_CODES };
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('Paratika', error, fallback, extra));
  }

  private static errorOf(response: ParatikaResponse | Record<string, string | undefined>) {
    return {
      errorCode: (response.errorCode as string) || (response.responseCode as string) || undefined,
      errorMessage:
        (response.errorMsg as string) ||
        (response.pgTranErrorText as string) ||
        (response.responseMsg as string) ||
        undefined,
    };
  }

  private get credentials(): Record<string, string> {
    return {
      MERCHANT: this.config.merchant,
      MERCHANTUSER: this.config.merchantUser,
      MERCHANTPASSWORD: this.config.merchantPassword,
    };
  }

  private async api<T extends ParatikaResponse>(
    params: Record<string, string | undefined>,
    retryable = false
  ): Promise<T> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, ...this.credentials })) {
      if (value !== undefined) body.append(key, value);
    }
    const response = await this.client.post<T>('', body.toString(), { retryable });
    if (!response.data || typeof response.data !== 'object') {
      throw new Error('Paratika returned an unexpected response');
    }
    return response.data;
  }

  /** Order and customer fields shared by SALE, PREAUTH and SESSIONTOKEN */
  private orderFields(request: PaymentRequest, orderId: string): Record<string, string> {
    const amount = formatParatikaAmount(request.paidPrice ?? request.price);
    return {
      MERCHANTPAYMENTID: orderId,
      AMOUNT: amount,
      CURRENCY: getParatikaCurrency(request.currency),
      CUSTOMER: request.buyer.id,
      CUSTOMERNAME: `${request.buyer.name} ${request.buyer.surname}`.trim(),
      CUSTOMEREMAIL: request.buyer.email,
      CUSTOMERPHONE: request.buyer.gsmNumber,
      CUSTOMERIP: request.buyer.ip,
      ORDERITEMS: buildParatikaOrderItems(request.basketItems, amount),
    };
  }

  private paymentResult(response: ParatikaResponse, orderId: string): PaymentResponse {
    const approved = isParatikaApproved(response);
    return this.withErrorCode({
      status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
      paymentId: approved ? response.pgTranId || undefined : undefined,
      conversationId: orderId,
      ...(approved ? {} : Paratika.errorOf(response)),
      rawResponse: response,
    });
  }

  /** Non-3D sale (`SALE`) */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    return this.pay(request, 'SALE');
  }

  /** Non-3D pre-authorization (`PREAUTH`); capture it with capture() */
  async authorize(request: PaymentRequest): Promise<PaymentResponse> {
    return this.pay(request, 'PREAUTH');
  }

  private async pay(request: PaymentRequest, action: 'SALE' | 'PREAUTH'): Promise<PaymentResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, {
        card: true,
        required: ['buyer.id', 'buyer.email', 'buyer.gsmNumber'],
      });
      const card = this.cardOf(request);
      const expiry = formatParatikaExpiry(card.expireMonth, card.expireYear);
      const response = await this.api({
        ACTION: action,
        ...this.orderFields(request, orderId),
        CARDPAN: card.cardNumber.replace(/\s/g, ''),
        CARDEXPIRY: `${expiry.month}.${expiry.year}`,
        CARDCVV: card.cvc,
        NAMEONCARD: card.cardHolderName,
        INSTALLMENTS:
          request.installment && request.installment > 1 ? String(request.installment) : undefined,
      });
      return this.paymentResult(response, orderId);
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Payment failed', { conversationId: orderId });
    }
  }

  /**
   * 3D Secure payment (Direct POST 3D): a payment session is created with the
   * order, then the customer's browser posts the card straight to Paratika,
   * which runs 3D Secure and POSTs the result to callbackUrl.
   */
  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    return this.payThreeDS(request, 'sale3d');
  }

  /**
   * 3D pre-authorization: the same payment session, but the card is posted to
   * `/post/auth3d/{token}`, which only runs 3D authentication. The callback
   * carries an auth3DToken, and completeThreeDSPayment() blocks the amount with
   * `PREAUTH`. Capture it later with capture().
   */
  async initThreeDSAuthorize(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    return this.payThreeDS(request, 'auth3d');
  }

  private async payThreeDS(
    request: ThreeDSPaymentRequest,
    endpoint: 'sale3d' | 'auth3d'
  ): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, {
        card: true,
        required: ['buyer.id', 'buyer.email', 'buyer.gsmNumber'],
      });
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }
      const card = this.cardOf(request);
      const expiry = formatParatikaExpiry(card.expireMonth, card.expireYear);

      const session = await this.api({
        ACTION: 'SESSIONTOKEN',
        SESSIONTYPE: 'PAYMENTSESSION',
        RETURNURL: request.callbackUrl,
        ...this.orderFields(request, orderId),
      });
      if (!isParatikaApproved(session) || !session.sessionToken) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          conversationId: orderId,
          ...Paratika.errorOf(session),
          rawResponse: session,
        });
      }

      const fields: Record<string, string> = {
        cardOwner: card.cardHolderName,
        pan: card.cardNumber.replace(/\s/g, ''),
        expiryMonth: expiry.month,
        expiryYear: expiry.year,
        cvv: card.cvc,
        installmentCount: String(
          request.installment && request.installment > 1 ? request.installment : 1
        ),
      };
      const inputs = Object.entries(fields)
        .map(
          ([name, value]) =>
            `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
        )
        .join('');
      const action = `${this.config.baseUrl!.replace(/\/$/, '')}/post/${endpoint}/${encodeURIComponent(session.sessionToken)}`;
      const html =
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
        `<form id="paratika-3d-form" method="POST" action="${escapeHtml(action)}">${inputs}</form>` +
        '<script>document.getElementById("paratika-3d-form").submit();</script>' +
        '</body></html>';

      return this.withErrorCode({
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: html,
        conversationId: orderId,
        rawResponse: { responseCode: session.responseCode },
      });
    } catch (error) {
      return this.failure<ThreeDSInitResponse>(error, '3DS initialization failed', {
        conversationId: orderId,
      });
    }
  }

  /**
   * Completes the payment after the RETURNURL POST. With `secretKey`, a callback
   * whose `sdSha512` does not verify is rejected as INVALID_HASH. The payment is
   * then confirmed with QUERYTRANSACTION: an approved (AP) SALE of the same
   * merchantPaymentId must exist. The amount was fixed by the payment session
   * your server created.
   *
   * `paymentId` and `conversationId` are set only for a confirmed payment, and
   * on a timeout after Paratika was reached; a failure carries no ids.
   */
  async completeThreeDSPayment(callbackData: Paratika3DCallbackData): Promise<PaymentResponse> {
    const data = callbackData ?? {};
    if (data.auth3DToken !== undefined) {
      return this.completeThreeDSAuthorize(data);
    }
    const untrusted = (errorMessage: string, rawResponse: unknown): PaymentResponse =>
      this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'INVALID_HASH',
        errorMessage,
        rawResponse,
      });

    if (this.config.secretKey && !(await verifyParatikaCallback(data, this.config.secretKey))) {
      return untrusted('Invalid 3D Secure callback hash', data);
    }
    if (data.responseCode !== '00') {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        ...Paratika.errorOf(data),
        errorCode: data.errorCode || data.responseCode || 'INVALID_CALLBACK',
        rawResponse: data,
      });
    }

    let reached = false;
    try {
      if (!data.pgTranId || !data.merchantPaymentId) {
        throw new ValidationError('3D Secure callback is missing pgTranId or merchantPaymentId');
      }
      reached = true;
      const inquiry = await this.queryTransactions({ PGTRANID: data.pgTranId });
      const sale = (inquiry.transactionList ?? []).find(
        (transaction) =>
          transaction.pgTranId === data.pgTranId &&
          String(transaction.transactionStatus).toUpperCase() === 'AP' &&
          String(transaction.transactionType ?? 'SALE').toUpperCase() === 'SALE' &&
          (transaction.merchantPaymentId === undefined ||
            transaction.merchantPaymentId === data.merchantPaymentId)
      );
      if (!isParatikaApproved(inquiry) || !sale) {
        return untrusted('3D Secure callback does not match an approved payment', {
          callback: data,
          inquiry,
        });
      }
      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        paymentId: data.pgTranId,
        conversationId: data.merchantPaymentId,
        rawResponse: { callback: data, inquiry },
      });
    } catch (error) {
      const result = this.failure<PaymentResponse>(error, '3D Secure completion failed');
      return reached && result.status === PaymentStatus.PENDING
        ? { ...result, paymentId: data.pgTranId, conversationId: data.merchantPaymentId }
        : result;
    }
  }

  /**
   * After `/post/auth3d`: when the authentication succeeded and `mdStatus` is
   * accepted, the amount is blocked with `PREAUTH` on the same session; the
   * session your server created fixed the order and amount, and the bank's
   * answer decides. A failure carries no ids.
   */
  private async completeThreeDSAuthorize(data: Paratika3DCallbackData): Promise<PaymentResponse> {
    const accepted = this.config.acceptedMdStatuses ?? ['1'];
    if (data.responseCode !== '00' || !data.mdStatus || !accepted.includes(data.mdStatus)) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode:
          data.errorCode ||
          (data.responseCode === '00' ? `MD_STATUS_${data.mdStatus ?? ''}` : data.responseCode) ||
          'INVALID_CALLBACK',
        errorMessage:
          data.mdErrorMsg || data.errorMsg || data.responseMsg || '3D Secure authentication failed',
        rawResponse: data,
      });
    }

    let reached = false;
    try {
      if (!data.sessionToken || !data.auth3DToken) {
        throw new ValidationError('3D Secure callback is missing sessionToken or auth3DToken');
      }
      reached = true;
      const response = await this.api({
        ACTION: 'PREAUTH',
        SESSIONTOKEN: data.sessionToken,
        AUTH3DTOKEN: data.auth3DToken,
      });
      const approved = isParatikaApproved(response) && !!response.pgTranId;
      if (!approved) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          ...Paratika.errorOf(response),
          rawResponse: { callback: data, payment: response },
        });
      }
      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        paymentId: response.pgTranId,
        conversationId: response.merchantPaymentId || data.merchantPaymentId,
        rawResponse: { callback: data, payment: response },
      });
    } catch (error) {
      const result = this.failure<PaymentResponse>(error, '3D Secure completion failed');
      return reached && result.status === PaymentStatus.PENDING
        ? { ...result, conversationId: data.merchantPaymentId }
        : result;
    }
  }

  private queryTransactions(
    filter: Record<string, string>
  ): Promise<ParatikaResponse & { transactionList?: ParatikaTransaction[] }> {
    return this.api({ ACTION: 'QUERYTRANSACTION', ...filter }, true);
  }

  /** Refund of a sale of an earlier day (`REFUND`); a lower amount is a partial refund */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const response = await this.api({
        ACTION: 'REFUND',
        PGTRANID: request.paymentId,
        AMOUNT: formatParatikaAmount(request.price),
        CURRENCY: getParatikaCurrency(request.currency),
      });
      const approved = isParatikaApproved(response);
      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: approved ? response.pgTranId || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : Paratika.errorOf(response)),
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  private async void(paymentId: string, conversationId?: string): Promise<CancelResponse> {
    try {
      const response = await this.api({ ACTION: 'VOID', PGTRANID: paymentId });
      const approved = isParatikaApproved(response);
      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        transactionId: approved ? response.pgTranId || undefined : undefined,
        conversationId,
        ...(approved ? {} : Paratika.errorOf(response)),
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', { conversationId });
    }
  }

  /** Same-day cancel (`VOID`) */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    return this.void(request.paymentId, request.conversationId);
  }

  /** Releases a pre-authorization (`VOID`) */
  async voidAuthorization(request: VoidAuthorizationRequest): Promise<CancelResponse> {
    return this.void(request.paymentId, request.conversationId);
  }

  /** Captures a pre-authorization (`POSTAUTH`); a lower amount captures part of it */
  async capture(request: CaptureRequest): Promise<PaymentResponse> {
    try {
      this.validateCapture(request);
      const response = await this.api({
        ACTION: 'POSTAUTH',
        PGTRANID: request.paymentId,
        AMOUNT: formatParatikaAmount(request.amount),
      });
      return this.paymentResult(response, request.conversationId ?? '');
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Capture failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Payment status (`QUERYTRANSACTION`). `paymentId` is the pgTranId. An approved
   * sale is `success`, or `cancelled` once the order has an approved VOID or REFUND.
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const inquiry = await this.queryTransactions({ PGTRANID: paymentId });
      const transaction = (inquiry.transactionList ?? []).find((t) => t.pgTranId === paymentId);
      if (!isParatikaApproved(inquiry) || !transaction) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          paymentId,
          ...(isParatikaApproved(inquiry)
            ? { errorCode: 'ERR10030', errorMessage: 'Transaction not found' }
            : Paratika.errorOf(inquiry)),
          rawResponse: inquiry,
        });
      }

      const orderId = transaction.merchantPaymentId;
      let order: ParatikaTransaction[] = [];
      if (orderId) {
        const history = await this.queryTransactions({ MERCHANTPAYMENTID: orderId });
        if (isParatikaApproved(history)) order = history.transactionList ?? [];
      }
      const approved = (t: ParatikaTransaction) =>
        String(t.transactionStatus).toUpperCase() === 'AP';
      const reversed = order.some(
        (t) => approved(t) && ['VOID', 'REFUND'].includes(String(t.transactionType).toUpperCase())
      );
      const status = !approved(transaction)
        ? PaymentStatus.FAILURE
        : reversed
          ? PaymentStatus.CANCELLED
          : PaymentStatus.SUCCESS;

      return this.withErrorCode({
        status,
        paymentId,
        conversationId: orderId,
        rawResponse: { transaction, order },
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Get payment failed', { paymentId });
    }
  }

  /** Card details by BIN (`QUERYBIN`) */
  async binCheck(binNumber: string): Promise<BinCheckResponse> {
    const response = await this.api<ParatikaResponse & { bin?: Record<string, string> }>(
      { ACTION: 'QUERYBIN', BIN: binNumber.slice(0, 8) },
      true
    );
    if (!isParatikaApproved(response) || !response.bin) {
      const { errorCode, errorMessage } = Paratika.errorOf(response);
      throw new ValidationError(
        `BIN query failed: ${errorCode ?? ''} ${errorMessage ?? ''}`.trim()
      );
    }
    const bin = response.bin;
    return {
      binNumber,
      cardType: bin.cardType ? `${bin.cardType}_CARD` : '',
      cardAssociation: (bin.cardBrand || '').toUpperCase().replace('MASTERCARD', 'MASTER_CARD'),
      cardFamily: bin.cardNetwork || '',
      bankName: bin.issuer || '',
      bankCode: 0,
      commercial: (bin.cardLevel || '').toUpperCase() === 'BUSINESS',
      rawResponse: response,
    };
  }

  /**
   * Installment options for a BIN (`QUERYINSTALLMENT`), with totals from the
   * customer cost commission rates of your account
   */
  async installmentInfo(request: InstallmentInfoRequest): Promise<InstallmentInfoResponse> {
    try {
      const priceMinor = toMinorUnits(request.price);
      if (!(priceMinor > 0)) throw new ValidationError('price must be greater than 0');
      const response = await this.api<
        ParatikaResponse & {
          paymentSystemList?: Array<{
            name?: string;
            installmentList?: Array<{ count?: string; customerCostCommissionRate?: number }>;
          }>;
        }
      >({ ACTION: 'QUERYINSTALLMENT', BIN: request.binNumber.slice(0, 8) }, true);
      if (!isParatikaApproved(response)) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          conversationId: request.conversationId,
          ...Paratika.errorOf(response),
          rawResponse: response,
        });
      }

      const system = response.paymentSystemList?.[0];
      const options = (system?.installmentList ?? [])
        .filter((option) => /^\d+$/.test(String(option.count)))
        .map((option) => {
          const installmentNumber = Number(option.count);
          const rate = Number(option.customerCostCommissionRate) || 0;
          const totalMinor = Math.round(priceMinor * (1 + rate / 100));
          return {
            installmentNumber,
            totalPrice: totalMinor / 100,
            installmentPrice: Math.round(totalMinor / installmentNumber) / 100,
            commissionRate: rate,
          };
        });
      if (!options.some((option) => option.installmentNumber === 1)) {
        options.push({
          installmentNumber: 1,
          totalPrice: priceMinor / 100,
          installmentPrice: priceMinor / 100,
          commissionRate: 0,
        });
      }
      options.sort((a, b) => a.installmentNumber - b.installmentNumber);

      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        installmentDetails: [
          {
            binNumber: request.binNumber,
            price: priceMinor / 100,
            cardType: '',
            cardAssociation: '',
            cardFamilyName: system?.name || '',
            bankCode: 0,
            bankName: system?.name || '',
            commercial: 0,
            installmentPrices: options,
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

const PARATIKA_PROVIDER_TYPES: Record<ParatikaBrand, RemoteProviderType> = {
  paratika: ProviderType.PARATIKA,
  vakifpay: ProviderType.VAKIFPAY,
  ziraatpay: ProviderType.ZIRAATPAY,
};

/**
 * A Paratika (Payten) provider, for
 * `betterPayment({ providers: { vakifpay: paratika({ brand: 'vakifpay', merchant, merchantUser, merchantPassword }) } })`.
 * The base URL follows `mode` and `brand` unless `baseUrl` is set.
 */
export const paratika = (config: ParatikaConfig): ProviderDefinition<Paratika> =>
  defineProvider((ctx) => {
    const type: RemoteProviderType | undefined =
      PARATIKA_PROVIDER_TYPES[config.brand ?? 'paratika'];
    if (type) {
      return new Paratika(withProviderDefaults(type, config, ctx));
    }
    return new Paratika({
      ...withProviderDefaults(ProviderType.PARATIKA, config, ctx),
      baseUrl: config.baseUrl,
    });
  });
