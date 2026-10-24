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
  GARANTI_API_VERSION,
  GARANTI_ENDPOINTS,
  GARANTI_SECURITY_LEVELS,
  type GarantiSecurityLevel,
  type GarantiXmlResponse,
  createGarantiSecurityData,
  createGarantiHashData,
  createGaranti3DHash,
  verifyGarantiCallback,
  formatGarantiAmount,
  getGarantiCurrencyCode,
  formatGarantiInstallment,
  formatGarantiExpiry,
  buildGarantiXml,
  parseGarantiXmlResponse,
  isGarantiApproved,
} from './utils';
import type { GarantiConfig, Garanti3DCallbackData, GarantiCompleteContext } from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface ApiRequest {
  orderId: string;
  amount: string;
  currencyCode: string;
  ip: string;
  transaction: Record<string, XmlValue>;
  card?: { Number: string; ExpireDate: string; CVV2: string };
  refund?: boolean;
  retryable?: boolean;
}

/**
 * Garanti BBVA virtual POS (GVP, XML API version 512)
 *
 * - createPayment():          XML `sales` (non-3D)
 * - initThreeDSPayment():     auto-submitting form to the 3D engine (3D, 3D_PAY, or
 *                             GARANTI_PAY for GarantiPay without card details)
 * - completeThreeDSPayment(): verifies the callback hash; 3D provisions with XML
 *                             `sales`, 3D_PAY and GARANTI_PAY are confirmed with an
 *                             order inquiry
 * - refund() `refund`, cancel() `void` (PROVRFN user), getPayment() `orderinq`
 *
 * `paymentId` is your order id: the `conversationId` you pass, or a generated one.
 */
export class Garanti extends PaymentProvider<GarantiConfig> {
  private client: HttpClient;

  constructor(config: GarantiConfig) {
    super(config);

    this.client = this.createHttpClient('garanti', {
      timeout: 30000,
      headers: { 'Content-Type': 'application/xml' },
    });
  }

  protected validateConfig(): void {
    const missing = (['merchantId', 'terminalId', 'password', 'storeKey'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(
        `Garanti BBVA configuration is missing: ${missing.join(', ')}`,
        'garanti'
      );
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('Garanti BBVA baseUrl is required', 'garanti');
    }
    if (this.config.securityLevel && !GARANTI_SECURITY_LEVELS.includes(this.config.securityLevel)) {
      throw new ConfigurationError(
        `Unknown Garanti BBVA securityLevel: ${this.config.securityLevel}`,
        'garanti'
      );
    }
  }

  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return ISO8583_ERROR_CODES;
  }

  private get securityLevel(): GarantiSecurityLevel {
    return this.config.securityLevel ?? '3D';
  }

  private get mode(): string {
    return this.config.testMode ? 'TEST' : 'PROD';
  }

  private get provUserId(): string {
    return this.config.provUserId || 'PROVAUT';
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('Garanti BBVA', error, fallback, extra));
  }

  /** Raw error code: ReasonCode (ISO 8583 for bank declines), else Code */
  private static errorOf(result: GarantiXmlResponse) {
    const { response } = result;
    return {
      errorCode: response.ReasonCode || response.Code || undefined,
      errorMessage: response.ErrorMsg || response.SysErrMsg || response.Message || undefined,
    };
  }

  /**
   * Sends a GVPSRequest signed with HashData. Cancel and refund use the
   * PROVRFN user and its password.
   */
  private async api(request: ApiRequest): Promise<GarantiXmlResponse> {
    const userId = request.refund ? this.config.refundUserId || 'PROVRFN' : this.provUserId;
    const password = request.refund
      ? this.config.refundPassword || this.config.password
      : this.config.password;
    const securityData = await createGarantiSecurityData(password, this.config.terminalId);
    const hashData = await createGarantiHashData({
      orderId: request.orderId,
      terminalId: this.config.terminalId,
      cardNumber: request.card?.Number,
      amount: request.amount,
      currencyCode: request.currencyCode,
      securityData,
    });

    const body = buildGarantiXml({
      Mode: this.mode,
      Version: GARANTI_API_VERSION,
      Terminal: {
        ProvUserID: userId,
        HashData: hashData,
        UserID: userId,
        ID: this.config.terminalId,
        MerchantID: this.config.merchantId,
      },
      Customer: { IPAddress: request.ip },
      ...(request.card ? { Card: request.card } : {}),
      Order: { OrderID: request.orderId },
      Transaction: {
        ...request.transaction,
        Amount: request.amount,
        CurrencyCode: request.currencyCode,
      },
    });
    const response = await this.client.post<string>(GARANTI_ENDPOINTS.API, body, {
      responseType: 'text',
      retryable: request.retryable ?? false,
    });
    return parseGarantiXmlResponse(typeof response.data === 'string' ? response.data : '');
  }

  /** Order inquiry (`orderinq`) */
  private orderInquiry(orderId: string, ip = '127.0.0.1'): Promise<GarantiXmlResponse> {
    return this.api({
      orderId,
      amount: '1',
      currencyCode: '949',
      ip,
      transaction: { Type: 'orderinq', ListPageNum: '0', CardholderPresentCode: '', MotoInd: 'N' },
      retryable: true,
    });
  }

  /**
   * Non-3D sale (XML `sales`)
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, { card: true, required: ['buyer.ip'] });
      const card = this.cardOf(request);
      const expiry = formatGarantiExpiry(card.expireMonth, card.expireYear);

      const result = await this.api({
        orderId,
        amount: formatGarantiAmount(request.paidPrice ?? request.price),
        currencyCode: getGarantiCurrencyCode(request.currency),
        ip: request.buyer.ip,
        card: {
          Number: card.cardNumber.replace(/\s/g, ''),
          ExpireDate: `${expiry.month}${expiry.year}`,
          CVV2: card.cvc,
        },
        transaction: {
          Type: 'sales',
          InstallmentCnt: formatGarantiInstallment(request.installment),
          CardholderPresentCode: '0',
          MotoInd: 'N',
        },
      });
      const approved = isGarantiApproved(result);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: orderId,
        conversationId: orderId,
        ...(approved ? {} : Garanti.errorOf(result)),
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Payment failed', {
        paymentId: orderId,
        conversationId: orderId,
      });
    }
  }

  /**
   * 3D Secure payment: an auto-submitting form to the Garanti BBVA 3D engine,
   * signed with secure3dhash. With GARANTI_PAY the form opens the GarantiPay
   * page instead (`gpdatarequest`), and the request needs no card.
   */
  async initThreeDSPayment(
    request: ThreeDSPaymentRequest & { failUrl?: string }
  ): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      const garantiPay = this.securityLevel === 'GARANTI_PAY';
      this.validatePayment(request, { card: !garantiPay, required: ['buyer.ip'] });
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }

      const fields: Record<string, string> = {
        secure3dsecuritylevel: garantiPay ? 'CUSTOM_PAY' : this.securityLevel,
        mode: this.mode,
        apiversion: GARANTI_API_VERSION,
        terminalprovuserid: this.provUserId,
        terminaluserid: this.provUserId,
        terminalmerchantid: this.config.merchantId,
        terminalid: this.config.terminalId,
        txntype: garantiPay ? 'gpdatarequest' : 'sales',
        txnamount: formatGarantiAmount(request.paidPrice ?? request.price),
        txncurrencycode: getGarantiCurrencyCode(request.currency),
        txninstallmentcount: formatGarantiInstallment(request.installment),
        orderid: orderId,
        successurl: request.callbackUrl,
        errorurl: request.failUrl || request.callbackUrl,
        customeripaddress: request.buyer.ip,
        customeremailaddress: request.buyer.email ?? '',
      };
      if (garantiPay) {
        Object.assign(fields, {
          txnsubtype: 'sales',
          garantipay: 'Y',
          // Let the customer use Bonus, partner (FBB), cheque and mile points
          bnsuseflag: 'Y',
          fbbuseflag: 'Y',
          chequeuseflag: 'Y',
          mileuseflag: 'Y',
          companyname: this.config.companyName ?? '',
          lang: (this.config.locale || 'tr').toLowerCase().startsWith('en') ? 'en' : 'tr',
          txntimestamp: new Date().toISOString(),
        });
      } else {
        const card = this.cardOf(request);
        const expiry = formatGarantiExpiry(card.expireMonth, card.expireYear);
        Object.assign(fields, {
          cardnumber: card.cardNumber.replace(/\s/g, ''),
          cardexpiredatemonth: expiry.month,
          cardexpiredateyear: expiry.year,
          cardcvv2: card.cvc,
        });
      }
      fields.secure3dhash = await createGaranti3DHash({
        terminalId: this.config.terminalId,
        orderId,
        amount: fields.txnamount,
        currencyCode: fields.txncurrencycode,
        successUrl: fields.successurl,
        errorUrl: fields.errorurl,
        type: fields.txntype,
        installment: fields.txninstallmentcount,
        storeKey: this.config.storeKey,
        securityData: await createGarantiSecurityData(this.config.password, this.config.terminalId),
      });

      const inputs = Object.entries(fields)
        .map(
          ([name, value]) =>
            `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
        )
        .join('');
      const action = `${this.config.baseUrl}${GARANTI_ENDPOINTS.GATE}`;
      const html =
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
        `<form id="garanti-3d-form" method="POST" action="${escapeHtml(action)}">${inputs}</form>` +
        '<script>document.getElementById("garanti-3d-form").submit();</script>' +
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
   * Completes the payment after the successurl / errorurl POST.
   *
   * The hash is rebuilt from the fields named in `hashparams`, whose values are
   * joined without a separator, so a valid hash alone does not pin each value.
   * The order therefore comes from your records (`context`, a separate second
   * argument never read from the callback body) or from the bank: 3D provisions
   * XML `sales` for `context.orderId` and `context.amount`, which it requires,
   * and the bank's answer decides; 3D_PAY is checked with an order inquiry,
   * against `context.amount` when given. A callback that fails the hash, names
   * another terminal or order, or claims a payment the bank does not confirm is
   * rejected as INVALID_HASH.
   *
   * `paymentId` and `conversationId` are set only for a payment the bank
   * confirmed, and on a timeout only when `context.orderId` was given; a
   * failure never carries ids taken from the callback.
   */
  async completeThreeDSPayment(
    callbackData: Garanti3DCallbackData,
    context: GarantiCompleteContext = {}
  ): Promise<PaymentResponse> {
    const expected = context ?? {};
    const untrusted = (errorMessage: string, rawResponse: unknown): PaymentResponse =>
      this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'INVALID_HASH',
        errorMessage,
        rawResponse,
      });

    // Error callbacks can come unsigned (a timed-out GarantiPay page posts no hash). A
    // failure that claims nothing is reported with its code; ids are never taken from it.
    if (
      !callbackData?.hash &&
      !callbackData?.hashparams &&
      callbackData?.procreturncode !== '00' &&
      callbackData?.response !== 'Approved'
    ) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: callbackData?.procreturncode || `MD_STATUS_${callbackData?.mdstatus ?? ''}`,
        errorMessage:
          callbackData?.errmsg || callbackData?.mderrormessage || '3D Secure payment failed',
        rawResponse: callbackData,
      });
    }
    if (!(await verifyGarantiCallback(callbackData ?? {}, this.config.storeKey))) {
      return untrusted('Invalid 3D Secure callback hash', callbackData);
    }
    const orderId = callbackData.orderid || callbackData.oid;
    if (
      !orderId ||
      (callbackData.oid && callbackData.orderid && callbackData.oid !== callbackData.orderid) ||
      callbackData.terminalid !== this.config.terminalId ||
      (callbackData.terminalmerchantid !== undefined &&
        callbackData.terminalmerchantid !== this.config.merchantId)
    ) {
      return untrusted('Callback belongs to a different terminal or order', callbackData);
    }
    if (expected.orderId !== undefined && expected.orderId !== orderId) {
      return untrusted('Callback belongs to another order than yours', callbackData);
    }

    let reached = false;
    try {
      if (this.securityLevel === '3D') {
        const accepted = this.config.acceptedMdStatuses ?? ['1'];
        if (!callbackData.mdstatus || !accepted.includes(callbackData.mdstatus)) {
          return this.withErrorCode({
            status: PaymentStatus.FAILURE,
            errorCode: `MD_STATUS_${callbackData.mdstatus ?? ''}`,
            errorMessage: callbackData.mderrormessage || '3D Secure authentication failed',
            rawResponse: callbackData,
          });
        }

        // The bank charges what this request says, so the order and amount must
        // be yours, not values a re-split callback could carry
        if (!expected.orderId || expected.amount === undefined) {
          throw new ValidationError(
            'completeThreeDSPayment() needs the order from your records: ' +
              'completeThreeDSPayment(callbackBody, { orderId, amount, currency })'
          );
        }
        reached = true;
        const result = await this.api({
          orderId,
          amount: formatGarantiAmount(expected.amount),
          currencyCode: getGarantiCurrencyCode(expected.currency),
          ip: callbackData.customeripaddress ?? '',
          transaction: {
            Type: 'sales',
            InstallmentCnt:
              expected.installment !== undefined
                ? formatGarantiInstallment(expected.installment)
                : (callbackData.txninstallmentcount ?? ''),
            CardholderPresentCode: '13',
            MotoInd: 'N',
            Secure3D: {
              AuthenticationCode: callbackData.cavv,
              SecurityLevel: callbackData.eci,
              TxnID: callbackData.xid,
              Md: callbackData.md,
            },
          },
        });

        if (!isGarantiApproved(result)) {
          return this.withErrorCode({
            status: PaymentStatus.FAILURE,
            ...Garanti.errorOf(result),
            rawResponse: { callback: callbackData, payment: result },
          });
        }
        return this.withErrorCode({
          status: PaymentStatus.SUCCESS,
          paymentId: orderId,
          conversationId: orderId,
          rawResponse: { callback: callbackData, payment: result },
        });
      }

      // 3D_PAY and GARANTI_PAY: the bank already charged
      if (callbackData.procreturncode !== '00') {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          errorCode: callbackData.procreturncode || `MD_STATUS_${callbackData.mdstatus ?? ''}`,
          errorMessage:
            callbackData.errmsg || callbackData.mderrormessage || '3D Secure payment failed',
          rawResponse: callbackData,
        });
      }

      reached = true;
      const inquiry = await this.orderInquiry(orderId, callbackData.customeripaddress);
      const expectedAmount =
        expected.amount !== undefined
          ? formatGarantiAmount(expected.amount)
          : callbackData.txnamount;
      if (
        !isGarantiCapturedSale(inquiry) ||
        (expectedAmount !== undefined && inquiry.orderInquiry.AuthAmount !== expectedAmount)
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
      // unknown. The ids are kept only for an order from your records, so it
      // can be checked with getPayment(); the callback's own order is not trusted
      return reached && result.status === PaymentStatus.PENDING && expected.orderId
        ? { ...result, paymentId: expected.orderId, conversationId: expected.orderId }
        : result;
    }
  }

  /**
   * Refund (XML `refund`, PROVRFN user). A lower amount than the sale is a
   * partial refund. `paymentId` is the order id.
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const result = await this.api({
        orderId: request.paymentId,
        amount: formatGarantiAmount(request.price),
        currencyCode: getGarantiCurrencyCode(request.currency),
        ip: request.ip,
        refund: true,
        transaction: {
          Type: 'refund',
          InstallmentCnt: '',
          CardholderPresentCode: '0',
          MotoInd: 'N',
        },
      });
      const approved = isGarantiApproved(result);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: approved ? result.transaction.RetrefNum || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : Garanti.errorOf(result)),
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Same-day void (XML `void`, PROVRFN user). `paymentId` is the order id.
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const result = await this.api({
        orderId: request.paymentId,
        // The amount only has to match HashData; Garanti voids the whole sale
        amount: request.price ? formatGarantiAmount(request.price) : '1',
        currencyCode: getGarantiCurrencyCode(request.currency),
        ip: request.ip,
        refund: true,
        transaction: {
          Type: 'void',
          InstallmentCnt: '',
          CardholderPresentCode: '0',
          MotoInd: 'N',
        },
      });
      const approved = isGarantiApproved(result);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        transactionId: approved ? result.transaction.RetrefNum || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : Garanti.errorOf(result)),
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Order status via order inquiry (`orderinq`). `paymentId` is the order id.
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const inquiry = await this.orderInquiry(paymentId);
      if (!isGarantiApproved(inquiry)) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          paymentId,
          conversationId: paymentId,
          ...Garanti.errorOf(inquiry),
          rawResponse: inquiry,
        });
      }
      const status = mapGarantiOrderStatus(inquiry.orderInquiry.Status);
      return this.withErrorCode({
        status,
        paymentId,
        conversationId: paymentId,
        ...(status === PaymentStatus.FAILURE
          ? {
              errorCode: inquiry.orderInquiry.ReasonCode || inquiry.orderInquiry.Code || undefined,
              errorMessage: inquiry.orderInquiry.SysErrMsg || undefined,
            }
          : {}),
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
 * OrderInqResult Status: APPROVED, DECLINED, VOID (cancelled), REFUND
 * (refunded; AuthAmount is what remains)
 */
export function mapGarantiOrderStatus(status: string | undefined): PaymentStatus {
  switch (status) {
    case 'APPROVED':
      return PaymentStatus.SUCCESS;
    case 'DECLINED':
      return PaymentStatus.FAILURE;
    case 'VOID':
    case 'REFUND':
      return PaymentStatus.CANCELLED;
    default:
      return PaymentStatus.PENDING;
  }
}

/** An approved sale in an order inquiry answer */
export function isGarantiCapturedSale(inquiry: GarantiXmlResponse): boolean {
  const order = inquiry.orderInquiry;
  return (
    isGarantiApproved(inquiry) &&
    order.Status === 'APPROVED' &&
    order.ChargeType === 'S' &&
    Number(order.AuthAmount) > 0
  );
}

/**
 * The Garanti BBVA provider, for
 * `betterPayment({ providers: { garanti: garanti({ merchantId, terminalId, password, storeKey }) } })`.
 * The base URL follows `mode` unless `baseUrl` is set.
 */
export const garanti = (config: GarantiConfig): ProviderDefinition<Garanti> =>
  defineProvider((ctx) => {
    const options = withProviderDefaults(ProviderType.GARANTI, config, ctx);
    return new Garanti({ ...options, testMode: config.testMode ?? ctx.mode === 'sandbox' });
  });
