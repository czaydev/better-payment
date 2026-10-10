import type { PaymentCore, RegisteredEndpoint } from './BetterPayment';
import { ProviderType } from './BetterPaymentConfig';
import { BetterPaymentError, ConfigurationError } from './errors';
import { EventListenerError } from './events';
import type { EndpointContext } from './plugin';
import { VERSION } from '../version';
import { PaymentStatus } from '../types';
import type { PaymentResponse } from '../types';
import type { PaymentProvider } from './PaymentProvider';
import { errorMessage } from './utils';
import { NETWORK_ERROR_CODE } from './failure';
import { fingerprint, MemoryIdempotencyStore, type IdempotencyStore } from './idempotency';
import type {
  CheckoutFormRequest,
  PWIPaymentRequest,
  InstallmentInfoRequest,
  SubscriptionInitializeRequest,
  SubscriptionCancelRequest,
  SubscriptionUpgradeRequest,
  SubscriptionRetrieveRequest,
  SubscriptionCardUpdateRequest,
  SubscriptionProductCreateRequest,
  PricingPlanCreateRequest,
} from '../types';
import { Iyzico } from '../providers/iyzico';
import { PayTR } from '../providers/paytr';

/**
 * HTTP Request interface for framework-agnostic handling
 */
export interface BetterPaymentRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Raw body (string) or an already parsed object */
  body?: unknown;
}

/**
 * HTTP Response interface for framework-agnostic handling.
 * `body` is a JSON-serializable object, except for text responses
 * (Content-Type text/plain, e.g. the PayTR "OK" acknowledgement) where it is a string.
 */
export interface BetterPaymentResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** A plugin endpoint, as `plugin:<plugin id>/<endpoint name>` */
export type PluginEndpointAction = `plugin:${string}`;

/**
 * Handler actions (URL path after `/:provider/`), and plugin endpoints
 */
export type HandlerAction = BuiltInHandlerAction | PluginEndpointAction;

export type BuiltInHandlerAction =
  | 'payment'
  | 'payment/init-3ds'
  | 'payment/token'
  | 'payment/complete-3ds'
  | 'payment/get'
  | 'callback'
  | 'refund'
  | 'cancel'
  | 'authorize'
  | 'authorize/init-3ds'
  | 'capture'
  | 'void'
  | 'cards/save'
  | 'cards/list'
  | 'cards/delete'
  | 'checkout/init'
  | 'checkout/retrieve'
  | 'pwi/init'
  | 'pwi/retrieve'
  | 'installment'
  | 'bin-check'
  | 'subscription/initialize'
  | 'subscription/cancel'
  | 'subscription/upgrade'
  | 'subscription/retrieve'
  | 'subscription/card-update'
  | 'subscription/product'
  | 'subscription/pricing-plan';

export const ALL_HANDLER_ACTIONS: BuiltInHandlerAction[] = [
  'payment',
  'payment/init-3ds',
  'payment/token',
  'payment/complete-3ds',
  'payment/get',
  'callback',
  'refund',
  'cancel',
  'authorize',
  'authorize/init-3ds',
  'capture',
  'void',
  'cards/save',
  'cards/list',
  'cards/delete',
  'checkout/init',
  'checkout/retrieve',
  'pwi/init',
  'pwi/retrieve',
  'installment',
  'bin-check',
  'subscription/initialize',
  'subscription/cancel',
  'subscription/upgrade',
  'subscription/retrieve',
  'subscription/card-update',
  'subscription/product',
  'subscription/pricing-plan',
];

/**
 * Enabled when `allowedActions` is not set: provider callbacks (which must be
 * reachable by the bank/provider) and read-only card queries.
 */
export const DEFAULT_HANDLER_ACTIONS: HandlerAction[] = [
  'payment/complete-3ds',
  'callback',
  'installment',
  'bin-check',
];

/**
 * Actions that move money back, manage subscriptions or expose payment
 * details. They can only be enabled together with an `authorize` hook.
 */
export const PRIVILEGED_HANDLER_ACTIONS: HandlerAction[] = [
  'refund',
  'cancel',
  'capture',
  'void',
  'cards/save',
  'cards/list',
  'cards/delete',
  'payment/get',
  'subscription/cancel',
  'subscription/upgrade',
  'subscription/retrieve',
  'subscription/card-update',
  'subscription/product',
  'subscription/pricing-plan',
];

/**
 * Provider callbacks. They are signed by the provider and are called by the
 * bank or the customer's browser, not by your frontend.
 */
export const CALLBACK_HANDLER_ACTIONS: HandlerAction[] = ['payment/complete-3ds', 'callback'];

export interface HandlerContext {
  /** The provider id of the route; undefined for plugin endpoints */
  provider: string | undefined;
  action: HandlerAction;
  params: Record<string, string>;
  request: BetterPaymentRequest;
  /**
   * Parsed request body (form-urlencoded callbacks are converted to objects).
   * Undefined when the request has no object body.
   */
  body: Record<string, unknown> | undefined;
}

export interface BetterPaymentHandlerOptions {
  /** Path prefix the handler is mounted on. Default: '/api/pay' */
  basePath?: string;
  /**
   * Actions exposed over HTTP. Default: DEFAULT_HANDLER_ACTIONS.
   * Use 'all' to expose everything (requires `authorize`).
   */
  allowedActions?: HandlerAction[] | 'all';
  /**
   * Called before every action except the health check. Return false (or throw)
   * to reject the request with 403. Required when privileged actions are enabled.
   *
   * Provider callbacks (`callback`, `payment/complete-3ds`) are signed by the
   * provider and are called by the bank/customer browser, so the hook usually
   * lets them through: `if (CALLBACK_HANDLER_ACTIONS.includes(ctx.action)) return true`.
   */
  authorize?: (ctx: HandlerContext) => boolean | Promise<boolean>;
  /**
   * Returns the body passed to the provider. Use it to set amounts, basket and
   * buyer on the server instead of trusting the client, e.g. look up the order
   * by id and build the payment request from your database.
   */
  transformRequest?: (ctx: HandlerContext) => object | undefined | Promise<object | undefined>;
  /**
   * Called with the verified result of a provider callback. Update your order here.
   * Errors thrown here make the handler return 500 (PayTR will then retry the notification).
   */
  onCallback?: (result: PaymentResponse, ctx: CallbackContext) => void | Promise<void>;
  /**
   * For browser callbacks (3D Secure return), return a URL to redirect the
   * customer to (303). When undefined, the result is returned as JSON.
   */
  callbackRedirect?: (
    result: PaymentResponse,
    ctx: CallbackContext
  ) => string | undefined | Promise<string | undefined>;
  /** Include error messages of unexpected exceptions in 500 responses. Default: false */
  exposeErrors?: boolean;
  /**
   * Include the provider's `rawResponse` in responses. It can hold merchant data
   * (commission rates, fraud status) and stored-card keys, so it is left out by
   * default. Your hooks (`onCallback`, events) always receive it. Default: false
   */
  exposeRawResponse?: boolean;
  /**
   * Deduplication of provider callbacks and `Idempotency-Key` requests.
   * On by default with an in-memory store; pass a shared store (Redis, DB)
   * when running several instances, or `false` to turn it off.
   */
  idempotency?: false | HandlerIdempotencyOptions;
}

/** The context of a provider callback: the provider is always known */
export type CallbackContext = HandlerContext & { provider: string };

export interface HandlerIdempotencyOptions {
  /** Default: MemoryIdempotencyStore (per process) */
  store?: IdempotencyStore;
  /** How long results are remembered. Default: 86400 (24 hours) */
  ttlSeconds?: number;
  /** How long an in-flight request holds its key if the process dies. Default: 60 */
  lockSeconds?: number;
  /**
   * Returns the caller an `Idempotency-Key` belongs to, such as the user or
   * session id. Keys of different callers never share a stored response.
   * Default: keys are shared by all callers
   */
  scope?: (ctx: HandlerContext) => string | undefined | Promise<string | undefined>;
}

/**
 * Actions that honor an `Idempotency-Key` request header: a repeated key
 * returns the first response instead of calling the provider again.
 */
export const IDEMPOTENT_KEY_ACTIONS: HandlerAction[] = [
  'payment',
  'payment/init-3ds',
  'payment/token',
  'refund',
  'cancel',
  'authorize',
  'authorize/init-3ds',
  'capture',
  'void',
  'cards/save',
  'cards/delete',
  'checkout/init',
  'pwi/init',
  'subscription/initialize',
  'subscription/cancel',
  'subscription/upgrade',
  'subscription/card-update',
  'subscription/product',
  'subscription/pricing-plan',
];

type CallbackRecord =
  | { state: 'processing'; result?: PaymentResponse }
  | { state: 'verified'; result: PaymentResponse }
  | { state: 'done'; response: BetterPaymentResponse };

type RequestRecord =
  | { state: 'processing'; request: string }
  | { state: 'done'; request: string; response: BetterPaymentResponse };

/** Removes leading and trailing slashes without a backtracking regex */
function trimSlashes(path: string): string {
  let start = 0;
  let end = path.length;
  while (start < end && path[start] === '/') start++;
  while (end > start && path[end - 1] === '/') end--;
  return path.slice(start, end);
}

function parseRecord<T>(value: string | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

interface TokenBody {
  token: string;
  conversationId?: string;
}

function supportsTokenPayment(
  provider: PaymentProvider
): provider is PaymentProvider & Pick<PayTR, 'createPaymentWithToken'> {
  return typeof (provider as Partial<PayTR>).createPaymentWithToken === 'function';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

interface RouteContext {
  provider: string;
  action: HandlerAction | string;
  params: Record<string, string>;
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * BetterPaymentHandler - Framework-agnostic HTTP handler
 *
 * Endpoints (relative to `basePath`, default `/api/pay`):
 * - POST /:provider/payment                -> createPayment()
 * - POST /:provider/payment/init-3ds       -> initThreeDSPayment()
 * - POST /:provider/payment/token          -> createPaymentWithToken() (PayTR)
 * - POST /:provider/payment/complete-3ds   -> completeThreeDSPayment()
 * - POST /:provider/callback               -> completeThreeDSPayment() (PayTR: responds "OK")
 * - GET  /:provider/payment/:id            -> getPayment()
 * - POST /:provider/refund | cancel        -> refund() / cancel()
 * - POST /:provider/authorize[/init-3ds]    -> authorize() / initThreeDSAuthorize()
 * - POST /:provider/capture | void         -> capture() / voidAuthorization()
 * - POST /:provider/cards/{save,list,delete} -> saveCard() / listCards() / deleteCard()
 * - POST /:provider/installment | bin-check
 * - iyzico only: checkout/*, pwi/*, subscription/*
 * - GET  /health
 *
 * Secure by default: only callbacks and card queries are enabled. Enable more
 * with `allowedActions`; privileged actions also require `authorize`.
 */
export class BetterPaymentHandler {
  private readonly basePath: string;
  private readonly allowed: Set<HandlerAction>;
  private readonly idempotency?: Required<Omit<HandlerIdempotencyOptions, 'scope'>> &
    Pick<HandlerIdempotencyOptions, 'scope'>;
  private readonly endpoints: Map<string, RegisteredEndpoint>;

  constructor(
    private core: PaymentCore,
    private options: BetterPaymentHandlerOptions = {}
  ) {
    this.basePath = '/' + trimSlashes(options.basePath ?? '/api/pay');
    const allowed =
      options.allowedActions === 'all'
        ? ALL_HANDLER_ACTIONS
        : (options.allowedActions ?? DEFAULT_HANDLER_ACTIONS);
    this.allowed = new Set(allowed);

    if (options.idempotency !== false) {
      this.idempotency = {
        store: options.idempotency?.store ?? new MemoryIdempotencyStore(),
        ttlSeconds: options.idempotency?.ttlSeconds ?? 86_400,
        lockSeconds: options.idempotency?.lockSeconds ?? 60,
        scope: options.idempotency?.scope,
      };
    }

    this.endpoints = new Map();
    for (const endpoint of core.endpoints) {
      const path = '/' + trimSlashes(endpoint.path);
      const first = path.split('/')[1];
      if (core.isProviderEnabled(first) || first === 'health' || first === 'ok') {
        throw new ConfigurationError(
          `Endpoint '${endpoint.name}' of plugin '${endpoint.pluginId}' uses the reserved path ${path}`
        );
      }
      if (this.endpoints.has(path)) {
        throw new ConfigurationError(`Two plugin endpoints use the path ${path}`);
      }
      this.endpoints.set(path, endpoint);
    }

    const privileged: string[] = allowed.filter((a) => PRIVILEGED_HANDLER_ACTIONS.includes(a));
    for (const endpoint of this.endpoints.values()) {
      if (endpoint.privileged) privileged.push(`plugin:${endpoint.pluginId}/${endpoint.name}`);
    }
    if (privileged.length > 0 && !options.authorize) {
      throw new ConfigurationError(
        `Handler actions [${privileged.join(', ')}] require an 'authorize' hook. ` +
          'Refunds, cancellations and subscription management must never be publicly reachable.'
      );
    }
  }

  /**
   * Main request handler
   */
  async handle(request: BetterPaymentRequest): Promise<BetterPaymentResponse> {
    return this.core.respond(await this.route(request), { request });
  }

  private async route(request: BetterPaymentRequest): Promise<BetterPaymentResponse> {
    try {
      const path = this.getPath(request.url);
      if (path === null) {
        return this.errorResponse(404, 'Route not found');
      }

      if (path === '/health' || path === '/ok') {
        return this.healthCheck();
      }

      const endpoint = this.endpoints.get(path);
      if (endpoint) {
        return await this.handleEndpoint(endpoint, request);
      }

      const route = this.parseRoute(path);
      if (!route) {
        return this.errorResponse(404, 'Route not found');
      }

      const action = route.action as BuiltInHandlerAction;
      if (!ALL_HANDLER_ACTIONS.includes(action)) {
        return this.errorResponse(404, `Action '${route.action}' not found`);
      }
      if (!this.allowed.has(action)) {
        return this.errorResponse(404, `Action '${route.action}' is not enabled`);
      }

      if (!this.core.isProviderEnabled(route.provider)) {
        return this.errorResponse(400, `Provider '${route.provider}' is not enabled or configured`);
      }

      if (!CALLBACK_HANDLER_ACTIONS.includes(action) && this.isFormRequest(request)) {
        // A cross-site HTML form can send these without a CORS preflight (CSRF)
        return this.errorResponse(415, 'Content-Type must be application/json');
      }

      const ctx: HandlerContext = {
        provider: route.provider,
        action,
        params: route.params,
        request,
        body: asRecord(this.parseBody(request)),
      };

      if (!(await this.isAuthorized(ctx))) {
        return this.errorResponse(403, 'Forbidden');
      }

      if (this.options.transformRequest && !CALLBACK_HANDLER_ACTIONS.includes(action)) {
        ctx.body = asRecord(await this.options.transformRequest(ctx));
      }

      const idempotencyKey = this.header(request, 'idempotency-key');
      if (this.idempotency && idempotencyKey && IDEMPOTENT_KEY_ACTIONS.includes(action)) {
        return await this.withIdempotencyKey(ctx, idempotencyKey, this.idempotency);
      }

      return await this.runAction(ctx);
    } catch (error: unknown) {
      if (error instanceof HttpError) {
        return this.errorResponse(error.status, error.message);
      }
      if (error instanceof BetterPaymentError && error.code === 'NOT_SUPPORTED') {
        return this.errorResponse(400, error.message);
      }
      const fallback = 'Internal server error';
      return this.errorResponse(
        500,
        this.options.exposeErrors ? errorMessage(error, fallback) : fallback
      );
    }
  }

  private async isAuthorized(ctx: HandlerContext): Promise<boolean> {
    if (!this.options.authorize) return true;
    try {
      return await this.options.authorize(ctx);
    } catch {
      return false;
    }
  }

  private async handleEndpoint(
    endpoint: RegisteredEndpoint,
    request: BetterPaymentRequest
  ): Promise<BetterPaymentResponse> {
    if (request.method.toUpperCase() !== endpoint.method) {
      return this.errorResponse(405, 'Method not allowed');
    }
    const body = asRecord(this.parseBody(request));
    const ctx: HandlerContext = {
      provider: undefined,
      action: `plugin:${endpoint.pluginId}/${endpoint.name}`,
      params: {},
      request,
      body,
    };
    if (!(await this.isAuthorized(ctx))) {
      return this.errorResponse(403, 'Forbidden');
    }
    const responses = new WeakSet<BetterPaymentResponse>();
    const endpointContext: EndpointContext = {
      ...this.core.context,
      request,
      body,
      query: new URL(request.url, 'http://localhost').searchParams,
      json: (value, status = 200) => {
        const response = this.jsonResponse(status, value);
        responses.add(response);
        return response;
      },
    };
    const result = await endpoint.handler(endpointContext);
    if (result && typeof result === 'object' && responses.has(result as BetterPaymentResponse)) {
      return result as BetterPaymentResponse;
    }
    return this.jsonResponse(200, result);
  }

  /**
   * Runs an action. When an event listener fails after the provider returned a
   * result, the result is still returned: the payment happened, and answering
   * with an error could make the client pay twice. (Callbacks are different: they
   * answer 500, so the provider re-sends them and the listeners run again.)
   */
  private async runAction(ctx: HandlerContext): Promise<BetterPaymentResponse> {
    try {
      return await this.handleAction(ctx);
    } catch (error) {
      if (error instanceof EventListenerError && !CALLBACK_HANDLER_ACTIONS.includes(ctx.action)) {
        this.core.context.logger?.error('Payment event listener failed', error, {
          provider: ctx.provider,
          action: ctx.action,
        });
        return this.resultResponse(error.result);
      }
      throw error;
    }
  }

  private getPath(url: string): string | null {
    let pathname: string;
    try {
      pathname = new URL(url, 'http://localhost').pathname;
    } catch {
      return null;
    }
    pathname = pathname.replace(/\/+$/, '');
    if (pathname === this.basePath) return '';
    if (!pathname.startsWith(this.basePath + '/')) return null;
    return pathname.slice(this.basePath.length);
  }

  /**
   * Parses "/:provider/:action..." (path relative to basePath)
   */
  private parseRoute(path: string): RouteContext | null {
    const segments = path
      .split('/')
      .filter(Boolean)
      .map((s) => decodeURIComponent(s));
    if (segments.length < 2) return null;

    const provider = segments[0];
    const builtIn = (Object.values(ProviderType) as string[]).includes(provider);
    if (!builtIn && !this.core.isProviderEnabled(provider)) {
      return null;
    }

    const rest = segments.slice(1);
    const params: Record<string, string> = {};

    // GET /payment/:id
    if (
      rest.length === 2 &&
      rest[0] === 'payment' &&
      !['init-3ds', 'token', 'complete-3ds'].includes(rest[1])
    ) {
      params.paymentId = rest[1];
      return { provider, action: 'payment/get', params };
    }

    return { provider, action: rest.join('/'), params };
  }

  private parseBody(request: BetterPaymentRequest): unknown {
    const body = request.body;
    const contentType = (this.header(request, 'content-type') || '').toLowerCase();
    if (typeof body === 'string') {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        return Object.fromEntries(new URLSearchParams(body));
      }
      if (contentType.includes('application/json')) {
        try {
          return JSON.parse(body);
        } catch {
          throw new HttpError(400, 'Invalid JSON body');
        }
      }
    }
    return body;
  }

  /**
   * Content types a browser form can send cross-site without a CORS preflight.
   * Only provider callbacks are posted this way.
   */
  private isFormRequest(request: BetterPaymentRequest): boolean {
    const contentType = (this.header(request, 'content-type') || '').toLowerCase();
    return ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'].some((type) =>
      contentType.includes(type)
    );
  }

  private header(request: BetterPaymentRequest, name: string): string | undefined {
    const key = Object.keys(request.headers || {}).find((k) => k.toLowerCase() === name);
    return key ? request.headers[key] : undefined;
  }

  private requireMethod(ctx: HandlerContext, method: 'GET' | 'POST'): void {
    if (ctx.request.method.toUpperCase() !== method) {
      throw new HttpError(405, 'Method not allowed');
    }
  }

  /**
   * Returns the request body. The type parameter is an unchecked cast: the
   * provider validates the fields it needs.
   */
  private requireBody<T extends object = Record<string, unknown>>(ctx: HandlerContext): T {
    if (!ctx.body) {
      throw new HttpError(400, 'Request body is required');
    }
    return ctx.body as T;
  }

  private requireIyzico(ctx: HandlerContext): Iyzico {
    const provider = this.core.use(this.providerOf(ctx));
    if (!(provider instanceof Iyzico)) {
      throw new HttpError(400, 'Route only available for iyzico provider');
    }
    return provider;
  }

  private providerOf(ctx: HandlerContext): string {
    if (!ctx.provider) throw new HttpError(404, 'Route not found');
    return ctx.provider;
  }

  private async handleAction(ctx: HandlerContext): Promise<BetterPaymentResponse> {
    const provider = this.core.use(this.providerOf(ctx));

    switch (ctx.action) {
      case 'payment':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(await provider.createPayment(this.requireBody(ctx)));

      case 'payment/init-3ds':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(await provider.initThreeDSPayment(this.requireBody(ctx)));

      case 'payment/token':
        this.requireMethod(ctx, 'POST');
        if (!supportsTokenPayment(provider)) {
          throw new HttpError(400, 'This provider does not support token payments');
        }
        return this.resultResponse(await provider.createPaymentWithToken(this.requireBody(ctx)));

      case 'payment/complete-3ds':
      case 'callback':
        this.requireMethod(ctx, 'POST');
        return this.handleCallback({ ...ctx, provider: this.providerOf(ctx) });

      case 'payment/get':
        this.requireMethod(ctx, 'GET');
        return this.resultResponse(await provider.getPayment(ctx.params.paymentId));

      case 'refund':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(await provider.refund(this.requireBody(ctx)));

      case 'cancel':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(await provider.cancel(this.requireBody(ctx)));

      case 'authorize':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(await provider.authorize(this.requireBody(ctx)));

      case 'authorize/init-3ds':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(await provider.initThreeDSAuthorize(this.requireBody(ctx)));

      case 'capture':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(await provider.capture(this.requireBody(ctx)));

      case 'void':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(await provider.voidAuthorization(this.requireBody(ctx)));

      case 'cards/save':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(await provider.saveCard(this.requireBody(ctx)));

      case 'cards/list':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(await provider.listCards(this.requireBody(ctx)));

      case 'cards/delete':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(await provider.deleteCard(this.requireBody(ctx)));

      case 'installment':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(
          await provider.installmentInfo(this.requireBody(ctx) as InstallmentInfoRequest)
        );

      case 'bin-check': {
        this.requireMethod(ctx, 'POST');
        const { binNumber } = this.requireBody(ctx);
        if (typeof binNumber !== 'string' || !/^\d{6,8}$/.test(binNumber)) {
          throw new HttpError(400, 'binNumber must be 6-8 digits');
        }
        try {
          return this.jsonResponse(200, this.publicResult(await provider.binCheck(binNumber)));
        } catch (error: unknown) {
          return this.errorResponse(422, errorMessage(error, 'BIN check failed'));
        }
      }

      case 'checkout/init':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(
          await this.requireIyzico(ctx).initCheckoutForm(
            this.requireBody(ctx) as CheckoutFormRequest
          )
        );

      case 'checkout/retrieve': {
        this.requireMethod(ctx, 'POST');
        const { token, conversationId } = this.requireBody<TokenBody>(ctx);
        return this.resultResponse(
          await this.requireIyzico(ctx).retrieveCheckoutForm(token, conversationId)
        );
      }

      case 'pwi/init':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(
          await this.requireIyzico(ctx).initPWIPayment(this.requireBody(ctx) as PWIPaymentRequest)
        );

      case 'pwi/retrieve': {
        this.requireMethod(ctx, 'POST');
        const { token, conversationId } = this.requireBody<TokenBody>(ctx);
        return this.resultResponse(
          await this.requireIyzico(ctx).retrievePWIPayment(token, conversationId)
        );
      }

      case 'subscription/initialize':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(
          await this.requireIyzico(ctx).initializeSubscription(
            this.requireBody(ctx) as SubscriptionInitializeRequest
          )
        );

      case 'subscription/cancel':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(
          await this.requireIyzico(ctx).cancelSubscription(
            this.requireBody(ctx) as SubscriptionCancelRequest
          )
        );

      case 'subscription/upgrade':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(
          await this.requireIyzico(ctx).upgradeSubscription(
            this.requireBody(ctx) as SubscriptionUpgradeRequest
          )
        );

      case 'subscription/retrieve':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(
          await this.requireIyzico(ctx).retrieveSubscription(
            this.requireBody(ctx) as SubscriptionRetrieveRequest
          )
        );

      case 'subscription/card-update':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(
          await this.requireIyzico(ctx).updateSubscriptionCard(
            this.requireBody(ctx) as SubscriptionCardUpdateRequest
          )
        );

      case 'subscription/product':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(
          await this.requireIyzico(ctx).createSubscriptionProduct(
            this.requireBody(ctx) as SubscriptionProductCreateRequest
          )
        );

      case 'subscription/pricing-plan':
        this.requireMethod(ctx, 'POST');
        return this.resultResponse(
          await this.requireIyzico(ctx).createPricingPlan(
            this.requireBody(ctx) as PricingPlanCreateRequest
          )
        );

      default:
        return this.errorResponse(404, `Action '${ctx.action}' not found`);
    }
  }

  /**
   * Provider callbacks.
   *
   * PayTR notifications (server-to-server) must be answered with plain "OK",
   * otherwise PayTR keeps re-sending them. Browser callbacks (3D return) can be
   * redirected with `callbackRedirect`.
   */
  private async handleCallback(ctx: CallbackContext): Promise<BetterPaymentResponse> {
    const body = this.requireBody(ctx);
    // Events are emitted in finishCallback, next to onCallback, so that a failing
    // listener is retried with the stored result instead of calling the provider again
    const complete = async () =>
      (await this.core.run('completeThreeDSPayment', ctx.provider, body, {
        routable: false,
        emit: false,
      })) as PaymentResponse;
    const idem = this.idempotency;
    if (!idem) {
      return this.finishCallback(ctx, await complete());
    }

    // A repeated delivery (PayTR resend, browser re-post) has the same body. Keying
    // on the body hash means a forged callback can never match a stored one.
    const key = `bp:callback:${ctx.provider}:${ctx.action}:${await fingerprint(body)}`;
    const { store, ttlSeconds, lockSeconds } = idem;
    let result: PaymentResponse | undefined;

    if (!(await store.setIfAbsent(key, JSON.stringify({ state: 'processing' }), lockSeconds))) {
      const record = parseRecord<CallbackRecord>(await store.get(key));
      if (record?.state === 'done') return record.response;
      if (record?.state !== 'verified') {
        // Another delivery is being processed; the provider will retry later
        return this.errorResponse(409, 'Callback is already being processed');
      }
      // The provider result is known but onCallback failed earlier: run it again
      // without calling the provider a second time.
      result = record.result;
      await store.set(key, JSON.stringify({ state: 'processing', result }), lockSeconds);
    }

    try {
      if (!result) {
        result = await complete();
        if (result.errorCode === 'INVALID_HASH' || result.errorCode === NETWORK_ERROR_CODE) {
          // Nothing trustworthy to remember: forged, or outcome unknown
          await store.delete(key);
          return await this.finishCallback(ctx, result);
        }
        await store.set(key, JSON.stringify({ state: 'verified', result }), ttlSeconds);
      }

      const response = await this.finishCallback(ctx, result);
      await store.set(key, JSON.stringify({ state: 'done', response }), ttlSeconds);
      return response;
    } catch (error) {
      if (result) {
        await store.set(key, JSON.stringify({ state: 'verified', result }), ttlSeconds);
      } else {
        await store.delete(key);
      }
      throw error;
    }
  }

  /** Runs onCallback and builds the response for a provider callback result */
  private async finishCallback(
    ctx: CallbackContext,
    result: PaymentResponse
  ): Promise<BetterPaymentResponse> {
    const invalidSignature = result?.errorCode === 'INVALID_HASH';

    if (!invalidSignature) {
      await this.core.emit('completeThreeDSPayment', ctx.provider, ctx.body, result);
      if (this.options.onCallback) await this.options.onCallback(result, ctx);
    }

    if (this.core.rawProvider(ctx.provider) instanceof PayTR && ctx.action === 'callback') {
      if (invalidSignature) {
        return {
          status: 400,
          headers: { 'Content-Type': 'text/plain' },
          body: 'PAYTR notification failed: bad hash',
        };
      }
      return { status: 200, headers: { 'Content-Type': 'text/plain' }, body: 'OK' };
    }

    if (this.options.callbackRedirect) {
      const location = await this.options.callbackRedirect(result, ctx);
      if (location) {
        return { status: 303, headers: { Location: location }, body: '' };
      }
    }

    return this.resultResponse(result);
  }

  /**
   * `Idempotency-Key`: the first request with a key runs; repeats with the same
   * body get the stored response, repeats with a different body are rejected.
   */
  private async withIdempotencyKey(
    ctx: HandlerContext,
    idempotencyKey: string,
    { store, ttlSeconds, lockSeconds, scope }: NonNullable<BetterPaymentHandler['idempotency']>
  ): Promise<BetterPaymentResponse> {
    if (idempotencyKey.length > 255) {
      throw new HttpError(400, 'Idempotency-Key must be at most 255 characters');
    }
    const owner = scope ? await scope(ctx) : undefined;
    // A scoped key is JSON, so neither its parts nor an unscoped key can imitate it
    const key =
      owner === undefined
        ? `bp:request:${ctx.provider}:${ctx.action}:${idempotencyKey}`
        : `bp:request:${JSON.stringify([ctx.provider, ctx.action, owner, idempotencyKey])}`;
    const request = await fingerprint(ctx.body);

    if (
      !(await store.setIfAbsent(key, JSON.stringify({ state: 'processing', request }), lockSeconds))
    ) {
      const record = parseRecord<RequestRecord>(await store.get(key));
      if (record && record.request !== request) {
        return this.errorResponse(422, 'Idempotency-Key was already used with a different request');
      }
      if (record?.state === 'done') {
        return {
          ...record.response,
          headers: { ...record.response.headers, 'Idempotent-Replayed': 'true' },
        };
      }
      return this.errorResponse(409, 'A request with this Idempotency-Key is in progress');
    }

    try {
      const response = await this.runAction(ctx);
      await store.set(key, JSON.stringify({ state: 'done', request, response }), ttlSeconds);
      return response;
    } catch (error) {
      // Rejected before a result (validation, unexpected error): the key can be reused
      await store.delete(key);
      throw error;
    }
  }

  /**
   * Maps a provider result to an HTTP response:
   * success/pending -> 200, failure -> 422 (the body carries the details)
   */
  private resultResponse(result: unknown): BetterPaymentResponse {
    const failed = asRecord(result)?.status === PaymentStatus.FAILURE;
    return this.jsonResponse(failed ? 422 : 200, this.publicResult(result));
  }

  /** Leaves out `rawResponse` unless `exposeRawResponse` is set */
  private publicResult(result: unknown): unknown {
    const record = asRecord(result);
    if (this.options.exposeRawResponse || !record || !('rawResponse' in record)) return result;
    const rest = { ...record };
    delete rest.rawResponse;
    return rest;
  }

  private healthCheck(): BetterPaymentResponse {
    return this.jsonResponse(200, {
      status: 'ok',
      service: 'better-payment',
      version: VERSION,
      timestamp: new Date().toISOString(),
    });
  }

  private jsonResponse(status: number, body: unknown): BetterPaymentResponse {
    return { status, headers: { ...JSON_HEADERS }, body };
  }

  private errorResponse(status: number, message: string): BetterPaymentResponse {
    return this.jsonResponse(status, {
      error: true,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
