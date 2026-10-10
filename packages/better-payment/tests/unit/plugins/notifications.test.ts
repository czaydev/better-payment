import { describe, it, expect, vi } from 'vitest';
import { betterPayment, ConfigurationError, PaymentStatus } from 'better-payment';
import { MockProvider, MOCK_CARDS } from 'better-payment/testing';
import {
  notifications,
  formatNotification,
  type NotificationsOptions,
} from 'better-payment/plugins';
import { mockPaymentRequest, mockRefundRequest } from '../../fixtures/payment-data';

const declined = {
  ...mockPaymentRequest,
  paymentCard: { ...mockPaymentRequest.paymentCard!, cardNumber: MOCK_CARDS.INSUFFICIENT_FUNDS },
};

/** A fetch that records calls and answers with `status` */
function mockFetch(status = 200) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response('{}', { status });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function setup(options: Partial<NotificationsOptions> & Pick<NotificationsOptions, 'channels'>) {
  return betterPayment({
    providers: { mock: new MockProvider() },
    plugins: [notifications(options)],
  });
}

const SLACK = 'https://hooks.slack.com/services/T/B/X';
const DISCORD = 'https://discord.com/api/webhooks/1/abc';

describe('notifications', () => {
  it('sends readable messages to Slack, Discord and Telegram', async () => {
    const { fetch, calls } = mockFetch();
    const payment = setup({
      fetch,
      channels: [
        { type: 'slack', webhookUrl: SLACK },
        { type: 'discord', webhookUrl: DISCORD },
        { type: 'telegram', botToken: '123:abc', chatId: -100 },
      ],
    });

    const result = await payment.createPayment(mockPaymentRequest);
    await payment.notifications.flush();

    const text = `✅ Payment received: 1.2 TRY (mock)\nPayment: ${result.paymentId} · Order: 123456789`;
    expect(calls).toEqual([
      { url: SLACK, body: { text } },
      { url: DISCORD, body: { content: text, allowed_mentions: { parse: [] } } },
      {
        url: 'https://api.telegram.org/bot123:abc/sendMessage',
        body: { chat_id: -100, text },
      },
    ]);
  });

  it('never puts card data in messages or custom channel events', async () => {
    const { fetch, calls } = mockFetch();
    const send = vi.fn();
    const payment = setup({
      fetch,
      channels: [
        { type: 'slack', webhookUrl: SLACK },
        { type: 'custom', send },
      ],
    });

    await payment.createPayment(mockPaymentRequest);
    await payment.notifications.flush();

    const card = mockPaymentRequest.paymentCard!.cardNumber;
    expect(JSON.stringify(calls)).not.toContain(card);
    const [message, event] = send.mock.calls[0];
    expect(message).not.toContain(card);
    expect(event).not.toHaveProperty('request');
    expect(event).not.toHaveProperty('result');
    expect(event).toMatchObject({ type: 'payment.succeeded', provider: 'mock', amount: '1.2' });
  });

  it('sends each channel only its events', async () => {
    const sales = vi.fn();
    const failures = vi.fn();
    const refunds = vi.fn();
    const payment = setup({
      channels: [
        { type: 'custom', send: sales, events: ['payment.succeeded'] },
        { type: 'custom', send: failures, events: ['payment.failed', 'refund.failed'] },
        { type: 'custom', send: refunds, events: ['refund.succeeded'] },
      ],
    });

    const paid = await payment.createPayment(mockPaymentRequest);
    await payment.createPayment(declined);
    await payment.refund({ ...mockRefundRequest, paymentId: paid.paymentId! });
    await payment.notifications.flush();

    expect(sales).toHaveBeenCalledTimes(1);
    expect(failures).toHaveBeenCalledTimes(1);
    expect(failures.mock.calls[0][0]).toContain('Error: INSUFFICIENT_FUNDS');
    expect(refunds).toHaveBeenCalledTimes(1);
    expect(refunds.mock.calls[0][0]).toMatch(/^↩️ Refund completed: 0.5 TRY \(mock\)/);
  });

  it('skips small amounts and filtered events', async () => {
    const send = vi.fn();
    const payment = setup({
      minAmount: 1,
      filter: (event) => event.conversationId !== 'skip',
      channels: [{ type: 'custom', send }],
    });

    await payment.createPayment(mockPaymentRequest); // 1.2
    await payment.createPayment({ ...mockPaymentRequest, price: '0.5', paidPrice: '0.5' });
    await payment.createPayment({ ...mockPaymentRequest, conversationId: 'skip' });
    await payment.notifications.flush();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('never fails the payment when a channel, format or onError fails', async () => {
    const { fetch, calls } = mockFetch(500);
    const onError = vi.fn();
    const reached = vi.fn();
    const payment = setup({
      fetch,
      onError,
      channels: [
        { type: 'slack', webhookUrl: SLACK },
        {
          type: 'custom',
          name: 'email',
          send: () => {
            throw new Error('SMTP down');
          },
        },
        { type: 'custom', send: reached },
      ],
    });

    const result = await payment.createPayment(mockPaymentRequest);
    await payment.notifications.flush();

    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(calls).toHaveLength(1);
    expect(reached).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls.map(([error, channel]) => [channel, error.message]).sort()).toEqual([
      ['email', 'SMTP down'],
      ['slack', 'HTTP 500'],
    ]);

    const broken = setup({
      format: () => {
        throw new Error('bad format');
      },
      onError: () => {
        throw new Error('bad onError');
      },
      channels: [{ type: 'custom', send: reached }],
    });
    expect((await broken.createPayment(mockPaymentRequest)).status).toBe(PaymentStatus.SUCCESS);
    await broken.notifications.flush();
  });

  it('logs failures to the payment logger without onError', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    const payment = betterPayment({
      logger,
      providers: { mock: new MockProvider() },
      plugins: [
        notifications({
          fetch: mockFetch(404).fetch,
          channels: [{ type: 'discord', webhookUrl: DISCORD }],
        }),
      ],
    });

    await payment.createPayment(mockPaymentRequest);
    await payment.notifications.flush();

    expect(logger.error).toHaveBeenCalledWith(
      'notifications: the discord channel failed',
      expect.objectContaining({ message: 'HTTP 404' }),
      expect.objectContaining({ event: 'payment.succeeded' })
    );
  });

  it('sends in the background and hands the work to waitUntil', async () => {
    let release!: () => void;
    const send = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const waitUntil = vi.fn();
    const payment = setup({ waitUntil, channels: [{ type: 'custom', send }] });

    // The payment returns while the message is still being sent
    await payment.createPayment(mockPaymentRequest);
    expect(send).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));

    let flushed = false;
    const flush = payment.notifications.flush().then(() => (flushed = true));
    await Promise.resolve();
    expect(flushed).toBe(false);
    release();
    await flush;
    expect(flushed).toBe(true);
  });

  it('formats messages in the localizedErrors languages, escaped for Slack', async () => {
    const { fetch, calls } = mockFetch();
    const payment = setup({
      fetch,
      locale: 'tr',
      channels: [{ type: 'slack', webhookUrl: SLACK }],
    });
    await payment.createPayment({ ...mockPaymentRequest, conversationId: '<@here> & co' });
    await payment.notifications.flush();
    expect(calls[0].body.text).toMatch(
      /^✅ Ödeme alındı: 1.2 TRY \(mock\)\nÖdeme: .+ · Sipariş: &lt;@here&gt; &amp; co$/
    );

    const event = {
      type: 'payment.failed',
      provider: 'iyzico',
      operation: 'createPayment',
    } as const;
    expect(formatNotification(event)).toBe('❌ Payment failed (iyzico)');
    expect(formatNotification(event, 'de')).toBe('❌ Zahlung fehlgeschlagen (iyzico)');
    expect(formatNotification(event, 'ru')).toBe('❌ Платёж не прошёл (iyzico)');
    expect(formatNotification(event, 'ar')).toBe('❌ فشلت الدفعة (iyzico)');
  });

  it('uses a custom format', async () => {
    const send = vi.fn();
    const payment = setup({
      format: (e) => `${e.type}: ${e.amount} ${e.currency} via ${e.provider}`,
      channels: [{ type: 'custom', send }],
    });
    await payment.createPayment(mockPaymentRequest);
    await payment.notifications.flush();
    expect(send.mock.calls[0][0]).toBe('payment.succeeded: 1.2 TRY via mock');
  });

  it('rejects incomplete channels and unknown languages', () => {
    expect(() => notifications({ channels: [{ type: 'slack', webhookUrl: '' }] })).toThrow(
      ConfigurationError
    );
    expect(() =>
      notifications({ channels: [{ type: 'telegram', botToken: 'x', chatId: '' }] })
    ).toThrow('the telegram channel is incomplete');
    expect(() =>
      notifications({ locale: 'fr' as 'en', channels: [{ type: 'custom', send: () => {} }] })
    ).toThrow("unknown locale 'fr'");
  });
});
