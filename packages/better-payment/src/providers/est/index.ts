import {
  defineProvider,
  withProviderDefaults,
  ProviderType,
  type ProviderDefinition,
  type RemoteProviderType,
} from '../../core/BetterPaymentConfig';
import type { HttpClient } from '../../core/http';
import { PaymentProvider } from '../../core/PaymentProvider';
import { ConfigurationError, ValidationError } from '../../core/errors';
import { failureResult, FailureResult } from '../../core/failure';
import type { PaymentValidationRules } from '../../core/validation';
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
  EST_ENDPOINTS,
  EST_STORE_TYPES,
  type EstBank,
  type EstStoreType,
  type EstXmlResponse,
  isEstHostedStoreType,
  isEstMerchantChargedStoreType,
  createEstHash,
  verifyEstCallback,
  generateEstRandom,
  formatEstAmount,
  getEstCurrencyCode,
  formatEstInstallment,
  formatEstExpiry,
  estCardType,
  buildEstXml,
  parseEstXmlResponse,
  isEstApproved,
} from './utils';
import type { EstConfig, Est3DCallbackData } from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * EST (Asseco) virtual POS, shared by İş Bankası, Ziraat Bankası, Halkbank,
 * TEB, Şekerbank, Akbank (its older virtual POS) and Halkbank Macedonia. One
 * provider class, configured per bank.
 *
 * - createPayment():          XML API `Auth` (non-3D)
 * - initThreeDSPayment():     auto-submitting form to `/fim/est3Dgate` (storetype 3d,
 *                             3d_pay, 3d_pay_hosting or 3d_host), signed with hash ver3
 * - completeThreeDSPayment(): verifies the callback hash; 3d / 3d_host charge with XML
 *                             `Auth`, 3d_pay / 3d_pay_hosting are confirmed with an order
 *                             status query
 * - refund() `Credit`, cancel() `Void`, getPayment() order status (`ORDERSTATUS`)
 *
 * `paymentId` is your order id (`oid`): the `conversationId` you pass, or a generated one.
 */
export class Est extends PaymentProvider<EstConfig> {
  private client: HttpClient;

  constructor(config: EstConfig) {
    super(config);

    this.client = this.createHttpClient('est', {
      timeout: 30000,
      headers: { 'Content-Type': 'text/xml; charset=ISO-8859-9' },
    });
  }

  protected validateConfig(): void {
    const missing = (['clientId', 'username', 'password', 'storeKey'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(`EST configuration is missing: ${missing.join(', ')}`, 'est');
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('EST baseUrl (or a known bank) is required', 'est');
    }
    if (this.config.storeType && !EST_STORE_TYPES.includes(this.config.storeType)) {
      throw new ConfigurationError(`Unknown EST storeType: ${this.config.storeType}`, 'est');
    }
  }

  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return ISO8583_ERROR_CODES;
  }

  private get storeType(): EstStoreType {
    return this.config.storeType ?? '3d';
  }

  private get lang(): string {
    return (this.config.locale || 'tr').toLowerCase().startsWith('en') ? 'en' : 'tr';
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('EST', error, fallback, extra));
  }

  private static errorOf(fields: Record<string, string | undefined>) {
    return {
      errorCode: fields.ProcReturnCode || undefined,
      errorMessage: fields.ErrMsg || fields.mdErrorMsg || undefined,
    };
  }

  /**
   * Sends a CC5Request to the XML API with the API user's credentials
   */
  private async api(fields: Record<string, XmlValue>, retryable = false): Promise<EstXmlResponse> {
    const body = buildEstXml({
      Name: this.config.username,
      Password: this.config.password,
      ClientId: this.config.clientId,
      ...fields,
    });
    const response = await this.client.post<string>(EST_ENDPOINTS.API, body, {
      responseType: 'text',
      retryable,
    });
    return parseEstXmlResponse(typeof response.data === 'string' ? response.data : '');
  }

  private extra(fields: Record<string, XmlValue> = {}): Record<string, XmlValue> {
    return this.config.department !== undefined
      ? { ...fields, BOLUM: this.config.department }
      : fields;
  }

  /**
   * Order status (`ORDERSTATUS` = `SOR`)
   */
  private orderStatus(orderId: string): Promise<EstXmlResponse> {
    return this.api({ OrderId: orderId, Mode: 'P', Extra: { ORDERSTATUS: 'SOR' } }, true);
  }

  /**
   * Non-3D sale (XML API `Auth`)
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, { card: true, required: ['buyer.ip'] });
      const card = this.cardOf(request);
      const expiry = formatEstExpiry(card.expireMonth, card.expireYear);

      const { fields } = await this.api({
        Type: 'Auth',
        IPAddress: request.buyer.ip,
        Email: request.buyer.email,
        OrderId: orderId,
        Total: formatEstAmount(request.paidPrice ?? request.price),
        Currency: getEstCurrencyCode(request.currency),
        Taksit: formatEstInstallment(request.installment),
        Number: card.cardNumber.replace(/\s/g, ''),
        Expires: `${expiry.month}/${expiry.year}`,
        Cvv2Val: card.cvc,
        Mode: 'P',
        BillTo: { Name: `${request.buyer.name} ${request.buyer.surname}`.trim() },
        Extra: this.extra({ CARDHOLDERNAME: card.cardHolderName }),
      });
      const approved = isEstApproved(fields);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: orderId,
        conversationId: orderId,
        ...(approved ? {} : Est.errorOf(fields)),
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
   * 3D Secure payment: an auto-submitting form to the bank's 3D gate, signed
   * with hash ver3. With storetype 3d_pay_hosting / 3d_host the bank collects
   * the card on its own page, so no card data is sent.
   */
  async initThreeDSPayment(
    request: ThreeDSPaymentRequest & { failUrl?: string }
  ): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      const hosted = isEstHostedStoreType(this.storeType);
      const rules: PaymentValidationRules = hosted ? {} : { card: true };
      this.validatePayment(request, rules);
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }

      const fields: Record<string, string> = {
        clientid: this.config.clientId,
        storetype: this.storeType,
        amount: formatEstAmount(request.paidPrice ?? request.price),
        oid: orderId,
        okUrl: request.callbackUrl,
        failUrl: request.failUrl || request.callbackUrl,
        TranType: 'Auth',
        currency: getEstCurrencyCode(request.currency),
        taksit: formatEstInstallment(request.installment),
        rnd: generateEstRandom(),
        lang: this.lang,
        hashAlgorithm: 'ver3',
        refreshTime: '0',
      };
      if (request.buyer?.email) fields.Email = request.buyer.email;
      if (!hosted) {
        const card = this.cardOf(request);
        const cardNumber = card.cardNumber.replace(/\s/g, '');
        const expiry = formatEstExpiry(card.expireMonth, card.expireYear);
        Object.assign(fields, {
          pan: cardNumber,
          Ecom_Payment_Card_ExpDate_Month: expiry.month,
          Ecom_Payment_Card_ExpDate_Year: expiry.year,
          cv2: card.cvc,
          cardType: estCardType(cardNumber),
          cardHolderName: card.cardHolderName,
        });
      }
      fields.hash = await createEstHash(fields, this.config.storeKey);

      const inputs = Object.entries(fields)
        .map(
          ([name, value]) =>
            `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
        )
        .join('');
      const action = `${this.config.baseUrl}${EST_ENDPOINTS.GATE}`;
      const html =
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
        `<form id="est-3d-form" method="POST" action="${escapeHtml(action)}">${inputs}</form>` +
        '<script>document.getElementById("est-3d-form").submit();</script>' +
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
   * Completes the payment after the okUrl / failUrl POST.
   *
   * The ver3 hash covers the values but not the field names, so a valid hash
   * alone does not pin which value is the order id. The result is therefore
   * confirmed with the bank: 3d and 3d_host only authenticate the card, so they
   * charge with XML `Auth` (the bank's answer decides); in 3d_pay and
   * 3d_pay_hosting the bank charged the card, which is checked with an order
   * status query.
   * A callback that fails the hash, names another store, or claims a payment
   * the bank does not confirm is rejected as INVALID_HASH.
   *
   * `paymentId` and `conversationId` are set only for a payment the bank
   * confirmed, and on a timeout after the bank was reached for this order;
   * a failure never carries ids taken from the callback.
   */
  async completeThreeDSPayment(callbackData: Est3DCallbackData): Promise<PaymentResponse> {
    const untrusted = (errorMessage: string, rawResponse: unknown): PaymentResponse =>
      this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'INVALID_HASH',
        errorMessage,
        rawResponse,
      });

    if (!(await verifyEstCallback(callbackData ?? {}, this.config.storeKey))) {
      return untrusted('Invalid 3D Secure callback hash', callbackData);
    }
    const orderId = callbackData.oid;
    if (!orderId || callbackData.clientid !== this.config.clientId) {
      return untrusted('Callback belongs to a different store or order', callbackData);
    }

    let reached = false;
    try {
      if (isEstMerchantChargedStoreType(this.storeType)) {
        const accepted = this.config.acceptedMdStatuses ?? ['1'];
        if (!callbackData.mdStatus || !accepted.includes(callbackData.mdStatus)) {
          return this.withErrorCode({
            status: PaymentStatus.FAILURE,
            errorCode: `MD_STATUS_${callbackData.mdStatus ?? ''}`,
            errorMessage:
              callbackData.mdErrorMsg || callbackData.ErrMsg || '3D Secure authentication failed',
            rawResponse: callbackData,
          });
        }

        reached = true;
        const { fields } = await this.api({
          Type: 'Auth',
          OrderId: orderId,
          Total: callbackData.amount,
          Currency: callbackData.currency,
          Taksit: callbackData.taksit ?? '',
          Number: callbackData.md,
          PayerTxnId: callbackData.xid,
          PayerSecurityLevel: callbackData.eci,
          PayerAuthenticationCode: callbackData.cavv,
          Mode: 'P',
          Extra: this.extra(),
        });

        if (!isEstApproved(fields) || (fields.OrderId && fields.OrderId !== orderId)) {
          return this.withErrorCode({
            status: PaymentStatus.FAILURE,
            ...Est.errorOf(fields),
            rawResponse: { callback: callbackData, payment: fields },
          });
        }
        return this.withErrorCode({
          status: PaymentStatus.SUCCESS,
          paymentId: orderId,
          conversationId: orderId,
          rawResponse: { callback: callbackData, payment: fields },
        });
      }

      // 3d_pay / 3d_pay_hosting: the bank already charged the card
      if (!isEstApproved(callbackData)) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          ...Est.errorOf(callbackData),
          errorCode: callbackData.ProcReturnCode || `MD_STATUS_${callbackData.mdStatus ?? ''}`,
          rawResponse: callbackData,
        });
      }

      reached = true;
      const inquiry = await this.orderStatus(orderId);
      if (!isEstCapturedSale(inquiry)) {
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
   * Refund (XML API `Credit`). `paymentId` is the order id.
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const { fields } = await this.api({
        Type: 'Credit',
        OrderId: request.paymentId,
        Total: formatEstAmount(request.price),
        Currency: getEstCurrencyCode(request.currency),
      });
      const approved = isEstApproved(fields);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: approved ? fields.TransId || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : Est.errorOf(fields)),
        rawResponse: fields,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Void (XML API `Void`), before end of day. `paymentId` is the order id.
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const { fields } = await this.api({ Type: 'Void', OrderId: request.paymentId });
      const approved = isEstApproved(fields);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        transactionId: approved ? fields.TransId || undefined : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : Est.errorOf(fields)),
        rawResponse: fields,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Order status (`ORDERSTATUS`). `paymentId` is the order id.
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const inquiry = await this.orderStatus(paymentId);
      const status = estOrderStatus(inquiry);
      const { fields, extra } = inquiry;
      return this.withErrorCode({
        status,
        paymentId,
        conversationId: paymentId,
        ...(status !== PaymentStatus.FAILURE
          ? {}
          : extra.TRANS_STAT === 'D'
            ? { errorCode: extra.PROC_RET_CD || undefined, errorMessage: 'Declined by the bank' }
            : Est.errorOf(fields)),
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
 * Maps an order status answer: voided (TRANS_STAT V) or refunded (charge type C)
 * orders are cancelled, declined ones (D) failed, captured sales succeeded. An
 * answer without a record (unknown order) is a failure; anything else, such as
 * a pre-authorization, is pending.
 */
export function estOrderStatus(inquiry: EstXmlResponse): PaymentStatus {
  const { fields, extra } = inquiry;
  if (!extra.TRANS_STAT) {
    return PaymentStatus.FAILURE;
  }
  if (extra.TRANS_STAT === 'V') {
    return PaymentStatus.CANCELLED;
  }
  if (extra.CHARGE_TYPE_CD === 'C') {
    // The answer shows the last approved transaction: a (partial) refund
    return PaymentStatus.CANCELLED;
  }
  if (extra.TRANS_STAT === 'D') {
    return PaymentStatus.FAILURE;
  }
  if (!isEstApproved(fields)) {
    return PaymentStatus.FAILURE;
  }
  return isEstCapturedSale(inquiry) ? PaymentStatus.SUCCESS : PaymentStatus.PENDING;
}

/**
 * A captured sale in an order status answer: TRANS_STAT S, C or A, charge type
 * S (sale) and a captured amount
 */
export function isEstCapturedSale(inquiry: EstXmlResponse): boolean {
  const { fields, extra } = inquiry;
  return (
    isEstApproved(fields) &&
    ['S', 'C', 'A'].includes(extra.TRANS_STAT) &&
    extra.CHARGE_TYPE_CD === 'S' &&
    Number(extra.CAPTURE_AMT) > 0
  );
}

const EST_PROVIDER_TYPES: Record<EstBank, RemoteProviderType> = {
  isbank: ProviderType.ISBANK,
  ziraat: ProviderType.ZIRAAT,
  halkbank: ProviderType.HALKBANK,
  teb: ProviderType.TEB,
  sekerbank: ProviderType.SEKERBANK,
  akbankest: ProviderType.AKBANKEST,
  halkbankmkd: ProviderType.HALKBANKMKD,
};

/**
 * An EST provider, for
 * `betterPayment({ providers: { isbank: est({ bank: 'isbank', clientId, username, password, storeKey }) } })`.
 * Sandbox mode uses the shared EST test host; production uses the bank's host
 * (`PROVIDER_DEFAULT_URLS`). `baseUrl` overrides both.
 */
export const est = (config: EstConfig): ProviderDefinition<Est> =>
  defineProvider((ctx) => {
    const type: RemoteProviderType | undefined = EST_PROVIDER_TYPES[config.bank];
    if (type) {
      return new Est(withProviderDefaults(type, config, ctx));
    }
    // Unknown bank: no default URL, validateConfig reports it unless baseUrl is set
    return new Est({
      ...withProviderDefaults(ProviderType.ISBANK, config, ctx),
      baseUrl: config.baseUrl,
    });
  });
