import type { PaymentProvider } from './PaymentProvider';
import type {
  BetterPaymentOptions,
  ProviderEntry,
  ProviderInstance,
  ProviderSetupContext,
} from './BetterPaymentConfig';
import { ProviderNotEnabledError, ConfigurationError } from './errors';
import {
  BetterPaymentHandler,
  type BetterPaymentHandlerOptions,
  type BetterPaymentRequest,
  type BetterPaymentResponse,
} from './BetterPaymentHandler';
import {
  PAYMENT_OPERATIONS,
  type AfterHook,
  type BeforeHook,
  type BetterPaymentPlugin,
  type EndpointInfo,
  type OperationContext,
  type PaymentEndpoint,
  type PaymentOperation,
  type PaymentOperations,
  type PluginContext,
  type RequestContext,
  type ResponseContext,
} from './plugin';
import {
  eventFor,
  EventListenerError,
  type PaymentEvent,
  type PaymentEventListener,
  type PaymentEventName,
} from './events';
import { PaymentStatus } from '../types';
import type {
  PaymentRequest,
  PaymentResponse,
  ThreeDSPaymentRequest,
  ThreeDSInitResponse,
  VerifyCardRequest,
  VerifyCardInitResponse,
  VerifyCardResult,
  RefundRequest,
  RefundResponse,
  CancelRequest,
  CancelResponse,
  CaptureRequest,
  VoidAuthorizationRequest,
  SaveCardRequest,
  SaveCardResponse,
  ListCardsResponse,
  DeleteCardRequest,
  DeleteCardResponse,
} from '../types';

type AnyListener = (event: PaymentEvent) => unknown;
type OperationFn = (request: unknown) => Promise<unknown>;

const OPERATIONS = new Set<string>(PAYMENT_OPERATIONS);

/** @internal A plugin endpoint with the id of the plugin that added it */
export interface RegisteredEndpoint extends PaymentEndpoint {
  pluginId: string;
  name: string;
}

/** A frozen copy of an endpoint without its handler, for other plugins */
function endpointInfo(endpoint: RegisteredEndpoint): EndpointInfo {
  return Object.freeze({
    pluginId: endpoint.pluginId,
    name: endpoint.name,
    method: endpoint.method,
    path: endpoint.path,
    privileged: endpoint.privileged === true,
    openapi: endpoint.openapi,
  });
}

/** @internal Options of `run()` */
interface RunOptions {
  routable: boolean;
  /** Emit events for the result. The handler defers them for callbacks. */
  emit?: boolean;
}

/** @internal A verifyCard() 3D Secure session waiting for its callback */
interface PendingVerification {
  /** The buyer's IP, needed to void; no card data is kept */
  ip: string;
  paymentId?: string;
  conversationId?: string;
  amount?: string;
  currency?: string;
  createdAt: number;
}

/** How long a pending verification is kept without a callback */
const VERIFICATION_TTL_MS = 60 * 60 * 1000;

function isProviderInstance(entry: ProviderEntry): entry is PaymentProvider {
  return typeof (entry as Partial<PaymentProvider>).createPayment === 'function';
}

/**
 * The payment object returned by `betterPayment()`. Its providers and the
 * members added by plugins are defined on it at runtime; `BetterPayment<...>`
 * types them.
 */
export class PaymentCore<P extends Record<string, ProviderEntry> = Record<string, ProviderEntry>> {
  private readonly handlerOptions?: BetterPaymentHandlerOptions;
  private readonly providers = new Map<string, PaymentProvider>();
  private readonly proxies = new Map<string, PaymentProvider>();
  private readonly plugins: readonly BetterPaymentPlugin[];
  private readonly beforeHooks: BeforeHook[] = [];
  private readonly afterHooks: AfterHook[] = [];
  private readonly requestHooks: {
    pluginId: string;
    hook: NonNullable<BetterPaymentPlugin['onRequest']>;
  }[] = [];
  private readonly responseHooks: {
    pluginId: string;
    hook: NonNullable<BetterPaymentPlugin['onResponse']>;
  }[] = [];
  private readonly listeners = new Map<PaymentEventName, AnyListener[]>();
  private readonly verifications = new Map<string, PendingVerification>();
  private readonly defaultProviderId?: string;
  private initialized?: Promise<void>;
  private initializedPlugins = 0;
  private _handler?: BetterPaymentHandler;

  /** @internal */
  readonly endpoints: RegisteredEndpoint[] = [];
  /** @internal */
  readonly context: PluginContext;
  /** Error codes added by plugins, with their default messages */
  readonly $ERROR_CODES: Record<string, string> = {};

  constructor(options: BetterPaymentOptions<P>) {
    this.handlerOptions = options.handler;
    this.plugins = options.plugins ?? [];
    const mode = options.mode ?? 'production';

    for (const [id, entry] of Object.entries(options.providers ?? {})) {
      this.reserve(id, `Provider id '${id}'`);
      if (!entry || (!isProviderInstance(entry) && typeof entry.create !== 'function')) {
        throw new ConfigurationError(
          `providers.${id} must be a provider, e.g. iyzico({ ... }) or new MockProvider()`
        );
      }
      const setup: ProviderSetupContext = {
        id,
        mode,
        logger: options.logger,
        retry: options.retry,
        fetch: options.fetch,
        validate: options.validate,
      };
      const provider = isProviderInstance(entry) ? entry : entry.create(setup);
      this.providers.set(id, provider);
      this.proxies.set(id, this.proxy(id, provider));
      Object.defineProperty(this, id, { value: this.proxies.get(id), enumerable: true });
    }

    const ids = [...this.providers.keys()];
    if (options.defaultProvider && !this.providers.has(options.defaultProvider)) {
      throw new ConfigurationError(
        `Default provider '${options.defaultProvider}' is not enabled or configured`
      );
    }
    this.defaultProviderId = options.defaultProvider ?? (ids.length === 1 ? ids[0] : undefined);

    const endpoints = this.endpoints;
    this.context = {
      providerIds: ids,
      errorCodes: this.$ERROR_CODES,
      defaultProvider: this.defaultProviderId,
      mode,
      logger: options.logger,
      use: (id) => this.use(id),
      emit: (event) => this.emitEvent(event),
      get endpoints() {
        return endpoints.map(endpointInfo);
      },
    };

    const pluginIds = new Set<string>();
    for (const plugin of this.plugins) {
      if (!plugin || typeof plugin.id !== 'string' || !plugin.id) {
        throw new ConfigurationError('Every plugin needs an id');
      }
      if (pluginIds.has(plugin.id)) {
        throw new ConfigurationError(`Plugin '${plugin.id}' is registered twice`);
      }
      pluginIds.add(plugin.id);
      this.beforeHooks.push(...(plugin.hooks?.before ?? []));
      this.afterHooks.push(...(plugin.hooks?.after ?? []));
      if (plugin.onRequest) this.requestHooks.push({ pluginId: plugin.id, hook: plugin.onRequest });
      if (plugin.onResponse)
        this.responseHooks.push({ pluginId: plugin.id, hook: plugin.onResponse });
      for (const [type, listener] of Object.entries(plugin.events ?? {})) {
        if (listener) this.addListener(type as PaymentEventName, listener as AnyListener);
      }
      for (const [name, endpoint] of Object.entries(plugin.endpoints ?? {})) {
        this.endpoints.push({ ...endpoint, pluginId: plugin.id, name });
      }
      Object.assign(this.$ERROR_CODES, plugin.$ERROR_CODES);
      for (const [key, value] of Object.entries(plugin.methods?.(this.context) ?? {})) {
        this.reserve(key, `'${key}' added by plugin '${plugin.id}'`);
        Object.defineProperty(this, key, { value, enumerable: true });
      }
    }
  }

  private reserve(key: string, what: string): void {
    if (key in this) {
      throw new ConfigurationError(`${what} clashes with a member of the payment object`);
    }
  }

  /**
   * A provider whose operations run with the plugin hooks and emit events. Other
   * members (provider-specific methods, MockProvider helpers) are the provider's own.
   */
  private proxy(id: string, provider: PaymentProvider): PaymentProvider {
    return new Proxy(provider, {
      get: (target, key, receiver) => {
        if (typeof key === 'string' && OPERATIONS.has(key)) {
          return (request: unknown) =>
            this.run(key as PaymentOperation, id, request, { routable: false });
        }
        return Reflect.get(target, key, receiver);
      },
    });
  }

  /**
   * Runs the plugins' `init` once, in order. If one fails, the operation fails and
   * the next operation retries from that plugin on.
   */
  private ready(): Promise<void> {
    if (!this.initialized) {
      this.initialized = (async () => {
        for (; this.initializedPlugins < this.plugins.length; this.initializedPlugins++) {
          await this.plugins[this.initializedPlugins].init?.(this.context);
        }
      })();
      this.initialized.catch(() => {
        this.initialized = undefined;
      });
    }
    return this.initialized;
  }

  /**
   * @internal Runs an operation: before hooks, the provider, after hooks, events.
   */
  async run(
    operation: PaymentOperation,
    providerId: string | undefined,
    request: unknown,
    { routable, emit = true }: RunOptions
  ): Promise<unknown> {
    await this.ready();
    let ctx = { operation, request, provider: providerId, routable } as OperationContext;
    let result: unknown;

    for (const hook of this.beforeHooks) {
      if (hook.matcher && !hook.matcher(ctx)) continue;
      const out = await hook.handler(ctx);
      if (!out) continue;
      if (out.provider !== undefined && out.provider !== ctx.provider) {
        if (!routable) {
          throw new ConfigurationError(
            `A plugin hook tried to move a '${operation}' call made on provider '${ctx.provider}' ` +
              `to '${out.provider}'. Only calls made on the payment object can be routed.`
          );
        }
        if (!this.providers.has(out.provider)) throw new ProviderNotEnabledError(out.provider);
        ctx = { ...ctx, provider: out.provider };
      }
      if (out.request !== undefined) ctx = { ...ctx, request: out.request } as OperationContext;
      if (out.result !== undefined) {
        result = out.result;
        break;
      }
    }

    if (result === undefined) {
      const provider = this.resolve(ctx.provider);
      result = await (provider[operation] as OperationFn).call(provider, ctx.request);
    }

    let after = { ...ctx, provider: ctx.provider ?? '', result } as Parameters<
      AfterHook['handler']
    >[0];
    for (const hook of this.afterHooks) {
      if (hook.matcher && !hook.matcher(after)) continue;
      const out = await hook.handler(after);
      if (out) {
        after = {
          ...after,
          ...(out.result !== undefined ? { result: out.result } : {}),
          ...(out.request !== undefined ? { request: out.request } : {}),
        } as typeof after;
      }
    }

    // remember a verifyCard() 3D Secure init so its callback can release the
    // hold; every completion path goes through this method
    if (operation === 'verifyCard') {
      const init = after.result as Partial<VerifyCardInitResponse> | undefined;
      if (ctx.provider && init?.verification === 'card') {
        if (init.status === PaymentStatus.PENDING || init.status === PaymentStatus.SUCCESS) {
          const { paymentId, conversationId } = init;
          if (paymentId || conversationId) {
            // drop sessions nobody completed, so the map cannot grow forever
            const cutoff = Date.now() - VERIFICATION_TTL_MS;
            for (const [key, record] of this.verifications) {
              if (record.createdAt < cutoff) this.verifications.delete(key);
            }
            const record: PendingVerification = {
              // keep only what the void needs: never retain the card in memory
              ip: (ctx.request as VerifyCardRequest | undefined)?.buyer?.ip ?? '',
              paymentId,
              conversationId,
              amount: init.amount,
              currency: init.currency,
              createdAt: Date.now(),
            };
            const prefix = `${ctx.provider}:`;
            if (paymentId) this.verifications.set(prefix + paymentId, record);
            if (conversationId) this.verifications.set(prefix + conversationId, record);
          }
        }
      }
    } else if (operation === 'completeThreeDSPayment') {
      after = {
        ...after,
        result: await this.settleVerification(ctx.provider, ctx.request, after.result),
      } as typeof after;
    }

    if (emit) await this.emit(operation, after.provider, after.request, after.result);
    return after.result;
  }

  /**
   * @internal Settles the callback of a verifyCard() session: a successful
   * completion voids the hold, then the result carries the verification
   * outcome. A failed authentication left no hold, so it is not voided.
   */
  private async settleVerification(
    provider: string | undefined,
    request: unknown,
    result: unknown
  ): Promise<unknown> {
    const completion = result as VerifyCardResult;
    // A forged callback is not an outcome: keep the session for the real one
    if (!provider || !completion || completion.errorCode === 'INVALID_HASH') return result;

    // The completion result carries the provider's id; the callback body is the
    // fallback (some providers, e.g. iyzico, omit ids from failed completions).
    const callback = (request ?? {}) as Record<string, unknown>;
    const id =
      completion.paymentId ??
      completion.conversationId ??
      callback.paymentId ??
      callback.conversationId;
    const record = id ? this.verifications.get(`${provider}:${id}`) : undefined;
    if (!record) return result;

    completion.verification = 'card';
    completion.amount = record.amount;
    completion.currency = record.currency;
    if (completion.status !== PaymentStatus.SUCCESS) return completion;

    this.verifications.delete(`${provider}:${record.paymentId}`);
    this.verifications.delete(`${provider}:${record.conversationId}`);

    const stored = completion.storedCard;
    if (stored) {
      completion.cardToken = stored.cardToken;
      completion.customerToken = stored.customerToken;
    }

    const voidRequest: VoidAuthorizationRequest = {
      paymentId: completion.paymentId ?? record.paymentId ?? '',
      ip: record.ip,
      conversationId: completion.conversationId,
    };
    let voidResult: CancelResponse;
    try {
      // Hooks and the payment.cancelled event apply to the automatic void
      voidResult = (await this.run('voidAuthorization', provider, voidRequest, {
        routable: false,
      })) as CancelResponse;
    } catch {
      voidResult = {
        status: PaymentStatus.FAILURE,
        errorMessage: 'Automatic void failed',
      };
    }

    completion.voided = voidResult.status === PaymentStatus.SUCCESS;
    if (!completion.voided) {
      completion.voidError = {
        status: voidResult.status,
        code: voidResult.code,
        errorMessage: voidResult.errorMessage,
      };
      await this.emitEvent({
        type: 'verification.void_failed',
        provider,
        operation: 'completeThreeDSPayment',
        paymentId: completion.paymentId ?? record.paymentId,
        conversationId: completion.conversationId ?? record.conversationId,
        amount: record.amount,
        currency: record.currency,
        code: voidResult.code,
        result: completion,
        request: voidRequest,
      });
    }
    return completion;
  }

  private resolve(providerId: string | undefined): PaymentProvider {
    if (!providerId) {
      throw new ConfigurationError(
        'No default provider set. Call the operation on a provider (payment.use(id), ' +
          'payment.iyzico) or set defaultProvider.'
      );
    }
    const provider = this.providers.get(providerId);
    if (!provider) throw new ProviderNotEnabledError(providerId);
    return provider;
  }

  /** @internal Emits an event to registered listeners */
  async emitEvent(event: PaymentEvent): Promise<void> {
    const listeners = [
      ...(this.listeners.get(event.type) ?? []),
      ...(this.listeners.get('*') ?? []),
    ];
    for (const listener of listeners) {
      try {
        await listener(event);
      } catch (cause) {
        throw new EventListenerError(event, event.result, cause);
      }
    }
  }

  /** @internal Emits the event of an operation result, if it has one */
  async emit(
    operation: PaymentOperation,
    provider: string,
    request: unknown,
    result: unknown
  ): Promise<void> {
    const event = eventFor(operation, provider, request, result);
    if (!event) return;
    await this.emitEvent(event);
  }

  /** @internal Runs the plugins' onRequest hooks on an incoming handler request */
  async interceptRequest(
    request: BetterPaymentRequest,
    ctx: RequestContext
  ): Promise<BetterPaymentResponse | undefined> {
    for (const { pluginId, hook } of this.requestHooks) {
      try {
        const response = await hook(request, ctx);
        if (response) return response;
      } catch (error) {
        this.context.logger?.error(
          `onRequest of plugin '${pluginId}' failed`,
          error instanceof Error ? error : new Error(String(error))
        );
        // Fail closed: the hook is a guard (rate limit, IP filter) that could not decide
        return {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
          body: {
            error: true,
            message: 'Service unavailable',
            timestamp: new Date().toISOString(),
          },
        };
      }
    }
    return undefined;
  }

  /** @internal Runs the plugins' onResponse hooks on a handler response */
  async respond(
    response: BetterPaymentResponse,
    ctx: ResponseContext
  ): Promise<BetterPaymentResponse> {
    for (const { pluginId, hook } of this.responseHooks) {
      try {
        response = (await hook(response, ctx)) ?? response;
      } catch (error) {
        this.context.logger?.error(
          `onResponse of plugin '${pluginId}' failed`,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
    return response;
  }

  private addListener(type: PaymentEventName, listener: AnyListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /**
   * Listens to a payment event (`*` for all). Listeners run in order after the
   * operation; if one throws, the operation throws an `EventListenerError` that
   * carries the result. Returns a function that removes the listener.
   *
   * @example
   * ```ts
   * payment.on('payment.succeeded', async (event) => {
   *   await orders.markPaid(event.conversationId, event.paymentId);
   * });
   * ```
   */
  on<T extends PaymentEventName>(type: T, listener: PaymentEventListener<T>): () => void {
    const fn = listener as AnyListener;
    this.addListener(type, fn);
    return () => {
      this.listeners.set(
        type,
        (this.listeners.get(type) ?? []).filter((l) => l !== fn)
      );
    };
  }

  /**
   * HTTP handler configured with `options.handler`.
   * Created lazily; see BetterPaymentHandlerOptions for the security defaults.
   */
  get handler(): BetterPaymentHandler {
    if (!this._handler) {
      this._handler = new BetterPaymentHandler(this, this.handlerOptions);
    }
    return this._handler;
  }

  /**
   * Creates an additional HTTP handler with its own options
   * (e.g. a public handler and an authenticated admin handler).
   */
  createHandler(options: BetterPaymentHandlerOptions = {}): BetterPaymentHandler {
    return new BetterPaymentHandler(this, options);
  }

  /** A provider by id. Its operations run with the plugin hooks and emit events. */
  use<K extends keyof P & string>(providerId: K): ProviderInstance<P[K]>;
  use(providerId: string): PaymentProvider;
  use(providerId: string): PaymentProvider {
    const provider = this.proxies.get(providerId);
    if (!provider) throw new ProviderNotEnabledError(providerId);
    return provider;
  }

  /** @internal The provider without hooks */
  rawProvider(providerId: string): PaymentProvider {
    return this.resolve(providerId);
  }

  /** Ids of the configured providers */
  getEnabledProviders(): string[] {
    return [...this.providers.keys()];
  }

  isProviderEnabled(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  private call<K extends PaymentOperation>(
    operation: K,
    request: PaymentOperations[K]['request']
  ): Promise<PaymentOperations[K]['result']> {
    return this.run(operation, this.defaultProviderId, request, { routable: true }) as Promise<
      PaymentOperations[K]['result']
    >;
  }

  /** Payment without 3D Secure, with the default provider */
  createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    return this.call('createPayment', request);
  }

  /** Starts a 3D Secure payment with the default provider */
  initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    return this.call('initThreeDSPayment', request);
  }

  /** Completes a 3D Secure payment with the default provider */
  completeThreeDSPayment(callbackData: unknown): Promise<PaymentResponse> {
    return this.call('completeThreeDSPayment', callbackData);
  }

  /** Refunds with the default provider */
  refund(request: RefundRequest): Promise<RefundResponse> {
    return this.call('refund', request);
  }

  /** Cancels with the default provider */
  cancel(request: CancelRequest): Promise<CancelResponse> {
    return this.call('cancel', request);
  }

  /** Pre-authorization with the default provider */
  authorize(request: PaymentRequest): Promise<PaymentResponse> {
    return this.call('authorize', request);
  }

  /** 3D Secure pre-authorization with the default provider */
  initThreeDSAuthorize(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    return this.call('initThreeDSAuthorize', request);
  }

  /**
   * Verifies a card with a small 3D Secure pre-authorization that is released
   * automatically after a successful callback, with the default provider.
   */
  verifyCard(request: VerifyCardRequest): Promise<VerifyCardInitResponse> {
    return this.call('verifyCard', request);
  }

  /** Captures a pre-authorization with the default provider */
  capture(request: CaptureRequest): Promise<PaymentResponse> {
    return this.call('capture', request);
  }

  /** Voids a pre-authorization with the default provider */
  voidAuthorization(request: VoidAuthorizationRequest): Promise<CancelResponse> {
    return this.call('voidAuthorization', request);
  }

  /** Saves a card with the default provider */
  saveCard(request: SaveCardRequest): Promise<SaveCardResponse> {
    return this.call('saveCard', request);
  }

  /** Lists a customer's saved cards with the default provider */
  listCards(request: { customerToken: string }): Promise<ListCardsResponse> {
    return this.call('listCards', request);
  }

  /** Deletes a saved card with the default provider */
  deleteCard(request: DeleteCardRequest): Promise<DeleteCardResponse> {
    return this.call('deleteCard', request);
  }

  /** Queries a payment with the default provider */
  getPayment(paymentId: string): Promise<PaymentResponse> {
    return this.call('getPayment', paymentId);
  }
}

// `unknown` would swallow the other members of the union
type Empty = Record<never, never>;

/** Providers as members, unless the provider ids are not known (`BetterPayment` without arguments) */
type ProviderMembers<P extends Record<string, ProviderEntry>> = string extends keyof P
  ? Empty
  : { readonly [K in keyof P]: ProviderInstance<P[K]> };

type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (
  i: infer I
) => void
  ? I
  : never;

/** Members the plugins add with `methods` */
export type PluginMethods<Plugins extends readonly BetterPaymentPlugin[]> = UnionToIntersection<
  {
    [I in keyof Plugins]: Plugins[I] extends { methods: (...args: never[]) => infer M } ? M : Empty;
  }[number]
>;

/** Error codes the plugins add with `$ERROR_CODES` */
export type PluginErrorCodes<Plugins extends readonly BetterPaymentPlugin[]> = UnionToIntersection<
  {
    [I in keyof Plugins]: Plugins[I] extends { $ERROR_CODES: infer C } ? C : Empty;
  }[number]
>;

/**
 * The payment object: operations with the default provider, the providers by id
 * (`payment.iyzico`), `on()` for events, the handler, and what plugins add.
 */
export type BetterPayment<
  P extends Record<string, ProviderEntry> = Record<string, ProviderEntry>,
  Plugins extends readonly BetterPaymentPlugin[] = readonly BetterPaymentPlugin[],
> = PaymentCore<P> &
  ProviderMembers<P> &
  PluginMethods<Plugins> & {
    readonly $ERROR_CODES: Record<string, string> & PluginErrorCodes<Plugins>;
  };

/**
 * Creates the payment object.
 *
 * @example
 * ```ts
 * import { betterPayment, iyzico, paytr } from 'better-payment';
 *
 * export const payment = betterPayment({
 *   providers: {
 *     iyzico: iyzico({ apiKey: process.env.IYZICO_API_KEY!, secretKey: process.env.IYZICO_SECRET_KEY! }),
 *     paytr: paytr({ merchantId: '...', merchantKey: '...', merchantSalt: '...' }),
 *   },
 *   defaultProvider: 'iyzico',
 *   mode: 'sandbox',
 *   plugins: [],
 * });
 *
 * await payment.createPayment({ ... });        // default provider
 * await payment.paytr.initThreeDSPayment({ ... }); // a specific provider
 * payment.on('payment.succeeded', (event) => { ... });
 * ```
 */
export function betterPayment<
  P extends Record<string, ProviderEntry>,
  const Plugins extends readonly BetterPaymentPlugin[] = [],
>(options: BetterPaymentOptions<P, Plugins>): BetterPayment<P, Plugins> {
  return new PaymentCore<P>(options) as BetterPayment<P, Plugins>;
}
