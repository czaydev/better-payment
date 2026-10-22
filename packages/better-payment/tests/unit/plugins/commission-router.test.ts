import { describe, it, expect, vi } from 'vitest';
import {
  betterPayment,
  ConfigurationError,
  PaymentErrorCode,
  PaymentStatus,
  ValidationError,
} from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import {
  commissionRouter,
  type CommissionRouterMethods,
  type CommissionRouterOptions,
  type RouterBinInfo,
} from 'better-payment/commission-router';
import {
  mockPaymentRequest,
  mockRefundRequest,
  mockCancelRequest,
} from '../../fixtures/payment-data';

type RouterPayment = ReturnType<typeof betterPayment> & CommissionRouterMethods;

function setup(
  options: CommissionRouterOptions,
  ids: string[] = ['alpha', 'beta', 'gamma'],
  paymentOptions: Record<string, unknown> = {}
) {
  const providers: Record<string, MockProvider> = {};
  for (const id of ids) providers[id] = new MockProvider();
  const payment = betterPayment({
    providers,
    defaultProvider: ids[0],
    plugins: [commissionRouter(options)],
    ...paymentOptions,
  } as any) as unknown as RouterPayment;
  return { payment, providers };
}

/** An order whose paid amount is exactly `price` */
const order = (price: string, extra: Record<string, unknown> = {}) => ({
  ...mockPaymentRequest,
  price,
  paidPrice: price,
  ...extra,
});

/**
 * All rates below are fictional test values invented for these tests. They are
 * not estimates of any provider's real commission.
 */
describe('commissionRouter', () => {
  it('routes to the cheapest eligible provider with exact integer costs', async () => {
    const { payment, providers } = setup({
      rates: [
        { provider: 'alpha', rate: '1.10', fixed: '0.10' },
        { provider: 'beta', rate: '1.00', fixed: '0.05' },
        { provider: 'gamma', rate: '1.25' },
      ],
    });

    const quote = await payment.router.quote({ price: '1000.00' });

    expect(quote.selected).toBe('beta');
    expect(quote.selectionReason).toBe('lowest-cost');
    expect(
      quote.candidates.map(({ provider, cost, chosen, reason }) => ({
        provider,
        cost,
        chosen,
        reason,
      }))
    ).toEqual([
      { provider: 'beta', cost: '10.05', chosen: true, reason: 'lowest-cost' },
      { provider: 'alpha', cost: '11.10', chosen: false, reason: 'higher-cost' },
      { provider: 'gamma', cost: '12.50', chosen: false, reason: 'higher-cost' },
    ]);
    expect(quote.candidates[1].detail).toBe("costs 1.05 TRY more than 'beta'");
    expect(quote.excluded).toEqual([]);
    expect(quote.amount).toEqual({
      price: '1000.00',
      priceMinor: 100000,
      currency: 'TRY',
      installment: 1,
      threeDS: false,
    });
    // Quoting must not count as a routing decision
    expect(payment.router.status().total).toBe(0);

    const result = await payment.createPayment(order('1000.00'));
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.provider).toBe('beta');
    expect(providers.beta.payments).toHaveLength(1);
    expect(providers.alpha.payments).toHaveLength(0);
    expect(payment.router.status().routed).toEqual({ alpha: 0, beta: 1, gamma: 0 });
  });

  it('rounds half a minor unit up and never compares floats', async () => {
    const { payment } = setup({ rates: [{ provider: 'alpha', rate: '10' }] }, ['alpha']);
    const half = await payment.router.quote({ price: '0.05' });
    const below = await payment.router.quote({ price: '0.04' });
    expect(half.candidates[0]).toMatchObject({ cost: '0.01', costMinor: 1 });
    expect(below.candidates[0]).toMatchObject({ cost: '0.00', costMinor: 0 });

    // 2.49% of 10.10 TRY is 0.25149 TRY -> 25 minor units, rounded half up
    const { payment: percent } = setup({ rates: [{ provider: 'alpha', rate: '2.49' }] }, ['alpha']);
    const exact = await percent.router.quote({ price: '10.10' });
    expect(exact.candidates[0]).toMatchObject({ cost: '0.25', costMinor: 25 });
  });

  it('explains currency and installment exclusions instead of guessing', async () => {
    const { payment } = setup(
      {
        rates: [
          { provider: 'alpha', rate: '1', currencies: ['USD'] },
          { provider: 'beta', rate: '1', installments: [1] },
        ],
      },
      ['alpha', 'beta']
    );

    const quote = await payment.router.quote({ price: '100.00', currency: 'TRY', installment: 3 });

    expect(quote.selected).toBeNull();
    expect(quote.candidates).toEqual([]);
    expect(quote.excluded).toEqual([
      {
        provider: 'alpha',
        reason: 'currency-not-supported',
        detail: 'the line covers USD, not TRY',
        rateIndex: 0,
      },
      {
        provider: 'beta',
        reason: 'installment-not-supported',
        detail: 'installment 3 is not in [1]',
        rateIndex: 1,
      },
    ]);
    expect(quote.notes).toEqual([
      'no provider is eligible and the fallback order is empty or unavailable',
    ]);
  });

  it('filters by amount bounds and by rate validity dates', async () => {
    let now = Date.parse('2026-06-01T00:00:00Z');
    const { payment } = setup(
      {
        now: () => now,
        rates: [
          {
            provider: 'alpha',
            rate: '1',
            minAmount: '100.00',
            maxAmount: '500.00',
            validFrom: '2026-01-01T00:00:00Z',
            validTo: '2026-09-01T00:00:00Z',
          },
          { provider: 'beta', rate: '2' },
        ],
      },
      ['alpha', 'beta']
    );

    expect((await payment.router.quote({ price: '50.00' })).excluded[0]).toMatchObject({
      provider: 'alpha',
      reason: 'amount-below-min',
      detail: "the amount is below the line's minimum of 100.00",
    });
    expect((await payment.router.quote({ price: '600.00' })).excluded[0]).toMatchObject({
      provider: 'alpha',
      reason: 'amount-above-max',
      detail: "the amount is above the line's maximum of 500.00",
    });

    now = Date.parse('2025-12-01T00:00:00Z');
    expect((await payment.router.quote({ price: '100.00' })).excluded[0]).toMatchObject({
      provider: 'alpha',
      reason: 'rate-not-yet-valid',
    });
    now = Date.parse('2026-10-01T00:00:00Z');
    expect((await payment.router.quote({ price: '100.00' })).excluded[0]).toMatchObject({
      provider: 'alpha',
      reason: 'rate-expired',
    });

    // The fallback line without any filter stays eligible throughout
    expect((await payment.router.quote({ price: '100.00' })).selected).toBe('beta');
  });

  it('filters by the 3D Secure requirement', async () => {
    const { payment } = setup(
      {
        rates: [
          { provider: 'alpha', rate: '1', threeDS: true },
          { provider: 'beta', rate: '1', threeDS: false },
        ],
      },
      ['alpha', 'beta']
    );

    expect((await payment.router.quote({ price: '100.00' })).selected).toBe('beta');
    expect(
      (await payment.router.quote({ price: '100.00', operation: 'initThreeDSPayment' })).selected
    ).toBe('alpha');
    expect(
      (
        await payment.router.quote({
          price: '100.00',
          operation: 'initThreeDSPayment',
          threeDS: false,
        })
      ).selected
    ).toBe('beta');
  });

  it('matches card filters from the BIN lookup and reports unknown cards', async () => {
    const lookup = vi.fn((bin: string): RouterBinInfo => ({
      binNumber: bin,
      cardFamily: 'Bonus',
      bankName: 'Fictional Bank',
      cardAssociation: 'MASTER_CARD',
      cardType: 'CREDIT_CARD',
      commercial: false,
    }));
    const { payment } = setup({
      binLookup: lookup,
      rates: [
        { provider: 'alpha', rate: '1', cardFamily: 'Bonus' },
        { provider: 'beta', rate: '0.5', cardFamily: 'Axess' },
        { provider: 'gamma', rate: '3' },
      ],
    });

    const quote = await payment.router.quote({ price: '100.00', binNumber: '552879' });
    expect(quote.selected).toBe('alpha');
    expect(quote.card).toEqual({
      bankName: 'Fictional Bank',
      cardFamily: 'Bonus',
      cardType: 'CREDIT_CARD',
      cardAssociation: 'MASTER_CARD',
      commercial: false,
    });
    expect(quote.excluded).toEqual([
      {
        provider: 'beta',
        reason: 'card-mismatch',
        detail: "card family 'Bonus' is not axess",
        rateIndex: 1,
      },
    ]);
    expect(lookup).toHaveBeenCalledWith('552879');
    // The quote never contains the BIN or the card number
    expect(JSON.stringify(quote)).not.toContain('552879');

    const unknown = await payment.router.quote({ price: '100.00' });
    expect(unknown.selected).toBe('gamma');
    expect(unknown.excluded.map((entry) => entry.reason)).toEqual(['card-unknown', 'card-unknown']);
  });

  it('skips unhealthy providers, and fails open when the health monitor throws', async () => {
    const skipped = setup(
      {
        isHealthy: (provider) => provider !== 'alpha',
        rates: [
          { provider: 'alpha', rate: '1' },
          { provider: 'beta', rate: '2' },
        ],
      },
      ['alpha', 'beta']
    );
    const quote = await skipped.payment.router.quote({ price: '100.00' });
    expect(quote.selected).toBe('beta');
    expect(quote.excluded).toEqual([
      {
        provider: 'alpha',
        reason: 'provider-unhealthy',
        detail: 'isHealthy() returned false',
      },
    ]);

    const broken = setup(
      {
        isHealthy: () => {
          throw new Error('monitor down');
        },
        rates: [{ provider: 'alpha', rate: '1' }],
      },
      ['alpha']
    );
    const open = await broken.payment.router.quote({ price: '100.00' });
    expect(open.selected).toBe('alpha');
    expect(open.notes).toContain("health check for 'alpha' failed; treated as healthy");
  });

  it('uses the fallback order only for providers that have no rate line', async () => {
    const { payment } = setup({
      rates: [{ provider: 'alpha', rate: '1', currencies: ['USD'] }],
      fallback: ['beta', 'gamma'],
      isHealthy: (provider) => provider !== 'gamma',
    });

    const quote = await payment.router.quote({ price: '100.00', currency: 'TRY' });

    expect(quote.selected).toBe('beta');
    expect(quote.selectionReason).toBe('fallback');
    expect(quote.candidates).toEqual([
      expect.objectContaining({
        provider: 'beta',
        cost: null,
        costMinor: null,
        rate: null,
        fixed: null,
        rateIndex: null,
        chosen: true,
        reason: 'fallback',
      }),
    ]);
    // A hard filter (currency) is never bypassed by the fallback order
    expect(quote.excluded).toEqual([
      {
        provider: 'alpha',
        reason: 'currency-not-supported',
        detail: 'the line covers USD, not TRY',
        rateIndex: 0,
      },
      { provider: 'gamma', reason: 'no-rate-line', detail: 'no rate line for this provider' },
    ]);
  });

  it('resolves ties with policy.prefer, then the rate-table order', async () => {
    const rates = [
      { provider: 'alpha', rate: '1.50' },
      { provider: 'beta', rate: '1.50' },
      { provider: 'gamma', rate: '2' },
    ];

    const plain = setup({ rates });
    const first = await plain.payment.router.quote({ price: '100.00' });
    expect(first.selected).toBe('alpha');
    expect(first.selectionReason).toBe('lowest-cost');

    const preferred = setup({ rates, policy: { prefer: ['beta'] } });
    const second = await preferred.payment.router.quote({ price: '100.00' });
    expect(second.selected).toBe('beta');
    expect(second.selectionReason).toBe('preferred-on-tie');
    expect(second.candidates[0]).toMatchObject({
      provider: 'beta',
      chosen: true,
      reason: 'preferred-on-tie',
      detail: 'same cost as the runner-up; preferred by policy.prefer (1.50 TRY)',
    });
    expect(second.candidates[1]).toMatchObject({
      provider: 'alpha',
      chosen: false,
      reason: 'ranked-lower',
    });
  });

  it('rotates providers under a share cap instead of exceeding it', async () => {
    const { payment } = setup(
      {
        rates: [
          { provider: 'alpha', rate: '1' },
          { provider: 'beta', rate: '2' },
        ],
        policy: { shareCap: { maxShare: 0.5, window: 2 } },
      },
      ['alpha', 'beta']
    );

    const first = await payment.createPayment(order('100.00'));
    const afterOne = await payment.router.quote({ price: '100.00' });
    expect(afterOne.selected).toBe('beta');
    expect(afterOne.excluded).toEqual([
      {
        provider: 'alpha',
        reason: 'share-cap',
        detail: 'one more payment would take 100% of the last 2 routing decisions (cap 50%)',
        rateIndex: 0,
      },
    ]);

    const second = await payment.createPayment(order('100.00'));
    const afterTwo = await payment.router.quote({ price: '100.00' });
    // Both providers are at the cap: the cheapest eligible provider is used
    expect(afterTwo.selected).toBe('alpha');
    expect(afterTwo.notes).toContain(
      'every eligible provider is at its share cap; the cheapest eligible provider is used'
    );

    const third = await payment.createPayment(order('100.00'));
    expect([first.provider, second.provider, third.provider]).toEqual(['alpha', 'beta', 'alpha']);
    // The window keeps only the last 2 decisions
    expect(payment.router.status()).toMatchObject({
      routed: { alpha: 1, beta: 1 },
      total: 2,
      shareWindow: 2,
    });
    expect(payment.router.status().binCache).toEqual({
      entries: 0,
      maxEntries: 1024,
      ttlMs: 86_400_000,
    });

    payment.router.reset();
    expect(payment.router.status()).toMatchObject({ routed: { alpha: 0, beta: 0 }, total: 0 });
  });

  it('applies a per-order override, even when it is not the cheapest', async () => {
    const { payment, providers } = setup({
      rates: [
        { provider: 'alpha', rate: '1' },
        { provider: 'beta', rate: '2' },
        { provider: 'gamma', rate: '3' },
      ],
      policy: {
        override: ({ conversationId }) => (conversationId === 'order-gamma' ? 'gamma' : null),
      },
    });

    const quote = await payment.router.quote({ price: '100.00', conversationId: 'order-gamma' });
    expect(quote.selected).toBe('gamma');
    expect(quote.selectionReason).toBe('override');
    expect(quote.candidates[0]).toMatchObject({
      provider: 'gamma',
      cost: '3.00',
      chosen: true,
      reason: 'override',
      detail: 'selected by policy.override (3.00 TRY)',
    });

    const result = await payment.createPayment(order('100.00', { conversationId: 'order-gamma' }));
    expect(result.provider).toBe('gamma');
    expect(providers.gamma.payments).toHaveLength(1);
    expect(providers.alpha.payments).toHaveLength(0);
  });

  it('ignores an override to a provider that is not eligible', async () => {
    const { payment } = setup(
      {
        rates: [
          { provider: 'alpha', rate: '1' },
          { provider: 'beta', rate: '2' },
        ],
        policy: { override: () => 'delta' },
      },
      ['alpha', 'beta']
    );

    const quote = await payment.router.quote({ price: '100.00' });
    expect(quote.selected).toBe('alpha');
    expect(quote.notes).toContain(
      "policy.override selected 'delta', which is not eligible; normal ranking used"
    );
  });

  it('does not retry failures whose charge state is unknown or declined', async () => {
    const network = setup(
      {
        rates: [
          { provider: 'alpha', rate: '2' },
          { provider: 'beta', rate: '1' },
        ],
      },
      ['alpha', 'beta']
    );
    network.providers.beta.networkErrorNext('payment');
    const pending = await network.payment.createPayment(order('100.00'));
    expect(pending.status).toBe(PaymentStatus.PENDING);
    expect(pending.code).toBe(PaymentErrorCode.NETWORK_ERROR);
    expect(pending.provider).toBe('beta');
    expect(network.providers.beta.payments).toHaveLength(1);
    expect(network.providers.alpha.payments).toHaveLength(0);

    const declined = setup(
      {
        rates: [
          { provider: 'alpha', rate: '2' },
          { provider: 'beta', rate: '1' },
        ],
      },
      ['alpha', 'beta']
    );
    declined.providers.beta.failNext('payment', PaymentErrorCode.CARD_DECLINED);
    const failure = await declined.payment.createPayment(order('100.00'));
    expect(failure.status).toBe(PaymentStatus.FAILURE);
    expect(failure.code).toBe(PaymentErrorCode.CARD_DECLINED);
    expect(declined.providers.alpha.payments).toHaveLength(0);
  });

  it('falls back once when the error proves no charge happened', async () => {
    const { payment, providers } = setup(
      {
        rates: [
          { provider: 'alpha', rate: '2' },
          { provider: 'beta', rate: '1' },
        ],
      },
      ['alpha', 'beta']
    );
    providers.beta.failNext('payment', PaymentErrorCode.PROVIDER_ERROR);

    const result = await payment.createPayment(order('100.00'));

    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.provider).toBe('alpha');
    expect(providers.beta.payments).toHaveLength(1);
    expect(providers.alpha.payments).toHaveLength(1);
    expect(providers.alpha.getRecord(result.paymentId!)).toMatchObject({
      state: 'succeeded',
      amount: 10000,
    });
  });

  it('refuses a fallbackOn configuration that could double-charge', () => {
    expect(() =>
      commissionRouter({
        rates: [{ provider: 'alpha', rate: '1' }],
        fallbackOn: [PaymentErrorCode.NETWORK_ERROR],
      })
    ).toThrow(/can charge the customer twice/);
    expect(() =>
      commissionRouter({
        rates: [{ provider: 'alpha', rate: '1' }],
        fallbackOn: [PaymentErrorCode.CARD_DECLINED],
      })
    ).toThrow(ConfigurationError);
  });

  it('sends refund, cancel and getPayment to the provider that handled the payment', async () => {
    const { payment, providers } = setup(
      {
        rates: [
          { provider: 'alpha', rate: '2' },
          { provider: 'beta', rate: '1' },
        ],
      },
      ['alpha', 'beta']
    );

    const paid = await payment.createPayment(order('100.00'));
    expect(paid.provider).toBe('beta');

    const refund = await payment.refund({ ...mockRefundRequest, paymentId: paid.paymentId! });
    expect(refund.status).toBe(PaymentStatus.SUCCESS);
    expect(refund.provider).toBe('beta');
    expect(providers.beta.getRecord(paid.paymentId!)?.refunds).toHaveLength(1);
    expect(providers.alpha.payments).toHaveLength(0);

    const status = await payment.getPayment(paid.paymentId!);
    expect(status.status).toBe(PaymentStatus.SUCCESS);
    expect(status.provider).toBe('beta');

    const second = await payment.createPayment(order('200.00'));
    const cancelled = await payment.cancel({ ...mockCancelRequest, paymentId: second.paymentId! });
    expect(cancelled.status).toBe(PaymentStatus.SUCCESS);
    expect(cancelled.provider).toBe('beta');
    expect(providers.alpha.payments).toHaveLength(0);
  });

  it('bounds the BIN cache and expires its entries', async () => {
    let now = 1_000;
    const lookup = vi.fn((): RouterBinInfo => ({ cardFamily: 'Bonus' }));
    const { payment } = setup(
      {
        now: () => now,
        cache: { maxEntries: 2, ttlMs: 1_000 },
        binLookup: lookup,
        rates: [{ provider: 'alpha', rate: '1' }],
      },
      ['alpha']
    );

    await payment.router.quote({ price: '1.00', binNumber: '552879' });
    await payment.router.quote({ price: '1.00', binNumber: '552879' });
    expect(lookup).toHaveBeenCalledTimes(1);

    now = 2_001;
    await payment.router.quote({ price: '1.00', binNumber: '552879' });
    expect(lookup).toHaveBeenCalledTimes(2);

    await payment.router.quote({ price: '1.00', binNumber: '400000' });
    await payment.router.quote({ price: '1.00', binNumber: '555555' });
    expect(payment.router.status().binCache).toEqual({
      entries: 2,
      maxEntries: 2,
      ttlMs: 1_000,
    });
  });

  it('looks up the 8-digit prefix, then the 6-digit prefix, never the full PAN', async () => {
    const fullPan = '5528790000000008';
    const lookup = vi.fn((bin: string): RouterBinInfo | undefined =>
      bin === '552879' ? { cardFamily: 'Bonus' } : undefined
    );
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    const { payment } = setup(
      {
        binLookup: lookup,
        rates: [{ provider: 'alpha', rate: '1', cardFamily: 'Bonus' }],
      },
      ['alpha'],
      { logger }
    );

    const result = await payment.createPayment(order('100.00'));
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(lookup.mock.calls.map(([bin]) => bin)).toEqual(['55287900', '552879']);

    const logged = JSON.stringify([
      logger.debug.mock.calls,
      logger.info.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(logged).not.toContain(fullPan);
    expect(JSON.stringify(result)).not.toContain(fullPan);

    await expect(payment.router.quote({ price: '1.00', binNumber: fullPan })).rejects.toThrow(
      ValidationError
    );
    await expect(payment.router.quote({ price: '1.00', binNumber: fullPan })).rejects.toThrow(
      /6-8 digit BIN prefix/
    );
  });

  it('serves the quote endpoint with 400 for invalid input and 405 for the wrong method', async () => {
    const { payment } = setup({ rates: [{ provider: 'alpha', rate: '1.50' }] }, ['alpha']);
    const handler = payment.handler;

    const ok = await handler.handle({
      method: 'POST',
      url: '/api/pay/router/quote',
      headers: { 'content-type': 'application/json' },
      body: { price: '200.00', currency: 'try' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      selected: 'alpha',
      amount: { price: '200.00', priceMinor: 20000, currency: 'TRY' },
      candidates: [{ provider: 'alpha', cost: '3.00', chosen: true }],
    });

    const bad = await handler.handle({
      method: 'POST',
      url: '/api/pay/router/quote',
      headers: { 'content-type': 'application/json' },
      body: { price: 'not-a-number' },
    });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: expect.stringContaining('non-negative decimal') });
    expect(JSON.stringify(bad.body)).not.toContain('not-a-number');

    const wrongMethod = await handler.handle({
      method: 'GET',
      url: '/api/pay/router/quote',
      headers: {},
    });
    expect(wrongMethod.status).toBe(405);
  });

  it('validates the rate table, the options, the configured providers and quote input', async () => {
    expect(() => commissionRouter({ rates: [{ provider: 'alpha', rate: '100.01' }] })).toThrow(
      /at most 100/
    );
    expect(() =>
      commissionRouter({ rates: [{ provider: 'alpha', rate: '1', installments: [] }] })
    ).toThrow(/non-empty array/);
    expect(() =>
      commissionRouter({
        rates: [{ provider: 'alpha', rate: '1', minAmount: '10.00', maxAmount: '5.00' }],
      })
    ).toThrow(/minAmount is above maxAmount/);
    expect(() =>
      commissionRouter({
        rates: [{ provider: 'alpha', rate: '1' }],
        strategy: 'highest-cost' as 'lowest-cost',
      })
    ).toThrow(/unknown strategy/);
    // The provider of every line is checked when the plugin is attached
    expect(() => setup({ rates: [{ provider: 'ghost', rate: '1' }] }, ['alpha'])).toThrow(
      "'ghost' is not a configured provider"
    );

    const { payment } = setup({ rates: [{ provider: 'alpha', rate: '1' }] }, ['alpha']);
    await expect(payment.router.quote({ price: '-1.00' })).rejects.toThrow(ValidationError);
    await expect(payment.router.quote({ price: '1.00', installment: 0 })).rejects.toThrow(
      ValidationError
    );
    await expect(payment.router.quote({ price: '1.00', currency: 'TL' })).rejects.toThrow(
      ValidationError
    );
    await expect(
      payment.router.quote({ price: '1.00', operation: 'refund' as 'createPayment' })
    ).rejects.toThrow(/operation must be/);
  });
});
