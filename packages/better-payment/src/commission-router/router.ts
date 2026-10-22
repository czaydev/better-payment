// commissionRouter: routes each payment to the cheapest eligible provider from
// the merchant's own commission rate tables. See
// apps/web/content/docs/plugins/commission-router.mdx for the guide.
import {
  ConfigurationError,
  PaymentErrorCode,
  PaymentStatus,
  ValidationError,
  definePlugin,
  type OperationContext,
  type OperationResultContext,
  type PaymentOperation,
  type PluginContext,
} from 'better-payment';
import { TtlCache } from './cache';
import { evaluateProvider, prepareRates, type PreparedLine, type QuoteCriteria } from './matching';
import { amountMinor, formatMinor, validateRateTable, type RouterBinInfo } from './rates';
import { MemoryRoutingStore, type RoutingStore } from './store';
import type {
  CandidateReason,
  CommissionRouterOptions,
  ExcludedProvider,
  RouterCandidate,
  RouterOperation,
  RouterQuote,
  RouterQuoteInput,
  RouterStatus,
  SelectionReason,
} from './types';

/** Operations that start a charge and therefore may be routed by cost */
const CHARGE_OPERATIONS: readonly RouterOperation[] = [
  'createPayment',
  'authorize',
  'initThreeDSPayment',
  'initThreeDSAuthorize',
];

/** Operations that must reach the provider that handled the payment */
const BOUND_OPERATIONS: readonly PaymentOperation[] = [
  'refund',
  'cancel',
  'getPayment',
  'capture',
  'voidAuthorization',
  'completeThreeDSPayment',
];

const CHARGE_SET = new Set<string>(CHARGE_OPERATIONS);
const BOUND_SET = new Set<string>(BOUND_OPERATIONS);
const ROUTED_SET = new Set<string>([...CHARGE_OPERATIONS, ...BOUND_OPERATIONS]);

/**
 * Never retried, whatever `fallbackOn` says. A decline proves the card was not
 * charged, but retrying it at another provider is a scheme violation and can
 * look like card testing; `NETWORK_ERROR`, pending and unknown outcomes have an
 * unknown charge state and retrying them is the double-charge bug.
 */
const NEVER_RETRY = new Set<string>([
  PaymentErrorCode.NETWORK_ERROR,
  PaymentErrorCode.CARD_DECLINED,
  PaymentErrorCode.INSUFFICIENT_FUNDS,
  PaymentErrorCode.INVALID_CARD,
  PaymentErrorCode.EXPIRED_CARD,
  PaymentErrorCode.INVALID_CVC,
  PaymentErrorCode.THREEDS_FAILED,
  PaymentErrorCode.FRAUD_SUSPECTED,
  PaymentErrorCode.LIMIT_EXCEEDED,
  PaymentErrorCode.DUPLICATE_ORDER,
  PaymentErrorCode.CANCELLED_BY_CUSTOMER,
  PaymentErrorCode.INVALID_HASH,
  PaymentErrorCode.UNKNOWN,
]);

/**
 * Errors that prove no charge happened and therefore allow one fallback to the
 * next candidate. `PROVIDER_ERROR` before authorization is the case the issue
 * names; merchants can narrow it, never widen it to an unknown outcome.
 */
const DEFAULT_FALLBACK_ON: readonly string[] = [
  PaymentErrorCode.INVALID_REQUEST,
  PaymentErrorCode.PROVIDER_ERROR,
];

/** Initial attempt plus two fallbacks: bounded latency and blast radius */
const MAX_ATTEMPTS = 3;

const DEFAULT_CACHE_ENTRIES = 1_024;
const DEFAULT_CACHE_TTL_MS = 86_400_000;
const DEFAULT_SHARE_WINDOW = 100;

interface ProviderResult {
  status: string;
  paymentId?: string;
  code?: unknown;
  errorCode?: unknown;
}

type OperationFn = (request: unknown) => Promise<unknown>;

/** One eligible provider, with the decided cost */
interface EligibleProvider {
  provider: string;
  line: PreparedLine;
  costMinor: number;
  /** Index of the provider's first line, a stable tie-breaker */
  tableOrder: number;
}

/** The routing decisions of the last `window` payments, for the share cap */
class ShareWindow {
  private readonly entries: string[] = [];

  constructor(readonly window: number) {}

  count(provider: string): number {
    let count = 0;
    for (const entry of this.entries) if (entry === provider) count++;
    return count;
  }

  /** Projected share if this provider took one more payment */
  projection(provider: string): { count: number; denominator: number } {
    return {
      count: this.count(provider) + 1,
      denominator: Math.max(this.window, this.entries.length + 1),
    };
  }

  /** True when one more payment would push the provider over the cap */
  overCap(provider: string, capPerMillion: number): boolean {
    const { count, denominator } = this.projection(provider);
    return count * 1_000_000 > capPerMillion * denominator;
  }

  record(provider: string): void {
    this.entries.push(provider);
    if (this.entries.length > this.window) this.entries.shift();
  }

  counts(providers: readonly string[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const provider of providers) counts[provider] = this.count(provider);
    return counts;
  }

  clear(): void {
    this.entries.length = 0;
  }

  get total(): number {
    return this.entries.length;
  }
}

function asResult(value: unknown): ProviderResult | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const status = (value as { status?: unknown }).status;
  return typeof status === 'string' ? (value as ProviderResult) : undefined;
}

function resultPaymentId(result: ProviderResult | undefined): string | undefined {
  const id = result?.paymentId;
  return typeof id === 'string' && id ? id : undefined;
}

function isThreeDSOperation(operation: RouterOperation): boolean {
  return operation === 'initThreeDSPayment' || operation === 'initThreeDSAuthorize';
}

function requestPaymentId(request: unknown): string | undefined {
  if (typeof request === 'string') return request || undefined;
  if (typeof request !== 'object' || request === null) return undefined;
  const id = (request as { paymentId?: unknown }).paymentId;
  return typeof id === 'string' && id ? id : undefined;
}

function requestConversationId(request: unknown): string | undefined {
  if (typeof request !== 'object' || request === null) return undefined;
  const id = (request as { conversationId?: unknown }).conversationId;
  return typeof id === 'string' && id ? id : undefined;
}

function isOperation(value: unknown): value is RouterOperation {
  return typeof value === 'string' && CHARGE_SET.has(value);
}

/** Validates the options that do not depend on the configured providers */
function validateOptions(options: CommissionRouterOptions): void {
  if (options.strategy !== undefined && options.strategy !== 'lowest-cost') {
    throw new ConfigurationError(
      `commissionRouter: unknown strategy '${String(options.strategy)}'; only 'lowest-cost' is supported`
    );
  }
  if (options.fallback !== undefined) {
    if (!Array.isArray(options.fallback)) {
      throw new ConfigurationError('commissionRouter: fallback must be an array of provider ids');
    }
    for (const provider of options.fallback) {
      if (typeof provider !== 'string' || !provider) {
        throw new ConfigurationError('commissionRouter: fallback must contain provider ids');
      }
    }
  }
  if (options.rates.length === 0 && (options.fallback?.length ?? 0) === 0) {
    throw new ConfigurationError(
      'commissionRouter: configure at least one rate line or a fallback provider'
    );
  }
  if (options.binLookup !== undefined && typeof options.binLookup !== 'function') {
    throw new ConfigurationError('commissionRouter: binLookup must be a function');
  }
  if (options.isHealthy !== undefined && typeof options.isHealthy !== 'function') {
    throw new ConfigurationError('commissionRouter: isHealthy must be a function');
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new ConfigurationError('commissionRouter: now must be a function');
  }
  const cache = options.cache;
  if (
    cache?.maxEntries !== undefined &&
    (!Number.isInteger(cache.maxEntries) || cache.maxEntries < 1)
  ) {
    throw new ConfigurationError('commissionRouter: cache.maxEntries must be an integer >= 1');
  }
  if (cache?.ttlMs !== undefined && !(cache.ttlMs > 0)) {
    throw new ConfigurationError('commissionRouter: cache.ttlMs must be greater than 0');
  }
  const policy = options.policy;
  if (policy?.prefer !== undefined) {
    if (!Array.isArray(policy.prefer)) {
      throw new ConfigurationError(
        'commissionRouter: policy.prefer must be an array of provider ids'
      );
    }
    for (const provider of policy.prefer) {
      if (typeof provider !== 'string' || !provider) {
        throw new ConfigurationError('commissionRouter: policy.prefer must contain provider ids');
      }
    }
  }
  if (policy?.shareCap !== undefined) {
    const { maxShare, window } = policy.shareCap;
    if (typeof maxShare !== 'number' || !(maxShare > 0) || maxShare > 1) {
      throw new ConfigurationError('commissionRouter: policy.shareCap.maxShare must be in (0, 1]');
    }
    if (window !== undefined && (!Number.isInteger(window) || window < 1 || window > 10_000)) {
      throw new ConfigurationError(
        'commissionRouter: policy.shareCap.window must be an integer between 1 and 10000'
      );
    }
  }
  if (policy?.override !== undefined && typeof policy.override !== 'function') {
    throw new ConfigurationError('commissionRouter: policy.override must be a function');
  }
  const fallbackOn = options.fallbackOn ?? DEFAULT_FALLBACK_ON;
  if (!Array.isArray(fallbackOn)) {
    throw new ConfigurationError('commissionRouter: fallbackOn must be an array of error codes');
  }
  for (const code of fallbackOn) {
    if (typeof code !== 'string' || !code) {
      throw new ConfigurationError('commissionRouter: fallbackOn must contain error codes');
    }
    if (NEVER_RETRY.has(code)) {
      throw new ConfigurationError(
        `commissionRouter: fallbackOn must not contain '${code}'. Only errors that prove no ` +
          'charge happened may fall back; retrying a decline, NETWORK_ERROR or an unknown ' +
          'outcome can charge the customer twice.'
      );
    }
  }
}

/** Deduplicates provider ids, keeping the first occurrence */
function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Routes payments by commission cost.
 *
 * @example
 * ```ts
 * import { betterPayment, iyzico, paytr } from 'better-payment';
 * import { commissionRouter } from 'better-payment/commission-router';
 *
 * const payment = betterPayment({
 *   providers: { iyzico: iyzico({ ... }), paytr: paytr({ ... }) },
 *   plugins: [
 *     commissionRouter({
 *       strategy: 'lowest-cost',
 *       rates: [
 *         { provider: 'iyzico', installments: [1], rate: '1.10' },
 *         { provider: 'paytr', installments: [1, 3, 6], rate: '1.25' },
 *       ],
 *       fallback: ['paytr'],
 *     }),
 *   ],
 * });
 *
 * const quote = await payment.router.quote({ binNumber: '552879', price: '1000.00' });
 * ```
 */
export const commissionRouter = (options: CommissionRouterOptions) => {
  if (!options || typeof options !== 'object') {
    throw new ConfigurationError('commissionRouter: options are required');
  }
  if (!Array.isArray(options.rates)) {
    throw new ConfigurationError('commissionRouter: rates must be an array');
  }
  // Shape validation before the providers are known; provider ids are checked in bind().
  validateRateTable(options.rates);
  validateOptions(options);

  const now = options.now ?? Date.now;
  const cacheEntries = options.cache?.maxEntries ?? DEFAULT_CACHE_ENTRIES;
  const cacheTtlMs = options.cache?.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  const binCache = new TtlCache<{ info: RouterBinInfo | null }>({
    maxEntries: cacheEntries,
    ttlMs: cacheTtlMs,
    now,
  });
  const routingStore: RoutingStore = options.store ?? new MemoryRoutingStore({ now });
  const fallback = dedupe(options.fallback ?? []);
  const prefer = dedupe(options.policy?.prefer ?? []);
  const fallbackOn = new Set<string>((options.fallbackOn ?? DEFAULT_FALLBACK_ON).map(String));
  const shareWindow = options.policy?.shareCap?.window ?? DEFAULT_SHARE_WINDOW;
  const capPerMillion =
    options.policy?.shareCap === undefined
      ? null
      : Math.round(options.policy.shareCap.maxShare * 1_000_000);
  const share = new ShareWindow(shareWindow);
  /** Providers to try after a known-safe failure, per in-flight request */
  const plans = new WeakMap<object, string[]>();

  let context: PluginContext | undefined;
  let bound = false;
  let prepared: PreparedLine[] = [];
  let tableOrder = new Map<string, number>();

  const requireContext = (): PluginContext => {
    if (!context) {
      throw new ConfigurationError(
        'commissionRouter: the plugin is not attached to a payment object'
      );
    }
    return context;
  };

  const bind = (ctx: PluginContext): void => {
    if (bound) return;
    validateRateTable(options.rates, ctx.providerIds);
    for (const provider of [...fallback, ...prefer]) {
      if (!ctx.providerIds.includes(provider)) {
        throw new ConfigurationError(
          `commissionRouter: '${provider}' is not a configured provider (${ctx.providerIds.join(', ') || 'none'})`
        );
      }
    }
    prepared = prepareRates(options.rates);
    tableOrder = new Map();
    for (const line of prepared) {
      if (!tableOrder.has(line.provider)) tableOrder.set(line.provider, line.index);
    }
    context = ctx;
    bound = true;
  };

  const checkHealth = async (provider: string, notes: string[]): Promise<boolean> => {
    if (!options.isHealthy) return true;
    try {
      const healthy = await options.isHealthy(provider);
      return healthy !== false;
    } catch {
      // A broken health monitor must not stop every payment.
      notes.push(`health check for '${provider}' failed; treated as healthy`);
      return true;
    }
  };

  /** One BIN classification, cached (bounded and with a TTL) */
  const classify = async (binPrefix: string): Promise<RouterBinInfo | null> => {
    const cached = binCache.get(binPrefix);
    if (cached) return cached.info;
    if (!options.binLookup) return null;
    try {
      const info = (await options.binLookup(binPrefix)) ?? null;
      binCache.set(binPrefix, { info });
      return info;
    } catch {
      // Never log the BIN: a failed lookup is reported without card data.
      context?.logger?.info(
        '[commission-router] BIN lookup failed; the card is treated as unknown'
      );
      return null;
    }
  };

  /** Classifies an extracted BIN prefix (8 digits, then 6), never a full PAN */
  const classifyCard = async (cardNumber: string): Promise<RouterBinInfo | null> => {
    const digits = cardNumber.replace(/\D/g, '');
    if (digits.length < 6) return null;
    const eight = digits.length >= 8 ? digits.slice(0, 8) : digits.slice(0, 6);
    const info = await classify(eight);
    if (info) return info;
    const six = digits.slice(0, 6);
    return eight === six ? null : classify(six);
  };

  const criteriaFromRequest = async (
    request: unknown,
    operation: RouterOperation
  ): Promise<QuoteCriteria | null> => {
    if (typeof request !== 'object' || request === null) return null;
    const record = request as {
      paidPrice?: unknown;
      price?: unknown;
      currency?: unknown;
      installment?: unknown;
      paymentCard?: { cardNumber?: unknown };
    };
    const amountText =
      typeof record.paidPrice === 'string' && record.paidPrice
        ? record.paidPrice
        : typeof record.price === 'string' && record.price
          ? record.price
          : undefined;
    if (!amountText) return null;
    const amount = amountMinor(amountText, 'amount');
    const currency =
      typeof record.currency === 'string' && /^[A-Za-z]{3}$/.test(record.currency)
        ? record.currency.toUpperCase()
        : 'TRY';
    const installment = Number(record.installment);
    const cardNumber = record.paymentCard?.cardNumber;
    const card =
      typeof cardNumber === 'string' && cardNumber ? await classifyCard(cardNumber) : null;
    return {
      amountMinor: amount,
      currency,
      installment:
        Number.isInteger(installment) && installment >= 1 && installment <= 99 ? installment : 1,
      threeDS: isThreeDSOperation(operation),
      card,
      now: now(),
    };
  };

  const mayRetry = (result: ProviderResult): boolean => {
    if (result.status !== PaymentStatus.FAILURE) return false;
    const code = typeof result.code === 'string' ? result.code : '';
    const raw = typeof result.errorCode === 'string' ? result.errorCode : '';
    if (NEVER_RETRY.has(code) || NEVER_RETRY.has(raw)) return false;
    return fallbackOn.has(code) || fallbackOn.has(raw);
  };

  const remember = async (paymentId: string, provider: string): Promise<void> => {
    if (!provider) return;
    try {
      await routingStore.set(paymentId, provider);
    } catch (error) {
      // The payment already happened; a store failure must not turn a
      // confirmed success into an error. Same-provider refunds lose the hint.
      context?.logger?.error(
        '[commission-router] routing store write failed; later refunds may use the default provider',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  };

  const runOverride = async (
    criteria: QuoteCriteria,
    operation: RouterOperation,
    conversationId: string | undefined,
    candidates: string[],
    notes: string[]
  ): Promise<string | null> => {
    const override = options.policy?.override;
    if (!override) return null;
    try {
      const provider = await override({
        operation,
        conversationId,
        amount: {
          price: formatMinor(criteria.amountMinor),
          priceMinor: criteria.amountMinor,
          currency: criteria.currency,
          installment: criteria.installment,
          threeDS: criteria.threeDS,
        },
        candidates,
        card: criteria.card
          ? {
              bankName: criteria.card.bankName,
              cardFamily: criteria.card.cardFamily,
              cardType: criteria.card.cardType,
              cardAssociation: criteria.card.cardAssociation,
              commercial: criteria.card.commercial,
            }
          : null,
      });
      return typeof provider === 'string' && provider ? provider : null;
    } catch {
      context?.logger?.info('[commission-router] policy.override threw; normal ranking used');
      notes.push('policy.override threw; normal ranking used');
      return null;
    }
  };

  const candidateDetail = (
    candidate: EligibleProvider,
    chosen: EligibleProvider | null,
    currency: string,
    reason: CandidateReason
  ): string => {
    const cost = `${formatMinor(candidate.costMinor)} ${currency}`;
    if (reason === 'lowest-cost') return `cheapest eligible commission: ${cost}`;
    if (reason === 'preferred-on-tie') {
      return `same cost as the runner-up; preferred by policy.prefer (${cost})`;
    }
    if (reason === 'override') return `selected by policy.override (${cost})`;
    if (!chosen) return cost;
    const difference = candidate.costMinor - chosen.costMinor;
    if (difference === 0) {
      return `same cost as '${chosen.provider}' (${cost}); ranked lower by policy.prefer or the rate table order`;
    }
    return `costs ${formatMinor(difference)} ${currency} more than '${chosen.provider}'`;
  };

  const buildQuote = async (
    criteria: QuoteCriteria,
    operation: RouterOperation,
    conversationId: string | undefined
  ): Promise<RouterQuote> => {
    const ctx = requireContext();
    const notes: string[] = [];
    const excluded: ExcludedProvider[] = [];
    const eligible: EligibleProvider[] = [];

    for (const provider of ctx.providerIds) {
      const evaluation = evaluateProvider(provider, prepared, criteria);
      if (!evaluation.eligible) {
        excluded.push({
          provider: evaluation.provider,
          reason: evaluation.reason,
          detail: evaluation.detail,
          rateIndex: evaluation.rateIndex,
        });
        continue;
      }
      if (!(await checkHealth(provider, notes))) {
        excluded.push({
          provider,
          reason: 'provider-unhealthy',
          detail: 'isHealthy() returned false',
        });
        continue;
      }
      eligible.push({
        provider,
        line: evaluation.line,
        costMinor: evaluation.costMinor,
        tableOrder: tableOrder.get(provider) ?? Number.MAX_SAFE_INTEGER,
      });
    }

    const preferIndex = (provider: string): number => {
      const index = prefer.indexOf(provider);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    eligible.sort(
      (a, b) =>
        a.costMinor - b.costMinor ||
        preferIndex(a.provider) - preferIndex(b.provider) ||
        a.tableOrder - b.tableOrder ||
        (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0)
    );

    let selected: EligibleProvider | null = null;
    let selectionReason: SelectionReason | null = null;

    const overrideProvider = await runOverride(
      criteria,
      operation,
      conversationId,
      eligible.map((entry) => entry.provider),
      notes
    );
    if (overrideProvider) {
      selected = eligible.find((entry) => entry.provider === overrideProvider) ?? null;
      if (selected) {
        selectionReason = 'override';
        // An explicit per-order decision wins over the share cap.
      } else {
        notes.push(
          `policy.override selected '${overrideProvider}', which is not eligible; normal ranking used`
        );
      }
    }

    let ranked = eligible;
    if (!selected && capPerMillion !== null && eligible.length > 0) {
      const kept = eligible.filter((entry) => !share.overCap(entry.provider, capPerMillion));
      if (kept.length === 0) {
        notes.push(
          'every eligible provider is at its share cap; the cheapest eligible provider is used'
        );
      } else {
        for (const entry of eligible) {
          if (kept.includes(entry)) continue;
          const { count, denominator } = share.projection(entry.provider);
          excluded.push({
            provider: entry.provider,
            reason: 'share-cap',
            detail:
              `one more payment would take ${Math.round((count / denominator) * 100)}% of the ` +
              `last ${denominator} routing decisions (cap ${Math.round(
                (capPerMillion / 1_000_000) * 100
              )}%)`,
            rateIndex: entry.line.index,
          });
        }
        ranked = kept;
      }
    }

    if (!selected) {
      selected = ranked[0] ?? null;
      if (selected) {
        const runnerUp = ranked[1];
        const tied =
          runnerUp !== undefined &&
          runnerUp.costMinor === selected.costMinor &&
          preferIndex(selected.provider) < preferIndex(runnerUp.provider);
        selectionReason = tied ? 'preferred-on-tie' : 'lowest-cost';
      }
    }

    const candidates: RouterCandidate[] = [];
    if (selected) {
      const chosenReason: SelectionReason = selectionReason ?? 'lowest-cost';
      candidates.push({
        provider: selected.provider,
        cost: formatMinor(selected.costMinor),
        costMinor: selected.costMinor,
        rate: selected.line.rate,
        fixed: selected.line.fixed,
        rateIndex: selected.line.index,
        chosen: true,
        reason: chosenReason,
        detail: candidateDetail(selected, null, criteria.currency, chosenReason),
      });
      for (const entry of ranked) {
        if (entry === selected) continue;
        const reason: CandidateReason =
          entry.costMinor > selected.costMinor ? 'higher-cost' : 'ranked-lower';
        candidates.push({
          provider: entry.provider,
          cost: formatMinor(entry.costMinor),
          costMinor: entry.costMinor,
          rate: entry.line.rate,
          fixed: entry.line.fixed,
          rateIndex: entry.line.index,
          chosen: false,
          reason,
          detail: candidateDetail(entry, selected, criteria.currency, reason),
        });
      }
    }

    // No rate line is eligible: use the merchant's fallback order, but never a
    // provider that was excluded by a filter (wrong currency, 3DS, card...).
    if (!selected) {
      const fallbackCandidates: string[] = [];
      for (const provider of fallback) {
        const exclusion = excluded.find((entry) => entry.provider === provider);
        if (!exclusion || exclusion.reason !== 'no-rate-line') continue;
        if (!(await checkHealth(provider, notes))) continue;
        fallbackCandidates.push(provider);
      }
      if (fallbackCandidates.length > 0) {
        for (const provider of fallbackCandidates) {
          const index = excluded.findIndex((entry) => entry.provider === provider);
          if (index !== -1) excluded.splice(index, 1);
        }
        selectionReason = 'fallback';
        fallbackCandidates.forEach((provider, index) => {
          candidates.push({
            provider,
            cost: null,
            costMinor: null,
            rate: null,
            fixed: null,
            rateIndex: null,
            chosen: index === 0,
            reason: index === 0 ? 'fallback' : 'ranked-lower',
            detail:
              index === 0
                ? 'no rate line matched; first provider in the fallback order'
                : `comes after '${fallbackCandidates[0]}' in the fallback order`,
          });
        });
      } else {
        notes.push('no provider is eligible and the fallback order is empty or unavailable');
      }
    }

    return {
      strategy: 'lowest-cost',
      amount: {
        price: formatMinor(criteria.amountMinor),
        priceMinor: criteria.amountMinor,
        currency: criteria.currency,
        installment: criteria.installment,
        threeDS: criteria.threeDS,
      },
      card: criteria.card
        ? {
            bankName: criteria.card.bankName,
            cardFamily: criteria.card.cardFamily,
            cardType: criteria.card.cardType,
            cardAssociation: criteria.card.cardAssociation,
            commercial: criteria.card.commercial,
          }
        : null,
      selected: candidates.find((candidate) => candidate.chosen)?.provider ?? null,
      selectionReason: candidates.length > 0 ? selectionReason : null,
      candidates,
      excluded,
      notes,
    };
  };

  const quote = async (input: RouterQuoteInput): Promise<RouterQuote> => {
    if (!input || typeof input !== 'object') {
      throw new ValidationError('commissionRouter: quote input must be an object');
    }
    const operation = input.operation ?? 'createPayment';
    if (!isOperation(operation)) {
      throw new ValidationError(
        'commissionRouter: operation must be createPayment, authorize, initThreeDSPayment or initThreeDSAuthorize'
      );
    }
    const priceText =
      typeof input.price === 'number'
        ? String(input.price)
        : typeof input.price === 'string'
          ? input.price.trim()
          : '';
    if (!priceText) {
      throw new ValidationError('commissionRouter: price is required');
    }
    let priceMinor: number;
    try {
      priceMinor = amountMinor(priceText, 'price');
    } catch {
      throw new ValidationError(
        'commissionRouter: price must be a non-negative decimal with at most 2 decimals'
      );
    }
    const installment = input.installment ?? 1;
    if (!Number.isInteger(installment) || installment < 1 || installment > 99) {
      throw new ValidationError(
        'commissionRouter: installment must be an integer between 1 and 99'
      );
    }
    const currency = (input.currency ?? 'TRY').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ValidationError('commissionRouter: currency must be a 3-letter ISO code');
    }
    if (input.binNumber !== undefined && !/^\d{6,8}$/.test(input.binNumber)) {
      // Never echo the value: callers sometimes pass a full card number by mistake.
      throw new ValidationError(
        'commissionRouter: binNumber must be the 6-8 digit BIN prefix, never a full card number'
      );
    }
    if (input.conversationId !== undefined && typeof input.conversationId !== 'string') {
      throw new ValidationError('commissionRouter: conversationId must be a string');
    }
    const card = input.binNumber === undefined ? null : await classify(input.binNumber);
    const criteria: QuoteCriteria = {
      amountMinor: priceMinor,
      currency,
      installment,
      threeDS: input.threeDS ?? isThreeDSOperation(operation),
      card,
      now: now(),
    };
    return buildQuote(criteria, operation, input.conversationId);
  };

  return definePlugin({
    id: 'commission-router',
    options,
    init: (ctx) => {
      bind(ctx);
    },
    hooks: {
      before: [
        {
          matcher: (ctx: OperationContext) => ctx.routable && ROUTED_SET.has(ctx.operation),
          handler: async (ctx: OperationContext) => {
            requireContext();

            if (BOUND_SET.has(ctx.operation)) {
              // Refunds, cancels and status calls must reach the provider that
              // handled the payment, even when it is no longer the cheapest.
              const paymentId = requestPaymentId(ctx.request);
              if (!paymentId) return undefined;
              let provider: string | null | undefined;
              try {
                provider = await routingStore.get(paymentId);
              } catch (error) {
                context?.logger?.error(
                  '[commission-router] routing store lookup failed; the default provider is used',
                  error instanceof Error ? error : new Error(String(error))
                );
                return undefined;
              }
              if (provider && provider !== ctx.provider) {
                context?.logger?.info(
                  `[commission-router] ${ctx.operation} is routed to '${provider}', which handled the payment`
                );
                return { provider };
              }
              return undefined;
            }

            const operation = ctx.operation as RouterOperation;
            let criteria: QuoteCriteria | null;
            try {
              criteria = await criteriaFromRequest(ctx.request, operation);
            } catch {
              // Invalid amounts are the provider's validation to report.
              return undefined;
            }
            if (!criteria) return undefined;
            const decision = await buildQuote(
              criteria,
              operation,
              requestConversationId(ctx.request)
            );
            const chosen = decision.candidates.find((candidate) => candidate.chosen);
            if (!chosen) return undefined;

            if (typeof ctx.request === 'object' && ctx.request !== null) {
              plans.set(
                ctx.request,
                decision.candidates
                  .filter((candidate) => !candidate.chosen)
                  .map((candidate) => candidate.provider)
                  .slice(0, MAX_ATTEMPTS - 1)
              );
            }
            // Record every routing decision, not only when a cap is configured:
            // `router.status()` reports what the router actually did.
            share.record(chosen.provider);
            if (chosen.provider !== ctx.provider) {
              context?.logger?.info(
                `[commission-router] ${operation} is routed to '${chosen.provider}'` +
                  (chosen.cost ? ` (commission ${chosen.cost} ${criteria.currency})` : '')
              );
              return { provider: chosen.provider };
            }
            return undefined;
          },
        },
      ],
      after: [
        {
          matcher: (ctx: OperationResultContext) => ctx.routable && ROUTED_SET.has(ctx.operation),
          handler: async (ctx: OperationResultContext) => {
            const initial = asResult(ctx.result);
            const startedWith = ctx.provider;
            let provider = startedWith;
            let result: unknown = ctx.result;
            const request = ctx.request;
            const plan =
              typeof request === 'object' && request !== null ? plans.get(request) : undefined;
            if (typeof request === 'object' && request !== null) plans.delete(request);

            // Remember the provider of a payment that may exist even when the
            // attempt failed (a payment id was returned).
            const initialPaymentId = resultPaymentId(initial);
            if (initialPaymentId && startedWith) await remember(initialPaymentId, startedWith);

            if (plan && initial && mayRetry(initial)) {
              for (const candidate of plan) {
                if (candidate === provider) continue;
                context?.logger?.info(
                  `[commission-router] ${ctx.operation} failed with a code that proves no charge; ` +
                    `retrying with '${candidate}'`
                );
                let next: unknown;
                try {
                  const backup = requireContext().use(candidate);
                  const call = backup[ctx.operation] as unknown as OperationFn;
                  next = await call.call(backup, request);
                } catch (error) {
                  // The backup call threw: its outcome is unknown. Never try
                  // another provider after an unknown outcome.
                  context?.logger?.error(
                    `[commission-router] fallback call to '${candidate}' threw; no further retries`,
                    error instanceof Error ? error : new Error(String(error))
                  );
                  throw error;
                }
                const outcome = asResult(next);
                result = next;
                provider = candidate;
                const paymentId = resultPaymentId(outcome);
                if (paymentId) await remember(paymentId, candidate);
                if (!outcome || !mayRetry(outcome)) break;
              }
            }

            if (typeof result !== 'object' || result === null) return undefined;
            return { result: { ...(result as Record<string, unknown>), provider } };
          },
        },
      ],
    },
    methods: (ctx: PluginContext) => {
      bind(ctx);
      return {
        router: {
          quote: (input: RouterQuoteInput) => quote(input),
          status: (): RouterStatus => ({
            routed: share.counts(ctx.providerIds),
            total: share.total,
            shareWindow,
            binCache: {
              entries: binCache.size,
              maxEntries: cacheEntries,
              ttlMs: cacheTtlMs,
            },
          }),
          reset: (): void => {
            share.clear();
            binCache.clear();
          },
        },
      };
    },
    endpoints: {
      quote: {
        method: 'POST',
        path: '/router/quote',
        handler: async (ctx) => {
          const body = ctx.body ?? {};
          const price = body.price;
          try {
            return await quote({
              binNumber: typeof body.binNumber === 'string' ? body.binNumber : undefined,
              price: typeof price === 'string' || typeof price === 'number' ? price : '',
              installment: typeof body.installment === 'number' ? body.installment : undefined,
              currency: typeof body.currency === 'string' ? body.currency : undefined,
              threeDS: typeof body.threeDS === 'boolean' ? body.threeDS : undefined,
              operation:
                typeof body.operation === 'string'
                  ? (body.operation as RouterQuoteInput['operation'])
                  : undefined,
              conversationId:
                typeof body.conversationId === 'string' ? body.conversationId : undefined,
            });
          } catch (error) {
            if (error instanceof ValidationError) return ctx.json({ error: error.message }, 400);
            throw error;
          }
        },
      },
    },
  });
};
