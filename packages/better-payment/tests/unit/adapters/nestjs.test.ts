import { describe, expect, it, vi } from 'vitest';
import type { BetterPaymentRequest, BetterPaymentResponse } from 'better-payment';
import {
  toNestHandler,
  type HandlerSource,
  type NestFastifyReplyLike,
  type NestFastifyRequestLike,
  type NodeRequestLike,
  type NodeResponseLike,
} from 'better-payment/nestjs';

function source(
  handle: (request: BetterPaymentRequest) => Promise<BetterPaymentResponse>
): HandlerSource {
  return { handle } as unknown as HandlerSource;
}

const URL_PATH = '/api/pay/mock/callback';

function expressRequest({
  method = 'POST',
  chunks = [],
  headers = {},
  body,
  readableEnded,
}: {
  method?: string;
  chunks?: Array<string | Uint8Array>;
  headers?: NodeRequestLike['headers'];
  body?: unknown;
  readableEnded?: boolean;
} = {}): NodeRequestLike {
  return {
    method,
    url: URL_PATH,
    originalUrl: URL_PATH,
    headers,
    body,
    readableEnded,
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  };
}

function expressResponse(): NodeResponseLike & {
  body: string | undefined;
  headers: Record<string, string>;
} {
  return {
    statusCode: 0,
    body: undefined,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}

function fastifyRequest({
  method = 'POST',
  headers = {},
  body,
}: {
  method?: string;
  headers?: NestFastifyRequestLike['headers'];
  body?: unknown;
} = {}): NestFastifyRequestLike {
  return { method, url: URL_PATH, headers, body };
}

function fastifyReply(): NestFastifyReplyLike & {
  statusCode?: number;
  headers: Record<string, string>;
  body?: unknown;
} {
  return {
    headers: {},
    code(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    header(name, value) {
      this.headers[name] = value;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('NestJS adapter platform detection', () => {
  it('routes an Express-like response through the Express handler', async () => {
    const handle = vi.fn(async () => ({ status: 200, headers: {}, body: { ok: true } }));
    const res = expressResponse();

    await toNestHandler(source(handle))(expressRequest({ chunks: ['raw'] }), res);

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ body: 'raw' }));
    expect(res.statusCode).toBe(200);
  });

  it('routes a Fastify-like reply through the Fastify handler', async () => {
    const handle = vi.fn(async () => ({ status: 200, headers: {}, body: { ok: true } }));
    const reply = fastifyReply();

    await toNestHandler(source(handle))(fastifyRequest({ body: 'raw' }), reply);

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ body: 'raw' }));
    expect(reply.statusCode).toBe(200);
  });
});

describe.each([
  ['platform-express', expressRequest, expressResponse],
  ['platform-fastify', fastifyRequest, fastifyReply],
] as const)('NestJS adapter on %s', (_name, makeRequest, makeResponse) => {
  it.each(['GET', 'POST', 'PUT'])('forwards the %s method and the full request path', async (method) => {
    const handle = vi.fn(async (input: BetterPaymentRequest) => ({
      status: 200,
      headers: {},
      body: { method: input.method },
    }));
    const res = makeResponse();

    await toNestHandler(source(handle))(makeRequest({ method }), res);

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ method, url: URL_PATH }));
  });

  it('copies the status, headers and JSON body from the handler', async () => {
    const handle = vi.fn(async (): Promise<BetterPaymentResponse> => ({
      status: 201,
      headers: { 'X-Payment': 'ok' },
      body: { paymentId: 'P1' },
    }));
    const res = makeResponse();

    await toNestHandler(source(handle))(makeRequest(), res);

    const sent = res as { statusCode: number; headers: Record<string, string>; body: unknown };
    expect(sent.statusCode).toBe(201);
    expect(sent.headers['X-Payment']).toBe('ok');
    expect(sent.headers['Content-Type'] ?? sent.headers['content-type']).toContain('application/json');
    expect(typeof sent.body).toBe('string');
    expect(JSON.parse(sent.body as string)).toEqual({ paymentId: 'P1' });
  });

  it('keeps a redirect Location and sends no body', async () => {
    const handle = vi.fn(async (): Promise<BetterPaymentResponse> => ({
      status: 303,
      headers: { Location: '/orders/P1' },
    }));
    const res = makeResponse();

    await toNestHandler(source(handle))(makeRequest(), res);

    const sent = res as { statusCode: number; headers: Record<string, string>; body: unknown };
    expect(sent.statusCode).toBe(303);
    expect(sent.headers.Location).toBe('/orders/P1');
    expect(sent.body ?? undefined).toBeUndefined();
  });

  it('sends a plain-text OK body without adding a JSON content type', async () => {
    const handle = vi.fn(async (): Promise<BetterPaymentResponse> => ({
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: 'OK',
    }));
    const res = makeResponse();

    await toNestHandler(source(handle))(makeRequest(), res);

    const sent = res as { statusCode: number; headers: Record<string, string>; body: unknown };
    expect(sent.body).toBe('OK');
  });

  it('forwards the request path and copies a 404 from the handler verbatim', async () => {
    const handle = vi.fn(async (): Promise<BetterPaymentResponse> => ({
      status: 404,
      headers: { 'Content-Type': 'application/json' },
      body: { error: true, message: 'Route not found' },
    }));
    const res = makeResponse();

    await toNestHandler(source(handle))(makeRequest({ method: 'GET' }), res);

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ url: URL_PATH }));
    const sent = res as { statusCode: number; headers: Record<string, string>; body: unknown };
    expect(sent.statusCode).toBe(404);
    expect(JSON.parse(sent.body as string)).toMatchObject({ error: true });
  });
});

describe('NestJS adapter body parsing', () => {
  it('reassembles a raw form-urlencoded body on platform-express', async () => {
    const handle = vi.fn(async (input: BetterPaymentRequest) => ({
      status: 200,
      headers: {},
      body: input.body,
    }));
    const res = expressResponse();

    await toNestHandler(source(handle))(
      expressRequest({
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        chunks: ['merchant_oid=ORDER1', '&status=success'],
      }),
      res
    );

    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'merchant_oid=ORDER1&status=success' })
    );
  });

  it('reassembles a raw JSON body split across chunks on platform-express', async () => {
    const handle = vi.fn(async (input: BetterPaymentRequest) => ({
      status: 200,
      headers: {},
      body: input.body,
    }));
    const res = expressResponse();

    await toNestHandler(source(handle))(expressRequest({ chunks: ['{"a":', '1}'] }), res);

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ body: '{"a":1}' }));
  });

  it('uses a body a controller-level parser already produced', async () => {
    const handle = vi.fn(async (input: BetterPaymentRequest) => ({
      status: 200,
      headers: {},
      body: input.body,
    }));
    const res = expressResponse();

    await toNestHandler(source(handle))(
      expressRequest({ body: { merchant_oid: 'ORDER1' }, readableEnded: true }),
      res
    );

    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ body: { merchant_oid: 'ORDER1' } })
    );
  });

  it('passes the Fastify request body through, and treats an empty string as no body', async () => {
    const handle = vi.fn(async (input: BetterPaymentRequest) => ({
      status: 200,
      headers: {},
      body: input.body,
    }));

    await toNestHandler(source(handle))(
      fastifyRequest({ body: 'merchant_oid=ORDER1' }),
      fastifyReply()
    );
    expect(handle).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: 'merchant_oid=ORDER1' })
    );

    await toNestHandler(source(handle))(fastifyRequest({ body: '' }), fastifyReply());
    expect(handle).toHaveBeenLastCalledWith(expect.objectContaining({ body: undefined }));
  });

  it('flattens repeated request headers on platform-fastify', async () => {
    const handle = vi.fn(async () => ({ status: 200, headers: {}, body: undefined }));

    await toNestHandler(source(handle))(
      fastifyRequest({ headers: { accept: ['application/json', 'text/plain'] } }),
      fastifyReply()
    );

    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { accept: 'application/json, text/plain' } })
    );
  });
});
