import { describe, it, expect, vi } from 'vitest';
import {
  betterPayment,
  ConfigurationError,
  PaymentErrorCode,
  PaymentStatus,
  type PaymentRequest,
  type ThreeDSPaymentRequest,
} from 'better-payment';
import { MOCK_CARDS, MockProvider } from 'better-payment/testing';
import { localizedErrors } from 'better-payment/plugins';
import {
  fraudRules,
  MemoryFraudStore,
  clientIp,
  normalizeIp,
  type FraudDecision,
  type FraudIpOptions,
  type FraudIpSource,
  type FraudStore,
  type FraudWindow,
} from 'better-payment/fraud';
import {
  mockPaymentRequest,
  mockPaymentCard,
  mockThreeDSPaymentRequest,
} from '../../fixtures/payment-data';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function request(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return { ...mockPaymentRequest, ...overrides };
}

function cardRequest(cardNumber: string, overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return request({
    paymentCard: { ...mockPaymentCard, cardNumber },
    ...overrides,
  });
}

function threeDsRequest(overrides: Partial<ThreeDSPaymentRequest> = {}): ThreeDSPaymentRequest {
  return { ...mockThreeDSPaymentRequest, ...overrides };
}

function setup(options: Parameters<typeof fraudRules>[0]) {
  const provider = new MockProvider();
  const spies = {
    createPayment: vi.spyOn(provider, 'createPayment'),
    initThreeDSPayment: vi.spyOn(provider, 'initThreeDSPayment'),
    completeThreeDSPayment: vi.spyOn(provider, 'completeThreeDSPayment'),
    authorize: vi.spyOn(provider, 'authorize'),
    refund: vi.spyOn(provider, 'refund'),
    cancel: vi.spyOn(provider, 'cancel'),
    getPayment: vi.spyOn(provider, 'getPayment'),
  };
  const payment = betterPayment({
    providers: { mock: provider },
    defaultProvider: 'mock',
    mode: 'sandbox',
    plugins: [fraudRules(options)],
  });
  return { payment, provider, ...spies };
}

/** Every string a store, a logger or a callback ever received, flattened into digit runs */
function digitRuns(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    found.push(...(value.match(/\d{13,}/g) ?? []));
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) digitRuns(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) digitRuns(item, found);
  }
  return found;
}

/** The private maps of the default store, so a test can read what it actually holds */
interface MemoryInternals {
  windows: Map<string, FraudWindow>;
  groups: Map<string, { members: Set<string>; resetAt: number }>;
}

function memoryInternals(store: MemoryFraudStore): MemoryInternals {
  return store as unknown as MemoryInternals;
}

class RecordingStore implements FraudStore {
  readonly hits: [string, number][] = [];
  readonly peeks: string[] = [];
  readonly distincts: [string, string][] = [];

  hit(key: string, windowMs: number): FraudWindow {
    this.hits.push([key, windowMs]);
    return { count: this.hits.filter(([name]) => name === key).length, resetAt: 0 };
  }

  peek(key: string): number {
    this.peeks.push(key);
    return this.hits.filter(([name]) => name === key).length;
  }

  distinct(group: string, member: string): FraudWindow {
    this.distincts.push([group, member]);
    const seen = new Set(
      this.distincts.filter(([name]) => name === group).map(([, memberKey]) => memberKey)
    );
    return { count: seen.size, resetAt: 0 };
  }
}

describe('fraudRules', () => {
  describe('velocity rules', () => {
    it('blocks the attempt after the window limit, without calling the provider', async () => {
      const { payment, createPayment } = setup({
        velocity: [{ key: 'ip', max: 2, window: '10m' }],
      });

      expect((await payment.createPayment(request())).status).toBe(PaymentStatus.SUCCESS);
      expect((await payment.createPayment(request())).status).toBe(PaymentStatus.SUCCESS);

      const blocked = await payment.createPayment(request());
      expect(blocked.status).toBe(PaymentStatus.FAILURE);
      expect(blocked.status).not.toBe(PaymentStatus.SUCCESS);
      expect(blocked.code).toBe(PaymentErrorCode.FRAUD_SUSPECTED);
      expect(blocked.errorCode).toBe('RATE_LIMITED');
      expect(blocked.errorMessage).toBeTruthy();
      // two attempts reached the provider, the block did not, and nothing retried
      expect(createPayment).toHaveBeenCalledTimes(2);

      expect((await payment.createPayment(request())).errorCode).toBe('RATE_LIMITED');
      expect(createPayment).toHaveBeenCalledTimes(2);
    });

    it('lets the next attempt through once the window passed', async () => {
      const { payment, createPayment } = setup({
        velocity: [{ key: 'ip', max: 1, window: '120ms' }],
      });
      expect((await payment.createPayment(request())).status).toBe(PaymentStatus.SUCCESS);
      expect((await payment.createPayment(request())).status).toBe(PaymentStatus.FAILURE);
      await sleep(200);
      expect((await payment.createPayment(request())).status).toBe(PaymentStatus.SUCCESS);
      expect(createPayment).toHaveBeenCalledTimes(2);
    });

    it('counts attempts per key, so one buyer cannot exhaust another window', async () => {
      const { payment, createPayment } = setup({ velocity: [{ key: 'card', max: 1 }] });

      expect((await payment.createPayment(cardRequest(MOCK_CARDS.SUCCESS))).status).toBe(
        PaymentStatus.SUCCESS
      );
      expect((await payment.createPayment(cardRequest(MOCK_CARDS.SUCCESS))).status).toBe(
        PaymentStatus.FAILURE
      );
      // another card, same IP and buyer: its own counter
      expect((await payment.createPayment(cardRequest(MOCK_CARDS.SUCCESS_MASTERCARD))).status).toBe(
        PaymentStatus.SUCCESS
      );

      const byIp = setup({
        velocity: [{ key: 'ip', max: 1 }],
      });
      expect((await byIp.payment.createPayment(request())).status).toBe(PaymentStatus.SUCCESS);
      expect((await byIp.payment.createPayment(request())).status).toBe(PaymentStatus.FAILURE);
      expect(
        (
          await byIp.payment.createPayment(
            request({ buyer: { ...mockPaymentRequest.buyer, ip: '85.34.78.113' } })
          )
        ).status
      ).toBe(PaymentStatus.SUCCESS);
      expect(createPayment).toHaveBeenCalledTimes(2);
      expect(byIp.createPayment).toHaveBeenCalledTimes(2);
    });

    it('keeps two rules over the same kind in separate windows', async () => {
      const store = new RecordingStore();
      const { payment } = setup({
        store,
        velocity: [
          { key: 'ip', max: 5, code: 'IP_LIMIT' },
          { key: 'ip', max: 1, code: 'OTHER_IP_LIMIT' },
        ],
      });

      expect((await payment.createPayment(request())).status).toBe(PaymentStatus.SUCCESS);
      const second = await payment.createPayment(request());
      expect(second.errorCode).toBe('OTHER_IP_LIMIT');
      // each rule writes its own counter key, prefixed with its index and its kind
      expect(store.hits.map(([key]) => key.replace(/:[0-9a-f]{16}$/, ''))).toEqual([
        '0:ip',
        '1:ip',
        '0:ip',
        '1:ip',
      ]);
      for (const [key] of store.hits) expect(key).toMatch(/^\d:ip:[0-9a-f]{16}$/);
    });

    it('counts declines of the provider, and never its own refusals', async () => {
      const store = new RecordingStore();
      const { payment, createPayment } = setup({
        store,
        velocity: [{ key: 'ip', max: 2, window: '1h', on: 'declined' }],
      });

      for (let i = 0; i < 2; i++) {
        const declined = await payment.createPayment(
          cardRequest(MOCK_CARDS.CARD_DECLINED, { paidPrice: '1', price: '1' })
        );
        expect(declined.code).toBe(PaymentErrorCode.CARD_DECLINED);
      }
      expect(store.hits.filter(([key]) => key.startsWith('0:ip:'))).toHaveLength(2);

      const blocked = await payment.createPayment(request());
      expect(blocked.status).toBe(PaymentStatus.FAILURE);
      expect(blocked.errorCode).toBe('RATE_LIMITED');
      expect(createPayment).toHaveBeenCalledTimes(2);
      // the refusal added no decline: only the two issuer declines are recorded
      expect(store.hits.filter(([key]) => key.startsWith('0:ip:'))).toHaveLength(2);
    });

    it('counts different cards of one buyer, and an amount ladder', async () => {
      const cards = setup({
        velocity: [{ key: 'buyer', distinct: 'card', max: 2, window: '30m' }],
      });
      expect((await cards.payment.createPayment(cardRequest(MOCK_CARDS.SUCCESS))).status).toBe(
        PaymentStatus.SUCCESS
      );
      expect(
        (await cards.payment.createPayment(cardRequest(MOCK_CARDS.SUCCESS_MASTERCARD))).status
      ).toBe(PaymentStatus.SUCCESS);
      // the same card again is not a new card, the third one is
      expect((await cards.payment.createPayment(cardRequest(MOCK_CARDS.SUCCESS))).status).toBe(
        PaymentStatus.SUCCESS
      );
      const fourth = await cards.payment.createPayment(cardRequest(MOCK_CARDS.EXPIRED_CARD));
      expect(fourth.status).toBe(PaymentStatus.FAILURE);
      expect(fourth.errorCode).toBe('RATE_LIMITED');

      const ladder = setup({
        velocity: [{ key: 'buyer', distinct: 'amount', max: 3, window: '15m' }],
      });
      for (const paidPrice of ['1.2', '2.5', '3.9']) {
        expect((await ladder.payment.createPayment(request({ paidPrice }))).status).toBe(
          PaymentStatus.SUCCESS
        );
      }
      // three different amounts reached the bank, a fourth one is the ladder
      expect(ladder.createPayment).toHaveBeenCalledTimes(3);
      const probed = await ladder.payment.createPayment(request({ paidPrice: '100.1' }));
      expect(probed.status).toBe(PaymentStatus.FAILURE);
      expect(ladder.createPayment).toHaveBeenCalledTimes(3);
      // a repeat of a known amount does not raise the distinct count
      const repeat = setup({
        velocity: [{ key: 'email', distinct: 'card', max: 2 }],
      });
      await repeat.payment.createPayment(cardRequest(MOCK_CARDS.SUCCESS));
      await repeat.payment.createPayment(cardRequest(MOCK_CARDS.SUCCESS_MASTERCARD));
      expect((await repeat.payment.createPayment(cardRequest(MOCK_CARDS.SUCCESS))).status).toBe(
        PaymentStatus.SUCCESS
      );
    });

    it('applies a rule only when its condition holds', async () => {
      const store = new RecordingStore();
      const { payment, createPayment } = setup({
        store,
        velocity: [{ key: 'ip', max: 1, when: () => false }],
      });
      for (let i = 0; i < 3; i++) {
        expect((await payment.createPayment(request())).status).toBe(PaymentStatus.SUCCESS);
      }
      expect(createPayment).toHaveBeenCalledTimes(3);
      // a rule that never applies never counts
      expect(store.hits).toEqual([]);
    });

    it('exposes the counter store and resets it', async () => {
      const { payment, createPayment } = setup({ velocity: [{ key: 'ip', max: 1 }] });
      await payment.createPayment(request());
      expect((await payment.createPayment(request())).status).toBe(PaymentStatus.FAILURE);
      await payment.fraud.reset();
      expect((await payment.createPayment(request())).status).toBe(PaymentStatus.SUCCESS);
      expect(createPayment).toHaveBeenCalledTimes(2);
      expect(payment.fraud.store).toBeInstanceOf(MemoryFraudStore);
    });
  });

  describe('built-in rules', () => {
    it('refuses an exact BIN and a BIN range with BLOCKED_BIN', async () => {
      const { payment, createPayment } = setup({
        blockBins: ['552879', [MOCK_CARDS.CARD_DECLINED.slice(0, 6), '400001']],
      });
      const blocked = await payment.createPayment(request());
      expect(blocked.status).toBe(PaymentStatus.FAILURE);
      expect(blocked.code).toBe(PaymentErrorCode.FRAUD_SUSPECTED);
      expect(blocked.errorCode).toBe('BLOCKED_BIN');
      expect(blocked.errorMessage).toContain('not accepted');
      expect(createPayment).not.toHaveBeenCalled();

      const ranged = await payment.createPayment(cardRequest(MOCK_CARDS.CARD_DECLINED));
      expect(ranged.errorCode).toBe('BLOCKED_BIN');
      expect(createPayment).not.toHaveBeenCalled();

      // 8 digits are accepted too, for a card prefix
      const prefix = setup({ blockBins: ['55287900'] });
      expect((await prefix.payment.createPayment(request())).errorCode).toBe('BLOCKED_BIN');
      expect(prefix.createPayment).not.toHaveBeenCalled();
    });

    it('refuses an amount above the limit and keeps a valid one', async () => {
      const { payment, createPayment } = setup({ maxAmount: '50000' });
      expect((await payment.createPayment(request({ paidPrice: '49999.99' }))).status).toBe(
        PaymentStatus.SUCCESS
      );
      const big = await payment.createPayment(request({ paidPrice: '50000.01' }));
      expect(big.status).toBe(PaymentStatus.FAILURE);
      expect(big.errorCode).toBe('AMOUNT_LIMIT');
      expect(createPayment).toHaveBeenCalledTimes(1);
    });

    it('runs your own rules, with a code and a verdict of their own', async () => {
      const { payment, createPayment } = setup({
        rules: [
          (ctx) => ctx.currency === 'USD' && 'USD_NOT_ACCEPTED',
          (ctx) => (ctx.installment ?? 0) > 3 && { code: 'LONG_INSTALLMENT', verdict: 'flag' },
        ],
      });
      const usd = await payment.createPayment(request({ currency: 'USD' }));
      expect(usd.status).toBe(PaymentStatus.FAILURE);
      expect(usd.errorCode).toBe('USD_NOT_ACCEPTED');
      expect(usd.errorMessage).toBeTruthy();
      expect(createPayment).not.toHaveBeenCalled();

      expect((await payment.createPayment(request({ installment: 2 }))).status).toBe(
        PaymentStatus.SUCCESS
      );
      expect(createPayment).toHaveBeenCalledTimes(1);
    });

    it('checks the counters before the rules, so blocked attempts still count', async () => {
      const store = new RecordingStore();
      const { payment } = setup({
        store,
        blockBins: ['552879'],
        velocity: [{ key: 'ip', max: 9 }],
      });
      expect((await payment.createPayment(request())).errorCode).toBe('BLOCKED_BIN');
      expect((await payment.createPayment(request())).errorCode).toBe('BLOCKED_BIN');
      // a refused attempt still leaves its mark on the window
      expect(store.hits.length).toBe(2);
      expect(store.hits.every(([key]) => key.startsWith('0:ip:'))).toBe(true);
    });
  });

  describe('verdicts', () => {
    it('flags instead of blocking when the verdict is flag', async () => {
      const decisions: FraudDecision[] = [];
      const { payment, createPayment } = setup({
        verdict: 'flag',
        maxAmount: 10,
        onDecision: (decision) => decisions.push(decision),
      });
      const result = await payment.createPayment(request({ paidPrice: '999' }));
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(createPayment).toHaveBeenCalledTimes(1);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        code: 'AMOUNT_LIMIT',
        verdict: 'flag',
        outcome: 'flagged',
      });
    });

    it('requires 3D Secure on a non-3DS payment and accepts one that already has it', async () => {
      const { payment, createPayment, initThreeDSPayment } = setup({
        verdict: 'threeDS',
        maxAmount: 10,
      });

      const refused = await payment.createPayment(request({ paidPrice: '999' }));
      expect(refused.status).toBe(PaymentStatus.FAILURE);
      expect(refused.code).toBe(PaymentErrorCode.THREEDS_FAILED);
      expect(refused.errorCode).toBe('THREEDS_REQUIRED');
      expect(createPayment).not.toHaveBeenCalled();

      const threeDs = await payment.initThreeDSPayment(threeDsRequest({ paidPrice: '999' }));
      expect(threeDs.status).toBe(PaymentStatus.PENDING);
      expect(initThreeDSPayment).toHaveBeenCalledTimes(1);
    });

    it('clears a block with the challenge hook, and fails closed', async () => {
      const decisions: FraudDecision[] = [];
      let accept = false;
      const { payment, createPayment } = setup({
        maxAmount: 10,
        challenge: () => accept,
        onDecision: (decision) => decisions.push(decision),
      });

      const refused = await payment.createPayment(request({ paidPrice: '999' }));
      expect(refused.status).toBe(PaymentStatus.FAILURE);
      expect(refused.errorCode).toBe('FRAUD_CHALLENGE_FAILED');
      expect(createPayment).not.toHaveBeenCalled();

      accept = true;
      expect((await payment.createPayment(request({ paidPrice: '999' }))).status).toBe(
        PaymentStatus.SUCCESS
      );
      expect(createPayment).toHaveBeenCalledTimes(1);
      expect(decisions.map((d) => [d.outcome, d.challenged])).toEqual([
        ['blocked', false],
        ['allowed', true],
      ]);

      const broken = setup({ maxAmount: 10, challenge: () => Promise.reject(new Error('down')) });
      expect((await broken.payment.createPayment(request({ paidPrice: '999' }))).errorCode).toBe(
        'FRAUD_CHALLENGE_FAILED'
      );
      expect(broken.createPayment).not.toHaveBeenCalled();
    });

    it('reports the rule message when one is given', async () => {
      const { payment } = setup({
        rules: [(ctx) => ctx.ip === '85.34.78.112' && { code: 'TEST_IP', message: 'Nope.' }],
      });
      const result = await payment.createPayment(request());
      expect(result.errorCode).toBe('TEST_IP');
      expect(result.errorMessage).toBe('Nope.');
    });
  });

  describe('callbacks and 3D Secure completion', () => {
    it('cannot be pointed at the provider callback', () => {
      expect(() => fraudRules({ operations: ['completeThreeDSPayment'] })).toThrow(
        ConfigurationError
      );
      expect(() => fraudRules({ operations: ['createPayment', 'completeThreeDSPayment'] })).toThrow(
        /strand paid orders/
      );
    });

    it('never blocks a 3DS completion, even over every limit', async () => {
      const { payment, completeThreeDSPayment } = setup({
        velocity: [{ key: 'ip', max: 1 }],
        blockBins: ['552879'],
        maxAmount: 1,
      });
      await payment.initThreeDSPayment(threeDsRequest());
      expect((await payment.initThreeDSPayment(threeDsRequest())).status).toBe(
        PaymentStatus.FAILURE
      );

      const callback = await payment.completeThreeDSPayment({
        paymentId: 'PAY-1',
        mdStatus: '1',
        signature: 'forged',
        paymentCard: mockPaymentCard,
        buyer: mockPaymentRequest.buyer,
        paidPrice: '9999',
      });
      expect(completeThreeDSPayment).toHaveBeenCalledTimes(1);
      expect(callback.errorCode).toBe('INVALID_HASH');
      expect(callback.errorMessage).not.toContain('fraud');
    });

    it('guards only the operations it is given', async () => {
      const { payment, authorize, createPayment } = setup({
        operations: ['authorize'],
        blockBins: ['552879'],
      });
      const authorized = await payment.authorize(request());
      expect(authorized.errorCode).toBe('BLOCKED_BIN');
      expect(authorize).not.toHaveBeenCalled();
      expect((await payment.createPayment(request())).status).toBe(PaymentStatus.SUCCESS);
      expect(createPayment).toHaveBeenCalledTimes(1);
    });

    it('does not touch refunds, cancels or queries', async () => {
      const { payment, refund, cancel, getPayment, createPayment } = setup({
        velocity: [{ key: 'ip', max: 1 }],
        maxAmount: 5000,
      });
      const paid = await payment.createPayment(request());
      expect(paid.status).toBe(PaymentStatus.SUCCESS);
      // the guard is armed: the same IP is already blocked for a second payment
      expect((await payment.createPayment(request())).errorCode).toBe('RATE_LIMITED');

      const other = await payment.createPayment(
        request({ buyer: { ...mockPaymentRequest.buyer, ip: '85.34.78.119' } })
      );
      expect(other.status).toBe(PaymentStatus.SUCCESS);

      const refunded = await payment.refund({
        paymentId: paid.paymentId!,
        price: '0.5',
        currency: 'TRY',
        ip: '85.34.78.112',
      });
      expect(refunded.status).toBe(PaymentStatus.SUCCESS);
      expect((await payment.getPayment(paid.paymentId!)).status).toBe(PaymentStatus.SUCCESS);
      const cancelled = await payment.cancel({
        paymentId: other.paymentId!,
        ip: '85.34.78.119',
      });
      expect(cancelled.status).toBe(PaymentStatus.SUCCESS);
      // every one of them reached the provider: none was refused as fraud
      expect(refund).toHaveBeenCalledTimes(1);
      expect(getPayment).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledTimes(1);
      // the two allowed payments, not the blocked one
      expect(createPayment).toHaveBeenCalledTimes(2);
    });
  });

  describe('pluggable store', () => {
    it('uses the store it is given instead of memory', async () => {
      const store = new RecordingStore();
      const { payment } = setup({
        store,
        velocity: [
          { key: 'ip', max: 1 },
          { key: 'buyer', distinct: 'card', max: 5 },
          { key: 'email', max: 1, on: 'declined' },
        ],
      });
      await payment.createPayment(request());
      expect(store.hits.length).toBeGreaterThan(0);
      expect(store.distincts.length).toBe(1);
      expect(store.peeks.length).toBe(1);
      expect(payment.fraud.store).toBe(store);
    });

    it('rejects a distinct rule a store cannot serve', () => {
      const store: FraudStore = { hit: () => ({ count: 0, resetAt: 0 }), peek: () => 0 };
      expect(() =>
        fraudRules({ store, velocity: [{ key: 'buyer', distinct: 'card', max: 1 }] })
      ).toThrow(/does\s?n.t support/);
    });

    it('derives stable keys from a shared salt, so instances share one window', async () => {
      const store = new MemoryFraudStore();
      const make = (salt: string) =>
        betterPayment({
          providers: { mock: new MockProvider() },
          defaultProvider: 'mock',
          mode: 'sandbox',
          plugins: [fraudRules({ salt, store, velocity: [{ key: 'ip', max: 1 }] })],
        });

      const first = make('same-salt');
      const second = make('same-salt');
      expect((await first.createPayment(request())).status).toBe(PaymentStatus.SUCCESS);
      expect((await second.createPayment(request())).status).toBe(PaymentStatus.FAILURE);

      const other = make('other-salt');
      expect((await other.createPayment(request())).status).toBe(PaymentStatus.SUCCESS);
    });

    it('caps the in-memory store so rotating identities cannot grow it forever', async () => {
      const store = new MemoryFraudStore(4);
      for (let i = 0; i < 50; i++) {
        store.hit(`0:ip:${i}`, 60_000);
        store.distinct?.('1:buyer:x', `card:${i}`, 60_000);
      }
      const internals = memoryInternals(store);
      expect(internals.windows.size + internals.groups.size).toBeLessThanOrEqual(4);
      expect(store.peek('0:ip:0')).toBe(0);
      expect(store.peek('0:ip:49')).toBe(1);
      store.reset();
      expect(internals.windows.size).toBe(0);
      expect(internals.groups.size).toBe(0);
    });
  });

  describe('card data never leaves the attempt', () => {
    it('keeps a full PAN out of the store, the log, the decisions and the result', async () => {
      const pan = MOCK_CARDS.SUCCESS;
      const store = new RecordingStore();
      const logged: unknown[] = [];
      const logger = {
        debug: (message: string, meta?: Record<string, unknown>) => logged.push([message, meta]),
        info: (message: string, meta?: Record<string, unknown>) => logged.push([message, meta]),
        error: (message: string, error?: Error, meta?: Record<string, unknown>) =>
          logged.push([message, error?.message, meta]),
      };
      const decisions: FraudDecision[] = [];

      const payment = betterPayment({
        providers: { mock: new MockProvider() },
        defaultProvider: 'mock',
        mode: 'sandbox',
        logger,
        plugins: [
          fraudRules({
            salt: 'test-salt',
            store,
            blockBins: ['552879'],
            maxAmount: 5,
            velocity: [
              { key: 'ip', max: 1 },
              { key: 'card', max: 1 },
              { key: 'buyer', distinct: 'card', max: 1 },
              { key: 'email', max: 1, on: 'declined' },
              { key: 'bin', max: 1 },
              { key: 'prefix', max: 1 },
            ],
            rules: [(ctx) => ctx.maskedCard === undefined && 'NO_CARD'],
            onDecision: (decision) => decisions.push(decision),
          }),
        ],
      });

      const results = [];
      for (let i = 0; i < 3; i++) results.push(await payment.createPayment(cardRequest(pan)));
      results.push(await payment.createPayment(request()));
      results.push(await payment.initThreeDSPayment(threeDsRequest({ paidPrice: '99' })));

      // refused, and never reported as a success that was not earned
      expect(results.some((r) => r.status === PaymentStatus.FAILURE)).toBe(true);
      for (const result of results) {
        expect(digitRuns(result)).toEqual([]);
        expect(JSON.stringify(result)).not.toContain(pan);
      }

      const watched: unknown[] = [store.hits, store.peeks, store.distincts, logged, decisions];
      expect(digitRuns(watched)).toEqual([]);
      for (const [key] of store.hits) expect(key).toMatch(/^\d+:\w+:[0-9a-f]{16}$/);
      for (const [, member] of store.distincts) expect(member).toMatch(/^\w+:[0-9a-f]{16}$/);

      // the default store keeps nothing but rule ids and digests
      const memory = new MemoryFraudStore();
      const guarded = betterPayment({
        providers: { mock: new MockProvider() },
        defaultProvider: 'mock',
        mode: 'sandbox',
        plugins: [
          fraudRules({ salt: 'test-salt', store: memory, velocity: [{ key: 'card', max: 5 }] }),
        ],
      });
      await guarded.createPayment(cardRequest(pan));
      const internals = JSON.parse(
        JSON.stringify({
          windows: [...memoryInternals(memory).windows.keys()],
          groups: [...memoryInternals(memory).groups.keys()],
          members: [...memoryInternals(memory).groups.values()].map((entry) => [...entry.members]),
        })
      );
      expect(digitRuns(internals)).toEqual([]);
      expect(JSON.stringify(internals)).not.toContain(pan);
      expect(internals.windows).toHaveLength(1);
      expect(String(internals.windows[0])).toMatch(/^\d+:\w+:[0-9a-f]{16}$/);
      expect(internals.members).toEqual([]);
    });

    it('only hands rules masked card data', async () => {
      const seen: (string | undefined)[] = [];
      const { payment } = setup({
        rules: [
          (ctx) => {
            seen.push(ctx.maskedCard, ctx.bin, ctx.prefix, ctx.last4);
            return false;
          },
        ],
      });
      await payment.createPayment(cardRequest(MOCK_CARDS.SUCCESS));
      expect(seen).toEqual(['424242******4242', '424242', '42424242', '4242']);
    });
  });

  describe('the visitor address', () => {
    const chain = { 'x-forwarded-for': '203.0.113.7, 10.0.0.9' };

    it('reads no header until the app names one', () => {
      // the address the connection arrived on is the only source by default
      expect(clientIp({ headers: chain, socketAddress: '10.0.0.9' })).toBe('10.0.0.9');
      expect(clientIp({ headers: chain })).toBeUndefined();
      // a proxy list on its own opens no header either
      expect(
        clientIp({ headers: chain, socketAddress: '10.0.0.9' }, { trustedProxies: ['10.0.0.0/8'] })
      ).toBe('10.0.0.9');
      // an unparseable address is no address
      expect(normalizeIp('999.1.1.1')).toBeUndefined();
      expect(normalizeIp('example.com')).toBeUndefined();
      expect(normalizeIp('[2001:DB8::1]')).toBe('2001:db8::1');
      expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    });

    it('reads the address from a declared header, closest proxy inward', () => {
      const options: FraudIpOptions = {
        headers: ['x-forwarded-for'],
        trustedProxies: ['10.0.0.0/8'],
      };
      // our own proxy wrote the last entry, so the visitor is the one before it
      expect(clientIp({ headers: chain, socketAddress: '10.0.0.9' }, options)).toBe('203.0.113.7');
      // every hop we trust: the leftmost address is the visitor after all
      expect(
        clientIp(
          {
            headers: { 'x-forwarded-for': '8.8.8.8, 203.0.113.7, 10.0.0.9' },
            socketAddress: '10.0.0.9',
          },
          { headers: ['x-forwarded-for'], trustedProxies: ['10.0.0.0/8', '203.0.113.7'] }
        )
      ).toBe('8.8.8.8');
      // a request that did not arrive from a trusted proxy keeps its own address
      expect(clientIp({ headers: chain, socketAddress: '198.51.100.4' }, options)).toBe(
        '198.51.100.4'
      );
      // header names are matched case insensitively, junk entries skipped
      expect(
        clientIp(
          { headers: { 'X-Forwarded-For': '203.0.113.7' } },
          { headers: ['x-forwarded-for'] }
        )
      ).toBe('203.0.113.7');
      expect(
        clientIp(
          { headers: { 'x-forwarded-for': 'unknown, 203.0.113.7' } },
          { headers: ['x-forwarded-for'] }
        )
      ).toBe('203.0.113.7');
      expect(
        clientIp({ headers: { 'x-forwarded-for': 'unknown' } }, { headers: ['x-forwarded-for'] })
      ).toBeUndefined();
      // the first header that carries an address wins
      expect(
        clientIp(
          { headers: { 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.4' } },
          { headers: ['x-real-ip', 'x-forwarded-for'] }
        )
      ).toBe('203.0.113.7');
    });

    it('keys the counter on the request address, and hashes it like every other key', async () => {
      let http: FraudIpSource = {
        headers: { 'x-forwarded-for': '1.1.1.1' },
        socketAddress: '10.0.0.9',
      };
      const build = (ip?: FraudIpOptions) => {
        const store = new RecordingStore();
        const payment = betterPayment({
          providers: { mock: new MockProvider() },
          defaultProvider: 'mock',
          mode: 'sandbox',
          plugins: [
            fraudRules({
              salt: 'test-salt',
              store,
              resolveIp: () => http,
              ip,
              velocity: [{ key: 'ip', max: 1 }],
            }),
          ],
        });
        return { store, payment };
      };

      // not configured: the customer cannot pick the counter by writing the header
      const trusting = build();
      expect((await trusting.payment.createPayment(request())).status).toBe(PaymentStatus.SUCCESS);
      http = { headers: { 'x-forwarded-for': '2.2.2.2' }, socketAddress: '10.0.0.9' };
      expect((await trusting.payment.createPayment(request())).errorCode).toBe('RATE_LIMITED');
      expect(new Set(trusting.store.hits.map(([key]) => key)).size).toBe(1);
      for (const [key] of trusting.store.hits) {
        expect(key).not.toContain('1.1.1.1');
        expect(key).not.toContain('10.0.0.9');
      }

      // configured: two visitors behind one proxy are two windows
      http = { headers: { 'x-forwarded-for': '1.1.1.1' }, socketAddress: '10.0.0.9' };
      const opted = build({ headers: ['x-forwarded-for'], trustedProxies: ['10.0.0.0/8'] });
      expect((await opted.payment.createPayment(request())).status).toBe(PaymentStatus.SUCCESS);
      http = { headers: { 'x-forwarded-for': '2.2.2.2' }, socketAddress: '10.0.0.9' };
      expect((await opted.payment.createPayment(request())).status).toBe(PaymentStatus.SUCCESS);
      expect(new Set(opted.store.hits.map(([key]) => key)).size).toBe(2);

      // a direct connection that is not a proxy cannot inject an address either
      http = { headers: { 'x-forwarded-for': '8.8.8.8' }, socketAddress: '198.51.100.4' };
      const direct = build({ headers: ['x-forwarded-for'], trustedProxies: ['10.0.0.0/8'] });
      expect((await direct.payment.createPayment(request())).status).toBe(PaymentStatus.SUCCESS);
      http = { headers: { 'x-forwarded-for': '9.9.9.9' }, socketAddress: '198.51.100.4' };
      expect((await direct.payment.createPayment(request())).errorCode).toBe('RATE_LIMITED');
    });

    it('derives no ip key from a value that is not an address', async () => {
      const store = new RecordingStore();
      const { payment } = setup({ store, velocity: [{ key: 'ip', max: 1 }] });
      for (const ip of ['not-an-ip', '999.1.1.1', '', 'example.org']) {
        await payment.createPayment(request({ buyer: { ...mockPaymentRequest.buyer, ip } }));
      }
      // nothing counted: a customer who writes junk into the field cannot group
      // their attempts with anyone else's, and cannot get a free window either
      expect(store.hits).toEqual([]);
      expect((await payment.createPayment(request())).status).toBe(PaymentStatus.SUCCESS);
      expect((await payment.createPayment(request())).errorCode).toBe('RATE_LIMITED');
      expect(new Set(store.hits.map(([key]) => key)).size).toBe(1);
      for (const [key] of store.hits) expect(key).toMatch(/^\d:ip:[0-9a-f]{16}$/);
    });
  });

  describe('events and configuration', () => {
    it('emits payment.failed for a refusal and never a success', async () => {
      const failed = vi.fn();
      const succeeded = vi.fn();
      const payment = betterPayment({
        providers: { mock: new MockProvider() },
        defaultProvider: 'mock',
        mode: 'sandbox',
        plugins: [fraudRules({ blockBins: ['552879'] })],
      });
      payment.on('payment.failed', failed);
      payment.on('payment.succeeded', succeeded);

      await payment.createPayment(request());
      expect(failed).toHaveBeenCalledTimes(1);
      expect(succeeded).not.toHaveBeenCalled();
      expect(failed.mock.calls[0][0]).toMatchObject({
        code: PaymentErrorCode.FRAUD_SUSPECTED,
        operation: 'createPayment',
        provider: 'mock',
      });
    });

    it('registers its codes on $ERROR_CODES and lets localizedErrors translate them', async () => {
      const payment = betterPayment({
        providers: { mock: new MockProvider() },
        defaultProvider: 'mock',
        mode: 'sandbox',
        plugins: [
          fraudRules({ blockBins: ['552879'] }),
          localizedErrors({
            locale: 'tr',
            messages: { tr: { RATE_LIMITED: 'Çok fazla deneme yaptınız.' } },
          }),
        ],
      });
      // the codes the issue asks for, with their default English messages
      expect(payment.$ERROR_CODES.FRAUD_BLOCKED).toContain('not accepted');
      expect(payment.$ERROR_CODES.RATE_LIMITED).toContain('Too many payment attempts');
      expect(payment.errors.message('RATE_LIMITED', 'tr')).toBe('Çok fazla deneme yaptınız.');
      expect(payment.errors.message('FRAUD_BLOCKED', 'tr')).toBe(
        payment.$ERROR_CODES.FRAUD_BLOCKED
      );

      const blocked = await payment.createPayment(request());
      expect(blocked.errorCode).toBe('BLOCKED_BIN');
      expect(blocked.errorMessage).toBe(payment.$ERROR_CODES.BLOCKED_BIN);
      expect(blocked.providerMessage).toBe(payment.$ERROR_CODES.BLOCKED_BIN);
    });

    it('keeps onDecision failures from changing the outcome', async () => {
      const { payment } = setup({
        maxAmount: 1,
        onDecision: () => Promise.reject(new Error('alerting is down')),
      });
      expect((await payment.createPayment(request({ paidPrice: '9' }))).status).toBe(
        PaymentStatus.FAILURE
      );
    });

    it('validates its own configuration', () => {
      expect(() => fraudRules({ velocity: [{ key: 'ip', max: 0 }] })).toThrow(ConfigurationError);
      expect(() => fraudRules({ velocity: [{ key: 'ip', max: -1 }] })).toThrow(ConfigurationError);
      expect(() => fraudRules({ window: 'soon' })).toThrow(/invalid window/);
      expect(() => fraudRules({ velocity: [{ key: 'ip', max: 1, window: '1x' }] })).toThrow(
        /invalid rule window/
      );
      expect(() => fraudRules({ blockBins: ['552'] })).toThrow(/6 to 8 digits/);
      expect(() => fraudRules({ maxAmount: 'lots' })).toThrow(/invalid maxAmount/);
      expect(() => fraudRules({ operations: [] })).toThrow(/must not be empty/);
      expect(() =>
        fraudRules({ velocity: [{ key: 'ip', max: 'x' as unknown as number }] })
      ).toThrow(ConfigurationError);
    });

    it('reads a missing card, buyer or amount as no key instead of guessing one', async () => {
      const store = new RecordingStore();
      const { payment, createPayment } = setup({
        store,
        velocity: [
          { key: 'buyer', max: 1 },
          { key: 'ip', max: 1 },
          { key: 'card', max: 1 },
        ],
      });

      // no buyer at all: only the card counter exists, and nothing is blocked
      const anonymous = request({ buyer: undefined as unknown as PaymentRequest['buyer'] });
      expect((await payment.createPayment(anonymous)).status).toBe(PaymentStatus.SUCCESS);
      expect(store.hits.map(([key]) => key.replace(/:[0-9a-f]{16}$/, ''))).toEqual(['2:card']);

      // no card: the provider answers with its own validation error, never a fraud refusal
      const missing = await payment.createPayment({ ...request(), paymentCard: undefined });
      expect(missing.errorCode).toBe('VALIDATION_ERROR');
      expect(missing.errorMessage).not.toContain('fraud');
      expect(createPayment).toHaveBeenCalledTimes(2);
      // the cardless attempt contributed no card counter
      expect(store.hits.filter(([key]) => key.startsWith('2:card'))).toHaveLength(1);
    });
  });
});
