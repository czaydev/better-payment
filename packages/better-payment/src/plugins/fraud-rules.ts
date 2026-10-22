import {
  ConfigurationError,
  definePlugin,
  hmac,
  PaymentErrorCode,
  PaymentStatus,
  randomHex,
  toHex,
  type BetterPaymentLogger,
  type OperationContext,
  type OperationResultContext,
  type PaymentOperation,
  type PaymentRequest,
} from 'better-payment';

type Awaitable<T> = T | Promise<T>;

/** What a fraud verdict does with the payment */
export type FraudVerdict = 'block' | 'threeDS' | 'flag';

/**
 * How attempts are grouped. A value is always hashed with the plugin salt before
 * it reaches the store, so a card number never becomes a key.
 */
export type FraudKeyKind = 'ip' | 'email' | 'buyer' | 'bin' | 'prefix' | 'card';

/** A grouping key plus `'amount'`, for counting distinct values inside a window */
export type FraudMemberKind = FraudKeyKind | 'amount';

/** One derived attempt: only data that is safe to log, never a PAN, CVC or expiry */
export interface FraudContext {
  operation: PaymentOperation;
  provider: string | undefined;
  /** The operation request. Read it in your rules; never store or log it as it is */
  request: PaymentRequest;
  /** First 6 digits of the card (BIN), when the request carries a card */
  bin?: string;
  /** First 8 digits of the card */
  prefix?: string;
  /** Last 4 digits of the card */
  last4?: string;
  /** BIN plus last four, e.g. `552879******0008`: the widest form a card number may take */
  maskedCard?: string;
  email?: string;
  ip?: string;
  buyerId?: string;
  /** `paidPrice`, or `price` when there is none, as a number. Money stays a string in requests */
  amount?: number;
  currency?: string;
  installment?: number;
  conversationId?: string;
}

/** What a custom rule reports: a code, or a code with its verdict and message */
export interface FraudRuleHit {
  code?: string;
  verdict?: FraudVerdict;
  message?: string;
}

/**
 * A rule you write: return an error code (or a hit) to trigger it, a falsy value
 * to let the payment through.
 *
 * @example
 * ```ts
 * (ctx) => Number(ctx.request.price) > 50_000 && 'AMOUNT_LIMIT'
 * ```
 */
export type FraudRule = (ctx: FraudContext) => Awaitable<string | false | void | FraudRuleHit>;

/** Attempts counted per grouping key inside a window */
export interface FraudVelocityRule {
  /** Group to count: a built-in kind, or your own function returning the value to hash */
  key: FraudKeyKind | ((ctx: FraudContext) => Awaitable<string | undefined>);
  /**
   * How many hits to allow. An `attempt` rule triggers on its `max + 1`-th attempt
   * (the current one counts); a `declined` rule triggers once the window already
   * holds `max` declines.
   */
  max: number;
  /** Window: milliseconds or `'30s'`, `'10m'`, `'1h'`, `'1d'`. Default: the plugin `window` */
  window?: string | number;
  /**
   * `'attempt'` (default) counts every attempt as it is made, blocked or not.
   * `'declined'` counts only attempts the provider declined, so a run of declines
   * on one IP or card escalates.
   */
  on?: 'attempt' | 'declined';
  /**
   * Count *different* values of this kind in the group instead of every attempt:
   * `distinct: 'card'` on `key: 'buyer'` is one buyer trying several cards,
   * `distinct: 'amount'` is an amount ladder.
   */
  distinct?: FraudMemberKind;
  /** Apply the rule only when this returns true */
  when?: (ctx: FraudContext) => boolean;
  /** Verdict of this rule. Default: the plugin `verdict` */
  verdict?: FraudVerdict;
  /** Code of the refusal. Default: `RATE_LIMITED` */
  code?: string;
}

/** Counters of one window: how many hits it holds and when it starts over */
export interface FraudWindow {
  count: number;
  resetAt: number;
}

/**
 * Counter backend. Keys are derived and hashed by the plugin, so a store never
 * sees card data. Memory fits one process; pass a shared store (Redis, a
 * database) when several instances serve the same checkout.
 *
 * The interface is deliberately minimal and structural — three methods, two of
 * them optional, over plain strings and numbers — so that anything that can
 * count under a key with a TTL fits it: a Redis `INCR`/`PEXPIRE` pair today, and
 * the key-value store adapters discussed in #116 (`get`/`set`/`setIfAbsent`/
 * `delete`, with an expiry on `set`) when they land. `reset` maps to `delete`.
 */
export interface FraudStore {
  /** Registers a hit and returns the count of the live window */
  hit(key: string, windowMs: number): Awaitable<FraudWindow>;
  /** The count of the live window without registering a hit; 0 when it expired */
  peek(key: string): Awaitable<number>;
  /** Registers a member of a group and returns how many different members it has. Needed by `distinct` rules */
  distinct?(group: string, member: string, windowMs: number): Awaitable<FraudWindow>;
  /** Drops one key, or everything when called without one */
  reset?(key?: string): Awaitable<void>;
}

/** In-memory fixed-window store for one process, tests and development */
export class MemoryFraudStore implements FraudStore {
  private readonly windows = new Map<string, FraudWindow>();
  private readonly groups = new Map<string, { members: Set<string>; resetAt: number }>();

  constructor(private readonly maxEntries = 10_000) {}

  hit(key: string, windowMs: number): FraudWindow {
    const now = Date.now();
    const live = this.windows.get(key);
    if (live && live.resetAt > now) {
      live.count += 1;
      return live;
    }
    const fresh = { count: 1, resetAt: now + windowMs };
    this.windows.set(key, fresh);
    this.trim();
    return fresh;
  }

  peek(key: string): number {
    const live = this.windows.get(key);
    return live && live.resetAt > Date.now() ? live.count : 0;
  }

  distinct(group: string, member: string, windowMs: number): FraudWindow {
    const now = Date.now();
    const live = this.groups.get(group);
    const keep = live !== undefined && live.resetAt > now;
    const entry = keep
      ? (live as { members: Set<string>; resetAt: number })
      : { members: new Set<string>(), resetAt: now + windowMs };
    entry.members.add(member);
    this.groups.set(group, entry);
    if (!keep) this.trim();
    return { count: entry.members.size, resetAt: entry.resetAt };
  }

  reset(key?: string): void {
    if (key === undefined) {
      this.windows.clear();
      this.groups.clear();
      return;
    }
    this.windows.delete(key);
    this.groups.delete(key);
  }

  /** A bot rotating fake identities must not be able to grow this without bound */
  private trim(): void {
    while (this.windows.size + this.groups.size > this.maxEntries) {
      const oldest = this.windows.keys().next().value ?? this.groups.keys().next().value;
      if (oldest === undefined) return;
      this.windows.delete(oldest);
      this.groups.delete(oldest);
    }
  }
}

/** A trigger, as the plugin and your callbacks see it */
export interface FraudDecision {
  /** Code reported for this trigger */
  code: string;
  /** Verdict that applied */
  verdict: FraudVerdict;
  /** `blocked`: refused, `flagged`: allowed and marked, `allowed`: cleared by the challenge or already 3D Secure */
  outcome: 'blocked' | 'flagged' | 'allowed';
  /** True when the `challenge` hook cleared it */
  challenged: boolean;
  /** Derived, hashed counter key of the rule that triggered (`''` when the rule counts nothing) */
  key: string;
  /** Counter value that crossed the limit */
  count: number;
  operation: PaymentOperation;
  amount?: number;
  currency?: string;
  maskedCard?: string;
  conversationId?: string;
}

/** Where `clientIp` may read an address from */
export interface FraudIpSource {
  /** Request headers, in any case (`BetterPaymentRequest['headers']` fits) */
  headers?: Record<string, string | undefined>;
  /** Address the connection arrived on, when your framework gives one (`socket.remoteAddress`) */
  socketAddress?: string;
}

/** How `clientIp` decides which address is the visitor's */
export interface FraudIpOptions {
  /**
   * Header names allowed to carry the visitor address, most preferred first.
   * Default: none — `x-forwarded-for` and friends are set by whoever talks to you,
   * so an address is only read from a header you list here.
   */
  headers?: string[];
  /**
   * Addresses or IPv4 CIDRs of the proxies in front of the app. When you set them,
   * a header is only used for a request that actually arrived from one of them, and
   * a comma separated chain is read from the right (each proxy prepends the address
   * in front of it, so the first entry your own proxy does not hold is the visitor).
   */
  trustedProxies?: string[];
}

export interface FraudRulesOptions {
  /** Counter backend. Default: `new MemoryFraudStore()` */
  store?: FraudStore;
  /**
   * Salt of the derived keys. Default: random per process. Set a stable secret
   * when several instances share a store, otherwise their keys never match.
   */
  salt?: string;
  /** Operations the guard runs for. Default: the four payment and 3DS inits */
  operations?: PaymentOperation[];
  /** Velocity rules, in order */
  velocity?: FraudVelocityRule[];
  /** Your own rules, in order, after the blocked BINs and the amount limit */
  rules?: FraudRule[];
  /** BINs to refuse, exact (`'552879'`) or a range (`['492156', '492160']`); 6 to 8 digits */
  blockBins?: (string | [string, string])[];
  /** Refuse amounts above this, compared as a number in the currency of the request */
  maxAmount?: number | string;
  /** Verdict of triggers that do not set one. Default: `'block'` */
  verdict?: FraudVerdict;
  /** Default window of the velocity rules. Default: `'10m'` */
  window?: string | number;
  /**
   * Async check that can clear a block, e.g. a captcha: `async (ctx) => verify(ctx)`.
   * A throw counts as a failure, so an unreachable service never lets a payment through.
   */
  challenge?: (ctx: FraudContext) => Awaitable<boolean>;
  /** Called for every trigger, blocked, flagged or cleared: alerts and audit log */
  onDecision?: (decision: FraudDecision, ctx: FraudContext) => Awaitable<void>;
  /** Override where an identity comes from, e.g. take the IP from your own server-side value */
  keys?: Partial<Record<FraudKeyKind, (ctx: FraudContext) => Awaitable<string | undefined>>>;
  /**
   * How the visitor address is read out of the HTTP request: return the headers the
   * handler saw, and the address the connection arrived on when your framework gives
   * one. Without it the plugin only uses `buyer.ip` of the request, which is a value
   * your own code wrote, never one a customer sent.
   */
  resolveIp?: (ctx: OperationContext) => Awaitable<FraudIpSource | undefined>;
  /**
   * Which headers and proxies `resolveIp` may believe: `headers` names the ones that
   * carry the visitor, `trustedProxies` the addresses whose word you take. Nothing is
   * read from a header by default, so an unset `ip` means `resolveIp` answers with the
   * connection address alone.
   */
  ip?: FraudIpOptions;
}

/** Default messages of the plugin codes; `localizedErrors` translates them */
export const FRAUD_ERROR_MESSAGES = {
  FRAUD_BLOCKED: 'This payment was not accepted. Please contact us or use another payment method.',
  RATE_LIMITED: 'Too many payment attempts from here. Please try again later.',
  BLOCKED_BIN: 'This card is not accepted.',
  AMOUNT_LIMIT: 'This card is not accepted for amounts this high.',
  THREEDS_REQUIRED: 'This payment needs 3D Secure verification.',
  FRAUD_CHALLENGE_FAILED: 'Verification failed. Please try again.',
} as const;

const DEFAULT_OPERATIONS: PaymentOperation[] = [
  'createPayment',
  'initThreeDSPayment',
  'authorize',
  'initThreeDSAuthorize',
];

/** Operations that already are a 3D Secure flow: a `threeDS` verdict cannot ask for more */
const THREE_DS_OPERATIONS: PaymentOperation[] = ['initThreeDSPayment', 'initThreeDSAuthorize'];

const UNITS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function parseDuration(value: string | number, what: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      throw new ConfigurationError(`fraudRules: ${what} must be positive, got ${value}`);
    }
    return value;
  }
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new ConfigurationError(
      `fraudRules: invalid ${what} '${value}'. Use milliseconds or '30s', '10m', '1h', '1d'.`
    );
  }
  return Math.round(Number(match[1]) * UNITS[match[2]]);
}

/** Digits of a card number, held in a local variable: never a field of a context */
function panDigits(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 13 && digits.length <= 19 ? digits : undefined;
}

/** Digits of a BIN or BIN range bound */
function binDigits(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 8 ? digits : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function amountOf(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Bytes of a dotted quad, `undefined` for anything else */
function ipv4Bytes(value: string): number[] | undefined {
  const match = IPV4.exec(value);
  if (!match) return undefined;
  const bytes = [match[1], match[2], match[3], match[4]].map(Number);
  return bytes.every((byte) => byte <= 255) ? bytes : undefined;
}

/** An address as the counter sees it: no brackets, no `::ffff:` prefix, no whitespace */
export function normalizeIp(value: unknown): string | undefined {
  const raw = text(value)
    ?.replace(/^\[|\]$/g, '')
    .toLowerCase();
  if (!raw) return undefined;
  const mapped = /^::ffff:(.+)$/.exec(raw)?.[1] ?? raw;
  if (ipv4Bytes(mapped)) return mapped;
  return mapped.includes(':') && /^[0-9a-f:.]+$/.test(mapped) ? mapped : undefined;
}

/** One entry of `trustedProxies`: an exact address, or an IPv4 range in CIDR notation */
function proxyMatcher(entry: string): (ip: string) => boolean {
  const [range, bits] = entry.trim().split('/');
  const bytes = ipv4Bytes(range.trim());
  const mask = Number(bits);
  if (bytes && bits && Number.isInteger(mask) && mask >= 0 && mask <= 32) {
    const toNumber = (parts: number[]): number =>
      ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
    const base = toNumber(bytes);
    const keep = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
    return (ip) => {
      const other = ipv4Bytes(ip);
      return other !== undefined && (toNumber(other) & keep) === base;
    };
  }
  const exact = normalizeIp(entry);
  return exact ? (ip) => ip === exact : () => false;
}

/**
 * The visitor address of a request, from the sources you configured.
 *
 * Nothing is trusted by default: `x-forwarded-for` is a header any client can set,
 * so a counter keyed on it is a counter the client chooses. Pass `headers` when
 * your own proxy writes the address, and `trustedProxies` when you can tell that
 * connection from a customer: only then is a header read, and only after the
 * addresses it lists have been checked against your proxies.
 *
 * @example
 * ```ts
 * // behind one known proxy: the leftmost address of x-forwarded-for is the visitor
 * clientIp({ headers: request.headers, socketAddress: socket.remoteAddress }, {
 *   headers: ['x-forwarded-for'],
 *   trustedProxies: ['10.0.0.0/8'],
 * });
 * ```
 */
export function clientIp(
  source: FraudIpSource | undefined,
  options: FraudIpOptions = {}
): string | undefined {
  const socket = normalizeIp(source?.socketAddress);
  const names = (options.headers ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean);
  if (names.length === 0) return socket;
  const trusted = (options.trustedProxies ?? []).map(proxyMatcher);
  // A header written by someone else is only readable from a connection you accept
  if (socket && trusted.length > 0 && !trusted.some((match) => match(socket))) return socket;
  for (const name of names) {
    const header = Object.entries(source?.headers ?? {}).find(
      ([key]) => key.toLowerCase() === name
    );
    if (!header) continue;
    const chain = String(header[1] ?? '')
      .split(',')
      .map((part) => normalizeIp(part))
      .filter((ip): ip is string => ip !== undefined);
    // read from the closest proxy inward: entries a customer appended sit on the left
    for (let index = chain.length - 1; index >= 0; index--) {
      const candidate = chain[index];
      if (!trusted.length || !trusted.some((match) => match(candidate))) return candidate;
    }
  }
  return socket;
}

async function derive(ctx: OperationContext, options: FraudRulesOptions): Promise<FraudContext> {
  const request = (
    ctx.request && typeof ctx.request === 'object' ? ctx.request : {}
  ) as PaymentRequest;
  const buyer = request.buyer as Partial<PaymentRequest['buyer']> | undefined;
  const digits = panDigits(request.paymentCard?.cardNumber);
  // The address of the HTTP request when the app hands one over, `buyer.ip` otherwise.
  // A header is only ever read through `clientIp`, which trusts nothing by default.
  const ip =
    (options.resolveIp ? clientIp(await options.resolveIp(ctx), options.ip) : undefined) ??
    normalizeIp(buyer?.ip);
  return {
    operation: ctx.operation,
    provider: ctx.provider,
    request,
    bin: digits ? digits.slice(0, 6) : undefined,
    prefix: digits ? digits.slice(0, 8) : undefined,
    last4: digits ? digits.slice(-4) : undefined,
    maskedCard: digits
      ? `${digits.slice(0, 6)}${'*'.repeat(digits.length - 10)}${digits.slice(-4)}`
      : undefined,
    email: text(buyer?.email)?.toLowerCase(),
    ip,
    buyerId: text(buyer?.id),
    amount: amountOf(request.paidPrice ?? request.price),
    currency: text(request.currency),
    installment: typeof request.installment === 'number' ? request.installment : undefined,
    conversationId: text(request.conversationId),
  };
}

interface Trigger {
  code: string;
  verdict: FraudVerdict;
  message?: string;
  key: string;
  count: number;
}

/**
 * Fraud rules and card-testing protection: counts attempts per IP, BIN, card,
 * email or buyer inside a window, blocks BIN ranges and amounts, flags one buyer
 * trying several cards, and refuses a payment **before** the provider is called.
 *
 * A refusal is an ordinary failure result (`status: 'failure'`,
 * `code: FRAUD_SUSPECTED`, plus the rule's `errorCode`), so it is never reported
 * as success and never retried. It emits the `payment.failed` event like any
 * other decline, which is where alerts and the audit log read it.
 *
 * Provider callbacks and 3D Secure completions are never guarded: refusing one
 * would strand a payment the customer already finished at the bank. This plugin
 * is the state over attempts; a token check on the form and an HTTP throttle on
 * the endpoint are separate layers, and `clientIp` covers the address both
 * of them need.
 *
 * @example
 * ```ts
 * import { fraudRules } from 'better-payment/fraud';
 *
 * const payment = betterPayment({
 *   providers: { ... },
 *   plugins: [
 *     fraudRules({
 *       salt: process.env.FRAUD_SALT!,
 *       velocity: [
 *         { key: 'ip', max: 5, window: '10m' },
 *         { key: 'card', max: 3, window: '1h' },
 *         { key: 'buyer', distinct: 'card', max: 3, window: '30m' },
 *         { key: 'ip', max: 3, window: '1h', on: 'declined' },
 *       ],
 *       blockBins: ['552879', ['400000', '400002']],
 *       maxAmount: 50_000,
 *       rules: [(ctx) => Number(ctx.request.price) > 50_000 && 'AMOUNT_LIMIT'],
 *     }),
 *   ],
 * });
 * ```
 */
export const fraudRules = (options: FraudRulesOptions = {}) => {
  const operations = new Set<PaymentOperation>(options.operations ?? DEFAULT_OPERATIONS);
  // A callback carries the outcome of a payment the customer already finished at
  // the bank: refusing it loses money instead of preventing it.
  if (operations.has('completeThreeDSPayment')) {
    throw new ConfigurationError(
      'fraudRules: completeThreeDSPayment is the provider callback and 3DS completion. ' +
        'Guarding it would strand paid orders, so it can never be blocked.'
    );
  }
  if (operations.size === 0) {
    throw new ConfigurationError('fraudRules: operations must not be empty');
  }

  const defaultWindowMs = parseDuration(options.window ?? '10m', 'window');
  const verdict = options.verdict ?? 'block';
  const store = options.store ?? new MemoryFraudStore();
  const salt = options.salt ?? randomHex(16);
  const codes = new Set<string>(Object.keys(FRAUD_ERROR_MESSAGES));

  const velocity = (options.velocity ?? []).map((rule, index) => {
    if (!Number.isFinite(rule.max) || rule.max < 1) {
      throw new ConfigurationError(
        `fraudRules: velocity rule ${index} needs a max of at least 1, got ${rule.max}`
      );
    }
    if (rule.distinct && !store.distinct) {
      throw new ConfigurationError(
        `fraudRules: velocity rule ${index} counts distinct values, which the store does ` +
          'not support. Implement store.distinct(group, member, windowMs), or drop the rule.'
      );
    }
    return {
      rule,
      windowMs:
        rule.window === undefined ? defaultWindowMs : parseDuration(rule.window, 'rule window'),
      declined: rule.on === 'declined',
      verdict: rule.verdict ?? verdict,
      /** Rule id, so that two rules over the same kind never share a counter */
      id: `${index}:${typeof rule.key === 'function' ? 'custom' : rule.key}`,
    };
  });

  const blockedBins = (options.blockBins ?? []).map((entry) => {
    const bounds = (typeof entry === 'string' ? [entry, entry] : entry).map((b) => binDigits(b));
    if (bounds.some((b) => b === undefined)) {
      throw new ConfigurationError(
        `fraudRules: blocked BIN '${entry}' must be 6 to 8 digits, or a [from, to] range`
      );
    }
    return { from: Number(bounds[0]), to: Number(bounds[1]) };
  });

  const maxAmount = options.maxAmount === undefined ? undefined : amountOf(options.maxAmount);
  if (options.maxAmount !== undefined && maxAmount === undefined) {
    throw new ConfigurationError(`fraudRules: invalid maxAmount '${options.maxAmount}'`);
  }

  let logger: BetterPaymentLogger | undefined;

  /** Salted digest of an identity: the only form the store ever sees */
  const tag = async (value: string): Promise<string> =>
    toHex(await hmac('SHA-256', salt, value)).slice(0, 16);

  async function valueOf(
    kind: FraudKeyKind,
    ctx: FraudContext,
    digits: string | undefined
  ): Promise<string | undefined> {
    const custom = options.keys?.[kind];
    if (custom) return await custom(ctx);
    if (kind === 'ip') return ctx.ip;
    if (kind === 'email') return ctx.email;
    if (kind === 'buyer') return ctx.buyerId;
    if (kind === 'bin') return ctx.bin;
    if (kind === 'prefix') return ctx.prefix;
    return digits;
  }

  /** The hashed counter value of a grouping key: undefined when the attempt has none */
  const groupOf = async (
    rule: (typeof velocity)[number],
    ctx: FraudContext,
    digits: string | undefined
  ): Promise<string | undefined> => {
    const spec = rule.rule.key;
    const raw =
      typeof spec === 'function' ? text(await spec(ctx)) : await valueOf(spec, ctx, digits);
    return raw === undefined ? undefined : `${rule.id}:${await tag(raw)}`;
  };

  const memberOf = async (
    kind: FraudMemberKind,
    ctx: FraudContext,
    digits: string | undefined
  ): Promise<string | undefined> => {
    if (kind === 'amount') return ctx.amount === undefined ? undefined : `amount:${ctx.amount}`;
    const raw = await valueOf(kind, ctx, digits);
    return raw === undefined ? undefined : `${kind}:${await tag(raw)}`;
  };

  /** Registers every attempt counter and returns the first window it crossed */
  const countAttempts = async (
    ctx: FraudContext,
    digits: string | undefined
  ): Promise<Trigger | undefined> => {
    let first: Trigger | undefined;
    for (const entry of velocity) {
      if (entry.rule.when && !entry.rule.when(ctx)) continue;
      const key = await groupOf(entry, ctx, digits);
      if (key === undefined) continue;
      let count: number;
      if (entry.declined) {
        count = await store.peek(key);
      } else if (entry.rule.distinct) {
        const member = await memberOf(entry.rule.distinct, ctx, digits);
        if (member === undefined) continue;
        count = (await store.distinct!(key, member, entry.windowMs)).count;
      } else {
        count = (await store.hit(key, entry.windowMs)).count;
      }
      const crossed = entry.declined ? count >= entry.rule.max : count > entry.rule.max;
      if (crossed && !first) {
        first = { code: entry.rule.code ?? 'RATE_LIMITED', verdict: entry.verdict, key, count };
      }
    }
    return first;
  };

  const hit = (code: string, out?: FraudRuleHit): Trigger => ({
    code,
    verdict: out?.verdict ?? verdict,
    message: out?.message,
    key: '',
    count: 0,
  });

  /** Blocked BINs, the amount limit, then your own rules */
  const matchRules = async (ctx: FraudContext): Promise<Trigger | undefined> => {
    if (ctx.bin !== undefined) {
      const values = [Number(ctx.bin), ctx.prefix === undefined ? NaN : Number(ctx.prefix)];
      if (blockedBins.some((range) => values.some((v) => v >= range.from && v <= range.to))) {
        return hit('BLOCKED_BIN');
      }
    }
    if (maxAmount !== undefined && ctx.amount !== undefined && ctx.amount > maxAmount) {
      return hit('AMOUNT_LIMIT');
    }
    for (const rule of options.rules ?? []) {
      const out = await rule(ctx);
      if (!out) continue;
      return typeof out === 'string' ? hit(out) : hit(out.code ?? 'FRAUD_BLOCKED', out);
    }
    return undefined;
  };

  const report = async (
    ctx: FraudContext,
    trigger: Trigger,
    outcome: FraudDecision['outcome'],
    challenged = false
  ) => {
    const decision: FraudDecision = {
      code: trigger.code,
      verdict: trigger.verdict,
      outcome,
      challenged,
      key: trigger.key,
      count: trigger.count,
      operation: ctx.operation,
      amount: ctx.amount,
      currency: ctx.currency,
      maskedCard: ctx.maskedCard,
      conversationId: ctx.conversationId,
    };
    // Derived data only: a fraud log line never carries a request body
    logger?.info(`fraudRules: payment ${outcome}`, {
      code: decision.code,
      outcome,
      key: decision.key,
      count: decision.count,
      operation: decision.operation,
    });
    try {
      await options.onDecision?.(decision, ctx);
    } catch (error) {
      logger?.error(
        'fraudRules: onDecision failed',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  };

  const refuse = (trigger: Trigger, code: string) => {
    const message: string | undefined =
      trigger.message ?? FRAUD_ERROR_MESSAGES[code as keyof typeof FRAUD_ERROR_MESSAGES];
    return {
      result: {
        status: PaymentStatus.FAILURE,
        code:
          trigger.verdict === 'threeDS'
            ? PaymentErrorCode.THREEDS_FAILED
            : PaymentErrorCode.FRAUD_SUSPECTED,
        errorCode: code,
        errorMessage: message ?? FRAUD_ERROR_MESSAGES.FRAUD_BLOCKED,
      },
    };
  };

  const decide = async (ctx: FraudContext, trigger: Trigger) => {
    if (trigger.verdict === 'flag') {
      await report(ctx, trigger, 'flagged');
      return;
    }
    if (trigger.verdict === 'threeDS' && THREE_DS_OPERATIONS.includes(ctx.operation)) {
      await report(ctx, trigger, 'allowed');
      return;
    }
    if (trigger.verdict === 'block' && options.challenge) {
      let cleared = false;
      try {
        cleared = await options.challenge(ctx);
      } catch {
        cleared = false;
      }
      await report(ctx, trigger, cleared ? 'allowed' : 'blocked', cleared);
      return cleared ? undefined : refuse(trigger, 'FRAUD_CHALLENGE_FAILED');
    }
    await report(ctx, trigger, 'blocked');
    return refuse(trigger, trigger.verdict === 'threeDS' ? 'THREEDS_REQUIRED' : trigger.code);
  };

  return definePlugin({
    id: 'fraud-rules',
    options: { operations: [...operations], verdict, window: options.window },
    $ERROR_CODES: { ...FRAUD_ERROR_MESSAGES },
    init: (ctx) => {
      logger = ctx.logger;
    },
    hooks: {
      before: [
        {
          matcher: (ctx: OperationContext) => operations.has(ctx.operation),
          handler: async (ctx) => {
            const attempt = await derive(ctx, options);
            const digits = panDigits(attempt.request.paymentCard?.cardNumber);
            const breach = await countAttempts(attempt, digits);
            const trigger = breach ?? (await matchRules(attempt));
            if (trigger === undefined) return;
            return decide(attempt, trigger);
          },
        },
      ],
      after: [
        {
          // Declines the provider made, for guarded operations only. A refusal by
          // this plugin carries one of its codes and is not an issuer decline.
          matcher: (ctx: OperationResultContext) => {
            if (!velocity.some((entry) => entry.declined)) return false;
            if (!operations.has(ctx.operation)) return false;
            const result = ctx.result as { status?: PaymentStatus; errorCode?: string } | undefined;
            return (
              result?.status === PaymentStatus.FAILURE &&
              !(typeof result.errorCode === 'string' && codes.has(result.errorCode))
            );
          },
          handler: async (ctx) => {
            const attempt = await derive(ctx, options);
            const digits = panDigits(attempt.request.paymentCard?.cardNumber);
            for (const entry of velocity) {
              if (!entry.declined || (entry.rule.when && !entry.rule.when(attempt))) continue;
              const key = await groupOf(entry, attempt, digits);
              if (key === undefined) continue;
              await store.hit(key, entry.windowMs);
            }
          },
        },
      ],
    },
    methods: () => ({
      fraud: {
        /** The counter backend */
        store,
        /** Drops one counter key, or every counter of this plugin */
        reset: (key?: string) => store.reset?.(key),
      },
    }),
  });
};
