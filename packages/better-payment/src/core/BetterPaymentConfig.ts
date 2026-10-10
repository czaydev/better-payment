import type { BetterPaymentLogger } from './logger';
import type { RetryConfig } from './retry';
export type { RetryConfig } from './retry';
import type { BetterPaymentHandlerOptions } from './BetterPaymentHandler';
import type { PaymentProvider, PaymentProviderConfig } from './PaymentProvider';
import type { BetterPaymentPlugin } from './plugin';

/**
 * Ids of the built-in providers. They are the usual keys of `providers`, but any
 * key works: the key is the provider's id in `payment.use(id)` and in handler URLs.
 */
export enum ProviderType {
  IYZICO = 'iyzico',
  PAYTR = 'paytr',
  AKBANK = 'akbank',
  PARAMPOS = 'parampos',
  KUVEYTTURK = 'kuveytturk',
  /** In-memory provider for tests, from `better-payment/testing` */
  MOCK = 'mock',
}

/** Settings shared by all providers, passed to provider definitions */
export interface ProviderSetupContext {
  /** The provider's key in `providers` */
  id: string;
  mode: 'sandbox' | 'production';
  logger?: BetterPaymentLogger;
  retry?: RetryConfig;
  fetch?: typeof fetch;
  validate?: boolean;
}

/**
 * Creates a provider once the shared settings (mode, logger, retry, fetch) are
 * known. `iyzico({...})`, `paytr({...})` and the other built-in factories return one.
 */
export interface ProviderDefinition<P extends PaymentProvider = PaymentProvider> {
  create(ctx: ProviderSetupContext): P;
}

/** A provider instance, or a definition that creates one */
export type ProviderEntry = PaymentProvider | ProviderDefinition;

/** The provider type an entry of `providers` resolves to */
export type ProviderInstance<E> =
  E extends ProviderDefinition<infer P> ? P : E extends PaymentProvider ? E : never;

/**
 * Wraps a function that creates a custom provider from the shared settings.
 *
 * @example
 * ```ts
 * export const myPos = (config: MyPosConfig) =>
 *   defineProvider((ctx) => new MyPos({ ...config, logger: config.logger ?? ctx.logger }));
 * ```
 */
export function defineProvider<P extends PaymentProvider>(
  create: (ctx: ProviderSetupContext) => P
): ProviderDefinition<P> {
  return { create };
}

export interface BetterPaymentOptions<
  P extends Record<string, ProviderEntry> = Record<string, ProviderEntry>,
  Plugins extends readonly BetterPaymentPlugin[] = readonly BetterPaymentPlugin[],
> {
  /**
   * Providers by id: `{ iyzico: iyzico({...}), paytr: paytr({...}) }`. A custom
   * provider can be passed as an instance of a `PaymentProvider` subclass.
   */
  providers: P;
  /**
   * Provider used by the operations on the payment object (`payment.createPayment()`).
   * Default: the only provider, when there is exactly one.
   */
  defaultProvider?: keyof P & string;
  /**
   * 'sandbox' selects test URLs and turns on provider test modes (PayTR
   * test_mode, Akbank test gateways). Defaults to 'production'.
   */
  mode?: 'sandbox' | 'production';
  logger?: BetterPaymentLogger;
  retry?: RetryConfig;
  /**
   * Custom fetch implementation for provider API calls (for example to add a proxy
   * or for tests). Default: globalThis.fetch.
   */
  fetch?: typeof fetch;
  /**
   * Validate requests before calling providers. Default: true.
   * Can be overridden per provider with `validate` in its config.
   */
  validate?: boolean;
  /** Options for `payment.handler` */
  handler?: BetterPaymentHandlerOptions;
  /** Plugins, applied in order */
  plugins?: Plugins;
}

/** Providers that call a remote API (all except the in-memory `mock`) */
export type RemoteProviderType = Exclude<ProviderType, ProviderType.MOCK>;

export const PROVIDER_DEFAULT_URLS: Record<
  RemoteProviderType,
  { sandbox: string; production: string }
> = {
  [ProviderType.IYZICO]: {
    sandbox: 'https://sandbox-api.iyzipay.com',
    production: 'https://api.iyzipay.com',
  },
  [ProviderType.PAYTR]: {
    // PayTR has a single host; test transactions are selected with test_mode=1
    sandbox: 'https://www.paytr.com',
    production: 'https://www.paytr.com',
  },
  [ProviderType.AKBANK]: {
    sandbox: 'https://apipre.akbank.com/api/v1/payment/virtualpos',
    production: 'https://api.akbank.com/api/v1/payment/virtualpos',
  },
  [ProviderType.PARAMPOS]: {
    sandbox: 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx',
    production: 'https://posws.param.com.tr/turkpos.ws/service_turkpos_prod.asmx',
  },
  [ProviderType.KUVEYTTURK]: {
    sandbox: 'https://boatest.kuveytturk.com.tr/boa.virtualpos.services',
    production: 'https://sanalpos.kuveytturk.com.tr/ServiceGateWay',
  },
};

/** Fills the base URL for the mode and the shared settings the config leaves out */
export function withProviderDefaults<T extends PaymentProviderConfig>(
  type: RemoteProviderType,
  config: T,
  ctx: ProviderSetupContext
): T {
  return {
    ...config,
    baseUrl: config.baseUrl ?? PROVIDER_DEFAULT_URLS[type][ctx.mode],
    logger: config.logger ?? ctx.logger,
    retry: config.retry ?? ctx.retry,
    fetch: config.fetch ?? ctx.fetch,
    validate: config.validate ?? ctx.validate,
  };
}
