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
import { PaymentErrorCode } from '../../core/error-codes';
import { generateOrderId, safeEqual, toMinorUnits } from '../../core/utils';
import {
  PaymentRequest,
  PaymentResponse,
  ThreeDSPaymentRequest,
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
  MOKAUNITED_ENDPOINTS,
  MOKAUNITED_SUCCESS,
  createMokaUnitedCheckKey,
  createMokaUnitedHashValue,
  formatMokaUnitedAmount,
  formatMokaUnitedInstallment,
  getMokaUnitedCurrency,
  mokaUnitedCardAssociation,
} from './utils';
import type {
  MokaUnitedAmountData,
  MokaUnitedBankCard,
  MokaUnitedConfig,
  MokaUnited3DCallbackData,
  MokaUnitedCompleteContext,
  MokaUnitedOperationData,
  MokaUnitedPaymentDetailData,
  MokaUnitedResponse,
  MokaUnitedThreeDData,
  MokaUnitedThreeDSInitResponse,
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
 * Maps a payment detail (GetDealerPaymentTrxDetailList) as the Sipay provider does:
 * a voided or fully refunded payment is cancelled; an approved payment or
 * pre-authorization (also after a partial refund) succeeded; a failed one failed;
 * a waiting one, or no detail, is pending.
 */
export function mokaUnitedPaymentStatus(
  data: MokaUnitedPaymentDetailData | null | undefined
): PaymentStatus {
  const detail = data?.PaymentDetail;
  if (!data?.IsSuccessful || !detail) return PaymentStatus.PENDING;
  if (detail.TrxStatus === 2) return PaymentStatus.FAILURE;
  if (detail.TrxStatus !== 1) return PaymentStatus.PENDING;
  switch (detail.PaymentStatus) {
    case 1:
    case 2:
      return PaymentStatus.SUCCESS;
    case 3:
    case 4:
      return PaymentStatus.CANCELLED;
    default:
      return PaymentStatus.PENDING;
  }
}

/**
 * Moka United (DoDirectPayment / DoDirectPaymentThreeD)
 *
 * - createPayment() / authorize():             DoDirectPayment (IsPreAuth 0 / 1)
 * - initThreeDSPayment() / initThreeDSAuthorize(): DoDirectPaymentThreeD; returns
 *   the 3D page URL and the payment's CodeForHash, which you keep with the order
 * - completeThreeDSPayment():                  checks hashValue against that CodeForHash,
 *   then confirms the payment with GetDealerPaymentTrxDetailList
 * - capture() DoCapture, cancel() / voidAuthorization() DoVoid,
 *   refund() DoCreateRefundRequest (a refund request: pending)
 * - getPayment(): GetDealerPaymentTrxDetailList
 * - binCheck() GetBankCardInformation, installmentInfo() DoCalcPaymentAmount
 *
 * `paymentId` is your order id (OtherTrxCode): the `conversationId` you pass, or a
 * generated one. Every request carries the dealer's CheckKey.
 */
export class MokaUnited extends PaymentProvider<MokaUnitedConfig> {
  private client: HttpClient;
  private checkKey?: Promise<string>;

  constructor(config: MokaUnitedConfig) {
    super(config);

    this.client = this.createHttpClient('mokaunited', {
      timeout: 60000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
  }

  protected validateConfig(): void {
    const missing = (['dealerCode', 'username', 'password'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(
        `Moka United configuration is missing: ${missing.join(', ')}`,
        'mokaunited'
      );
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('Moka United baseUrl is required', 'mokaunited');
    }
  }

  /** Moka United's bank result codes ("Hata Kodları") and request errors */
  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return {
      '001': PaymentErrorCode.CARD_DECLINED,
      '002': PaymentErrorCode.INSUFFICIENT_FUNDS,
      '003': PaymentErrorCode.INVALID_CARD,
      '004': PaymentErrorCode.CARD_DECLINED,
      '005': PaymentErrorCode.CARD_DECLINED,
      '006': PaymentErrorCode.EXPIRED_CARD,
      '012': PaymentErrorCode.INVALID_CARD,
      '015': PaymentErrorCode.INVALID_CVC,
      '018': PaymentErrorCode.FRAUD_SUSPECTED,
      '019': PaymentErrorCode.FRAUD_SUSPECTED,
      '020': PaymentErrorCode.CARD_DECLINED,
      '021': PaymentErrorCode.NETWORK_ERROR,
      '023': PaymentErrorCode.FRAUD_SUSPECTED,
      '024': PaymentErrorCode.THREEDS_FAILED,
      '025': PaymentErrorCode.THREEDS_FAILED,
      '026': PaymentErrorCode.THREEDS_FAILED,
      '028': PaymentErrorCode.FRAUD_SUSPECTED,
      '029': PaymentErrorCode.CARD_DECLINED,
      'PaymentDealer.CheckCardInfo.InvalidCardInfo': PaymentErrorCode.INVALID_CARD,
      'PaymentDealer.CheckDealerPaymentLimits.DailyDealerLimitExceeded':
        PaymentErrorCode.LIMIT_EXCEEDED,
      'PaymentDealer.CheckDealerPaymentLimits.DailyCardLimitExceeded':
        PaymentErrorCode.LIMIT_EXCEEDED,
      'PaymentDealer.DoDirectPayment.ThreeDRequired': PaymentErrorCode.INVALID_REQUEST,
      'PaymentDealer.CheckPaymentDealerAuthentication.InvalidRequest':
        PaymentErrorCode.INVALID_REQUEST,
      'PaymentDealer.CheckPaymentDealerAuthentication.InvalidAccount':
        PaymentErrorCode.PROVIDER_ERROR,
      'GetDealerIdWithName.UsernameOrPasswordInvalid': PaymentErrorCode.PROVIDER_ERROR,
    };
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('Moka United', error, fallback, extra));
  }

  /** The error of an answer: the bank's code inside Data, else the envelope's code */
  private static errorOf(response: MokaUnitedResponse<MokaUnitedOperationData>) {
    const data = response.Data;
    if (response.ResultCode !== MOKAUNITED_SUCCESS || !data) {
      return {
        errorCode: nonEmpty(response.ResultCode),
        errorMessage: nonEmpty(response.ResultMessage) ?? nonEmpty(response.ResultCode),
      };
    }
    return {
      errorCode: nonEmpty(data.ResultCode),
      errorMessage: nonEmpty(data.ResultMessage),
    };
  }

  private static isApproved(response: MokaUnitedResponse<MokaUnitedOperationData>): boolean {
    return response.ResultCode === MOKAUNITED_SUCCESS && response.Data?.IsSuccessful === true;
  }

  private async authentication() {
    this.checkKey ??= createMokaUnitedCheckKey(this.config);
    return {
      DealerCode: this.config.dealerCode,
      Username: this.config.username,
      Password: this.config.password,
      CheckKey: await this.checkKey,
    };
  }

  private async post<T>(
    endpoint: string,
    body: Record<string, unknown>,
    retryable = false
  ): Promise<MokaUnitedResponse<T>> {
    const response = await this.client.post<MokaUnitedResponse<T>>(
      endpoint,
      JSON.stringify({ PaymentDealerAuthentication: await this.authentication(), ...body }),
      { retryable, validateStatus: (status) => status < 500 }
    );
    return response.data ?? {};
  }

  /** PaymentDealerRequest of a card payment */
  private paymentFields(request: PaymentRequest, orderId: string, preAuth: boolean) {
    const card = this.cardOf(request);
    return {
      CardHolderFullName: card.cardHolderName,
      CardNumber: card.cardNumber.replace(/\s/g, ''),
      ExpMonth: card.expireMonth.padStart(2, '0'),
      ExpYear: card.expireYear.length === 2 ? `20${card.expireYear}` : card.expireYear,
      CvcNumber: card.cvc,
      CardToken: '',
      Amount: formatMokaUnitedAmount(request.paidPrice ?? request.price),
      Currency: getMokaUnitedCurrency(request.currency),
      InstallmentNumber: formatMokaUnitedInstallment(request.installment),
      ClientIP: request.buyer?.ip ?? '',
      OtherTrxCode: orderId,
      IsPoolPayment: 0,
      IsPreAuth: preAuth ? 1 : 0,
      IsTokenized: 0,
      Software: (this.config.software || 'better-payment').slice(0, 30),
      Description: '',
      BuyerInformation: {
        BuyerFullName: [request.buyer?.name, request.buyer?.surname].filter(Boolean).join(' '),
        BuyerEmail: request.buyer?.email ?? '',
        BuyerGsmNumber: (request.buyer?.gsmNumber ?? '').replace(/\D/g, '').slice(-10),
        BuyerAddress: request.billingAddress?.address ?? request.buyer?.registrationAddress ?? '',
      },
    };
  }

  /** Non-3D payment (DoDirectPayment); Moka United enables it per dealer */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    return this.directPayment(request, false);
  }

  /** Non-3D pre-authorization (DoDirectPayment, IsPreAuth 1) */
  async authorize(request: PaymentRequest): Promise<PaymentResponse> {
    return this.directPayment(request, true);
  }

  private async directPayment(request: PaymentRequest, preAuth: boolean): Promise<PaymentResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, { card: true, required: ['buyer.ip'] });
      const response = await this.post<MokaUnitedOperationData>(MOKAUNITED_ENDPOINTS.PAYMENT, {
        PaymentDealerRequest: this.paymentFields(request, orderId, preAuth),
      });
      const approved = MokaUnited.isApproved(response);
      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        ...(approved
          ? { paymentId: orderId, conversationId: orderId }
          : MokaUnited.errorOf(response)),
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Payment failed', {
        paymentId: orderId,
        conversationId: orderId,
      });
    }
  }

  /**
   * 3D Secure payment (DoDirectPaymentThreeD). Returns Moka United's 3D page as
   * `redirectUrl` (and an auto-redirecting page), and `codeForHash`: keep it with
   * the order, server side, for completeThreeDSPayment().
   */
  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<MokaUnitedThreeDSInitResponse> {
    return this.threeDSPayment(request, false);
  }

  /** 3D Secure pre-authorization; complete it with completeThreeDSPayment() */
  async initThreeDSAuthorize(
    request: ThreeDSPaymentRequest
  ): Promise<MokaUnitedThreeDSInitResponse> {
    return this.threeDSPayment(request, true);
  }

  private async threeDSPayment(
    request: ThreeDSPaymentRequest,
    preAuth: boolean
  ): Promise<MokaUnitedThreeDSInitResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, { card: true, required: ['buyer.ip'] });
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }
      const response = await this.post<MokaUnitedThreeDData>(MOKAUNITED_ENDPOINTS.PAYMENT_3D, {
        PaymentDealerRequest: {
          ...this.paymentFields(request, orderId, preAuth),
          ReturnHash: 1,
          RedirectUrl: request.callbackUrl,
          RedirectType: 0,
        },
      });
      const url = nonEmpty(response.Data?.Url);
      const codeForHash = nonEmpty(response.Data?.CodeForHash);
      if (response.ResultCode !== MOKAUNITED_SUCCESS || !url || !codeForHash) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          ...MokaUnited.errorOf(response as MokaUnitedResponse<MokaUnitedOperationData>),
          rawResponse: response,
        });
      }
      const html =
        '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
        `<meta http-equiv="refresh" content="0;url=${escapeHtml(url)}"></head><body>` +
        `<script>window.location.replace(${JSON.stringify(url).replace(/</g, '\\u003c')});</script>` +
        '</body></html>';
      return this.withErrorCode({
        status: PaymentStatus.PENDING,
        redirectUrl: url,
        threeDSHtmlContent: html,
        codeForHash,
        paymentId: orderId,
        conversationId: orderId,
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<MokaUnitedThreeDSInitResponse>(error, '3DS initialization failed', {
        paymentId: orderId,
        conversationId: orderId,
      });
    }
  }

  private async paymentDetail(orderId: string) {
    return this.post<MokaUnitedPaymentDetailData>(
      MOKAUNITED_ENDPOINTS.DETAIL,
      { PaymentDealerRequest: { PaymentId: '', OtherTrxCode: orderId } },
      true
    );
  }

  /**
   * Completes a 3D Secure payment from the RedirectUrl POST. `hashValue` must be
   * SHA-256(CodeForHash + "T"), with the CodeForHash you kept from
   * initThreeDSPayment(), passed as `context.codeForHash` (never from the body: the
   * default handler passes only the POST, so it cannot complete these payments);
   * "F" is a failure reported by Moka United. The order id comes from your records
   * (`context.orderId`) or the callback, and the
   * payment is confirmed with GetDealerPaymentTrxDetailList: an approved payment of
   * that order, with the callback's trxCode, and `amount` when given. Anything else
   * is INVALID_HASH. Failures carry no ids.
   */
  async completeThreeDSPayment(
    callbackData: MokaUnited3DCallbackData,
    context: MokaUnitedCompleteContext = {}
  ): Promise<PaymentResponse> {
    const data = callbackData ?? {};
    const untrusted = (errorMessage: string, rawResponse: unknown): PaymentResponse =>
      this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'INVALID_HASH',
        errorMessage,
        rawResponse,
      });

    const codeForHash = nonEmpty(context.codeForHash);
    if (!codeForHash) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'VALIDATION_ERROR',
        errorMessage:
          'codeForHash is required: complete in your own route with completeThreeDSPayment(body, { codeForHash }), using the codeForHash initThreeDSPayment() returned for this order',
        rawResponse: data,
      });
    }
    const hashValue = (nonEmpty(data.hashValue) ?? '').toLowerCase();
    if (safeEqual(hashValue, await createMokaUnitedHashValue(codeForHash, false))) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: nonEmpty(data.resultCode) ?? 'THREEDS_FAILED',
        errorMessage: nonEmpty(data.resultMessage) ?? '3D Secure payment failed',
        rawResponse: data,
      });
    }
    if (!safeEqual(hashValue, await createMokaUnitedHashValue(codeForHash, true))) {
      return untrusted('Invalid 3D Secure callback hash', data);
    }

    const orderId = nonEmpty(context.orderId) ?? nonEmpty(data.OtherTrxCode);
    if (!orderId) {
      return untrusted('The callback carries no order id: pass orderId from your records', data);
    }
    try {
      const detail = await this.paymentDetail(orderId);
      const payment = detail.Data?.PaymentDetail;
      const trxCode = nonEmpty(data.trxCode);
      const confirmed =
        detail.ResultCode === MOKAUNITED_SUCCESS &&
        mokaUnitedPaymentStatus(detail.Data) === PaymentStatus.SUCCESS &&
        nonEmpty(payment?.OtherTrxCode) === orderId &&
        (trxCode === undefined ||
          (detail.Data?.PaymentTrxDetailList ?? []).some(
            (trx) => nonEmpty(trx.VirtualPosOrderId) === trxCode && trx.TrxStatus === 1
          )) &&
        (context.amount === undefined ||
          toMinorUnits(payment?.Amount ?? NaN) === toMinorUnits(context.amount));
      if (!confirmed) {
        return untrusted('3D Secure callback does not match the order at Moka United', {
          callback: data,
          detail,
        });
      }
      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        paymentId: orderId,
        conversationId: orderId,
        rawResponse: { callback: data, detail },
      });
    } catch (error) {
      // A timeout while confirming: the outcome is unknown. The ids are kept only when
      // the order came from your records (`orderId`), to check it with getPayment()
      const result = this.failure<PaymentResponse>(error, '3D Secure completion failed');
      return result.status === PaymentStatus.PENDING && nonEmpty(context.orderId) !== undefined
        ? { ...result, paymentId: orderId, conversationId: orderId }
        : result;
    }
  }

  /** Capture of a pre-authorization (DoCapture); up to 15% more or any lower amount */
  async capture(request: CaptureRequest): Promise<PaymentResponse> {
    try {
      this.validateCapture(request);
      const response = await this.post<MokaUnitedOperationData>(MOKAUNITED_ENDPOINTS.CAPTURE, {
        PaymentDealerRequest: {
          VirtualPosOrderId: '',
          OtherTrxCode: request.paymentId,
          Amount: formatMokaUnitedAmount(request.amount),
          ClientIP: request.ip ?? '',
        },
      });
      const approved = MokaUnited.isApproved(response);
      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: request.paymentId,
        conversationId: request.paymentId,
        ...(approved ? {} : MokaUnited.errorOf(response)),
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
      const response = await this.post<MokaUnitedOperationData>(MOKAUNITED_ENDPOINTS.VOID, {
        PaymentDealerRequest: {
          VirtualPosOrderId: '',
          OtherTrxCode: paymentId,
          ClientIP: ip ?? '',
          VoidRefundReason: 2,
        },
      });
      const approved = MokaUnited.isApproved(response);
      return this.withErrorCode<CancelResponse>({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        conversationId,
        ...(approved ? {} : MokaUnited.errorOf(response)),
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', { conversationId });
    }
  }

  /** Void (DoVoid), before end of day. `paymentId` is the order id. */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    return this.void(request.paymentId, request.ip, request.conversationId);
  }

  /** Releases a pre-authorization (DoVoid) */
  async voidAuthorization(request: VoidAuthorizationRequest): Promise<CancelResponse> {
    return this.void(request.paymentId, request.ip);
  }

  /**
   * Refund (DoCreateRefundRequest), full or partial. Moka United processes refunds as
   * requests, so an accepted one is `pending`, with the request id as `refundId`;
   * getPayment() shows when it is done.
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const response = await this.post<MokaUnitedOperationData>(MOKAUNITED_ENDPOINTS.REFUND, {
        PaymentDealerRequest: {
          VirtualPosOrderId: '',
          OtherTrxCode: request.paymentId,
          Amount: formatMokaUnitedAmount(request.price),
        },
      });
      const accepted = MokaUnited.isApproved(response);
      return this.withErrorCode({
        status: accepted ? PaymentStatus.PENDING : PaymentStatus.FAILURE,
        refundId: accepted ? nonEmpty(response.Data?.RefundRequestId) : undefined,
        conversationId: request.conversationId,
        ...(accepted ? {} : MokaUnited.errorOf(response)),
        rawResponse: response,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /** Payment status (GetDealerPaymentTrxDetailList) by order id */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const detail = await this.paymentDetail(paymentId);
      if (detail.ResultCode !== MOKAUNITED_SUCCESS) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          paymentId,
          conversationId: paymentId,
          ...MokaUnited.errorOf(detail as MokaUnitedResponse<MokaUnitedOperationData>),
          rawResponse: detail,
        });
      }
      return this.withErrorCode({
        status: mokaUnitedPaymentStatus(detail.Data),
        paymentId,
        conversationId: paymentId,
        rawResponse: detail,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Get payment failed', {
        paymentId,
        conversationId: paymentId,
      });
    }
  }

  private static bin(binNumber: string): string {
    const bin = (binNumber || '').replace(/\s/g, '').slice(0, 8);
    if (!/^\d{6,8}$/.test(bin)) throw new ValidationError('binNumber must be 6 to 8 digits');
    return bin;
  }

  private static card(binNumber: string, card: MokaUnitedBankCard | undefined) {
    return {
      cardType:
        card?.CreditType === 'DebitCard' ? 'DEBIT_CARD' : card?.CreditType ? 'CREDIT_CARD' : '',
      cardAssociation: mokaUnitedCardAssociation(card?.CardType),
      cardFamily: card?.GroupName || card?.CardName || '',
      bankName: card?.BankName || '',
      bankCode: Number(card?.BankCode) || 0,
      commercial: /ticari|commercial/i.test(card?.ProductCategory || ''),
      binNumber,
    };
  }

  /** Card details for a BIN (GetBankCardInformation) */
  async binCheck(binNumber: string): Promise<BinCheckResponse> {
    const response = await this.post<MokaUnitedBankCard>(
      MOKAUNITED_ENDPOINTS.BIN,
      { BankCardInformationRequest: { BinNumber: MokaUnited.bin(binNumber) } },
      true
    );
    if (response.ResultCode !== MOKAUNITED_SUCCESS || !response.Data) {
      throw new BetterPaymentError(
        `Moka United BIN query failed: ${response.ResultCode || 'no card information'}`,
        'PROVIDER_ERROR',
        'mokaunited'
      );
    }
    return { ...MokaUnited.card(binNumber, response.Data), rawResponse: response };
  }

  /**
   * Installment options for a card: DoCalcPaymentAmount for each count (1 to 12),
   * with the amount to charge the card as Moka United calculates it for your account.
   * Counts your account or the card does not allow are left out.
   */
  async installmentInfo(request: InstallmentInfoRequest): Promise<InstallmentInfoResponse> {
    try {
      const priceMinor = toMinorUnits(request.price);
      if (!(priceMinor > 0)) throw new ValidationError('price must be greater than 0');
      const bin = MokaUnited.bin(request.binNumber);
      const answers = await Promise.all(
        Array.from({ length: 12 }, (_, i) => i + 1).map(async (count) => ({
          count,
          response: await this.post<MokaUnitedAmountData>(
            MOKAUNITED_ENDPOINTS.AMOUNT,
            {
              PaymentDealerRequest: {
                BinNumber: bin,
                Currency: 'TL',
                OrderAmount: priceMinor / 100,
                InstallmentNumber: count,
                IsThreeD: 1,
              },
            },
            true
          ),
        }))
      );
      const allowed = answers.filter(
        ({ response }) =>
          response.ResultCode === MOKAUNITED_SUCCESS && Number(response.Data?.PaymentAmount) > 0
      );
      if (allowed.length === 0) {
        const first = answers[0].response;
        throw new BetterPaymentError(
          `Moka United installment query failed: ${first.ResultCode || 'no options'}`,
          'PROVIDER_ERROR',
          'mokaunited'
        );
      }
      const installmentPrices: InstallmentDetail[] = allowed.map(({ count, response }) => {
        const totalMinor = toMinorUnits(response.Data!.PaymentAmount!);
        return {
          installmentNumber: count,
          totalPrice: totalMinor / 100,
          installmentPrice: Math.round(totalMinor / count) / 100,
          ...(response.Data?.DealerCommissionRate !== undefined
            ? { commissionRate: Number(response.Data.DealerCommissionRate) }
            : {}),
        };
      });
      const card = MokaUnited.card(request.binNumber, allowed[0].response.Data?.BankCard);
      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        installmentDetails: [
          {
            binNumber: request.binNumber,
            price: priceMinor / 100,
            cardType: card.cardType,
            cardAssociation: card.cardAssociation,
            cardFamilyName: card.cardFamily,
            bankCode: card.bankCode,
            bankName: card.bankName,
            commercial: card.commercial ? 1 : 0,
            installmentPrices,
          },
        ],
        conversationId: request.conversationId,
        rawResponse: answers.map(({ response }) => response),
      });
    } catch (error) {
      return this.failure<InstallmentInfoResponse>(error, 'Installment info failed', {
        conversationId: request.conversationId,
      });
    }
  }
}

/**
 * The Moka United provider, for
 * `betterPayment({ providers: { mokaunited: mokaUnited({ dealerCode, username, password }) } })`.
 * The base URL follows `mode` unless `baseUrl` is set.
 */
export const mokaUnited = (config: MokaUnitedConfig): ProviderDefinition<MokaUnited> =>
  defineProvider(
    (ctx) => new MokaUnited(withProviderDefaults(ProviderType.MOKAUNITED, config, ctx))
  );
