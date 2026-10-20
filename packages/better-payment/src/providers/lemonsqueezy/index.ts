import {
  defineProvider,
  withProviderDefaults,
  ProviderType,
  type ProviderDefinition,
} from '../../core/BetterPaymentConfig';
import type { HttpClient } from '../../core/http';
import { PaymentProvider } from '../../core/PaymentProvider';
import { ConfigurationError, ValidationError } from '../../core/errors';
import { failureResult, type FailureResult } from '../../core/failure';
import { PaymentErrorCode } from '../../core/error-codes';
import { generateOrderId, toMinorUnits } from '../../core/utils';
import {
  PaymentRequest,
  PaymentResponse,
  ThreeDSPaymentRequest,
  RefundRequest,
  RefundResponse,
  CancelRequest,
  CancelResponse,
  PaymentStatus,
} from '../../types';
import {
  LEMONSQUEEZY_MEDIA_TYPE,
  mapLemonSqueezyOrderStatus,
  verifyLemonSqueezySignature,
} from './utils';
import type {
  LemonSqueezyCompleteContext,
  LemonSqueezyConfig,
  LemonSqueezyOrderAttributes,
  LemonSqueezyResource,
  LemonSqueezyThreeDSInitResponse,
  LemonSqueezyWebhookDelivery,
  LemonSqueezyWebhookEvent,
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

/** A JSON:API answer: the resource, or the first error */
type LemonSqueezyResult<A> =
  | { data: LemonSqueezyResource<A>; error?: undefined }
  | { data?: undefined; error: { status: string; message: string } };

/**
 * Lemon Squeezy (REST, JSON:API)
 *
 * Lemon Squeezy is the merchant of record: the customer pays on Lemon Squeezy's
 * checkout (a page, or an overlay on yours), so the card never reaches your
 * server, and the result arrives as a signed webhook.
 *
 * - initThreeDSPayment():     creates a checkout for your variant at the order's price
 * - completeThreeDSPayment(): verifies a webhook (`X-Signature`), then reads the order
 * - refund() / cancel():      refunds an order, partly or fully
 * - getPayment():             reads an order
 *
 * `paymentId` is Lemon Squeezy's order id; `conversationId` is your order id,
 * kept in the checkout's custom data. Non-3D card payments, pre-authorization,
 * BIN and installment queries are not supported.
 */
export class LemonSqueezy extends PaymentProvider<LemonSqueezyConfig> {
  private client: HttpClient;

  constructor(config: LemonSqueezyConfig) {
    super(config);

    this.client = this.createHttpClient('lemonsqueezy', {
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: LEMONSQUEEZY_MEDIA_TYPE,
        'Content-Type': LEMONSQUEEZY_MEDIA_TYPE,
      },
    });
  }

  protected validateConfig(): void {
    const missing = (['apiKey', 'storeId', 'variantId', 'webhookSecret'] as const).filter(
      (key) => !this.config[key]
    );
    if (missing.length > 0) {
      throw new ConfigurationError(
        `Lemon Squeezy configuration is missing: ${missing.join(', ')}`,
        'lemonsqueezy'
      );
    }
    if (!this.config.baseUrl) {
      throw new ConfigurationError('Lemon Squeezy baseUrl is required', 'lemonsqueezy');
    }
  }

  /** HTTP statuses of Lemon Squeezy's errors */
  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return {
      '400': PaymentErrorCode.INVALID_REQUEST,
      '401': PaymentErrorCode.PROVIDER_ERROR,
      '403': PaymentErrorCode.PROVIDER_ERROR,
      '404': PaymentErrorCode.INVALID_REQUEST,
      '422': PaymentErrorCode.INVALID_REQUEST,
      '429': PaymentErrorCode.PROVIDER_ERROR,
    };
  }

  private failure<T extends FailureResult>(
    error: unknown,
    fallback: string,
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode(failureResult<T>('Lemon Squeezy', error, fallback, extra));
  }

  /** The store's currency: Lemon Squeezy reads every price in it */
  private get currency(): string {
    return (this.config.currency || 'USD').toUpperCase();
  }

  private async call<A>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    retryable = false
  ): Promise<LemonSqueezyResult<A>> {
    const response = await this.client.request<{
      data?: LemonSqueezyResource<A>;
      errors?: Array<{ status?: string; title?: string; detail?: string }>;
    }>({
      method,
      url: path,
      data: body === undefined ? undefined : JSON.stringify(body),
      retryable,
      validateStatus: (status) => status < 500,
    });
    const answer = response.data && typeof response.data === 'object' ? response.data : {};
    if (response.status >= 400 || !answer.data) {
      const first = answer.errors?.[0];
      return {
        error: {
          status: String(first?.status ?? response.status),
          message:
            nonEmpty(first?.detail) ??
            nonEmpty(first?.title) ??
            `Lemon Squeezy answered with status ${response.status}`,
        },
      };
    }
    return { data: answer.data };
  }

  private errorResult<T extends { status: PaymentStatus }>(
    error: { status: string; message: string },
    extra: Partial<T> = {}
  ): T {
    return this.withErrorCode({
      status: PaymentStatus.FAILURE,
      errorCode: error.status,
      errorMessage: error.message,
      rawResponse: error,
      ...extra,
    } as unknown as T);
  }

  /** Card payments go through Lemon Squeezy's checkout: use initThreeDSPayment() */
  async createPayment(_request: PaymentRequest): Promise<PaymentResponse> {
    throw this.notSupported(
      'Non-3D card payment',
      "the customer pays on Lemon Squeezy's checkout: use initThreeDSPayment()"
    );
  }

  /**
   * Creates a checkout for your variant at the order's price (`custom_price`),
   * with your order id in its custom data. `redirectUrl` is the checkout;
   * `threeDSHtmlContent` sends the browser there. With `embed`, open
   * `redirectUrl` with Lemon.js as an overlay instead. `callbackUrl` is where
   * the customer returns after paying; the result itself comes as a webhook.
   * No `paymentCard` is needed.
   */
  async initThreeDSPayment(
    request: ThreeDSPaymentRequest
  ): Promise<LemonSqueezyThreeDSInitResponse> {
    const orderId = request.conversationId || generateOrderId();
    try {
      this.validatePayment(request, {});
      const cents = toMinorUnits(request.paidPrice ?? request.price);
      if (!(cents > 0)) throw new ValidationError('price must be greater than 0');
      const currency = String(request.currency || '').toUpperCase();
      if (currency !== this.currency) {
        throw new ValidationError(
          `Lemon Squeezy prices are in the store's currency (${this.currency}), got ${currency || 'none'}`
        );
      }
      const name = [request.buyer?.name, request.buyer?.surname].filter(Boolean).join(' ');
      const result = await this.call<{ url?: string }>('POST', '/v1/checkouts', {
        data: {
          type: 'checkouts',
          attributes: {
            custom_price: cents,
            product_options: {
              enabled_variants: [Number(this.config.variantId)],
              ...(request.callbackUrl ? { redirect_url: request.callbackUrl } : {}),
            },
            checkout_options: { embed: this.config.embed === true },
            checkout_data: {
              ...(request.buyer?.email ? { email: request.buyer.email } : {}),
              ...(name ? { name } : {}),
              custom: { order_id: orderId },
            },
          },
          relationships: {
            store: { data: { type: 'stores', id: String(this.config.storeId) } },
            variant: { data: { type: 'variants', id: String(this.config.variantId) } },
          },
        },
      });
      if (result.error) {
        return this.errorResult<LemonSqueezyThreeDSInitResponse>(result.error, {
          conversationId: orderId,
        });
      }
      const url = nonEmpty(result.data.attributes?.url);
      if (!url) {
        return this.errorResult<LemonSqueezyThreeDSInitResponse>(
          { status: 'NO_CHECKOUT_URL', message: 'Lemon Squeezy returned no checkout URL' },
          { conversationId: orderId }
        );
      }
      const html =
        '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
        `<meta http-equiv="refresh" content="0;url=${escapeHtml(url)}"></head><body>` +
        `<a href="${escapeHtml(url)}">Continue to payment</a></body></html>`;
      return this.withErrorCode({
        status: PaymentStatus.PENDING,
        redirectUrl: url,
        threeDSHtmlContent: html,
        checkoutId: nonEmpty(result.data.id),
        conversationId: orderId,
        rawResponse: result.data,
      });
    } catch (error) {
      return this.failure<LemonSqueezyThreeDSInitResponse>(error, 'Checkout creation failed', {
        conversationId: orderId,
      });
    }
  }

  /**
   * Completes a payment from a webhook. The signature covers the exact bytes, so
   * this needs the raw body and the `X-Signature` header: the default handler's
   * `/lemonsqueezy/callback` route passes them as `callbackData`, and your own
   * route can pass them in `context`. Nothing but the signed raw body is used. The order id comes from the signed event's custom data and must
   * match `context.orderId` when given. The order is then read from Lemon Squeezy:
   * it must belong to your store, and to `context.amount` when given; its status
   * decides. A bad signature, another store, order or amount is INVALID_HASH.
   */
  async completeThreeDSPayment(
    callbackData: LemonSqueezyWebhookDelivery | LemonSqueezyWebhookEvent,
    context: LemonSqueezyCompleteContext = {}
  ): Promise<PaymentResponse> {
    const untrusted = (errorMessage: string, rawResponse: unknown): PaymentResponse =>
      this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'INVALID_HASH',
        errorMessage,
        rawResponse,
      });

    // The raw delivery: from the default handler, or from your route's context
    const delivery = (callbackData ?? {}) as Partial<LemonSqueezyWebhookDelivery>;
    const rawBody =
      context.rawBody ?? (typeof delivery.rawBody === 'string' ? delivery.rawBody : undefined);
    const signature =
      context.signature ??
      (typeof delivery.signature === 'string' ? delivery.signature : undefined);
    if (typeof rawBody !== 'string' || !signature) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'VALIDATION_ERROR',
        errorMessage:
          'A Lemon Squeezy webhook needs its raw body and X-Signature header: point the ' +
          "webhook at the handler's /lemonsqueezy/callback route, or call " +
          "completeThreeDSPayment(body, { rawBody, signature: headers['x-signature'] })",
      });
    }
    if (!(await verifyLemonSqueezySignature(rawBody, signature, this.config.webhookSecret))) {
      return untrusted('Invalid webhook signature', undefined);
    }

    let event: LemonSqueezyWebhookEvent;
    try {
      event = JSON.parse(rawBody) as LemonSqueezyWebhookEvent;
    } catch {
      return untrusted('Webhook body is not JSON', undefined);
    }
    const lsOrderId = nonEmpty(event.data?.id);
    if (event.data?.type !== 'orders' || !lsOrderId) {
      return this.withErrorCode({
        status: PaymentStatus.FAILURE,
        errorCode: 'INVALID_CALLBACK',
        errorMessage: `Not an order event: ${event.meta?.event_name ?? 'unknown'}`,
        rawResponse: event,
      });
    }
    const orderId = nonEmpty(event.meta?.custom_data?.order_id);
    if (context.orderId !== undefined && orderId !== context.orderId) {
      return untrusted('Webhook is for another order', event);
    }

    try {
      const result = await this.call<LemonSqueezyOrderAttributes>(
        'GET',
        `/v1/orders/${encodeURIComponent(lsOrderId)}`,
        undefined,
        true
      );
      if (result.error) return this.errorResult<PaymentResponse>(result.error);
      const order = result.data.attributes ?? {};
      if (String(order.store_id) !== String(this.config.storeId)) {
        return untrusted('Order belongs to another store', { event, order: result.data });
      }
      const status = mapLemonSqueezyOrderStatus(order.status);
      if (
        status === PaymentStatus.SUCCESS &&
        context.amount !== undefined &&
        (order.total !== toMinorUnits(context.amount) ||
          String(order.currency).toUpperCase() !== this.currency)
      ) {
        return untrusted('Order amount differs from yours', { event, order: result.data });
      }
      return this.withErrorCode({
        status,
        ...(status === PaymentStatus.FAILURE
          ? { errorCode: order.status, errorMessage: `Lemon Squeezy order is ${order.status}` }
          : { paymentId: lsOrderId, conversationId: orderId }),
        rawResponse: { event: event.meta, order: result.data },
      });
    } catch (error) {
      // A timeout while reading the order: the event is signed, so its ids stand
      const failed = this.failure<PaymentResponse>(error, 'Order lookup failed');
      return failed.status === PaymentStatus.PENDING
        ? { ...failed, paymentId: lsOrderId, conversationId: orderId }
        : failed;
    }
  }

  private async refundOrder(paymentId: string, cents: number | undefined) {
    if (!paymentId) throw new ValidationError('paymentId is required');
    return this.call<LemonSqueezyOrderAttributes>(
      'POST',
      `/v1/orders/${encodeURIComponent(paymentId)}/refund`,
      {
        data: {
          type: 'orders',
          id: String(paymentId),
          ...(cents !== undefined ? { attributes: { amount: cents } } : {}),
        },
      }
    );
  }

  /** Refund of an order (`/v1/orders/:id/refund`), partial or full. `paymentId` is Lemon Squeezy's order id. */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      this.validateRefund(request);
      const result = await this.refundOrder(request.paymentId, toMinorUnits(request.price));
      if (result.error) {
        return this.errorResult<RefundResponse>(result.error, {
          conversationId: request.conversationId,
        });
      }
      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        conversationId: request.conversationId,
        rawResponse: result.data,
      });
    } catch (error) {
      return this.failure<RefundResponse>(error, 'Refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /** Lemon Squeezy has no void: cancel() refunds the whole order */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const result = await this.refundOrder(request.paymentId, undefined);
      if (result.error) {
        return this.errorResult<CancelResponse>(result.error, {
          conversationId: request.conversationId,
        });
      }
      return this.withErrorCode({
        status: PaymentStatus.SUCCESS,
        conversationId: request.conversationId,
        rawResponse: result.data,
      });
    } catch (error) {
      return this.failure<CancelResponse>(error, 'Cancel failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /** An order's status (`/v1/orders/:id`); see mapLemonSqueezyOrderStatus() */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      if (!paymentId) throw new ValidationError('paymentId is required');
      const result = await this.call<LemonSqueezyOrderAttributes>(
        'GET',
        `/v1/orders/${encodeURIComponent(paymentId)}`,
        undefined,
        true
      );
      if (result.error) return this.errorResult<PaymentResponse>(result.error, { paymentId });
      const order = result.data.attributes ?? {};
      if (String(order.store_id) !== String(this.config.storeId)) {
        return this.errorResult<PaymentResponse>(
          { status: '404', message: 'Order belongs to another store' },
          { paymentId }
        );
      }
      return this.withErrorCode({
        status: mapLemonSqueezyOrderStatus(order.status),
        paymentId,
        rawResponse: result.data,
      });
    } catch (error) {
      return this.failure<PaymentResponse>(error, 'Get payment failed', { paymentId });
    }
  }
}

/**
 * The Lemon Squeezy provider, for
 * `betterPayment({ providers: { lemonsqueezy: lemonSqueezy({ apiKey, storeId, variantId, webhookSecret }) } })`.
 * Test or live mode follows the API key.
 */
export const lemonSqueezy = (config: LemonSqueezyConfig): ProviderDefinition<LemonSqueezy> =>
  defineProvider(
    (ctx) => new LemonSqueezy(withProviderDefaults(ProviderType.LEMONSQUEEZY, config, ctx))
  );
