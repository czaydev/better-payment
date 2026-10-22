import { describe, it, expect, vi } from 'vitest';
import {
  betterPayment,
  ConfigurationError,
  PaymentErrorCode,
  PaymentStatus,
  type PaymentOperation,
} from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import {
  routing,
  MemoryRoutingStore,
  type RoutingOptions,
  type RoutingRequest,
  type RoutingStore,
  type RoutingWhen,
} from 'better-payment/routing';
import type { PaymentRequest } from '../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../fixtures/payment-data';

type Req = PaymentRequest & RoutingRequest;

const base = mockPaymentRequest as Req;

function withRequest(overrides: Partial<Req>): Req {
  return { ...base, ...overrides };
}

function setup(options: RoutingOptions = {}, ids: readonly string[] = ['a', 'b']) {
  const providers = Object.fromEntries(ids.map((id) => [id, new MockProvider()]));
  const payment = betterPayment({
    providers,
    defaultProvider: ids[0],
    plugins: [routing(options)],
  });
  return { payment, providers };
}

function manualStore(
  initial: Record<string, string> = {}
): RoutingStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: (key) => data.get(key),
    set: (key, value) => {
      data.set(key, value);
    },
    delete: (key) => {
      data.delete(key);
    },
  };
}

describe('routing: configuration', () => {
  it('works with no options at all and uses the library default provider', async () => {
    const { payment, providers } = setup();
    const decision = await payment.routing.explain(base);

    expect(decision).toMatchObject({
      provider: 'a',
      rule: null,
      ruleIndex: null,
      reason: 'default',
      skipped: [],
    });
    const result = await payment.createPayment(base);
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(providers.a.payments).toHaveLength(1);
  });

  it('uses the only configured provider when no defaultProvider is set', async () => {
    const only = new MockProvider();
    const payment = betterPayment({ providers: { only }, plugins: [routing()] });
    expect(await payment.routing.explain(base)).toMatchObject({
      provider: 'only',
      reason: 'default',
    });
  });

  it('does not guess when there is no default and no eligible rule', async () => {
    const payment = betterPayment({
      providers: { a: new MockProvider(), b: new MockProvider() },
      plugins: [routing()],
    });
    expect(await payment.routing.explain(base)).toMatchObject({
      provider: null,
      reason: 'none',
    });
  });

  it('rejects invalid rules, targets and strategies before the first payment', () => {
    expect(() =>
      routing({ rules: [{ use: 'a', when: { cardType: 'prepaid' as never } }] })
    ).toThrow(ConfigurationError);
    expect(() => routing({ rules: [{ when: {} }] })).toThrow(ConfigurationError);
    expect(() => routing({ rules: [{ strategy: 'missing' }] })).toThrow(ConfigurationError);
    expect(() => routing({ default: { weights: { a: 0, b: 0 } } })).toThrow(ConfigurationError);
    expect(() => routing({ default: { weights: { a: -1, b: 2 } } })).toThrow(ConfigurationError);
    expect(() => routing({ default: [] })).toThrow(ConfigurationError);
    expect(() => routing({ rules: [{ use: 'a', when: { amount: { min: '1,00' } } }] })).toThrow(
      ConfigurationError
    );
    expect(() =>
      routing({ rules: [{ use: 'a', when: { amount: { min: '2', max: '1' } } }] })
    ).toThrow(ConfigurationError);
    expect(() =>
      routing({ rules: [{ use: 'a', when: { installment: { min: 3, max: 2 } } }] })
    ).toThrow(ConfigurationError);
    expect(() => routing({ rules: [{ use: 'a', when: { predicate: 'nope' as never } }] })).toThrow(
      ConfigurationError
    );
    expect(() => routing({ health: { isAvailable: 'nope' as never } })).toThrow(ConfigurationError);
  });

  it('wraps a throwing rule predicate in a ConfigurationError', async () => {
    const { payment } = setup({
      rules: [
        {
          when: {
            predicate: () => {
              throw new Error('boom');
            },
          },
          use: 'a',
        },
      ],
    });
    await expect(payment.routing.explain(base)).rejects.toThrow(ConfigurationError);
  });
});

describe('routing: rule conditions', () => {
  const whenCases: {
    label: string;
    when: RoutingWhen;
    request: Req;
    operation?: PaymentOperation;
  }[] = [
    { label: 'bin prefix', when: { bin: '5528' }, request: withRequest({ binNumber: '552879' }) },
    {
      label: 'bin from the card number',
      when: { bin: '552879' },
      request: withRequest({ paymentCard: base.paymentCard }),
    },
    {
      label: 'bank',
      when: { bank: 'garanti bbva' },
      request: withRequest({ bank: 'Garanti BBVA' }),
    },
    {
      label: 'card family',
      when: { cardFamily: 'bonus' },
      request: withRequest({ cardFamily: 'Bonus' }),
    },
    {
      label: 'card type in any casing',
      when: { cardType: 'debit' },
      request: withRequest({ cardType: 'DEBIT_CARD' }),
    },
    {
      label: 'foreign cards',
      when: { cardOrigin: 'foreign' },
      request: withRequest({ cardOrigin: 'international' }),
    },
    {
      label: 'threeDS by operation',
      when: { threeDS: true },
      request: mockThreeDSPaymentRequest as Req,
      operation: 'initThreeDSPayment',
    },
    {
      label: 'operation',
      when: { operation: 'authorize' },
      request: base,
      operation: 'authorize',
    },
    { label: 'currency', when: { currency: 'usd' }, request: withRequest({ currency: 'USD' }) },
    {
      label: 'exact installment',
      when: { installment: 6 },
      request: withRequest({ installment: 6 }),
    },
    {
      label: 'installment range',
      when: { installment: { min: 2, max: 6 } },
      request: withRequest({ installment: 3 }),
    },
    {
      label: 'amount min',
      when: { amount: { min: '100' } },
      request: withRequest({ price: '100.00' }),
    },
    {
      label: 'amount max',
      when: { amount: { max: '50.00' } },
      request: withRequest({ price: '49.99' }),
    },
    {
      label: 'predicate',
      when: { predicate: (ctx) => Number(ctx.request.price) > 0.5 },
      request: base,
    },
  ];

  it('matches every supported when field', async () => {
    for (const { label, when, request, operation } of whenCases) {
      const { payment } = setup({
        rules: [{ name: label, when, use: 'a' }],
        default: 'b',
      });
      const decision = await payment.routing.explain(
        request,
        operation === undefined ? undefined : { operation }
      );
      expect(decision.provider, label).toBe('a');
    }
  });

  it('requires every set condition to match (AND), and falls back otherwise', async () => {
    const { payment } = setup({
      rules: [
        {
          name: 'bonus installments',
          when: { cardFamily: 'Bonus', installment: { min: 2 }, currency: 'TRY' },
          use: 'a',
        },
      ],
      default: 'b',
    });
    expect(
      (await payment.routing.explain(withRequest({ cardFamily: 'Bonus', installment: 3 }))).provider
    ).toBe('a');
    expect(
      (await payment.routing.explain(withRequest({ cardFamily: 'Bonus', installment: 1 }))).provider
    ).toBe('b');
    expect(
      (await payment.routing.explain(withRequest({ cardFamily: 'World', installment: 3 }))).provider
    ).toBe('b');
    expect(
      (
        await payment.routing.explain(
          withRequest({ cardFamily: 'Bonus', installment: 3, currency: 'USD' })
        )
      ).provider
    ).toBe('b');
  });

  it('does not match an amount condition for an invalid request amount', async () => {
    const { payment } = setup({
      rules: [{ when: { amount: { min: '1' } }, use: 'a' }],
      default: 'b',
    });
    expect((await payment.routing.explain(withRequest({ price: 'not-a-number' }))).provider).toBe(
      'b'
    );
  });
});

describe('routing: BIN data', () => {
  it('classifies the BIN with the injected resolver, never the network', async () => {
    const binResolver = vi.fn(() => ({
      bankName: 'Garanti BBVA',
      cardFamily: 'Bonus',
      cardType: 'CREDIT_CARD',
      cardOrigin: 'domestic',
    }));
    const { payment } = setup({
      binResolver,
      rules: [
        {
          when: {
            bin: '552879',
            bank: 'Garanti BBVA',
            cardFamily: 'Bonus',
            cardType: 'credit',
            cardOrigin: 'domestic',
          },
          use: 'a',
        },
      ],
      default: 'b',
    });

    const decision = await payment.routing.explain(
      withRequest({ paymentCard: { cardNumber: '5528790000000008' } })
    );
    expect(decision.provider).toBe('a');
    expect(binResolver).toHaveBeenCalledWith('55287900');
  });

  it('lets explicit request fields win over the resolver', async () => {
    const { payment } = setup({
      binResolver: () => ({ cardFamily: 'World' }),
      rules: [{ when: { cardFamily: 'Bonus' }, use: 'a' }],
      default: 'b',
    });
    const decision = await payment.routing.explain(
      withRequest({ cardFamily: 'Bonus', binNumber: '552879' })
    );
    expect(decision.provider).toBe('a');
  });

  it('treats a throwing resolver as unknown BIN data instead of failing the payment', async () => {
    const { payment } = setup({
      binResolver: () => {
        throw new Error('lookup down');
      },
      rules: [{ when: { cardFamily: 'Bonus' }, use: 'a' }],
      default: 'b',
    });
    const decision = await payment.routing.explain(
      withRequest({ paymentCard: { cardNumber: '5528790000000008' } })
    );
    expect(decision.provider).toBe('b');
  });
});

describe('routing: rules and targets', () => {
  it('takes the first matching rule in order', async () => {
    const { payment } = setup({
      rules: [
        { name: 'first', when: { currency: 'TRY' }, use: 'a' },
        { name: 'second', when: {}, use: 'b' },
      ],
      default: 'a',
    });
    const decision = await payment.routing.explain(base);
    expect(decision).toMatchObject({
      provider: 'a',
      rule: 'first',
      ruleIndex: 0,
      reason: 'rule',
    });
    expect(decision.detail).toContain('first');
  });

  it('names unnamed rules by index', async () => {
    const { payment } = setup({ rules: [{ when: {}, use: 'a' }], default: 'b' });
    expect(await payment.routing.explain(base)).toMatchObject({ rule: 'rule[0]', ruleIndex: 0 });
  });

  it('moves to the next rule and reports why a provider was skipped', async () => {
    const { payment } = setup({
      rules: [
        { name: 'ghost', when: {}, use: 'ghost' },
        { name: 'second', when: {}, use: 'b' },
      ],
      default: 'a',
    });
    const decision = await payment.routing.explain(base);
    expect(decision).toMatchObject({ provider: 'b', rule: 'second', ruleIndex: 1, reason: 'rule' });
    expect(decision.skipped).toEqual([{ provider: 'ghost', reason: 'not-enabled' }]);
  });

  it('uses the first eligible provider of an ordered list', async () => {
    const { payment } = setup({
      rules: [{ when: {}, use: ['ghost', 'b', 'a'] }],
      default: 'a',
    });
    const decision = await payment.routing.explain(base);
    expect(decision.provider).toBe('b');
    expect(decision.skipped).toEqual([{ provider: 'ghost', reason: 'not-enabled' }]);
  });

  it('skips providers the health hook marks unavailable', async () => {
    const isAvailable = vi.fn((provider: string) => provider !== 'a');
    const { payment } = setup({
      health: { isAvailable },
      rules: [{ when: {}, use: ['a', 'b'] }],
      default: 'a',
    });
    const decision = await payment.routing.explain(base);
    expect(decision).toMatchObject({
      provider: 'b',
      skipped: [{ provider: 'a', reason: 'unhealthy' }],
    });
    expect(isAvailable).toHaveBeenCalledWith('a');
  });

  it('treats a throwing health check as unavailable', async () => {
    const { payment } = setup({
      health: {
        isAvailable: () => {
          throw new Error('health endpoint down');
        },
      },
      default: { weights: { a: 50, b: 50 } },
    });
    const decision = await payment.routing.explain(base);
    expect(decision).toMatchObject({ provider: null, reason: 'none' });
    expect(decision.skipped).toEqual([
      { provider: 'a', reason: 'unhealthy' },
      { provider: 'b', reason: 'unhealthy' },
    ]);
  });

  it('fails a charge before the provider call when health excludes every provider', async () => {
    const { payment, providers } = setup({ health: { isAvailable: () => false }, default: 'a' });
    await expect(payment.createPayment(base)).rejects.toThrow(ConfigurationError);
    expect(providers.a.payments).toHaveLength(0);
    expect(providers.b.payments).toHaveLength(0);
  });

  it('refuses to route after a charge whose provider is no longer enabled', async () => {
    const { payment, providers } = setup({
      store: manualStore({ 'routing:attempt:123456789': 'ghost' }),
      default: 'a',
    });
    await expect(payment.createPayment(base)).rejects.toThrow(ConfigurationError);
    expect(providers.a.payments).toHaveLength(0);
  });
});

describe('routing: weighted splits', () => {
  it('is deterministic for the same order and never uses Math.random', async () => {
    const { payment } = setup({ default: { weights: { a: 70, b: 30 } } });
    const random = vi.spyOn(Math, 'random');
    const first = await payment.routing.explain(withRequest({ conversationId: 'order-42' }));
    const second = await payment.routing.explain(withRequest({ conversationId: 'order-42' }));
    expect(first.provider).toBe(second.provider);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('respects the configured weights across orders', async () => {
    const { payment } = setup({ default: { weights: { a: 70, b: 30 } } });
    let fromA = 0;
    for (let index = 0; index < 5000; index++) {
      const decision = await payment.routing.explain(
        withRequest({ conversationId: `order-${index}` })
      );
      if (decision.provider === 'a') fromA++;
    }
    expect(fromA).toBeGreaterThan(3400);
    expect(fromA).toBeLessThan(3600);
  });

  it('renormalizes the weights over the eligible providers', async () => {
    const { payment } = setup({
      health: { isAvailable: (provider) => provider !== 'a' },
      default: { weights: { a: 70, b: 30 } },
    });
    const decisions = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        payment.routing.explain(withRequest({ conversationId: `order-${index}` }))
      )
    );
    expect(decisions.every((decision) => decision.provider === 'b')).toBe(true);
    expect(decisions[0].skipped).toEqual([{ provider: 'a', reason: 'unhealthy' }]);
  });
});

describe('routing: strategies', () => {
  it('lets a strategy choose among the eligible candidates', async () => {
    const choose = vi.fn((ctx: { candidates: readonly string[] }) => ctx.candidates[1]);
    const { payment } = setup(
      {
        rules: [{ name: 'custom', when: {}, use: ['a', 'b', 'c'], strategy: { choose } }],
        default: 'a',
      },
      ['a', 'b', 'c']
    );
    const decision = await payment.routing.explain(base);
    expect(decision).toMatchObject({
      provider: 'b',
      rule: 'custom',
      ruleIndex: 0,
      reason: 'strategy',
    });
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ candidates: ['a', 'b', 'c'] }));
  });

  it('accepts named strategies and restricts them to the rule target', async () => {
    const { payment } = setup(
      {
        strategies: { second: { choose: ({ candidates }) => candidates[1] } },
        rules: [{ strategy: 'second', use: ['b', 'c'] }],
        default: 'a',
      },
      ['a', 'b', 'c']
    );
    expect(await payment.routing.explain(base)).toMatchObject({
      provider: 'c',
      reason: 'strategy',
    });
  });

  it('removes unhealthy providers before the strategy sees them', async () => {
    const choose = vi.fn((ctx: { candidates: readonly string[] }) => ctx.candidates[1]);
    const { payment } = setup(
      {
        health: { isAvailable: (provider) => provider !== 'b' },
        rules: [{ strategy: { choose } }],
        default: 'a',
      },
      ['a', 'b', 'c']
    );
    expect((await payment.routing.explain(base)).provider).toBe('c');
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ candidates: ['a', 'c'] }));
  });

  it('falls through when a strategy makes no choice and rejects an ineligible one', async () => {
    const { payment } = setup({ rules: [{ strategy: { choose: () => null } }], default: 'a' });
    expect(await payment.routing.explain(base)).toMatchObject({ provider: 'a', reason: 'default' });

    const { payment: bad } = setup({
      rules: [{ strategy: { choose: () => 'ghost' } }],
      default: 'a',
    });
    await expect(bad.routing.explain(base)).rejects.toThrow(ConfigurationError);
  });
});

describe('routing: follow-up operations', () => {
  it('sends refunds, cancels and status queries to the provider that took the payment', async () => {
    const { payment, providers } = setup({ rules: [{ when: {}, use: 'b' }], default: 'a' });
    const paid = await payment.createPayment(base);
    expect(paid.status).toBe(PaymentStatus.SUCCESS);
    expect(providers.a.payments).toHaveLength(0);

    const refund = await payment.refund({
      paymentId: paid.paymentId!,
      price: '0.5',
      currency: 'TRY',
      ip: '85.34.78.112',
      conversationId: 'refund-1',
    });
    expect(refund.status).toBe(PaymentStatus.SUCCESS);
    expect(payment.routing.decision).toMatchObject({ provider: 'b', reason: 'follow-up' });
    expect(providers.b.payments[0].refunds).toHaveLength(1);

    const status = await payment.getPayment(paid.paymentId!);
    expect(status.status).toBe(PaymentStatus.SUCCESS);
    expect(payment.routing.decision).toMatchObject({ provider: 'b', reason: 'follow-up' });

    const second = await payment.createPayment(withRequest({ conversationId: 'cancel-order' }));
    const cancelled = await payment.cancel({
      paymentId: second.paymentId!,
      ip: '85.34.78.112',
      conversationId: 'cancel-order',
    });
    expect(cancelled.status).toBe(PaymentStatus.SUCCESS);
    expect(payment.routing.decision).toMatchObject({ provider: 'b', reason: 'follow-up' });
  });

  it('sends captures and voids to the provider that authorized the payment', async () => {
    const { payment } = setup({ rules: [{ when: {}, use: 'b' }], default: 'a' });
    const authorized = await payment.authorize(base);
    expect(authorized.status).toBe(PaymentStatus.SUCCESS);

    const captured = await payment.capture({
      paymentId: authorized.paymentId!,
      amount: '1.00',
      ip: '85.34.78.112',
    });
    expect(captured.status).toBe(PaymentStatus.SUCCESS);
    expect(payment.routing.decision).toMatchObject({ provider: 'b', reason: 'follow-up' });

    const other = await payment.authorize(withRequest({ conversationId: 'void-order' }));
    const voided = await payment.voidAuthorization({
      paymentId: other.paymentId!,
      ip: '85.34.78.112',
    });
    expect(voided.status).toBe(PaymentStatus.SUCCESS);
    expect(payment.routing.decision).toMatchObject({ provider: 'b', reason: 'follow-up' });
  });

  it('completes 3D Secure on the provider that started it', async () => {
    const { payment, providers } = setup({ rules: [{ when: {}, use: 'b' }], default: 'a' });
    const init = await payment.initThreeDSPayment(mockThreeDSPaymentRequest);
    expect(init.status).toBe(PaymentStatus.PENDING);
    const callback = await providers.b.threeDSCallback(init.paymentId!);
    const completed = await payment.completeThreeDSPayment(callback);
    expect(completed.status).toBe(PaymentStatus.SUCCESS);
    expect(payment.routing.decision).toMatchObject({ provider: 'b', reason: 'follow-up' });
    expect(providers.a.payments).toHaveLength(0);
  });

  it('does not re-route after a lost response or a decline, and keeps the payment pinned', async () => {
    for (const outcome of ['network', 'decline'] as const) {
      let healthy = true;
      const { payment, providers } = setup({
        default: 'a',
        health: { isAvailable: () => healthy },
      });
      if (outcome === 'network') providers.a.networkErrorNext('payment');
      else providers.a.failNext('payment', PaymentErrorCode.CARD_DECLINED);

      const first = await payment.createPayment(base);
      expect(first.status).toBe(
        outcome === 'network' ? PaymentStatus.PENDING : PaymentStatus.FAILURE
      );
      expect(providers.a.payments).toHaveLength(1);
      expect(providers.b.payments).toHaveLength(0);

      // The provider becomes unhealthy, but a retry of the same order must not move.
      healthy = false;
      const retry = await payment.createPayment(base);
      expect(retry.status).toBe(PaymentStatus.SUCCESS);
      expect(providers.a.payments).toHaveLength(2);
      expect(providers.b.payments).toHaveLength(0);
      expect(payment.routing.decision?.reason).toBe('pinned');
    }
  });

  it('falls back to the default for an unknown payment and says so', async () => {
    const { payment } = setup({ rules: [{ when: {}, use: 'b' }], default: 'a' });
    const refund = await payment.refund({
      paymentId: 'MISSING',
      price: '1.00',
      currency: 'TRY',
      ip: '85.34.78.112',
      conversationId: 'unknown-1',
    });
    expect(refund.status).toBe(PaymentStatus.FAILURE);
    expect(payment.routing.decision).toMatchObject({
      provider: 'a',
      rule: null,
      reason: 'unknown-payment',
    });
  });

  it('does not invent a provider for an unknown payment without a default', async () => {
    const payment = betterPayment({
      providers: { a: new MockProvider(), b: new MockProvider() },
      plugins: [routing({ rules: [{ when: {}, use: 'b' }] })],
    });
    const decision = await payment.routing.explain(
      {
        paymentId: 'MISSING',
        price: '1.00',
        currency: 'TRY',
        ip: '85.34.78.112',
      },
      { operation: 'refund' }
    );
    expect(decision).toMatchObject({ provider: null, reason: 'none' });
  });

  it('does not apply health to a follow-up of an unknown payment', async () => {
    const { payment, providers } = setup({
      health: { isAvailable: () => false },
      default: 'a',
    });
    const refund = await payment.refund({
      paymentId: 'MISSING',
      price: '1.00',
      currency: 'TRY',
      ip: '85.34.78.112',
      conversationId: 'unknown-2',
    });
    expect(refund.status).toBe(PaymentStatus.FAILURE);
    expect(payment.routing.decision).toMatchObject({ provider: 'a', reason: 'unknown-payment' });
    expect(providers.a.payments).toHaveLength(0);
  });

  it('refuses to route a known payment whose provider is not enabled', async () => {
    const { payment } = setup({
      store: manualStore({ 'routing:pay:pay-1': 'ghost' }),
      default: 'a',
    });
    await expect(
      payment.refund({
        paymentId: 'pay-1',
        price: '1.00',
        currency: 'TRY',
        ip: '85.34.78.112',
      })
    ).rejects.toThrow(ConfigurationError);
  });
});

describe('routing: store and audit', () => {
  it('remembers payment -> provider in an injected shared store across instances', async () => {
    const store = new MemoryRoutingStore();
    const first = setup({ rules: [{ when: {}, use: 'b' }], default: 'a', store });
    const paid = await first.payment.createPayment(base);
    expect(store.get(`routing:pay:${paid.paymentId!}`)).toBe('b');
    expect(store.get('routing:conv:123456789')).toBe('b');

    const second = setup({ default: 'a', store });
    await second.payment.refund({
      paymentId: paid.paymentId!,
      price: '0.5',
      currency: 'TRY',
      ip: '85.34.78.112',
    });
    // Routed to b even though this payment object never saw the payment
    expect(second.payment.routing.decision).toMatchObject({ provider: 'b', reason: 'follow-up' });
  });

  it('does not fail payments when the store is down', async () => {
    const store: RoutingStore = {
      get: () => {
        throw new Error('store down');
      },
      set: () => {
        throw new Error('store down');
      },
    };
    const { payment } = setup({ rules: [{ when: {}, use: 'b' }], default: 'a', store });
    const paid = await payment.createPayment(base);
    expect(paid.status).toBe(PaymentStatus.SUCCESS);
    expect(payment.routing.decision).toMatchObject({ provider: 'b' });

    await payment.refund({
      paymentId: paid.paymentId!,
      price: '0.5',
      currency: 'TRY',
      ip: '85.34.78.112',
    });
    // Without a mapping the refund goes to the default, not to a guessed provider
    expect(payment.routing.decision).toMatchObject({ provider: 'a', reason: 'unknown-payment' });
  });

  it('publishes decisions to onDecision listeners and keeps the last one', async () => {
    const { payment } = setup({ default: 'a' });
    const listener = vi.fn();
    const off = payment.routing.onDecision(listener);

    expect(payment.routing.decision).toBeUndefined();
    await payment.createPayment(base);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ provider: 'a', reason: 'default' });
    expect(payment.routing.decision).toMatchObject({ provider: 'a' });
    expect(payment.routing.status()).toEqual({ counts: { a: 1 }, total: 1 });

    off();
    await payment.createPayment(withRequest({ conversationId: 'other-order' }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(payment.routing.status()).toEqual({ counts: { a: 2 }, total: 2 });
  });

  it('does not let a failing audit listener change the routing', async () => {
    const { payment, providers } = setup({ default: 'b' });
    payment.routing.onDecision(() => {
      throw new Error('audit down');
    });
    const result = await payment.createPayment(base);
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(providers.b.payments).toHaveLength(1);
  });

  it('explain() has no side effects', async () => {
    const { payment, providers } = setup({ default: 'a' });
    const listener = vi.fn();
    payment.routing.onDecision(listener);
    const decision = await payment.routing.explain(base);
    expect(decision.provider).toBe('a');
    expect(listener).not.toHaveBeenCalled();
    expect(payment.routing.decision).toBeUndefined();
    expect(payment.routing.status()).toEqual({ counts: {}, total: 0 });
    expect(providers.a.payments).toHaveLength(0);
  });

  it('never puts card data or the BIN in a decision', async () => {
    const { payment } = setup({
      binResolver: () => ({ cardFamily: 'Bonus' }),
      rules: [{ name: 'bonus', when: { cardFamily: 'Bonus' }, use: 'a' }],
      default: 'b',
    });
    const decision = await payment.routing.explain(
      withRequest({ paymentCard: { cardNumber: '5528790000000008' }, binNumber: '552879' })
    );
    const serialized = JSON.stringify(decision);
    expect(serialized).not.toContain('5528790000000008');
    expect(serialized).not.toContain('552879');
    expect(serialized).not.toContain('cardNumber');
  });
});

describe('routing: calls made on a provider', () => {
  it('does not move provider calls and provider routes', async () => {
    const { payment, providers } = setup({ rules: [{ when: {}, use: 'b' }], default: 'a' });
    const result = await payment.use('a').createPayment(base);
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(providers.a.payments).toHaveLength(1);
    expect(providers.b.payments).toHaveLength(0);
  });
});

describe('MemoryRoutingStore', () => {
  it('expires entries and bounds its size', () => {
    let now = 1_000_000;
    const store = new MemoryRoutingStore({ ttlSeconds: 10, maxEntries: 2, now: () => now });
    store.set('first', 'a', 10);
    now += 5_000;
    store.set('second', 'b', 10);
    store.set('third', 'c', 10);
    expect(store.size).toBe(2);
    expect(store.get('first')).toBeUndefined();
    expect(store.get('third')).toBe('c');

    now += 11_000;
    expect(store.get('third')).toBeUndefined();
  });
});
