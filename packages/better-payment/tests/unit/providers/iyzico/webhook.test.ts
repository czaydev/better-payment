import { describe, it, expect, vi } from 'vitest';
import { betterPayment, iyzico, PaymentStatus, type PaymentEvent } from 'better-payment';
import { hmac, toHex } from '../../../../src/core/crypto';

const apiKey = 'test_api_key';
const secretKey = 'test_secret_key';

async function generateSignature(
  secret: string,
  event: { iyziEventType: string; paymentId: string; paymentConversationId: string; status: string }
) {
  const rawData = `${secret}${event.iyziEventType}${event.paymentId}${event.paymentConversationId}${event.status}`;
  return toHex(await hmac('SHA-256', secret, rawData));
}

describe('iyzico webhooks (merchant notifications)', () => {
  it('verifies a valid X-IYZ-SIGNATURE-V3 and returns PaymentResponse', async () => {
    const payment = betterPayment({
      providers: {
        iyzico: iyzico({ apiKey, secretKey }),
      },
    });

    const payload = {
      iyziEventType: 'CHECKOUT_FORM_AUTH',
      paymentId: '12345678',
      paymentConversationId: 'ORDER-101',
      status: 'SUCCESS',
      price: '100.00',
    };

    const signature = await generateSignature(secretKey, payload);

    const verification = await payment.iyzico.verifyWebhook(
      { 'x-iyz-signature-v3': signature },
      payload
    );

    expect(verification.valid).toBe(true);
    expect(verification.result?.status).toBe(PaymentStatus.SUCCESS);
    expect(verification.result?.paymentId).toBe('12345678');
    expect(verification.result?.conversationId).toBe('ORDER-101');
  });

  it('rejects tampered or missing signature', async () => {
    const payment = betterPayment({
      providers: {
        iyzico: iyzico({ apiKey, secretKey }),
      },
    });

    const payload = {
      iyziEventType: 'CHECKOUT_FORM_AUTH',
      paymentId: '12345678',
      paymentConversationId: 'ORDER-101',
      status: 'SUCCESS',
    };

    // Missing signature
    const missingRes = await payment.iyzico.verifyWebhook({}, payload);
    expect(missingRes.valid).toBe(false);

    // Tampered signature
    const tamperedRes = await payment.iyzico.verifyWebhook(
      { 'x-iyz-signature-v3': 'wrong_invalid_signature' },
      payload
    );
    expect(tamperedRes.valid).toBe(false);
  });

  it('handles webhook via HTTP handler, verifies signature and emits typed payment event', async () => {
    const succeededEvents: PaymentEvent<'payment.succeeded'>[] = [];

    const payment = betterPayment({
      providers: {
        iyzico: iyzico({ apiKey, secretKey }),
      },
    });

    payment.on('payment.succeeded', (event) => {
      succeededEvents.push(event);
    });

    const payload = {
      iyziEventType: 'CHECKOUT_FORM_AUTH',
      paymentId: '998877',
      paymentConversationId: 'CONV-555',
      status: 'SUCCESS',
    };

    const signature = await generateSignature(secretKey, payload);

    const response = await payment.handler.handle({
      method: 'POST',
      url: 'https://example.com/api/pay/iyzico/webhook',
      headers: {
        'content-type': 'application/json',
        'x-iyz-signature-v3': signature,
      },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ status: 'success', received: true }));

    // Verify typed payment event was emitted
    expect(succeededEvents).toHaveLength(1);
    expect(succeededEvents[0].paymentId).toBe('998877');
    expect(succeededEvents[0].conversationId).toBe('CONV-555');
  });

  it('rejects invalid webhook signatures with 401 in HTTP handler', async () => {
    const payment = betterPayment({
      providers: {
        iyzico: iyzico({ apiKey, secretKey }),
      },
    });

    const payload = {
      iyziEventType: 'CHECKOUT_FORM_AUTH',
      paymentId: '998877',
      paymentConversationId: 'CONV-555',
      status: 'SUCCESS',
    };

    const response = await payment.handler.handle({
      method: 'POST',
      url: 'https://example.com/api/pay/iyzico/webhook',
      headers: {
        'content-type': 'application/json',
        'x-iyz-signature-v3': 'bad_tampered_signature',
      },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(401);
  });

  it('processes duplicate webhook deliveries only once (idempotent)', async () => {
    const eventSpy = vi.fn();

    const payment = betterPayment({
      providers: {
        iyzico: iyzico({ apiKey, secretKey }),
      },
    });

    payment.on('payment.succeeded', eventSpy);

    const payload = {
      iyziEventType: 'CHECKOUT_FORM_AUTH',
      paymentId: 'DUPLICATE_ID',
      paymentConversationId: 'CONV-DUP',
      status: 'SUCCESS',
    };

    const signature = await generateSignature(secretKey, payload);

    const request = {
      method: 'POST',
      url: 'https://example.com/api/pay/iyzico/webhook',
      headers: {
        'content-type': 'application/json',
        'x-iyz-signature-v3': signature,
      },
      body: JSON.stringify(payload),
    };

    // First delivery
    const res1 = await payment.handler.handle(request);
    expect(res1.status).toBe(200);
    expect(eventSpy).toHaveBeenCalledTimes(1);

    // Duplicate delivery
    const res2 = await payment.handler.handle(request);
    expect(res2.status).toBe(200);
    // Must NOT emit duplicate event
    expect(eventSpy).toHaveBeenCalledTimes(1);
  });

  it('broadcasts payment.pending for a webhook that is not terminal', async () => {
    const payment = betterPayment({
      providers: {
        iyzico: iyzico({ apiKey, secretKey }),
      },
    });

    const failed: PaymentEvent[] = [];
    const pending: PaymentEvent[] = [];
    payment.on('payment.failed', (event) => failed.push(event));
    payment.on('payment.pending', (event) => pending.push(event));

    const payload = {
      iyziEventType: 'CREATE_INIT_3DS',
      paymentId: '445566',
      paymentConversationId: 'CONV-777',
      status: 'WAITING_FOR_AUTH',
    };

    const signature = await generateSignature(secretKey, payload);

    const response = await payment.handler.handle({
      method: 'POST',
      url: 'https://example.com/api/pay/iyzico/webhook',
      headers: {
        'content-type': 'application/json',
        'x-iyz-signature-v3': signature,
      },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);
    expect(pending).toHaveLength(1);
    expect(pending[0].paymentId).toBe('445566');
    // A 3DS step that is still in progress is not a failed payment
    expect(failed).toHaveLength(0);
  });

  it('keeps an explicit FAILURE webhook, and an error-only notification, failed', async () => {
    const payment = betterPayment({
      providers: {
        iyzico: iyzico({ apiKey, secretKey }),
      },
    });

    const failedPayload = {
      iyziEventType: 'CHECKOUT_FORM_AUTH',
      paymentId: '135790',
      paymentConversationId: 'CONV-900',
      status: 'FAILURE',
      errorCode: '51',
    };
    const failedSignature = await generateSignature(secretKey, failedPayload);
    const failedVerification = await payment.iyzico.verifyWebhook(
      { 'x-iyz-signature-v3': failedSignature },
      failedPayload
    );
    expect(failedVerification.valid).toBe(true);
    expect(failedVerification.result?.status).toBe(PaymentStatus.FAILURE);

    const errorOnlyPayload = {
      iyziEventType: 'CHECKOUT_FORM_AUTH',
      paymentId: '246813',
      paymentConversationId: 'CONV-901',
      errorCode: '12',
    };
    const errorOnlySignature = await generateSignature(secretKey, {
      ...errorOnlyPayload,
      status: '',
    });
    const errorOnlyVerification = await payment.iyzico.verifyWebhook(
      { 'x-iyz-signature-v3': errorOnlySignature },
      errorOnlyPayload
    );
    expect(errorOnlyVerification.result?.status).toBe(PaymentStatus.FAILURE);
  });
});
