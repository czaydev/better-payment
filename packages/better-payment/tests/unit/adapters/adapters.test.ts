import { describe, it, expect, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import Fastify from 'fastify';
import { Hono } from 'hono';
import { Elysia } from 'elysia';
import {
  betterPayment,
  type BetterPayment,
  ProviderType,
  toFetchHandler,
  paytr,
} from 'better-payment';
import { MockProvider, MOCK_CARDS } from 'better-payment/testing';
import { toNextJsHandler } from 'better-payment/next';
import { toExpressHandler, toNodeHandler } from 'better-payment/express';
import { toHonoHandler } from 'better-payment/hono';
import { toFastifyPlugin } from 'better-payment/fastify';
import { toElysiaHandler } from 'better-payment/elysia';
import { toReactRouterHandler } from 'better-payment/react-router';
import { mockPaymentRequest } from '../../fixtures/payment-data';

const PAYTR = { merchantId: '123456', merchantKey: 'KEY', merchantSalt: 'SALT' };

interface Reply {
  status: number;
  headers: Record<string, string>;
  text: string;
}
type Send = (method: string, path: string, body?: string, contentType?: string) => Promise<Reply>;

function createPayment(): BetterPayment {
  return betterPayment({
    providers: {
      [ProviderType.MOCK]: new MockProvider(),
      [ProviderType.PAYTR]: paytr({ ...PAYTR, testMode: true }),
    },
    handler: {
      allowedActions: 'all',
      authorize: () => true,
      callbackRedirect: (result) => `/orders/${result.paymentId}?payment=${result.status}`,
    },
  });
}

async function fromResponse(res: Response): Promise<Reply> {
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => (headers[key] = value));
  return { status: res.status, headers, text: await res.text() };
}

const servers: Server[] = [];
afterAll(() => servers.forEach((server) => server.close()));

async function listen(server: Server): Promise<Send> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return async (method, path, body, contentType) =>
    fromResponse(
      await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        body,
        redirect: 'manual',
        headers: contentType ? { 'content-type': contentType } : {},
      })
    );
}

const webRequest = (method: string, path: string, body?: string, contentType?: string) =>
  new Request(`http://localhost${path}`, {
    method,
    body,
    headers: contentType ? { 'content-type': contentType } : {},
  });

const adapters: Record<string, () => Promise<Send>> = {
  'fetch (toFetchHandler)': async () => {
    const handler = toFetchHandler(createPayment());
    return async (...args) => fromResponse(await handler(webRequest(...args)));
  },
  'Next.js (toNextJsHandler, lazy)': async () => {
    let payment: BetterPayment | undefined;
    const { GET, POST } = toNextJsHandler(() => (payment ??= createPayment()));
    return async (method, ...rest) =>
      fromResponse(await (method === 'GET' ? GET : POST)(webRequest(method, ...rest)));
  },
  'React Router (toReactRouterHandler, lazy)': async () => {
    let payment: BetterPayment | undefined;
    const { loader, action } = toReactRouterHandler(() => (payment ??= createPayment()));
    return async (method, ...rest) =>
      fromResponse(
        await (method === 'GET' ? loader : action)({ request: webRequest(method, ...rest) })
      );
  },
  Hono: async () => {
    const app = new Hono();
    app.all('/api/pay/*', toHonoHandler(createPayment()));
    return async (method, path, body, contentType) =>
      fromResponse(
        await app.request(path, {
          method,
          body,
          headers: contentType ? { 'content-type': contentType } : {},
        })
      );
  },
  Fastify: async () => {
    const app = Fastify();
    await app.register(toFastifyPlugin(createPayment()), { prefix: '/api/pay' });
    await app.ready();
    return async (method, path, body, contentType) => {
      const res = await app.inject({
        method: method as 'GET' | 'POST',
        url: path,
        payload: body,
        headers: contentType ? { 'content-type': contentType } : {},
      });
      return {
        status: res.statusCode,
        headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, String(v)])),
        text: res.body,
      };
    };
  },
  Elysia: async () => {
    const app = new Elysia().all('/api/pay/*', toElysiaHandler(createPayment()), {
      parse: 'none',
    });
    return async (...args) => fromResponse(await app.handle(webRequest(...args)));
  },
  // A hook that reads `body` makes Elysia parse the request; parse: 'none' keeps it raw
  'Elysia with a hook that reads the body': async () => {
    const app = new Elysia()
      .onTransform(({ body }) => void body)
      .all('/api/pay/*', toElysiaHandler(createPayment()), { parse: 'none' });
    return async (...args) => fromResponse(await app.handle(webRequest(...args)));
  },
  Express: async () => {
    const app = express();
    app.all('/api/pay/*path', toExpressHandler(createPayment()));
    return listen(createServer(app));
  },
  'Express with express.json() and express.urlencoded()': async () => {
    const app = express();
    app.use(express.json(), express.urlencoded({ extended: false }));
    app.use('/api/pay', toExpressHandler(createPayment()));
    return listen(createServer(app));
  },
  'node:http (toNodeHandler)': async () => listen(createServer(toNodeHandler(createPayment()))),
};

const FORM = 'application/x-www-form-urlencoded';

function paytrNotification(hash?: string): string {
  const fields = { merchant_oid: 'ORDER1', status: 'success', total_amount: '10000' };
  const signed = crypto
    .createHmac('sha256', PAYTR.merchantKey)
    .update(fields.merchant_oid + PAYTR.merchantSalt + fields.status + fields.total_amount)
    .digest('base64');
  return new URLSearchParams({ ...fields, hash: hash ?? signed }).toString();
}

describe.each(Object.entries(adapters))('%s', (_name, create) => {
  let send: Send;
  it('starts 3D Secure from a JSON body', async () => {
    send = await create();
    const res = await send(
      'POST',
      '/api/pay/mock/payment/init-3ds',
      JSON.stringify({ ...mockPaymentRequest, callbackUrl: 'https://shop.test/return' }),
      'application/json'
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = JSON.parse(res.text);
    expect(body.status).toBe('pending');

    // The bank posts the form back (form-urlencoded): 303 to callbackRedirect, no body
    const fields = Object.fromEntries(
      [...(body.threeDSHtmlContent as string).matchAll(/name="([^"]+)" value="([^"]*)"/g)].map(
        (m) => [m[1], m[2]]
      )
    );
    const complete = await send(
      'POST',
      '/api/pay/mock/payment/complete-3ds',
      new URLSearchParams(fields).toString(),
      FORM
    );
    expect(complete.status).toBe(303);
    expect(complete.headers.location).toBe(`/orders/${body.paymentId}?payment=success`);
    expect(complete.text).toBe('');

    const fetched = await send('GET', `/api/pay/mock/payment/${body.paymentId}`);
    expect(fetched.status).toBe(200);
    expect(JSON.parse(fetched.text)).toMatchObject({
      status: 'success',
      paymentId: body.paymentId,
    });
  });

  it('answers a PayTR notification with plain OK, and rejects a forged one', async () => {
    const ok = await send('POST', '/api/pay/paytr/callback', paytrNotification(), FORM);
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('OK');
    expect(ok.headers['content-type']).toContain('text/plain');

    const forged = await send('POST', '/api/pay/paytr/callback', paytrNotification('forged'), FORM);
    expect(forged.status).toBe(400);
  });

  it('answers 413 for a body larger than 1 MiB', async () => {
    const res = await send(
      'POST',
      '/api/pay/paytr/callback',
      'a=' + 'x'.repeat(2 * 1024 * 1024),
      FORM
    );
    expect(res.status).toBe(413);
  });

  it('rejects invalid JSON and serves the health check', async () => {
    const bad = await send('POST', '/api/pay/mock/payment', '{not json', 'application/json');
    expect(bad.status).toBe(400);
    const health = await send('GET', '/api/pay/health');
    expect(health.status).toBe(200);
    expect(JSON.parse(health.text)).toMatchObject({ status: 'ok' });
  });
});

describe('body size limit', () => {
  const stream = (bytes: number, chunk = 64 * 1024) => {
    let sent = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= bytes) return controller.close();
        controller.enqueue(new Uint8Array(chunk).fill(97));
        sent += chunk;
      },
    });
  };

  it('stops reading a streamed body without Content-Length at maxBodySize', async () => {
    const handler = toFetchHandler(createPayment(), { maxBodySize: 100 * 1024 });
    const body = stream(10 * 1024 * 1024);
    const res = await handler(
      new Request('http://localhost/api/pay/paytr/callback', {
        method: 'POST',
        body,
        headers: { 'content-type': FORM },
        duplex: 'half',
      } as RequestInit)
    );
    expect(res.status).toBe(413);
  });

  it('accepts a body up to maxBodySize', async () => {
    const handler = toFetchHandler(createPayment(), { maxBodySize: 10 });
    const res = await handler(
      webRequest('POST', '/api/pay/mock/payment', '{"a":1}', 'application/json')
    );
    expect(res.status).not.toBe(413);
  });

  it('applies maxBodySize in the Express adapter', async () => {
    const send = await listen(
      createServer(toExpressHandler(createPayment(), { maxBodySize: 1024 }))
    );
    const res = await send('POST', '/api/pay/paytr/callback', 'a=' + 'x'.repeat(4096), FORM);
    expect(res.status).toBe(413);
  });
});
