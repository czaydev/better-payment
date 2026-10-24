import { describe, it, expect, vi } from 'vitest';
import { betterPayment, ConfigurationError, PaymentStatus } from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import {
  paymentLinks,
  MemoryPaymentLinkStore,
  linkIdFromConversation,
} from '../../../src/plugins/payment-links';
import {
  mockPaymentCard,
  mockBuyer,
  mockShippingAddress,
  mockBillingAddress,
} from '../../fixtures/payment-data';

describe('paymentLinks plugin', () => {
  const SECRET = 'super-secret-key-12345';
  const BASE_URL = 'https://shop.example.com/api/payment';
  const CALLBACK_URL = 'https://shop.example.com/api/pay/mock/payment/complete-3ds';

  function createTestPayment(options = {}) {
    const store = new MemoryPaymentLinkStore();
    const mock = new MockProvider();
    const plugin = paymentLinks({
      secret: SECRET,
      baseUrl: BASE_URL,
      store,
      threeDSCallbackUrl: CALLBACK_URL,
      ...options,
    });

    const payment = betterPayment({
      providers: { mock },
      plugins: [plugin],
      handler: { basePath: '/api/payment' },
    });

    return { payment, store, plugin, mock };
  }

  /** The body a visitor posts to /links/pay, carrying the signature of the link URL */
  function payBody(link: { id: string; signature: string }, extra: Record<string, unknown> = {}) {
    return JSON.stringify({
      linkId: link.id,
      sig: link.signature,
      paymentCard: mockPaymentCard,
      buyer: mockBuyer,
      shippingAddress: mockShippingAddress,
      billingAddress: mockBillingAddress,
      ...extra,
    });
  }

  function parse(body: unknown) {
    return typeof body === 'string' ? JSON.parse(body) : body;
  }

  it('creates signed payment links with URL and HMAC signature', async () => {
    const { payment } = createTestPayment();

    const link = await payment.links.create({
      amount: '250.00',
      currency: 'TRY',
      description: 'Consulting invoice #42',
      expiresIn: '7d',
    });

    expect(link.id).toBeDefined();
    expect(link.amount).toBe('250.00');
    expect(link.currency).toBe('TRY');
    expect(link.description).toBe('Consulting invoice #42');
    expect(link.status).toBe('open');
    expect(link.singleUse).toBe(true);
    expect(link.useCount).toBe(0);
    expect(link.signature).toHaveLength(64); // SHA-256 hex
    expect(link.url).toContain(`${BASE_URL}/links/resolve?id=${link.id}&sig=${link.signature}`);

    const isValid = await payment.links.verify(link);
    expect(isValid).toBe(true);
  });

  it('refuses a link id that cannot travel inside a conversation id', () => {
    const { payment } = createTestPayment();
    return expect(payment.links.create({ amount: '10.00', id: 'order/../../x' })).rejects.toThrow(
      ConfigurationError
    );
  });

  it('detects tampering when amount or currency is altered', async () => {
    const { payment } = createTestPayment();

    const link = await payment.links.create({
      amount: '100.00',
      currency: 'TRY',
    });

    // Tamper with the amount
    const tampered = { ...link, amount: '10.00' };
    const isValid = await payment.links.verify(tampered);
    expect(isValid).toBe(false);
  });

  it('handles expiration correctly', async () => {
    const { payment } = createTestPayment();

    // Create a link that expired 1 second ago
    const link = await payment.links.create({
      amount: '50.00',
      expiresIn: -1000,
    });

    const fetched = await payment.links.get(link.id);
    expect(fetched?.status).toBe('expired');
  });

  it('cancels active payment links', async () => {
    const { payment } = createTestPayment();

    const link = await payment.links.create({ amount: '75.00' });
    expect(link.status).toBe('open');

    const cancelled = await payment.links.cancel(link.id);
    expect(cancelled?.status).toBe('cancelled');

    const refetched = await payment.links.get(link.id);
    expect(refetched?.status).toBe('cancelled');
  });

  it('requires the link signature on both endpoints', async () => {
    const { payment } = createTestPayment();
    const handler = payment.handler;

    const link = await payment.links.create({ amount: '120.00' });

    const noSig = await handler.handle({
      method: 'GET',
      url: `${BASE_URL}/links/resolve?id=${link.id}`,
      headers: {},
    });
    expect(noSig.status).toBe(400);
    expect(parse(noSig.body).message).toBe('Missing link signature');

    const wrongSig = await handler.handle({
      method: 'POST',
      url: `${BASE_URL}/links/pay`,
      headers: { 'Content-Type': 'application/json' },
      body: payBody(link, { sig: 'f'.repeat(64) }),
    });
    expect(wrongSig.status).toBe(400);
    expect(parse(wrongSig.body).message).toBe('Invalid payment link signature');

    const withSig = await handler.handle({
      method: 'GET',
      url: `${BASE_URL}/links/resolve?id=${link.id}&sig=${link.signature}`,
      headers: {},
    });
    expect(withSig.status).toBe(200);
    expect(parse(withSig.body).amount).toBe('120.00');
  });

  it('starts a 3D Secure payment, not a direct charge, by default', async () => {
    const { payment, mock } = createTestPayment();
    const handler = payment.handler;

    const link = await payment.links.create({
      amount: '120.00',
      currency: 'TRY',
      description: 'Single-use order #101',
      singleUse: true,
    });

    const payRes = await handler.handle({
      method: 'POST',
      url: `${BASE_URL}/links/pay`,
      headers: { 'Content-Type': 'application/json' },
      body: payBody(link),
    });

    expect(payRes.status).toBe(200);
    const init = parse(payRes.body);
    expect(init.paymentId).toBeDefined();
    expect(init.conversationId).toBe(`LINK_${link.id}#1`);

    // Nothing is charged until the bank returns
    let stored = await payment.links.get(link.id);
    expect(stored?.status).toBe('open');
    expect(stored?.useCount).toBe(0);
    expect(stored?.attempts).toBe(1);

    const completed = await payment.completeThreeDSPayment(
      await mock.threeDSCallback(init.paymentId)
    );
    expect(completed.status).toBe(PaymentStatus.SUCCESS);

    stored = await payment.links.get(link.id);
    expect(stored?.status).toBe('paid');
    expect(stored?.useCount).toBe(1);
    expect(stored?.paymentId).toBe(init.paymentId);

    const payAgainRes = await handler.handle({
      method: 'POST',
      url: `${BASE_URL}/links/pay`,
      headers: { 'Content-Type': 'application/json' },
      body: payBody(link),
    });
    expect(payAgainRes.status).toBe(410);
  });

  it('settles a 3D Secure completion only once per payment', async () => {
    const { payment, mock } = createTestPayment({ maxUses: 1 });
    const handler = payment.handler;

    const link = await payment.links.create({ amount: '50.00', singleUse: false });

    const init = parse(
      await (
        await handler.handle({
          method: 'POST',
          url: `${BASE_URL}/links/pay`,
          headers: { 'Content-Type': 'application/json' },
          body: payBody(link),
        })
      ).body
    );
    const callback = await mock.threeDSCallback(init.paymentId);

    const first = await payment.completeThreeDSPayment(callback);
    const second = await payment.completeThreeDSPayment(callback);

    expect(first.status).toBe(PaymentStatus.SUCCESS);
    expect(second.status).toBe(PaymentStatus.SUCCESS);
    const stored = await payment.links.get(link.id);
    expect(stored?.useCount).toBe(1);
  });

  it('leaves the link open when the 3D Secure authentication fails', async () => {
    const { payment, mock } = createTestPayment();
    const handler = payment.handler;

    const link = await payment.links.create({ amount: '90.00' });

    const init = parse(
      await (
        await handler.handle({
          method: 'POST',
          url: `${BASE_URL}/links/pay`,
          headers: { 'Content-Type': 'application/json' },
          body: payBody(link),
        })
      ).body
    );

    const refused = await payment.completeThreeDSPayment(
      await mock.threeDSCallback(init.paymentId, { approve: false })
    );
    expect(refused.status).toBe(PaymentStatus.FAILURE);

    // A failed authentication must not burn the link
    const stored = await payment.links.get(link.id);
    expect(stored?.status).toBe('open');
    expect(stored?.useCount).toBe(0);

    const retry = await handler.handle({
      method: 'POST',
      url: `${BASE_URL}/links/pay`,
      headers: { 'Content-Type': 'application/json' },
      body: payBody(link),
    });
    expect(retry.status).toBe(200);
  });
  it('ignores a provider named in the pay request body', async () => {
    const { payment } = createTestPayment({ allowDirectPayment: true });
    const handler = payment.handler;

    const link = await payment.links.create({ amount: '80.00' });

    const res = await handler.handle({
      method: 'POST',
      url: `${BASE_URL}/links/pay`,
      headers: { 'Content-Type': 'application/json' },
      body: payBody(link, { provider: 'attacker-acquirer' }),
    });

    // Honouring the body would ask for a provider that is not configured
    expect(res.status).toBe(200);
    expect(parse(res.body).status).toBe(PaymentStatus.SUCCESS);
  });

  it('pays single-use links directly only when that is opted into', async () => {
    const { payment } = createTestPayment({ allowDirectPayment: true });
    const handler = payment.handler;

    const link = await payment.links.create({
      amount: '120.00',
      currency: 'TRY',
      description: 'Single-use order #101',
      singleUse: true,
    });

    const payRes = await handler.handle({
      method: 'POST',
      url: `${BASE_URL}/links/pay`,
      headers: { 'Content-Type': 'application/json' },
      body: payBody(link),
    });

    expect(payRes.status).toBe(200);
    expect(parse(payRes.body).status).toBe(PaymentStatus.SUCCESS);

    const updatedLink = await payment.links.get(link.id);
    expect(updatedLink?.status).toBe('paid');
    expect(updatedLink?.useCount).toBe(1);
    expect(updatedLink?.paidAt).toBeDefined();

    const payAgainRes = await handler.handle({
      method: 'POST',
      url: `${BASE_URL}/links/pay`,
      headers: { 'Content-Type': 'application/json' },
      body: payBody(link),
    });

    expect(payAgainRes.status).toBe(410);
  });

  it('supports multi-use links that remain open after payment', async () => {
    const { payment } = createTestPayment({ allowDirectPayment: true });
    const handler = payment.handler;

    const link = await payment.links.create({
      amount: '50.00',
      currency: 'TRY',
      description: 'Donation link',
      singleUse: false,
      maxUses: 3,
    });

    for (const expected of [1, 2]) {
      const res = await handler.handle({
        method: 'POST',
        url: `${BASE_URL}/links/pay`,
        headers: { 'Content-Type': 'application/json' },
        body: payBody(link),
      });
      expect(res.status).toBe(200);
      const after = await payment.links.get(link.id);
      expect(after?.status).toBe('open');
      expect(after?.useCount).toBe(expected);
    }
  });

  it('claims one slot per link when two payments arrive at the same time', async () => {
    const { payment } = createTestPayment({ allowDirectPayment: true });
    const handler = payment.handler;

    const link = await payment.links.create({ amount: '300.00' });

    const requests = [1, 2].map(() =>
      handler.handle({
        method: 'POST',
        url: `${BASE_URL}/links/pay`,
        headers: { 'Content-Type': 'application/json' },
        body: payBody(link),
      })
    );
    const responses = (await Promise.all(requests)).map((res) => res.status);

    // The loser sees either the taken slot (409) or the settled link (410), depending
    // on how far the winner got; only one payment may ever be charged.
    expect(responses.filter((s) => s === 200)).toHaveLength(1);
    expect(responses.filter((s) => s === 409 || s === 410)).toHaveLength(1);

    const stored = await payment.links.get(link.id);
    expect(stored?.useCount).toBe(1);
    expect(stored?.status).toBe('paid');
  });

  it('caps payment attempts on a link', async () => {
    const { payment } = createTestPayment({ maxAttempts: 2 });
    const handler = payment.handler;

    const link = await payment.links.create({ amount: '20.00' });

    for (const expected of [200, 200]) {
      const res = await handler.handle({
        method: 'POST',
        url: `${BASE_URL}/links/pay`,
        headers: { 'Content-Type': 'application/json' },
        body: payBody(link),
      });
      expect(res.status).toBe(expected);
    }

    const refused = await handler.handle({
      method: 'POST',
      url: `${BASE_URL}/links/pay`,
      headers: { 'Content-Type': 'application/json' },
      body: payBody(link),
    });
    expect(refused.status).toBe(429);
    expect(parse(refused.body).message).toContain('attempt limit (2)');
  });

  it('holds the attempt limit when visitors post the same link at once', async () => {
    const { payment, mock } = createTestPayment({ maxAttempts: 3 });
    const handler = payment.handler;
    const link = await payment.links.create({ amount: '20.00' });
    const init = vi.spyOn(mock, 'initThreeDSPayment');

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        handler.handle({
          method: 'POST',
          url: `${BASE_URL}/links/pay`,
          headers: { 'Content-Type': 'application/json' },
          body: payBody(link),
        })
      )
    );

    const statuses = responses.map((r) => r.status);
    const accepted = statuses.filter((s) => s === 200).length;
    const stored = await payment.links.get(link.id);

    // The cap is a card-testing control, so it has to hold for overlapping requests,
    // not only for sequential ones: neither the provider fan-out nor the counter may
    // pass maxAttempts.
    expect(accepted).toBeLessThanOrEqual(3);
    expect(init).toHaveBeenCalledTimes(accepted);
    expect(stored?.attempts).toBeLessThanOrEqual(3);
    expect(statuses.every((s) => s === 200 || s === 429)).toBe(true);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it('requires a callback url while the pay endpoint stays 3D Secure', () => {
    expect(() =>
      paymentLinks({ secret: SECRET, baseUrl: BASE_URL, allowDirectPayment: false })
    ).toThrow(/threeDSCallbackUrl is required/);
  });

  it('maps only its own conversation ids back to a link', () => {
    expect(linkIdFromConversation('LINK_ab12cd34#3')).toBe('ab12cd34');
    expect(linkIdFromConversation('LINK_ab12cd34')).toBeUndefined();
    expect(linkIdFromConversation('LINK_ab12cd34#x')).toBeUndefined();
    expect(linkIdFromConversation('LINK_a#1')).toBeUndefined();
    expect(linkIdFromConversation('order-42')).toBeUndefined();
    expect(linkIdFromConversation(undefined)).toBeUndefined();
  });
});
