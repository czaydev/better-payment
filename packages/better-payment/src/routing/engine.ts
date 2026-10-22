// The rule engine behind the routing plugin: condition matching, eligibility,
// ordered and weighted targets, strategies and explainable decisions. It has no
// side effects on the store; the plugin records mappings around it.
import {
  ConfigurationError,
  PAYMENT_OPERATIONS,
  type BetterPaymentLogger,
  type PaymentOperation,
} from 'better-payment';
import type {
  RoutingBinInfo,
  RoutingContext,
  RoutingDecision,
  RoutingEngineContext,
  RoutingHealth,
  RoutingOptions,
  RoutingReason,
  RoutingRequest,
  RoutingRule,
  RoutingSkip,
  RoutingStrategy,
  RoutingTarget,
  RoutingWhen,
} from './types';

/** Operations that start a charge and can be routed by rules */
export const CHARGE_OPERATIONS: readonly PaymentOperation[] = [
  'createPayment',
  'authorize',
  'initThreeDSPayment',
  'initThreeDSAuthorize',
];

/** Operations that go to the provider that handled the payment */
export const FOLLOW_UP_OPERATIONS: readonly PaymentOperation[] = [
  'completeThreeDSPayment',
  'refund',
  'cancel',
  'capture',
  'voidAuthorization',
  'getPayment',
];

const CHARGE_SET = new Set<string>(CHARGE_OPERATIONS);
const FOLLOW_UP_SET = new Set<string>(FOLLOW_UP_OPERATIONS);
const OPERATION_SET = new Set<string>(PAYMENT_OPERATIONS);
const CARD_TYPES = new Set<string>(['credit', 'debit']);
const CARD_ORIGINS = new Set<string>(['domestic', 'foreign']);
const MAX_AMOUNT_DIGITS = 10;
const AMOUNT_SCALE = 10_000;

export function isChargeOperation(operation: PaymentOperation): boolean {
  return CHARGE_SET.has(operation);
}

export function isFollowUpOperation(operation: PaymentOperation): boolean {
  return FOLLOW_UP_SET.has(operation);
}

function fail(message: string): never {
  throw new ConfigurationError(`routing: ${message}`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined;
}

/** Parses a non-negative decimal string into 1/10000 units, exactly enough for bounds */
function minorUnits(value: string): number | undefined {
  const match = new RegExp(`^(\\d{1,${MAX_AMOUNT_DIGITS}})(?:\\.(\\d{1,4}))?$`).exec(value.trim());
  if (!match) return undefined;
  return Number(match[1]) * AMOUNT_SCALE + Number((match[2] ?? '').padEnd(4, '0'));
}

/** FNV-1a plus a murmur3 finalizer: cheap, stable and well spread for short keys */
export function bucket(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/**
 * The key a weighted split is derived from: the order, never randomness, so a
 * retry of the same payment always sees the same bucket. Identical requests
 * without any id share a bucket; pass `conversationId` for real traffic splits.
 */
export function splitKey(request: RoutingRequest, operation: PaymentOperation): string {
  const record = asRecord(request);
  return (
    text(record?.conversationId) ??
    text(record?.paymentId) ??
    text(record?.basketId) ??
    `${operation}|${text(record?.currency) ?? ''}|${text(record?.price) ?? ''}|${
      count(record?.installment) ?? 1
    }`
  );
}

function listOf(value: string | readonly string[] | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? [value] : value;
}

function pushSkip(skipped: RoutingSkip[], provider: string, reason: RoutingSkip['reason']): void {
  if (!skipped.some((entry) => entry.provider === provider)) skipped.push({ provider, reason });
}

function assertTarget(target: unknown, where: string): asserts target is RoutingTarget {
  if (typeof target === 'string') {
    if (!target.trim()) fail(`${where} must not be an empty provider id`);
    return;
  }
  if (Array.isArray(target)) {
    if (target.length === 0) fail(`${where} must list at least one provider`);
    for (const id of target) {
      if (typeof id !== 'string' || !id.trim()) fail(`${where} must contain provider ids`);
    }
    return;
  }
  const record = asRecord(target);
  const weights = record?.weights;
  if (!record || !asRecord(weights)) fail(`${where} must be a provider id, a list or { weights }`);
  const entries = Object.entries(asRecord(weights) ?? {});
  if (entries.length === 0) fail(`${where}.weights must not be empty`);
  let positive = 0;
  for (const [provider, weight] of entries) {
    if (!provider.trim()) fail(`${where}.weights must not contain an empty provider id`);
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      fail(`${where}.weights.${provider} must be a non-negative number`);
    }
    if (weight > 0) positive++;
  }
  if (positive === 0) fail(`${where}.weights must give at least one provider a positive weight`);
}

function assertWhen(when: unknown, where: string): asserts when is RoutingWhen {
  const record = asRecord(when);
  if (!record) fail(`${where}.when must be an object`);

  const strings: (keyof RoutingWhen)[] = ['bin', 'bank', 'cardFamily', 'currency'];
  for (const field of strings) {
    const value = record[field];
    if (value === undefined) continue;
    const list = listOf(value as string | readonly string[]);
    if (
      !list ||
      list.length === 0 ||
      list.some((entry) => typeof entry !== 'string' || !entry.trim())
    ) {
      fail(`${where}.when.${field} must be a non-empty string or an array of them`);
    }
  }
  for (const [field, allowed] of [
    ['cardType', CARD_TYPES],
    ['cardOrigin', CARD_ORIGINS],
  ] as const) {
    const value = record[field];
    if (value === undefined) continue;
    const list = listOf(value as string | readonly string[]);
    if (!list || list.length === 0) fail(`${where}.when.${field} must not be empty`);
    for (const entry of list) {
      if (typeof entry !== 'string' || !allowed.has(entry)) {
        fail(`${where}.when.${field} must be ${[...allowed].join(' or ')}`);
      }
    }
  }
  if (record.threeDS !== undefined && typeof record.threeDS !== 'boolean') {
    fail(`${where}.when.threeDS must be a boolean`);
  }
  if (record.operation !== undefined) {
    const list = listOf(record.operation as PaymentOperation | readonly PaymentOperation[]);
    if (!list || list.length === 0) fail(`${where}.when.operation must not be empty`);
    for (const operation of list) {
      if (typeof operation !== 'string' || !OPERATION_SET.has(operation)) {
        fail(`${where}.when.operation must be a payment operation`);
      }
    }
  }
  if (record.installment !== undefined) {
    const value = record.installment;
    if (typeof value === 'number') {
      if (!Number.isInteger(value) || value < 1) {
        fail(`${where}.when.installment must be an integer of at least 1`);
      }
    } else {
      const range = asRecord(value);
      if (!range) fail(`${where}.when.installment must be a number or { min, max }`);
      for (const key of ['min', 'max']) {
        const bound = range[key];
        if (
          bound !== undefined &&
          (typeof bound !== 'number' || !Number.isInteger(bound) || bound < 1)
        ) {
          fail(`${where}.when.installment.${key} must be an integer of at least 1`);
        }
      }
      if (range.min === undefined && range.max === undefined) {
        fail(`${where}.when.installment needs min or max`);
      }
      if (typeof range.min === 'number' && typeof range.max === 'number' && range.min > range.max) {
        fail(`${where}.when.installment.min must not exceed max`);
      }
    }
  }
  if (record.amount !== undefined) {
    const range = asRecord(record.amount);
    if (!range) fail(`${where}.when.amount must be { min, max }`);
    if (range.min === undefined && range.max === undefined) {
      fail(`${where}.when.amount needs min or max`);
    }
    const min = typeof range.min === 'string' ? minorUnits(range.min) : undefined;
    const max = typeof range.max === 'string' ? minorUnits(range.max) : undefined;
    if (range.min !== undefined && (typeof range.min !== 'string' || min === undefined)) {
      fail(`${where}.when.amount.min must be a non-negative decimal string`);
    }
    if (range.max !== undefined && (typeof range.max !== 'string' || max === undefined)) {
      fail(`${where}.when.amount.max must be a non-negative decimal string`);
    }
    if (min !== undefined && max !== undefined && min > max) {
      fail(`${where}.when.amount.min must not exceed max`);
    }
  }
  if (record.predicate !== undefined && typeof record.predicate !== 'function') {
    fail(`${where}.when.predicate must be a function`);
  }
}

/** Fails fast on a bad configuration, before the first payment */
export function validateRoutingOptions(options: RoutingOptions): void {
  assertOptions(options);
}

function assertOptions(options: RoutingOptions): void {
  if (options.rules !== undefined && !Array.isArray(options.rules)) fail('rules must be an array');
  const strategies = asRecord(options.strategies);
  if (options.strategies !== undefined && !strategies) fail('strategies must be an object');
  for (const [name, strategy] of Object.entries(strategies ?? {})) {
    if (!asRecord(strategy) || typeof (strategy as RoutingStrategy).choose !== 'function') {
      fail(`strategies.${name} must have a choose() function`);
    }
  }
  if (options.health !== undefined && !asRecord(options.health)) fail('health must be an object');
  if (
    options.health?.isAvailable !== undefined &&
    typeof options.health.isAvailable !== 'function'
  ) {
    fail('health.isAvailable must be a function');
  }
  if (options.binResolver !== undefined && typeof options.binResolver !== 'function') {
    fail('binResolver must be a function');
  }
  for (const [index, rule] of (options.rules ?? []).entries()) {
    const where = `rules[${index}]`;
    if (!asRecord(rule)) fail(`${where} must be an object`);
    if (rule.name !== undefined && (typeof rule.name !== 'string' || !rule.name.trim())) {
      fail(`${where}.name must be a non-empty string`);
    }
    if (rule.when !== undefined) assertWhen(rule.when, where);
    if (rule.use !== undefined) assertTarget(rule.use, `${where}.use`);
    if (rule.strategy === undefined) {
      if (rule.use === undefined) fail(`${where} needs use or strategy`);
    } else if (typeof rule.strategy === 'string') {
      if (!strategies?.[rule.strategy])
        fail(`${where}.strategy '${rule.strategy}' is not in strategies`);
    } else if (
      !asRecord(rule.strategy) ||
      typeof (rule.strategy as RoutingStrategy).choose !== 'function'
    ) {
      fail(`${where}.strategy must be a name or an object with choose()`);
    }
  }
  if (options.default !== undefined) assertTarget(options.default, 'default');
}

function matches(
  value: string | undefined,
  expected: string | readonly string[] | undefined
): boolean {
  if (expected === undefined) return true;
  if (value === undefined) return false;
  const wanted = typeof expected === 'string' ? [expected] : expected;
  const normalized = value.toLowerCase();
  return wanted.some((entry) => entry.toLowerCase() === normalized);
}

function matchesAny(value: string | undefined, expected: readonly string[]): boolean {
  if (value === undefined) return false;
  const normalized = value.toLowerCase();
  return expected.some((entry) => entry.toLowerCase() === normalized);
}

function matchesWhen(when: RoutingWhen | undefined, ctx: RoutingContext, where: string): boolean {
  if (!when) return true;
  if (when.bin !== undefined) {
    const prefixes = listOf(when.bin) ?? [];
    if (ctx.bin === undefined) return false;
    if (!prefixes.some((prefix) => ctx.bin!.startsWith(prefix))) return false;
  }
  if (when.bank !== undefined && !matches(ctx.bank, when.bank)) return false;
  if (when.cardFamily !== undefined && !matches(ctx.cardFamily, when.cardFamily)) return false;
  if (when.cardType !== undefined) {
    const types = listOf(when.cardType) ?? [];
    if (!matchesAny(ctx.cardType, types)) return false;
  }
  if (when.cardOrigin !== undefined) {
    const origins = listOf(when.cardOrigin) ?? [];
    if (!matchesAny(ctx.cardOrigin, origins)) return false;
  }
  if (when.threeDS !== undefined && ctx.threeDS !== when.threeDS) return false;
  if (when.operation !== undefined) {
    const operations = listOf(when.operation) ?? [];
    if (!operations.includes(ctx.operation)) return false;
  }
  if (when.currency !== undefined && !matches(ctx.currency, when.currency)) return false;
  if (when.installment !== undefined) {
    if (typeof when.installment === 'number') {
      if (ctx.installment !== when.installment) return false;
    } else {
      if (when.installment.min !== undefined && ctx.installment < when.installment.min)
        return false;
      if (when.installment.max !== undefined && ctx.installment > when.installment.max)
        return false;
    }
  }
  if (when.amount !== undefined) {
    const amount = ctx.amount === undefined ? undefined : minorUnits(ctx.amount);
    if (amount === undefined) return false;
    if (when.amount.min !== undefined) {
      const min = minorUnits(when.amount.min);
      if (min === undefined || amount < min) return false;
    }
    if (when.amount.max !== undefined) {
      const max = minorUnits(when.amount.max);
      if (max === undefined || amount > max) return false;
    }
  }
  if (when.predicate) {
    let matched: boolean;
    try {
      matched = when.predicate(ctx) === true;
    } catch (cause) {
      fail(
        `${where}.when.predicate threw: ${cause instanceof Error ? cause.message : String(cause)}`
      );
    }
    if (!matched) return false;
  }
  return true;
}

function targetIds(target: RoutingTarget): readonly string[] {
  if (typeof target === 'string') return [target];
  if (Array.isArray(target)) return target;
  return Object.keys((target as { weights: Record<string, number> }).weights);
}

interface Selection {
  provider?: string;
  skipped: RoutingSkip[];
  viaStrategy?: boolean;
}

/** A rule engine bound to one payment object's providers */
export class RoutingEngine {
  private readonly options: RoutingOptions;
  private readonly providerIds: readonly string[];
  private readonly defaultProvider?: string;
  private readonly logger?: BetterPaymentLogger;

  constructor(options: RoutingOptions = {}, context: RoutingEngineContext) {
    assertOptions(options);
    this.options = options;
    this.providerIds = context.providerIds;
    this.defaultProvider = context.defaultProvider;
    this.logger = context.logger;
  }

  /** Rules, then the default. Used for new charges. */
  async decide(operation: PaymentOperation, request: unknown): Promise<RoutingDecision> {
    const ctx = await this.contextFor(operation, request);
    const skipped: RoutingSkip[] = [];

    for (const [index, rule] of (this.options.rules ?? []).entries()) {
      const name = rule.name ?? `rule[${index}]`;
      if (!matchesWhen(rule.when, ctx, name)) continue;
      const selection = await this.selectRule(rule, ctx);
      mergeSkips(skipped, selection.skipped);
      if (selection.provider !== undefined) {
        return {
          provider: selection.provider,
          rule: rule.name ?? `rule[${index}]`,
          ruleIndex: index,
          reason: selection.viaStrategy ? 'strategy' : 'rule',
          operation,
          skipped,
          detail: `${name} matched; '${selection.provider}' is the first eligible choice`,
        };
      }
    }

    return this.fallbackFor(ctx, skipped);
  }

  /** The default target only (no rules): follow-ups of unknown payments use it. */
  async fallback(
    operation: PaymentOperation,
    request: unknown,
    skipped: RoutingSkip[] = [],
    reason: RoutingReason = 'default',
    applyHealth = true
  ): Promise<RoutingDecision> {
    return this.fallbackFor(
      await this.contextFor(operation, request),
      skipped,
      reason,
      applyHealth
    );
  }

  private async fallbackFor(
    ctx: RoutingContext,
    skipped: RoutingSkip[] = [],
    reason: RoutingReason = 'default',
    applyHealth = true
  ): Promise<RoutingDecision> {
    const target = this.options.default ?? this.defaultProvider;
    if (target === undefined) {
      return {
        provider: null,
        rule: null,
        ruleIndex: null,
        reason: 'none',
        operation: ctx.operation,
        skipped,
        detail: 'no rule matched and no default target is configured',
      };
    }
    const selection = await this.selectTarget(target, ctx, applyHealth);
    mergeSkips(skipped, selection.skipped);
    return {
      provider: selection.provider ?? null,
      rule: null,
      ruleIndex: null,
      reason: selection.provider === undefined ? 'none' : reason,
      operation: ctx.operation,
      skipped,
      detail:
        selection.provider === undefined
          ? 'no default provider is eligible'
          : `${reason === 'unknown-payment' ? 'the payment is unknown; fell back to' : 'default target selected'} '${selection.provider}'`,
    };
  }

  private async selectRule(rule: RoutingRule, ctx: RoutingContext): Promise<Selection> {
    if (rule.strategy !== undefined) {
      const strategy =
        typeof rule.strategy === 'string'
          ? this.options.strategies?.[rule.strategy]
          : rule.strategy;
      if (!strategy) fail(`strategy '${String(rule.strategy)}' is not configured`);
      const ids = rule.use === undefined ? this.providerIds : targetIds(rule.use);
      const { eligible, skipped } = await this.eligible(ids);
      if (eligible.length === 0) return { skipped };
      const chosen = await strategy.choose({
        operation: ctx.operation,
        request: ctx.request,
        candidates: eligible,
      });
      if (chosen === null || chosen === undefined) return { skipped };
      if (!eligible.includes(chosen)) {
        fail(`strategy chose '${chosen}', which is not an eligible candidate`);
      }
      return { provider: chosen, skipped, viaStrategy: true };
    }
    if (rule.use === undefined) fail('rule needs use or strategy');
    return this.selectTarget(rule.use, ctx);
  }

  private async selectTarget(
    target: RoutingTarget,
    ctx: RoutingContext,
    applyHealth = true
  ): Promise<Selection> {
    const skipped: RoutingSkip[] = [];
    if (typeof target === 'string' || Array.isArray(target)) {
      const ids = [...new Set(targetIds(target))];
      for (const provider of ids) {
        const reason = await this.ineligibility(provider, applyHealth);
        if (reason) {
          pushSkip(skipped, provider, reason);
          continue;
        }
        return { provider, skipped };
      }
      return { skipped };
    }

    const weights = (target as { weights: Record<string, number> }).weights;
    const eligible: { provider: string; weight: number }[] = [];
    for (const [provider, weight] of Object.entries(weights)) {
      if (weight <= 0) continue;
      const reason = await this.ineligibility(provider, applyHealth);
      if (reason) {
        pushSkip(skipped, provider, reason);
        continue;
      }
      eligible.push({ provider, weight });
    }
    if (eligible.length === 0) return { skipped };

    const total = eligible.reduce((sum, entry) => sum + entry.weight, 0);
    let bucketValue = bucket(splitKey(ctx.request, ctx.operation)) % total;
    for (const entry of eligible) {
      if (bucketValue < entry.weight) return { provider: entry.provider, skipped };
      bucketValue -= entry.weight;
    }
    // Floating point weights can add up to less than `total` in the last bucket
    return { provider: eligible[eligible.length - 1].provider, skipped };
  }

  private async eligible(
    ids: readonly string[]
  ): Promise<{ eligible: string[]; skipped: RoutingSkip[] }> {
    const eligible: string[] = [];
    const skipped: RoutingSkip[] = [];
    for (const provider of [...new Set(ids)]) {
      const reason = await this.ineligibility(provider);
      if (reason) pushSkip(skipped, provider, reason);
      else eligible.push(provider);
    }
    return { eligible, skipped };
  }

  private async ineligibility(
    provider: string,
    applyHealth = true
  ): Promise<RoutingSkip['reason'] | undefined> {
    if (!this.providerIds.includes(provider)) return 'not-enabled';
    const health: RoutingHealth['isAvailable'] = this.options.health?.isAvailable;
    if (!health || !applyHealth) return undefined;
    try {
      if ((await health(provider)) === false) return 'unhealthy';
      return undefined;
    } catch (cause) {
      this.logger?.error(
        `[routing] health check for '${provider}' threw; treating it as unavailable`,
        cause instanceof Error ? cause : new Error(String(cause))
      );
      return 'unhealthy';
    }
  }

  private async contextFor(operation: PaymentOperation, request: unknown): Promise<RoutingContext> {
    const record = asRecord(request);
    const card = asRecord(record?.card);
    const paymentCard = asRecord(record?.paymentCard);
    const digits = text(paymentCard?.cardNumber)?.replace(/\D/g, '');
    const explicitBin = text(record?.binNumber) ?? text(record?.bin) ?? text(card?.bin);
    let bin: string | undefined;
    if (explicitBin) {
      const binDigits = explicitBin.replace(/\D/g, '');
      if (binDigits.length >= 6) bin = binDigits.slice(0, 8);
    } else if (digits && digits.length >= 6) {
      bin = digits.slice(0, 8);
    }

    let resolved: RoutingBinInfo = {};
    if (bin && this.options.binResolver) {
      try {
        resolved = (await this.options.binResolver(bin)) ?? {};
      } catch (cause) {
        this.logger?.error(
          '[routing] binResolver threw; BIN conditions are treated as unknown',
          cause instanceof Error ? cause : new Error(String(cause))
        );
        resolved = {};
      }
    }
    const resolvedCard = asRecord(resolved) ?? {};

    const pick = (...values: unknown[]): string | undefined => {
      for (const value of values) {
        const found = text(value);
        if (found) return found;
      }
      return undefined;
    };
    const installment = count(record?.installment) ?? 1;
    const threeDS =
      operation === 'initThreeDSPayment' || operation === 'initThreeDSAuthorize'
        ? true
        : record?.threeDS === true;

    return {
      operation,
      request: (record ?? {}) as RoutingRequest,
      amount: pick(record?.price, record?.amount),
      currency: text(record?.currency),
      installment,
      threeDS,
      bin,
      bank: pick(
        record?.bank,
        record?.bankName,
        card?.bank,
        resolvedCard.bank,
        resolvedCard.bankName
      ),
      cardFamily: pick(record?.cardFamily, card?.cardFamily, resolvedCard.cardFamily),
      cardType: cardTypeOf(pick(record?.cardType, card?.cardType, resolvedCard.cardType)),
      cardOrigin: cardOriginOf(pick(record?.cardOrigin, card?.cardOrigin, resolvedCard.cardOrigin)),
    };
  }
}

/** Accepts provider BIN values such as `CREDIT_CARD` / `DEBIT_CARD` too */
function cardTypeOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized.includes('debit')) return 'debit';
  if (normalized.includes('credit')) return 'credit';
  return normalized;
}

function cardOriginOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === 'international') return 'foreign';
  if (normalized === 'local') return 'domestic';
  return normalized;
}

function mergeSkips(into: RoutingSkip[], from: readonly RoutingSkip[]): void {
  for (const skip of from) pushSkip(into, skip.provider, skip.reason);
}
