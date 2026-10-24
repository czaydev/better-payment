import { describe, it, expect, vi } from 'vitest';
import { betterPayment, ConfigurationError, PaymentStatus } from 'better-payment';
import { MockProvider, MOCK_CARDS } from 'better-payment/testing';
import {
  webhookForwarding,
  verifyForwardedWebhook,
  type WebhookForwardingOptions,
} from 'better-payment/plugins';
import { mockPaymentRequest, mockRefundRequest } from '../../fixtures/payment-data';

const declinedPayment = {
  ...mockPaymentRequest,
  paymentCard: { ...mockPaymentRequest.paymentCard!, cardNumber: MOCK_CARDS.INSUFFICIENT_FUNDS },
};

function createMockFetch(responses: { status: number; body?: string }[] = [{ status: 200 }]) {
  let callIndex = 0;
  const calls: {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
    rawBody: string;
  }[] = [];

  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const rawBody = String(init?.body ?? '');
    let parsedBody: Record<string, unknown> = {};
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      // ignore
    }
    const headersObj: Record<string, string> = {};
    if (init?.headers) {
      if (typeof (init.headers as Headers).forEach === 'function') {
        (init.headers as Headers).forEach((v, k) => {
          headersObj[k.toLowerCase()] = v;
        });
      } else {
        for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
          headersObj[k.toLowerCase()] = v;
        }
      }
    }

    calls.push({
      url: String(url),
      headers: headersObj,
      body: parsedBody,
      rawBody,
    });

    const resp = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    return new Response(resp.body ?? '{}', { status: resp.status });
  });

  return { fetch: fetchImpl as unknown as typeof globalThis.fetch, calls };
}

function setup(options: WebhookForwardingOptions) {
  return betterPayment({
    providers: { mock: new MockProvider() },
    plugins: [webhookForwarding(options)],
  });
}

const WEBHOOK_URL = 'https://api.example.com/webhooks/payments';
const SECRET = 'whsec_test_secret_12345';

describe('webhookForwarding plugin', () => {
  it('validates configuration options', () => {
    expect(() => webhookForwarding({ endpoints: [] })).toThrow(ConfigurationError);
    expect(() =>
      webhookForwarding({
        // @ts-expect-error test invalid endpoint
        endpoints: [{ url: '' }],
      })
    ).toThrow(ConfigurationError);
    expect(() =>
      webhookForwarding({
        // @ts-expect-error test missing secret
        endpoints: [{ url: WEBHOOK_URL }],
      })
    ).toThrow(ConfigurationError);
  });

  it('delivers signed webhooks on successful payment', async () => {
    const { fetch, calls } = createMockFetch([{ status: 200 }]);
    const payment = setup({
      fetch,
      endpoints: [{ url: WEBHOOK_URL, secret: SECRET }],
    });

    const result = await payment.createPayment(mockPaymentRequest);
    expect(result.status).toBe(PaymentStatus.SUCCESS);

    await payment.webhooks.flush();

    expect(calls.length).toBe(1);
    const call = calls[0];
    expect(call.url).toBe(WEBHOOK_URL);
    expect(call.headers['content-type']).toBe('application/json');

    const signature = call.headers['x-signature'];
    expect(signature).toBeDefined();
    expect(call.headers['x-better-payment-signature']).toBe(signature);

    // Verify signature with verifyForwardedWebhook helper
    const isValid = await verifyForwardedWebhook(call.rawBody, signature, SECRET);
    expect(isValid).toBe(true);

    // Payload verification
    expect(call.body.event).toBe('payment.succeeded');
    expect(call.body.provider).toBe('mock');
    expect(call.body.paymentId).toBe(result.paymentId);
    expect(call.body.conversationId).toBe('123456789');
    expect(typeof call.body.timestamp).toBe('number');
  });

  it('verifies signature helper correctly detects tampered body and invalid secrets', async () => {
    const { fetch, calls } = createMockFetch([{ status: 200 }]);
    const payment = setup({
      fetch,
      endpoints: [{ url: WEBHOOK_URL, secret: SECRET }],
    });

    await payment.createPayment(mockPaymentRequest);
    await payment.webhooks.flush();

    const signature = calls[0].headers['x-signature'];
    const rawBody = calls[0].rawBody;

    // Correct payload & secret
    expect(await verifyForwardedWebhook(rawBody, signature, SECRET)).toBe(true);

    // Supports sha256= prefix
    expect(await verifyForwardedWebhook(rawBody, `sha256=${signature}`, SECRET)).toBe(true);

    // Tampered payload
    expect(await verifyForwardedWebhook(rawBody + 'tampered', signature, SECRET)).toBe(false);

    // Wrong secret
    expect(await verifyForwardedWebhook(rawBody, signature, 'wrong_secret')).toBe(false);

    // Missing signature or secret
    expect(await verifyForwardedWebhook(rawBody, '', SECRET)).toBe(false);
    expect(await verifyForwardedWebhook(rawBody, signature, '')).toBe(false);
  });

  it('filters events based on endpoint configuration', async () => {
    const { fetch, calls } = createMockFetch([{ status: 200 }]);
    const SUCCESS_URL = 'https://api.example.com/webhooks/success-only';
    const FAILED_URL = 'https://api.example.com/webhooks/failed-only';

    const payment = setup({
      fetch,
      endpoints: [
        { url: SUCCESS_URL, secret: SECRET, events: ['payment.succeeded'] },
        { url: FAILED_URL, secret: SECRET, events: ['payment.failed'] },
      ],
    });

    // 1. Success payment
    await payment.createPayment(mockPaymentRequest);
    await payment.webhooks.flush();

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(SUCCESS_URL);
    expect(calls[0].body.event).toBe('payment.succeeded');

    // 2. Failed payment
    await payment.createPayment(declinedPayment);
    await payment.webhooks.flush();

    expect(calls.length).toBe(2);
    expect(calls[1].url).toBe(FAILED_URL);
    expect(calls[1].body.event).toBe('payment.failed');
  });

  it('retries failed endpoint deliveries with backoff', async () => {
    // Fail first 2 attempts with 500, succeed on 3rd attempt
    const { fetch, calls } = createMockFetch([
      { status: 500 },
      { status: 502 },
      { status: 200 },
    ]);

    const payment = setup({
      fetch,
      retry: { attempts: 3, delay: 10 },
      endpoints: [{ url: WEBHOOK_URL, secret: SECRET }],
    });

    await payment.createPayment(mockPaymentRequest);
    await payment.webhooks.flush();

    expect(calls.length).toBe(3);
    expect(calls[0].url).toBe(WEBHOOK_URL);
    expect(calls[1].url).toBe(WEBHOOK_URL);
    expect(calls[2].url).toBe(WEBHOOK_URL);
  });

  it('a failing endpoint does not block or fail the primary payment', async () => {
    const onError = vi.fn();
    const { fetch, calls } = createMockFetch([{ status: 500 }]);

    const payment = setup({
      fetch,
      onError,
      retry: { attempts: 2, delay: 5 },
      endpoints: [{ url: 'https://broken.endpoint.com', secret: SECRET }],
    });

    // Primary payment should succeed without throwing
    const result = await payment.createPayment(mockPaymentRequest);
    expect(result.status).toBe(PaymentStatus.SUCCESS);

    await payment.webhooks.flush();

    expect(calls.length).toBe(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1].url).toBe('https://broken.endpoint.com');
  });

  it('sanitizes card details from forwarded payloads', async () => {
    const { fetch, calls } = createMockFetch([{ status: 200 }]);
    const payment = setup({
      fetch,
      endpoints: [{ url: WEBHOOK_URL, secret: SECRET }],
    });

    // Provide payment with mock card
    await payment.createPayment(mockPaymentRequest);
    await payment.webhooks.flush();

    expect(calls.length).toBe(1);
    const resultData = calls[0].body.result as Record<string, unknown>;
    expect(resultData.card).toBeUndefined();
    expect(resultData.cardNumber).toBeUndefined();
    expect(resultData.cvv).toBeUndefined();
  });
});
