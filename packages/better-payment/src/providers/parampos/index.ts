/**
 * Parampos Payment Provider
 *
 * SOAP-based integration with Param (TurkPOS).
 */

import {
  defineProvider,
  withProviderDefaults,
  ProviderType,
  type ProviderDefinition,
} from '../../core/BetterPaymentConfig';
import type { HttpClient, HttpRequestConfig } from '../../core/http';
import { PaymentProvider, PaymentProviderConfig } from '../../core/PaymentProvider';
import { ConfigurationError, ValidationError } from '../../core/errors';
import { failureResult, FailureResult } from '../../core/failure';
import type { PaymentValidationRules } from '../../core/validation';
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
  CaptureRequest,
  VoidAuthorizationRequest,
  InstallmentDetail,
  InstallmentInfoRequest,
  InstallmentInfoResponse,
  PaymentStatus,
} from '../../types';
import { ParamposResult, Parampos3DSCallbackData, ParamposOrderStatus } from './types';
import { PARAMPOS_ERROR_CODES } from './error-codes';
import { ISO8583_ERROR_CODES, PaymentErrorCode, resolveErrorCode } from '../../core/error-codes';
import {
  generateParamposPaymentHash,
  generateParamposPreAuthHash,
  verifyParampos3DSCallback,
  verifyParamposReturnHash,
  PARAMPOS_FOREIGN_CURRENCY_CODES,
  formatParamposAmount,
  formatParamposRefundAmount,
  formatParamposExpiryMonth,
  formatParamposExpiryYear,
  formatParamposGsm,
  buildParamposSoapEnvelope,
  parseParamposSoapResponse,
  isParamposSuccess,
  parseParamposAmount,
  parseParamposDataSetRows,
  paramposRatesOf,
  calculateParamposTotalMinor,
  XmlValue,
} from './utils';

/**
 * Parampos configuration
 */
const PARAMPOS_CARD_RULES: PaymentValidationRules = { card: true, required: ['buyer.ip'] };

/** Commission rates of one card program (virtual POS) */
export interface ParamposInstallmentRates {
  /** Param SanalPOS_ID */
  posId: string;
  /** Card bank / program name, e.g. "Diğer Banka Kartları" */
  bankName: string;
  /** Commission rate in percent by installment count; unavailable counts are absent */
  rates: Record<number, number>;
}

export interface ParamposConfig extends PaymentProviderConfig {
  /** CLIENT_CODE (terminal number) */
  clientCode: string;
  /** CLIENT_USERNAME */
  clientUsername: string;
  /** CLIENT_PASSWORD */
  clientPassword: string;
  /** Merchant GUID (anahtar). Used for hashes, never sent to the browser. */
  guid: string;
}

/**
 * Parampos Payment Provider
 */
export class Parampos extends PaymentProvider<ParamposConfig> {
  private client: HttpClient;

  constructor(config: ParamposConfig) {
    super(config);

    this.client = this.createHttpClient('parampos', {
      timeout: 60000,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    });
  }

  protected validateConfig(): void {
    const missing = (['clientCode', 'clientUsername', 'clientPassword', 'guid'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(
        `Parampos configuration is missing: ${missing.join(', ')}`,
        'parampos'
      );
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('Parampos baseUrl is required', 'parampos');
    }
  }

  private get credentials() {
    return {
      G: {
        CLIENT_CODE: this.config.clientCode,
        CLIENT_USERNAME: this.config.clientUsername,
        CLIENT_PASSWORD: this.config.clientPassword,
      },
      GUID: this.config.guid,
    };
  }

  /**
   * Send SOAP request to Parampos API
   */
  private async sendSoapRequest(
    soapAction: string,
    fields: Record<string, XmlValue>,
    options: { retryable?: boolean } = {}
  ): Promise<ParamposResult> {
    const xml = await this.sendSoapRaw(soapAction, fields, options);
    return parseParamposSoapResponse<ParamposResult>(xml, `${soapAction}Result`);
  }

  /** Sends a SOAP request and returns the response XML as is */
  private async sendSoapRaw(
    soapAction: string,
    fields: Record<string, XmlValue>,
    options: { retryable?: boolean } = {}
  ): Promise<string> {
    const envelope = buildParamposSoapEnvelope(soapAction, fields);

    const requestConfig: HttpRequestConfig = {
      headers: { SOAPAction: `https://turkpos.com.tr/${soapAction}` },
      retryable: options.retryable === true,
      responseType: 'text',
    };

    const response = await this.client.post('', envelope, requestConfig);
    return String(response.data);
  }

  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return PARAMPOS_ERROR_CODES;
  }

  /**
   * The bank's ISO 8583 code (`Banka_Sonuc_Kod`) is the most specific reason
   * for a decline; Param's `Sonuc` is used when it is missing or not mapped.
   */
  protected resolveErrorCode(result: FailureResult): PaymentErrorCode {
    const bankCode = Parampos.bankResultCode(result.rawResponse);
    if (bankCode && ISO8583_ERROR_CODES[bankCode]) return ISO8583_ERROR_CODES[bankCode];
    return resolveErrorCode(result.errorCode, this.errorCodeTable());
  }

  /** Reads `Banka_Sonuc_Kod` from a SOAP result, or from `payment` after 3D completion */
  private static bankResultCode(raw: unknown): string | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const record = raw as { Banka_Sonuc_Kod?: unknown; payment?: { Banka_Sonuc_Kod?: unknown } };
    const value = record.Banka_Sonuc_Kod ?? record.payment?.Banka_Sonuc_Kod;
    if (typeof value !== 'string' || !/^\d{1,2}$/.test(value.trim())) return undefined;
    return value.trim().padStart(2, '0');
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('Parampos', error, fallback, extra));
  }

  private async buildPaymentFields(
    request: PaymentRequest,
    orderId: string,
    securityType: 'NS' | '3D',
    installment: number,
    callbackUrl?: string
  ): Promise<Record<string, XmlValue>> {
    const card = this.cardOf(request);
    const transactionAmount = formatParamposAmount(request.price);
    const totalAmount = formatParamposAmount(request.paidPrice ?? request.price);
    const hash = await generateParamposPaymentHash(
      this.config.clientCode,
      this.config.guid,
      installment,
      transactionAmount,
      totalAmount,
      orderId
    );

    return {
      ...this.credentials,
      KK_Sahibi: card.cardHolderName,
      KK_No: card.cardNumber,
      KK_SK_Ay: formatParamposExpiryMonth(card.expireMonth),
      KK_SK_Yil: formatParamposExpiryYear(card.expireYear),
      KK_CVC: card.cvc,
      // Optional per docs, but the service rejects requests without the element
      KK_Sahibi_GSM: formatParamposGsm(request.buyer?.gsmNumber),
      Hata_URL: callbackUrl ?? '',
      Basarili_URL: callbackUrl ?? '',
      Siparis_ID: orderId,
      Siparis_Aciklama: request.basketId ?? '',
      Taksit: installment,
      Islem_Tutar: transactionAmount,
      Toplam_Tutar: totalAmount,
      Islem_Hash: hash,
      Islem_Guvenlik_Tip: securityType,
      Islem_ID: orderId,
      IPAdr: request.buyer.ip,
      Ref_URL: '',
      Data1: '',
      Data2: '',
      Data3: '',
      Data4: '',
      Data5: '',
    };
  }
  /**
   * TP_Islem_Odeme_OnProv_WMD fields (pre-authorization), as Param expects them:
   * no order description or Data fields, and the URLs only for 3D Secure.
   */
  private async buildPreAuthFields(
    request: PaymentRequest,
    orderId: string,
    securityType: 'NS' | '3D',
    installment: number,
    callbackUrl?: string
  ): Promise<Record<string, XmlValue>> {
    const card = this.cardOf(request);
    const transactionAmount = formatParamposAmount(request.price);
    const totalAmount = formatParamposAmount(request.paidPrice ?? request.price);
    const urls =
      securityType === '3D' ? { Basarili_URL: callbackUrl ?? '', Hata_URL: callbackUrl ?? '' } : {};

    return {
      ...this.credentials,
      Islem_Guvenlik_Tip: securityType,
      Islem_ID: orderId,
      IPAdr: request.buyer.ip,
      Siparis_ID: orderId,
      Islem_Tutar: transactionAmount,
      Toplam_Tutar: totalAmount,
      ...urls,
      Taksit: installment,
      KK_Sahibi: card.cardHolderName,
      KK_No: card.cardNumber,
      KK_SK_Ay: formatParamposExpiryMonth(card.expireMonth),
      KK_SK_Yil: formatParamposExpiryYear(card.expireYear),
      KK_CVC: card.cvc,
      KK_Sahibi_GSM: formatParamposGsm(request.buyer?.gsmNumber),
      Islem_Hash: await generateParamposPreAuthHash(
        this.config.clientCode,
        this.config.guid,
        transactionAmount,
        totalAmount,
        orderId,
        urls.Hata_URL,
        urls.Basarili_URL
      ),
    };
  }

  /**
   * TP_Islem_Odeme_WD fields (foreign-currency 3D payment), as Param's request
   * model documents them: `Doviz_Kodu` 1001/1002/1003, both return URLs, and the
   * hash with the URLs instead of the installment count.
   * https://github.com/PARAMPOS/Dotnet-Ornek-Kod/blob/8c1160cfb9bb6df8ac117d97871b7e5b496088cb/src/ParamApi.Sdk/Models/Requests/TP_Islem_Odeme_WD_Request.cs
   */
  private async buildForeignPaymentFields(
    request: PaymentRequest,
    orderId: string,
    currencyCode: number
  ): Promise<Record<string, XmlValue>> {
    const card = this.cardOf(request);
    // Built once: these exact strings are sent and hashed (100 and 100.00 both
    // become "100,00", so the hash always matches the request byte for byte).
    const transactionAmount = formatParamposAmount(request.price);
    const totalAmount = formatParamposAmount(request.paidPrice ?? request.price);
    const callbackUrl = request.callbackUrl ?? '';

    return {
      ...this.credentials,
      Doviz_Kodu: currencyCode,
      KK_Sahibi: card.cardHolderName,
      KK_No: card.cardNumber,
      KK_SK_Ay: formatParamposExpiryMonth(card.expireMonth),
      KK_SK_Yil: formatParamposExpiryYear(card.expireYear),
      KK_CVC: card.cvc,
      KK_Sahibi_GSM: formatParamposGsm(request.buyer?.gsmNumber),
      Hata_URL: callbackUrl,
      Basarili_URL: callbackUrl,
      Siparis_ID: orderId,
      // Required by the WD request model; fall back to the order id, never invent one
      Siparis_Aciklama: request.basketId || orderId,
      Islem_Tutar: transactionAmount,
      Toplam_Tutar: totalAmount,
      Islem_Hash: await generateParamposPreAuthHash(
        this.config.clientCode,
        this.config.guid,
        transactionAmount,
        totalAmount,
        orderId,
        callbackUrl,
        callbackUrl
      ),
      Islem_Guvenlik_Tip: '3D',
      Islem_ID: orderId,
      IPAdr: request.buyer.ip,
    };
  }

  /**
   * Direct payments, pre-authorizations and captures stay on the TRY services.
   * Foreign currency is only available through initThreeDSPayment() (TP_Islem_Odeme_WD).
   */
  private assertTry(currency: string | undefined, operation = 'payments'): void {
    if (!Parampos.isTry(currency)) {
      throw new ValidationError(
        `Parampos ${operation} are TRY-only (received ${currency}); use initThreeDSPayment() for USD, EUR and GBP`
      );
    }
  }

  /** TRY (the old path); TL is accepted as the same currency */
  private static isTry(currency: string | undefined): boolean {
    const value = (currency || 'TRY').toUpperCase();
    return value === 'TRY' || value === 'TL';
  }

  /**
   * Param publishes no currency-aware refund/cancel message: the request model
   * of TP_Islem_Iptal_Iade_Kismi2 has only Durum, Siparis_ID and Tutar.
   * https://github.com/PARAMPOS/Dotnet-Ornek-Kod/blob/8c1160cfb9bb6df8ac117d97871b7e5b496088cb/src/ParamApi.Sdk/Models/Requests/TP_Islem_Iptal_Iade_Kismi2_Request.cs
   * Fail loudly instead of sending the TRY message for a foreign-currency payment.
   */
  private assertRefundCurrency(currency: string | undefined): void {
    if (!Parampos.isTry(currency)) {
      throw new ValidationError(
        `Parampos cannot refund or cancel ${(currency || '').toUpperCase()} payments: Param publishes no currency-aware refund message (TP_Islem_Iptal_Iade_Kismi2 has no Doviz_Kodu). Refund it in the Param panel.`
      );
    }
  }

  /**
   * Direct (non-3D) payment
   *
   * `price` is Islem_Tutar and `paidPrice` is Toplam_Tutar (amount charged to the
   * card, including any installment commission). For installments, calculate
   * `paidPrice` from the rates configured on your Param account.
   */
  async createPayment(
    request: PaymentRequest & { installment?: number }
  ): Promise<PaymentResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, PARAMPOS_CARD_RULES);
      this.assertTry(request.currency);
      const installment = Math.max(1, request.installment ?? 1);
      const fields = await this.buildPaymentFields(request, orderId, 'NS', installment);
      const result = await this.sendSoapRequest('TP_WMD_UCD', fields);

      const approved = isParamposSuccess(result.Sonuc) && Number(result.Islem_ID) > 0;

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: orderId,
        conversationId: orderId,
        errorCode: approved ? undefined : result.Sonuc,
        errorMessage: approved ? undefined : result.Sonuc_Str || result.Bank_HostMsg,
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
   * Initialize 3D Secure payment (TP_WMD_UCD, Islem_Guvenlik_Tip = 3D)
   *
   * TRY: render `threeDSHtmlContent` in the browser. Param POSTs the result to
   * `callbackUrl`; pass that POST body to completeThreeDSPayment().
   *
   * USD/EUR/GBP: TP_Islem_Odeme_WD instead, returning Param's `UCD_URL` as
   * `redirectUrl`; the customer completes the payment on that page and Param
   * posts `TURKPOS_RETVAL_*` fields to `callbackUrl`.
   */
  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, PARAMPOS_CARD_RULES);
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }
      const installment = Math.max(1, request.installment ?? 1);
      if (!Parampos.isTry(request.currency)) {
        return await this.initForeignThreeDSPayment(request, orderId, installment);
      }
      const fields = await this.buildPaymentFields(
        request,
        orderId,
        '3D',
        installment,
        request.callbackUrl
      );
      const result = await this.sendSoapRequest('TP_WMD_UCD', fields);

      if (!isParamposSuccess(result.Sonuc) || !result.UCD_HTML || result.UCD_HTML === 'NONSECURE') {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          paymentId: orderId,
          conversationId: orderId,
          errorCode: result.Sonuc,
          errorMessage: result.Sonuc_Str || '3D Secure form could not be created',
          rawResponse: result,
        });
      }

      return this.withErrorCode({
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: result.UCD_HTML,
        paymentId: orderId,
        conversationId: orderId,
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<ThreeDSInitResponse>(error, '3D Secure initialization failed', {
        paymentId: orderId,
        conversationId: orderId,
      });
    }
  }

  /**
   * Foreign-currency 3D Secure init via TP_Islem_Odeme_WD.
   * https://github.com/PARAMPOS/Dotnet-Ornek-Kod/blob/8c1160cfb9bb6df8ac117d97871b7e5b496088cb/src/ParamApi.Sdk/Models/Responses/TP_Islem_Odeme_WD_Response.cs
   */
  private async initForeignThreeDSPayment(
    request: ThreeDSPaymentRequest,
    orderId: string,
    installment: number
  ): Promise<ThreeDSInitResponse> {
    const currencyCode = PARAMPOS_FOREIGN_CURRENCY_CODES[(request.currency || '').toUpperCase()];
    if (!currencyCode) {
      throw new ValidationError(
        `Parampos foreign-currency payments support USD, EUR and GBP (received ${request.currency})`
      );
    }
    // The WD request model has no Taksit field, so installments are unconfirmed
    if (installment > 1) {
      throw new ValidationError('Parampos foreign-currency payments do not support installments');
    }
    const result = await this.sendSoapRequest(
      'TP_Islem_Odeme_WD',
      await this.buildForeignPaymentFields(request, orderId, currencyCode)
    );

    if (!isParamposSuccess(result.Sonuc)) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        paymentId: orderId,
        conversationId: orderId,
        errorCode: result.Sonuc,
        errorMessage: result.Sonuc_Str || 'Foreign-currency payment could not be started',
        rawResponse: result,
      });
    }
    if (!result.UCD_URL) {
      // Sonuc > 0 but there is no page to send the customer to: do not claim success
      return this.withErrorCode({
        status: PaymentStatus.PENDING,
        paymentId: orderId,
        conversationId: orderId,
        errorCode: 'MISSING_UCD_URL',
        errorMessage: 'Parampos returned no UCD_URL for the foreign-currency payment',
        rawResponse: result,
      });
    }

    return this.withErrorCode({
      status: PaymentStatus.PENDING,
      redirectUrl: result.UCD_URL,
      paymentId: orderId,
      conversationId: orderId,
      rawResponse: result,
    });
  }

  /**
   * Pre-authorization without 3D Secure (TP_Islem_Odeme_OnProv_WMD, NS).
   * Blocks the amount; charge it with capture() or release it with voidAuthorization().
   */
  async authorize(request: PaymentRequest & { installment?: number }): Promise<PaymentResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, PARAMPOS_CARD_RULES);
      this.assertTry(request.currency);
      const installment = Math.max(1, request.installment ?? 1);
      const fields = await this.buildPreAuthFields(request, orderId, 'NS', installment);
      const result = await this.sendSoapRequest('TP_Islem_Odeme_OnProv_WMD', fields);

      const approved = isParamposSuccess(result.Sonuc) && Number(result.Islem_ID) > 0;

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: orderId,
        conversationId: orderId,
        errorCode: approved ? undefined : result.Sonuc,
        errorMessage: approved ? undefined : result.Sonuc_Str || result.Bank_HostMsg,
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Pre-authorization failed', {
        paymentId: orderId,
        conversationId: orderId,
      });
    }
  }

  /**
   * 3D Secure pre-authorization (TP_Islem_Odeme_OnProv_WMD, 3D). The bank posts
   * to callbackUrl; completeThreeDSPayment() verifies it and finalizes with TP_WMD_Pay.
   */
  async initThreeDSAuthorize(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, PARAMPOS_CARD_RULES);
      this.assertTry(request.currency);
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }
      const installment = Math.max(1, request.installment ?? 1);
      const fields = await this.buildPreAuthFields(
        request,
        orderId,
        '3D',
        installment,
        request.callbackUrl
      );
      const result = await this.sendSoapRequest('TP_Islem_Odeme_OnProv_WMD', fields);

      if (!isParamposSuccess(result.Sonuc) || !result.UCD_HTML || result.UCD_HTML === 'NONSECURE') {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          paymentId: orderId,
          conversationId: orderId,
          errorCode: result.Sonuc,
          errorMessage: result.Sonuc_Str || '3D Secure form could not be created',
          rawResponse: result,
        });
      }

      return this.withErrorCode({
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: result.UCD_HTML,
        paymentId: orderId,
        conversationId: orderId,
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<ThreeDSInitResponse>(error, '3D Secure pre-authorization failed', {
        paymentId: orderId,
        conversationId: orderId,
      });
    }
  }

  /**
   * Capture of a pre-authorization (TP_Islem_Odeme_OnProv_Kapa). `amount` may be
   * lower than the authorized amount (partial capture).
   */
  async capture(request: CaptureRequest): Promise<PaymentResponse> {
    try {
      this.validateCapture(request);
      this.assertTry(request.currency);
      const result = await this.sendSoapRequest('TP_Islem_Odeme_OnProv_Kapa', {
        ...this.credentials,
        Prov_ID: '',
        Prov_Tutar: formatParamposAmount(request.amount),
        Siparis_ID: request.paymentId,
      });
      const approved = isParamposSuccess(result.Sonuc);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: request.paymentId,
        conversationId: request.conversationId ?? request.paymentId,
        errorCode: approved ? undefined : result.Sonuc,
        errorMessage: approved ? undefined : result.Sonuc_Str || result.Bank_HostMsg,
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Capture failed', {
        paymentId: request.paymentId,
        conversationId: request.conversationId ?? request.paymentId,
      });
    }
  }

  /** Releases a pre-authorization (TP_Islem_Iptal_OnProv); nothing is charged */
  async voidAuthorization(request: VoidAuthorizationRequest): Promise<CancelResponse> {
    try {
      const result = await this.sendSoapRequest('TP_Islem_Iptal_OnProv', {
        ...this.credentials,
        Prov_ID: '',
        Siparis_ID: request.paymentId,
      });
      const approved = isParamposSuccess(result.Sonuc);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        conversationId: request.conversationId ?? request.paymentId,
        errorCode: approved ? undefined : result.Sonuc,
        errorMessage: approved ? undefined : result.Sonuc_Str,
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Void failed', {
        conversationId: request.conversationId ?? request.paymentId,
      });
    }
  }

  /**
   * Complete 3D Secure payment
   *
   * Foreign currency (TP_Islem_Odeme_WD): Param returns `TURKPOS_RETVAL_*` form
   * fields; they are accepted only after `TURKPOS_RETVAL_Hash` verifies. No
   * second request is needed (or allowed): the signed return is the result.
   *
   * TRY (TP_WMD_UCD):
   * 1. Verifies islemHash with the configured GUID (callback values are untrusted).
   * 2. Requires mdStatus = 1 (full 3D authentication).
   * 3. Finalizes the payment with TP_WMD_Pay. The payment is only successful
   *    when TP_WMD_Pay returns Sonuc > 0 and a Dekont_ID.
   */
  async completeThreeDSPayment(callbackData: Parampos3DSCallbackData): Promise<PaymentResponse> {
    if (callbackData && Parampos.isReturnCallback(callbackData)) {
      return this.completeForeignPayment(callbackData);
    }
    const orderId = callbackData?.orderId;
    try {
      if (!(await verifyParampos3DSCallback(callbackData ?? {}, this.config.guid))) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          paymentId: orderId,
          conversationId: orderId,
          errorCode: 'INVALID_HASH',
          errorMessage: 'Invalid 3D Secure callback signature',
          rawResponse: callbackData,
        });
      }

      if (callbackData.mdStatus !== '1') {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          paymentId: orderId,
          conversationId: orderId,
          errorCode: `MD_STATUS_${callbackData.mdStatus}`,
          errorMessage: callbackData.bankResult || '3D Secure authentication failed',
          rawResponse: callbackData,
        });
      }

      const result = await this.sendSoapRequest('TP_WMD_Pay', {
        ...this.credentials,
        UCD_MD: callbackData.md,
        Islem_GUID: callbackData.islemGUID,
        Siparis_ID: callbackData.orderId,
      });

      const approved = isParamposSuccess(result.Sonuc) && Number(result.Dekont_ID) > 0;

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: orderId,
        conversationId: orderId,
        errorCode: approved ? undefined : result.Sonuc,
        errorMessage: approved
          ? undefined
          : result.Sonuc_Ack || result.Sonuc_Str || result.Bank_HostMsg,
        rawResponse: { callback: callbackData, payment: result },
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, '3D Secure completion failed', {
        paymentId: orderId,
        conversationId: orderId,
      });
    }
  }

  /** True for Param's TP_Islem_Odeme_WD return form (`TURKPOS_RETVAL_*`), not the TRY 3D callback */
  private static isReturnCallback(data: Parampos3DSCallbackData | undefined): boolean {
    return !!data && Object.keys(data).some((key) => key.startsWith('TURKPOS_RETVAL_'));
  }

  /**
   * Completes a foreign-currency payment from the signed `TURKPOS_RETVAL_*` form.
   * Success requires a valid hash AND Sonuc > 0, a non-zero Islem_ID and a
   * positive Dekont_ID (Param's published success check); the amount and
   * currency are kept exactly as reported.
   */
  private async completeForeignPayment(
    callbackData: Parampos3DSCallbackData
  ): Promise<PaymentResponse> {
    const details = {
      paymentId: callbackData.TURKPOS_RETVAL_Siparis_ID,
      conversationId: callbackData.TURKPOS_RETVAL_Siparis_ID,
      amount: callbackData.TURKPOS_RETVAL_Tahsilat_Tutari,
      currency: callbackData.TURKPOS_RETVAL_PB,
    };
    try {
      if (
        !(await verifyParamposReturnHash(callbackData, this.config.clientCode, this.config.guid))
      ) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          ...details,
          errorCode: 'INVALID_HASH',
          errorMessage: 'Invalid foreign-currency callback signature',
          rawResponse: callbackData,
        });
      }

      // Islem_ID is alphanumeric in published WD returns, so require a value
      // (not "0"), not a number; Dekont_ID is numeric and must be positive.
      const islemId = callbackData.TURKPOS_RETVAL_Islem_ID;
      const dekontId = callbackData.TURKPOS_RETVAL_Dekont_ID;
      const approved =
        !!details.paymentId &&
        isParamposSuccess(callbackData.TURKPOS_RETVAL_Sonuc) &&
        !!islemId &&
        islemId !== '0' &&
        !!dekontId &&
        Number(dekontId) > 0;

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        ...details,
        errorCode: approved ? undefined : callbackData.TURKPOS_RETVAL_Sonuc,
        errorMessage: approved
          ? undefined
          : callbackData.TURKPOS_RETVAL_Sonuc_Str || 'Foreign-currency payment failed',
        rawResponse: callbackData,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Foreign-currency callback failed', details);
    }
  }

  private async cancelOrRefund(
    action: 'IADE' | 'IPTAL',
    orderId: string,
    amount: string
  ): Promise<ParamposResult> {
    return this.sendSoapRequest('TP_Islem_Iptal_Iade_Kismi2', {
      ...this.credentials,
      Durum: action,
      Siparis_ID: orderId,
      Tutar: formatParamposRefundAmount(amount),
    });
  }

  /**
   * Refund (full or partial). `paymentId` is the order id (Siparis_ID).
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      this.assertRefundCurrency(request.currency);
      const result = await this.cancelOrRefund('IADE', request.paymentId, request.price);
      const approved = isParamposSuccess(result.Sonuc);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: approved ? result.Bank_Trans_ID || request.paymentId : undefined,
        conversationId: request.conversationId,
        errorCode: approved ? undefined : result.Sonuc,
        errorMessage: approved ? undefined : result.Sonuc_Str,
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Cancel (void) a same-day payment. `paymentId` is the order id (Siparis_ID).
   * Param requires the full amount; when `price` is not given it is read with
   * a status query first.
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      this.assertRefundCurrency(request.currency);
      let amount = request.price;
      if (!amount) {
        const status = await this.queryOrder(request.paymentId);
        const total = parseParamposAmount(status.Toplam_Tutar);
        if (!isParamposSuccess(status.Sonuc) || total === undefined) {
          return this.withErrorCode({
            status: PaymentStatus.FAILURE,
            conversationId: request.conversationId,
            errorMessage:
              status.Sonuc_Str || 'Could not determine payment amount for cancellation; pass price',
            rawResponse: status,
          });
        }
        amount = total.toFixed(2);
      }

      const result = await this.cancelOrRefund('IPTAL', request.paymentId, amount);
      const approved = isParamposSuccess(result.Sonuc);

      return this.withErrorCode({
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        transactionId: approved ? result.Bank_Trans_ID : undefined,
        conversationId: request.conversationId,
        errorCode: approved ? undefined : result.Sonuc,
        errorMessage: approved ? undefined : result.Sonuc_Str,
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancellation failed', {
        conversationId: request.conversationId,
      });
    }
  }

  private queryOrder(orderId: string): Promise<ParamposResult> {
    return this.sendSoapRequest(
      'TP_Islem_Sorgulama4',
      {
        ...this.credentials,
        Dekont_ID: '',
        Siparis_ID: orderId,
        Islem_ID: '',
      },
      { retryable: true }
    );
  }

  /**
   * Payment status by order id (Siparis_ID)
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const result = await this.queryOrder(paymentId);

      if (!isParamposSuccess(result.Sonuc)) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          paymentId,
          conversationId: paymentId,
          errorCode: result.Sonuc,
          errorMessage: result.Sonuc_Str,
          rawResponse: result,
        });
      }

      return this.withErrorCode({
        status: mapParamposOrderStatus(result.Durum as ParamposOrderStatus | undefined),
        paymentId: result.Siparis_ID || paymentId,
        conversationId: result.Siparis_ID || paymentId,
        errorMessage: result.Durum === 'SUCCESS' ? undefined : result.Odeme_Sonuc_Aciklama,
        rawResponse: result,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Payment inquiry failed', { paymentId });
    }
  }

  /**
   * BIN query (BIN_SanalPos)
   */
  async binCheck(binNumber: string): Promise<BinCheckResponse> {
    const result = await this.lookupBin(binNumber);
    return {
      binNumber: result.BIN ?? binNumber,
      cardType: result.Kart_Tip || '',
      cardAssociation: result.Kart_Org || '',
      cardFamily: result.Kart_Tip || '',
      bankName: result.Kart_Banka || '',
      bankCode: Number(result.Banka_Kodu) || 0,
      commercial: result.Ticari_Kart === '1' || /ticari/i.test(result.Kart_Tip || ''),
      rawResponse: result,
    };
  }

  private async lookupBin(binNumber: string): Promise<ParamposResult> {
    const result = await this.sendSoapRequest(
      'BIN_SanalPos',
      { ...this.credentials, BIN: binNumber },
      { retryable: true }
    );
    if (!isParamposSuccess(result.Sonuc) || !result.BIN) {
      throw new Error(result.Sonuc_Str || `BIN ${binNumber} not found`);
    }
    return result;
  }

  /**
   * The merchant's customer-facing commission rates per card program
   * (`TP_Ozel_Oran_SK_Liste`). Negative rates mean "not available" and are left out.
   */
  async getInstallmentRates(): Promise<ParamposInstallmentRates[]> {
    const xml = await this.sendSoapRaw('TP_Ozel_Oran_SK_Liste', this.credentials, {
      retryable: true,
    });
    const result = parseParamposSoapResponse<ParamposResult>(xml, 'TP_Ozel_Oran_SK_ListeResult');
    if (result.Sonuc !== undefined && !isParamposSuccess(result.Sonuc)) {
      throw new Error(result.Sonuc_Str || 'Could not list installment rates');
    }
    return parseParamposDataSetRows(xml, 'DT_Ozel_Oranlar_SK').map((row) => ({
      posId: row.SanalPOS_ID,
      bankName: row.Kredi_Karti_Banka || '',
      rates: Object.fromEntries(paramposRatesOf(row)),
    }));
  }

  /**
   * Rates that apply to a card: the row of the card's virtual POS, or the
   * "other bank cards" row when Param routes the BIN there (DKK = 1).
   */
  private async ratesForBin(binNumber: string) {
    const [bin, programs] = await Promise.all([
      this.lookupBin(binNumber),
      this.getInstallmentRates(),
    ]);
    const program =
      programs.find((p) => p.posId === bin.SanalPOS_ID) ??
      (bin.DKK === '1' ? programs.find((p) => /diğer|diger|other/i.test(p.bankName)) : undefined);
    return { bin, program };
  }

  /**
   * Installment options for a card with Param's totals
   * (Toplam_Tutar = price + price × rate / 100).
   */
  async installmentInfo(request: InstallmentInfoRequest): Promise<InstallmentInfoResponse> {
    try {
      const priceMinor = toMinorUnits(request.price);
      if (!(priceMinor > 0)) throw new ValidationError('price must be greater than 0', 'parampos');
      const { bin, program } = await this.ratesForBin(request.binNumber);

      const installmentPrices: InstallmentDetail[] = Object.entries(program?.rates ?? {})
        .map(([count, rate]) => {
          const installmentNumber = Number(count);
          const totalMinor = calculateParamposTotalMinor(priceMinor, rate);
          return {
            installmentNumber,
            totalPrice: totalMinor / 100,
            installmentPrice: Math.round(totalMinor / installmentNumber) / 100,
            commissionRate: rate,
          };
        })
        .sort((a, b) => a.installmentNumber - b.installmentNumber);

      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        installmentDetails: [
          {
            binNumber: bin.BIN ?? request.binNumber,
            price: priceMinor / 100,
            cardType: bin.Kart_Tip || '',
            cardAssociation: bin.Kart_Org || '',
            cardFamilyName: program?.bankName || bin.Kart_Banka || '',
            bankCode: Number(bin.Banka_Kodu) || 0,
            bankName: bin.Kart_Banka || '',
            commercial: bin.Ticari_Kart === '1' ? 1 : 0,
            installmentPrices,
          },
        ],
        conversationId: request.conversationId,
        rawResponse: { bin, program },
      });
    } catch (error) {
      return this.failure<InstallmentInfoResponse>(error, 'Installment info failed');
    }
  }

  /**
   * The amount to charge (`paidPrice`, Param's Toplam_Tutar) for a card and
   * installment count, using the merchant's rates.
   *
   * @throws ValidationError when the installment count is not available for the card
   */
  async calculatePaidPrice(request: {
    binNumber: string;
    price: string;
    installment?: number;
  }): Promise<string> {
    const installment = request.installment ?? 1;
    const priceMinor = toMinorUnits(request.price);
    const { program } = await this.ratesForBin(request.binNumber);
    const rate = program?.rates[installment];
    if (rate === undefined) {
      throw new ValidationError(
        `installment ${installment} is not available for BIN ${request.binNumber}`,
        'parampos',
        [{ path: 'installment', message: 'is not available for this card' }]
      );
    }
    return (calculateParamposTotalMinor(priceMinor, rate) / 100).toFixed(2);
  }
}

/**
 * Maps Param `Durum` to the unified payment status
 */
export function mapParamposOrderStatus(durum: ParamposOrderStatus | undefined): PaymentStatus {
  switch (durum) {
    case 'SUCCESS':
    case 'PARTIAL_REFUND':
      return PaymentStatus.SUCCESS;
    case 'CANCEL':
    case 'REFUND':
      return PaymentStatus.CANCELLED;
    case 'FAIL':
    case 'BANK_FAIL':
      return PaymentStatus.FAILURE;
    default:
      return PaymentStatus.PENDING;
  }
}

/**
 * The Parampos provider, for `betterPayment({ providers: { parampos: parampos({ clientCode, clientUsername, clientPassword, guid }) } })`.
 * The base URL follows `mode` unless `baseUrl` is set.
 */
export const parampos = (config: ParamposConfig): ProviderDefinition<Parampos> =>
  defineProvider((ctx) => new Parampos(withProviderDefaults(ProviderType.PARAMPOS, config, ctx)));
