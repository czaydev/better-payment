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
import type { PaymentErrorCode } from '../../core/error-codes';
import { generateOrderId } from '../../core/utils';
import {
  PaymentResponse,
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
  STRIPE_API_VERSION,
  STRIPE_JS_URL,
  STRIPE_ERROR_CODES,
  stripeCurrency,
  toStripeAmount,
  encodeStripeForm,
  mapStripeStatus,
  validateStripeIntentId,
} from './utils';
import type {
  StripeConfig,
  StripePaymentRequest,
  StripeThreeDSPaymentRequest,
  Stripe3DCallbackData,
  StripePaymentIntent,
  StripeRefund,
  StripeError,
} from './types';

/** Answer of a Stripe API call: the object, or the error Stripe returned */
type StripeResult<T> = { data: T; error?: undefined } | { data?: undefined; error: StripeError };

/** Statuses from which a PaymentIntent can still be canceled */
const CANCELABLE = [
  'requires_payment_method',
  'requires_capture',
  'requires_confirmation',
  'requires_action',
  'processing',
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A JavaScript string literal that is safe inside a <script> element */
function jsString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Stripe (PaymentIntents API)
 *
 * The card never reaches your server: Stripe.js collects it on your page and
 * returns a token (`paymentToken`), and the 3D Secure step opens on your page
 * too, with no redirect to a Stripe page.
 *
 * - createPayment():          confirms a PaymentIntent; fails when 3D Secure is needed
 * - initThreeDSPayment():     confirms a PaymentIntent and returns a page that runs
 *                             Stripe.js `handleNextAction()`, then POSTs to callbackUrl
 * - completeThreeDSPayment(): fetches the PaymentIntent from Stripe and reads its status
 * - refund(), cancel(), getPayment(), and pre-authorization (authorize / capture / void)
 *
 * `paymentId` is the PaymentIntent id (`pi_...`); `conversationId` is your order id,
 * kept in the PaymentIntent's metadata.
 */
export class Stripe extends PaymentProvider<StripeConfig> {
  private client: HttpClient;

  constructor(config: StripeConfig) {
    super(config);

    this.client = this.createHttpClient('stripe', {
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': STRIPE_API_VERSION,
      },
    });
  }

  protected validateConfig(): void {
    if (!this.config.secretKey) {
      throw new ConfigurationError('Stripe configuration is missing: secretKey', 'stripe');
    }
    if (!/^(sk|rk)_(test|live)_/.test(this.config.secretKey)) {
      throw new ConfigurationError(
        'Stripe secretKey must be a secret (sk_) or restricted (rk_) key',
        'stripe'
      );
    }
    if (this.config.publishableKey && !/^pk_(test|live)_/.test(this.config.publishableKey)) {
      throw new ConfigurationError('Stripe publishableKey must start with pk_', 'stripe');
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('Stripe baseUrl is required', 'stripe');
    }
  }

  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return STRIPE_ERROR_CODES;
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('Stripe', error, fallback, extra));
  }

  private static errorOf(error: StripeError | null | undefined) {
    return {
      errorCode: error?.decline_code || error?.code || error?.type || undefined,
      errorMessage: error?.message || undefined,
    };
  }

  /**
   * Calls the Stripe API. 4xx answers resolve with Stripe's error; network
   * errors and 5xx answers throw.
   */
  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, unknown> = {},
    retryable = false
  ): Promise<StripeResult<T>> {
    const query = encodeStripeForm(params);
    const response = await this.client.request<{ error?: StripeError } & T>({
      method,
      url: method === 'GET' && query ? `${path}?${query}` : path,
      data: method === 'POST' ? query : undefined,
      retryable,
      validateStatus: (status) => status < 500,
    });
    const body = response.data;
    if (response.status >= 400 || !body || typeof body !== 'object') {
      return {
        error:
          body && typeof body === 'object' && body.error
            ? body.error
            : { type: 'api_error', message: `Stripe answered with status ${response.status}` },
      };
    }
    return { data: body as T };
  }

  private retrieveIntent(id: string): Promise<StripeResult<StripePaymentIntent>> {
    return this.call<StripePaymentIntent>(
      'GET',
      `/v1/payment_intents/${encodeURIComponent(id)}`,
      { expand: ['latest_charge'] },
      true
    );
  }

  /** The PaymentIntent parameters of a payment request */
  private intentParams(request: StripePaymentRequest, orderId: string): Record<string, unknown> {
    this.validatePayment(request, { storedCard: true });
    if (request.installment !== undefined && request.installment > 1) {
      throw new ValidationError('Installments are not supported by the Stripe provider');
    }

    const params: Record<string, unknown> = {
      amount: toStripeAmount(request.paidPrice ?? request.price, request.currency),
      currency: stripeCurrency(request.currency),
      confirm: true,
      payment_method_types: this.config.paymentMethodTypes ?? ['card'],
      metadata: { order_id: orderId, basket_id: request.basketId },
      statement_descriptor_suffix: this.config.statementDescriptorSuffix,
      expand: ['latest_charge'],
    };

    const token = request.paymentToken;
    if (token) {
      if (token.startsWith('ctoken_')) params.confirmation_token = token;
      else if (token.startsWith('pm_')) params.payment_method = token;
      else
        throw new ValidationError(
          'paymentToken must be a ConfirmationToken (ctoken_) or PaymentMethod (pm_) id'
        );
    } else if (request.storedCard) {
      params.customer = request.storedCard.customerToken;
      params.payment_method = request.storedCard.cardToken;
    } else if (request.paymentCard) {
      throw new ValidationError(
        'Stripe does not take card numbers: collect the card with Stripe.js and pass paymentToken'
      );
    } else {
      throw new ValidationError('paymentToken (from Stripe.js) or storedCard is required');
    }
    return params;
  }

  /** Builds the result of a confirmed PaymentIntent */
  private intentResult(
    result: StripeResult<StripePaymentIntent>,
    orderId: string
  ): PaymentResponse {
    if (result.error) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        paymentId: result.error.payment_intent?.id,
        conversationId: orderId,
        ...Stripe.errorOf(result.error),
        rawResponse: result.error,
      });
    }
    const intent = result.data;
    const status = mapStripeStatus(intent);
    return this.withErrorCode({
      status,
      paymentId: intent.id,
      conversationId: orderId,
      ...(status === PaymentStatus.FAILURE ? Stripe.errorOf(intent.last_payment_error) : {}),
      rawResponse: intent,
    });
  }

  /**
   * Payment without a 3D Secure step (`error_on_requires_action`): when the card
   * needs 3D Secure, it fails with `authentication_required`; use
   * initThreeDSPayment() then.
   */
  async createPayment(request: StripePaymentRequest): Promise<PaymentResponse> {
    return this.pay(request, false);
  }

  /** Pre-authorization: blocks the amount (`capture_method: manual`) */
  async authorize(request: StripePaymentRequest): Promise<PaymentResponse> {
    return this.pay(request, true);
  }

  private async pay(request: StripePaymentRequest, preAuth: boolean): Promise<PaymentResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      const params = this.intentParams(request, orderId);
      const result = await this.call<StripePaymentIntent>('POST', '/v1/payment_intents', {
        ...params,
        capture_method: preAuth ? 'manual' : undefined,
        error_on_requires_action: true,
      });
      return this.intentResult(result, orderId);
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Payment failed', { conversationId: orderId });
    }
  }

  /**
   * 3D Secure payment. Confirms the PaymentIntent and returns a page for the
   * customer's browser: it loads Stripe.js, runs `handleNextAction()` (the bank's
   * 3D Secure window opens on that page) and POSTs `payment_intent` to callbackUrl.
   * When no 3D Secure step is needed, the page POSTs right away.
   *
   * For a single-page app, read `client_secret` from `rawResponse` and call
   * `stripe.handleNextAction({ clientSecret })` yourself instead.
   */
  async initThreeDSPayment(request: StripeThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    return this.payThreeDS(request, false);
  }

  /** initThreeDSPayment() as a pre-authorization (`capture_method: manual`) */
  async initThreeDSAuthorize(request: StripeThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    return this.payThreeDS(request, true);
  }

  private async payThreeDS(
    request: StripeThreeDSPaymentRequest,
    preAuth: boolean
  ): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      if (!request.callbackUrl) {
        throw new ValidationError('callbackUrl is required for 3D Secure payments');
      }
      if (!this.config.publishableKey) {
        throw new ValidationError('Stripe publishableKey is required for initThreeDSPayment()');
      }
      const params = this.intentParams(request, orderId);
      const result = await this.call<StripePaymentIntent>('POST', '/v1/payment_intents', {
        ...params,
        capture_method: preAuth ? 'manual' : undefined,
      });

      const confirmed = this.intentResult(result, orderId);
      const intent = result.data;
      const usable =
        intent &&
        (intent.status === 'requires_action' || confirmed.status === PaymentStatus.SUCCESS);
      if (!intent || !usable || !intent.client_secret) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          paymentId: confirmed.paymentId,
          conversationId: orderId,
          errorCode: confirmed.errorCode,
          errorMessage:
            confirmed.errorMessage || `Unexpected PaymentIntent status: ${intent?.status}`,
          rawResponse: confirmed.rawResponse,
        });
      }

      return this.withErrorCode({
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: this.threeDSPage(intent, request.callbackUrl),
        paymentId: intent.id,
        conversationId: orderId,
        rawResponse: intent,
      });
    } catch (error) {
      return this.failure<ThreeDSInitResponse>(error, '3DS initialization failed', {
        conversationId: orderId,
      });
    }
  }

  private threeDSPage(intent: StripePaymentIntent, callbackUrl: string): string {
    const locale = (this.config.locale || 'tr').toLowerCase().startsWith('en') ? 'en' : 'tr';
    const needsAction = intent.status === 'requires_action';
    return (
      '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      `<script src="${STRIPE_JS_URL}"></script></head><body>` +
      `<form id="stripe-3d-form" method="POST" action="${escapeHtml(callbackUrl)}">` +
      `<input type="hidden" name="payment_intent" value="${escapeHtml(intent.id)}"></form>` +
      '<script>(function(){' +
      'var form=document.getElementById("stripe-3d-form");' +
      'var done=function(){form.submit();};' +
      (needsAction
        ? 'try{Stripe(' +
          jsString(this.config.publishableKey!) +
          ',{locale:' +
          jsString(locale) +
          '}).handleNextAction({clientSecret:' +
          jsString(intent.client_secret!) +
          '}).then(done,done);}catch(e){done();}'
        : 'done();') +
      '})();</script></body></html>'
    );
  }

  /**
   * Completes the payment after the 3D Secure page POSTs to callbackUrl. Only
   * the PaymentIntent id is taken from the POST: the status, amount and order id
   * come from Stripe.
   *
   * `paymentId` and `conversationId` are set for a confirmed payment, and while
   * the payment is still processing at Stripe; a failure carries no ids.
   */
  async completeThreeDSPayment(callbackData: Stripe3DCallbackData): Promise<PaymentResponse> {
    try {
      const id = validateStripeIntentId(callbackData?.payment_intent);
      const result = await this.retrieveIntent(id);
      if (result.error) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          ...Stripe.errorOf(result.error),
          rawResponse: result.error,
        });
      }

      const intent = result.data;
      const status = mapStripeStatus(intent);
      const orderId = intent.metadata?.order_id || undefined;
      if (status === PaymentStatus.SUCCESS || intent.status === 'processing') {
        return this.withErrorCode({
          status,
          paymentId: intent.id,
          conversationId: orderId,
          rawResponse: intent,
        });
      }
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        ...(intent.last_payment_error
          ? Stripe.errorOf(intent.last_payment_error)
          : {
              errorCode:
                intent.status === 'requires_action' ? 'authentication_required' : intent.status,
              errorMessage:
                intent.status === 'requires_action'
                  ? '3D Secure authentication was not completed'
                  : `Payment is ${intent.status}`,
            }),
        rawResponse: intent,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, '3D Secure completion failed');
    }
  }

  private refundResult(
    result: StripeResult<StripeRefund>,
    conversationId: string | undefined
  ): RefundResponse {
    if (result.error) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        conversationId,
        ...Stripe.errorOf(result.error),
        rawResponse: result.error,
      });
    }
    const refund = result.data;
    const status =
      refund.status === 'succeeded'
        ? PaymentStatus.SUCCESS
        : refund.status === 'failed' || refund.status === 'canceled'
          ? PaymentStatus.FAILURE
          : PaymentStatus.PENDING;
    return this.withErrorCode({
      status,
      refundId: refund.id,
      conversationId,
      ...(status === PaymentStatus.FAILURE
        ? { errorCode: refund.failure_reason || refund.status, errorMessage: 'Refund failed' }
        : {}),
      rawResponse: refund,
    });
  }

  /**
   * Refund (a lower amount is a partial refund). `paymentId` is the PaymentIntent
   * id. Card refunds usually succeed at once; `pending` means Stripe is still
   * processing it.
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const id = validateStripeIntentId(request.paymentId);
      const result = await this.call<StripeRefund>('POST', '/v1/refunds', {
        payment_intent: id,
        amount: toStripeAmount(request.price, request.currency),
      });
      return this.refundResult(result, request.conversationId);
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Cancels a payment. A PaymentIntent that has not been charged yet (for example
   * a pre-authorization) is canceled; a charged one is refunded in full, since
   * Stripe has no void after the charge.
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const id = validateStripeIntentId(request.paymentId);
      const current = await this.retrieveIntent(id);
      if (current.error) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          conversationId: request.conversationId,
          ...Stripe.errorOf(current.error),
          rawResponse: current.error,
        });
      }

      if (current.data.status === 'succeeded') {
        const refund = this.refundResult(
          await this.call<StripeRefund>('POST', '/v1/refunds', { payment_intent: id }),
          request.conversationId
        );
        return { ...refund, transactionId: refund.refundId };
      }
      if (!CANCELABLE.includes(current.data.status)) {
        return this.withErrorCode({
          status: PaymentStatus.FAILURE,
          conversationId: request.conversationId,
          errorCode: current.data.status,
          errorMessage: `Payment is already ${current.data.status}`,
          rawResponse: current.data,
        });
      }
      return this.cancelIntent(id, request.conversationId);
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', {
        conversationId: request.conversationId,
      });
    }
  }

  private async cancelIntent(
    id: string,
    conversationId: string | undefined
  ): Promise<CancelResponse> {
    const result = await this.call<StripePaymentIntent>(
      'POST',
      `/v1/payment_intents/${encodeURIComponent(id)}/cancel`
    );
    if (result.error || result.data.status !== 'canceled') {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        conversationId,
        ...(result.error
          ? Stripe.errorOf(result.error)
          : { errorCode: result.data.status, errorMessage: 'PaymentIntent was not canceled' }),
        rawResponse: result.error ?? result.data,
      });
    }
    return this.withErrorCode({
      status: PaymentStatus.SUCCESS,
      transactionId: result.data.id,
      voidId: result.data.id,
      conversationId,
      rawResponse: result.data,
    });
  }

  /** Captures a pre-authorization; a lower amount captures part of it */
  async capture(request: CaptureRequest): Promise<PaymentResponse> {
    try {
      this.validateCapture(request);
      const id = validateStripeIntentId(request.paymentId);
      let currency = request.currency;
      if (!currency) {
        const current = await this.retrieveIntent(id);
        if (current.error) return this.intentResult(current, request.conversationId ?? '');
        currency = current.data.currency;
      }
      const result = await this.call<StripePaymentIntent>(
        'POST',
        `/v1/payment_intents/${encodeURIComponent(id)}/capture`,
        { amount_to_capture: toStripeAmount(request.amount, currency), expand: ['latest_charge'] }
      );
      const response = this.intentResult(result, request.conversationId ?? '');
      return {
        ...response,
        conversationId: result.data?.metadata?.order_id ?? request.conversationId,
      };
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Capture failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /** Releases a pre-authorization (cancels the PaymentIntent) */
  async voidAuthorization(request: VoidAuthorizationRequest): Promise<CancelResponse> {
    try {
      return await this.cancelIntent(
        validateStripeIntentId(request.paymentId),
        request.conversationId
      );
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Void failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /** Payment status. `paymentId` is the PaymentIntent id. */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const id = validateStripeIntentId(paymentId);
      const result = await this.retrieveIntent(id);
      const response = this.intentResult(result, result.data?.metadata?.order_id ?? '');
      return {
        ...response,
        paymentId: id,
        conversationId: result.data?.metadata?.order_id || undefined,
      };
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Get payment failed', { paymentId });
    }
  }
}

/**
 * The Stripe provider, for
 * `betterPayment({ providers: { stripe: stripe({ secretKey, publishableKey }) } })`.
 * Stripe has one API host; sandbox mode refuses live keys.
 */
export const stripe = (config: StripeConfig): ProviderDefinition<Stripe> =>
  defineProvider((ctx) => {
    const live = [config.secretKey, config.publishableKey].some((key) =>
      /^(sk|rk|pk)_live_/.test(key ?? '')
    );
    if (ctx.mode === 'sandbox' && live) {
      throw new ConfigurationError('Stripe live keys cannot be used in sandbox mode', 'stripe');
    }
    return new Stripe(withProviderDefaults(ProviderType.STRIPE, config, ctx));
  });
