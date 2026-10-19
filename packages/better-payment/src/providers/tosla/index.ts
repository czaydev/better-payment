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
  BinCheckResponse,
  InstallmentInfoRequest,
  InstallmentInfoResponse,
  PaymentStatus,
} from '../../types';
import {
  TOSLA_ENDPOINTS,
  createToslaHash,
  formatToslaAmount,
  formatToslaExpiry,
  formatToslaInstallment,
  formatToslaTimeSpan,
  generateToslaRandom,
  getToslaCurrencyCode,
  toslaCardAssociation,
  toslaInstallmentRates,
} from './utils';
import type {
  ToslaConfig,
  Tosla3DCallbackData,
  ToslaCompleteContext,
  ToslaCommissionResponse,
  ToslaInquiryResponse,
  ToslaResponse,
  ToslaReversalResponse,
  ToslaThreeDResponse,
} from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nonEmpty(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

/**
 * A refund or void is approved only when Tosla accepted it (`Code` 0) and, when
 * the answer carries the bank's code, the bank approved it too (`00`).
 */
function isToslaReversalApproved(result: ToslaReversalResponse): boolean {
  const bankCode = nonEmpty(result.BankResponseCode);
  return result.Code === 0 && (bankCode === undefined || bankCode === '00');
}

/**
 * Maps an inquiry answer: no record is a failure, a declined payment failed, a
 * (partly) refunded one is cancelled, an approved one succeeded.
 */
export function toslaOrderStatus(inquiry: ToslaInquiryResponse): PaymentStatus {
  if (inquiry.Code !== 0 || !nonEmpty(inquiry.OrderId)) return PaymentStatus.FAILURE;
  if (inquiry.BankResponseCode !== '00') return PaymentStatus.FAILURE;
  if (Number(inquiry.RefundedAmount) > 0) return PaymentStatus.CANCELLED;
  return PaymentStatus.SUCCESS;
}

/**
 * Tosla İşim (AKÖde) virtual POS
 *
 * - initThreeDSPayment():     threeDPayment opens a session; the customer's browser
 *                             posts the card to ProcessCardForm
 * - completeThreeDSPayment(): the callback is not signed, so the result is
 *                             confirmed with an inquiry
 * - refund() `refund`, cancel() `void`; getPayment() is not supported yet (see there)
 * - binCheck() / installmentInfo(): GetCommissionAndInstallmentInfo
 *
 * Every request is signed with base64(SHA-512(apiPass + clientId + apiUser + Rnd +
 * timeSpan)). `paymentId` is your order id: the `conversationId` you pass, or a
 * generated one.
 */
export class Tosla extends PaymentProvider<ToslaConfig> {
  private client: HttpClient;

  constructor(config: ToslaConfig) {
    super(config);

    this.client = this.createHttpClient('tosla', {
      timeout: 30000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
  }

  protected validateConfig(): void {
    const missing = (['clientId', 'apiUser', 'apiPass'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(
        `Tosla configuration is missing: ${missing.join(', ')}`,
        'tosla'
      );
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('Tosla baseUrl is required', 'tosla');
    }
  }

  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return ISO8583_ERROR_CODES;
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('Tosla', error, fallback, extra));
  }

  /** The bank's code when it declined, else Tosla's own code */
  private static errorOf(
    data: ToslaResponse & { BankResponseCode?: string | null; BankResponseMessage?: string | null }
  ) {
    const bankDeclined = nonEmpty(data.BankResponseCode) && data.BankResponseCode !== '00';
    return {
      errorCode: bankDeclined
        ? (data.BankResponseCode as string)
        : data.Code !== undefined && data.Code !== 0
          ? String(data.Code)
          : undefined,
      errorMessage:
        (bankDeclined ? nonEmpty(data.BankResponseMessage) : undefined) ?? nonEmpty(data.Message),
    };
  }

  /** Signs and posts a request */
  private async post<T extends ToslaResponse>(
    endpoint: string,
    body: Record<string, unknown>,
    retryable = false
  ): Promise<T> {
    const rnd = generateToslaRandom();
    const timeSpan = formatToslaTimeSpan();
    const signed = {
      ...body,
      clientId: Number(this.config.clientId),
      apiUser: this.config.apiUser,
      Rnd: rnd,
      timeSpan,
      Hash: await createToslaHash({
        apiPass: this.config.apiPass,
        clientId: this.config.clientId,
        apiUser: this.config.apiUser,
        rnd,
        timeSpan,
      }),
    };
    const response = await this.client.post<T>(endpoint, JSON.stringify(signed), {
      retryable,
      validateStatus: (status) => status < 500,
    });
    return (response.data ?? {}) as T;
  }

  private inquiry(orderId: string): Promise<ToslaInquiryResponse> {
    return this.post<ToslaInquiryResponse>(TOSLA_ENDPOINTS.INQUIRY, { OrderId: orderId }, true);
  }

  async createPayment(_request: PaymentRequest): Promise<PaymentResponse> {
    throw new BetterPaymentError(
      'Tosla payments are processed with 3D Secure: use initThreeDSPayment().',
      'NOT_SUPPORTED',
      'tosla'
    );
  }

  /**
   * 3D Secure payment: threeDPayment opens a session for the order, then an
   * auto-submitting form posts the card from the customer's browser to
   * ProcessCardForm. Tosla runs 3D Secure and POSTs the result to callbackUrl.
   */
  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, { card: true });
      const card = this.cardOf(request);
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }
      const installment = formatToslaInstallment(request.installment);
      const expiry = formatToslaExpiry(card.expireMonth, card.expireYear);

      const session = await this.post<ToslaThreeDResponse>(TOSLA_ENDPOINTS.THREE_D_PAYMENT, {
        callbackUrl: request.callbackUrl,
        orderId,
        amount: formatToslaAmount(request.paidPrice ?? request.price),
        currency: getToslaCurrencyCode(request.currency),
        installmentCount: installment,
      });
      const sessionId = nonEmpty(session.ThreeDSessionId);
      if (session.Code !== 0 || !sessionId) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          ...Tosla.errorOf(session),
          rawResponse: session,
        });
      }

      const fields: Record<string, string> = {
        ThreeDSessionId: sessionId,
        CardHolderName: card.cardHolderName,
        CardNo: card.cardNumber.replace(/\s/g, ''),
        ExpireDate: expiry,
        Cvv: card.cvc,
        installment: String(installment),
      };
      const inputs = Object.entries(fields)
        .map(
          ([name, value]) =>
            `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
        )
        .join('');
      const action = `${this.config.baseUrl}${TOSLA_ENDPOINTS.PROCESS_CARD_FORM}`;
      const html =
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
        `<form id="tosla-3d-form" method="POST" action="${escapeHtml(action)}">${inputs}</form>` +
        '<script>document.getElementById("tosla-3d-form").submit();</script>' +
        '</body></html>';

      return this.withErrorCode({
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: html,
        paymentId: orderId,
        conversationId: orderId,
        rawResponse: session,
      });
    } catch (error) {
      return this.failure<ThreeDSInitResponse>(error, '3DS initialization failed', {
        paymentId: orderId,
        conversationId: orderId,
      });
    }
  }

  /**
   * Completes the payment after the callbackUrl POST. The callback is not
   * signed, so only the order id is taken from it (or `context.orderId` from
   * your records); the result, amount and status come from an inquiry. A
   * callback claiming a payment the bank does not confirm is rejected as
   * INVALID_HASH. `context` is read only from the second argument, never from
   * the callback body.
   *
   * `paymentId` and `conversationId` are set only for a payment the bank
   * confirmed, and on a timeout of that inquiry only when `context.orderId`
   * was given.
   */
  async completeThreeDSPayment(
    callbackData: Tosla3DCallbackData,
    context: ToslaCompleteContext = {}
  ): Promise<PaymentResponse> {
    const data = callbackData ?? {};
    const trustedOrderId = nonEmpty(context.orderId);
    const orderId = trustedOrderId ?? nonEmpty(data.OrderId) ?? nonEmpty(data.orderid);
    if (!orderId) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'The callback carries no order id: pass orderId from your records',
        rawResponse: data,
      });
    }

    // A failure the callback reports needs no confirmation and carries no ids
    const reported = nonEmpty(data.BankResponseCode);
    if (reported && reported !== '00') {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: reported,
        errorMessage: nonEmpty(data.BankResponseMessage) ?? '3D Secure payment failed',
        rawResponse: data,
      });
    }

    try {
      const inquiry = await this.inquiry(orderId);
      const approved =
        toslaOrderStatus(inquiry) === PaymentStatus.SUCCESS && inquiry.OrderId === orderId;
      const amountMatches =
        context.amount === undefined || Number(inquiry.Amount) === toMinorUnits(context.amount);

      if (!approved || !amountMatches) {
        if (
          inquiry.Code === 0 &&
          nonEmpty(inquiry.BankResponseCode) &&
          inquiry.BankResponseCode !== '00'
        ) {
          return this.withErrorCode({
            status: PaymentStatus.FAILURE,
            ...Tosla.errorOf(inquiry),
            rawResponse: { callback: data, inquiry },
          });
        }
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          errorCode: 'INVALID_HASH',
          errorMessage: '3D Secure callback does not match the order at Tosla',
          rawResponse: { callback: data, inquiry },
        });
      }
      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        paymentId: orderId,
        conversationId: orderId,
        rawResponse: { callback: data, inquiry },
      });
    } catch (error) {
      const result = this.failure<PaymentResponse>(error, '3D Secure completion failed');
      // A timeout while asking Tosla about the order: the outcome is unknown. The
      // ids are kept only when the order came from your records
      // (`context.orderId`); an unsigned callback's OrderId is not trusted.
      return result.status === PaymentStatus.PENDING && trustedOrderId !== undefined
        ? { ...result, paymentId: orderId, conversationId: orderId }
        : result;
    }
  }

  /** Refund (`refund`), full or partial. `paymentId` is the order id. */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const result = await this.post<ToslaReversalResponse>(TOSLA_ENDPOINTS.REFUND, {
        OrderId: request.paymentId,
        Amount: formatToslaAmount(request.price),
      });
      const approved = isToslaReversalApproved(result);
      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: approved ? nonEmpty(result.TransactionId) : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : Tosla.errorOf(result)),
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /** Cancel (`void`), the same day. `paymentId` is the order id. */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      if (!request.paymentId) throw new ValidationError('paymentId is required');
      const result = await this.post<ToslaReversalResponse>(TOSLA_ENDPOINTS.VOID, {
        OrderId: request.paymentId,
      });
      const approved = isToslaReversalApproved(result);
      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        conversationId: request.conversationId,
        ...(approved ? {} : Tosla.errorOf(result)),
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Not supported yet: it is not confirmed how a same-day void shows in the
   * `inquiry` answer (refunds show in `RefundedAmount`), so a voided payment
   * could be reported as paid. Completion still confirms a new payment with
   * `inquiry`.
   */
  async getPayment(_paymentId: string): Promise<PaymentResponse> {
    throw this.notSupported(
      'Payment status',
      "it is not confirmed how a void shows in Tosla's inquiry answer"
    );
  }

  private async commission(binNumber: string): Promise<ToslaCommissionResponse> {
    const bin = (binNumber || '').replace(/\s/g, '').slice(0, 8);
    if (!/^\d{6,8}$/.test(bin)) throw new ValidationError('binNumber must be 6 to 8 digits');
    const result = await this.post<ToslaCommissionResponse>(
      TOSLA_ENDPOINTS.COMMISSION,
      { Bin: bin },
      true
    );
    if (result.Code !== 0) {
      const { errorCode, errorMessage } = Tosla.errorOf(result);
      throw new BetterPaymentError(
        `${errorMessage ?? 'Commission and installment query failed'}${errorCode ? ` (${errorCode})` : ''}`,
        'PROVIDER_ERROR',
        'tosla'
      );
    }
    return result;
  }

  /** Card details for a BIN (GetCommissionAndInstallmentInfo) */
  async binCheck(binNumber: string): Promise<BinCheckResponse> {
    const info = await this.commission(binNumber);
    return {
      binNumber,
      cardType: info.CardType || '',
      cardAssociation: toslaCardAssociation(binNumber),
      cardFamily: info.CardName || '',
      bankName: info.BankName || '',
      bankCode: Number(info.BankCode) || 0,
      commercial: /ticari|commercial|business|corporate/i.test(info.CardClass || ''),
      rawResponse: info,
    };
  }

  /**
   * Installment options for a card (GetCommissionAndInstallmentInfo): the
   * counts your account allows, each total adding its commission rate.
   */
  async installmentInfo(request: InstallmentInfoRequest): Promise<InstallmentInfoResponse> {
    try {
      const priceMinor = toMinorUnits(request.price);
      if (!(priceMinor > 0)) throw new ValidationError('price must be greater than 0');
      const info = await this.commission(request.binNumber);
      const rates = toslaInstallmentRates(info.CommissionPackages?.[0]?.InstallmentRate);

      const installmentPrices = rates.map(({ count, rate }) => {
        const totalMinor = Math.round(priceMinor * (1 + rate / 100));
        return {
          installmentNumber: count,
          totalPrice: totalMinor / 100,
          installmentPrice: Math.round(totalMinor / count) / 100,
          commissionRate: rate,
        };
      });

      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        installmentDetails: [
          {
            binNumber: request.binNumber,
            price: priceMinor / 100,
            cardType: info.CardType || '',
            cardAssociation: toslaCardAssociation(request.binNumber),
            cardFamilyName: info.CardName || '',
            bankCode: Number(info.BankCode) || 0,
            bankName: info.BankName || '',
            commercial: /ticari|commercial|business|corporate/i.test(info.CardClass || '') ? 1 : 0,
            installmentPrices,
          },
        ],
        conversationId: request.conversationId,
        rawResponse: info,
      });
    } catch (error) {
      return this.failure<InstallmentInfoResponse>(error, 'Installment info failed', {
        conversationId: request.conversationId,
      });
    }
  }
}

/**
 * The Tosla provider, for
 * `betterPayment({ providers: { tosla: tosla({ clientId, apiUser, apiPass }) } })`.
 * The base URL follows `mode` unless `baseUrl` is set.
 */
export const tosla = (config: ToslaConfig): ProviderDefinition<Tosla> =>
  defineProvider((ctx) => new Tosla(withProviderDefaults(ProviderType.TOSLA, config, ctx)));
