import { describe, expect, it, vi } from 'vitest';
import type { BetterPaymentRequest, BetterPaymentResponse } from 'better-payment';
import {
  toFastifyPlugin,
  type FastifyInstanceLike,
  type FastifyReplyLike,
  type FastifyRequestLike,
  type HandlerSource,
} from 'better-payment/fastify';

const FORM = 'application/x-www-form-urlencoded';

function source(
  handle: (request: BetterPaymentRequest) => Promise<BetterPaymentResponse>
): HandlerSource {
  return { handle } as unknown as HandlerSource;
}

function fastify(hasParser = false) {
  let parserInstalled = hasParser;
  const routes = new Map<
    string,
    (request: FastifyRequestLike, reply: FastifyReplyLike) => Promise<unknown>
  >();
  let parser:
    | ((
        request: unknown,
        body: string,
        done: (error: Error | null, body?: unknown) => void
      ) => void)
    | undefined;
  const instance: FastifyInstanceLike = {
    hasContentTypeParser: vi.fn(() => parserInstalled),
    addContentTypeParser: vi.fn((_contentType, _options, added) => {
      parserInstalled = true;
      parser = added;
    }),
    all: vi.fn((path, handler) => {
      routes.set(path, handler);
    }),
  };
  return { instance, routes, getParser: () => parser };
}

function reply(): FastifyReplyLike & {
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

const ok = (body: unknown = { ok: true }): BetterPaymentResponse => ({
  status: 200,
  headers: { 'X-Adapter': 'fastify' },
  body,
});

describe('Fastify adapter boundaries', () => {
  it('preserves an existing form parser', async () => {
    const app = fastify(true);

    await toFastifyPlugin(source(async () => ok()))(app.instance);

    expect(app.instance.hasContentTypeParser).toHaveBeenCalledWith(FORM);
    expect(app.instance.addContentTypeParser).not.toHaveBeenCalled();
    expect(app.instance.all).toHaveBeenCalledTimes(2);
  });

  it('adds a missing raw form parser only once and keeps the body unchanged', async () => {
    const app = fastify();
    const plugin = toFastifyPlugin(source(async () => ok()));

    await plugin(app.instance);
    await plugin(app.instance);

    expect(app.instance.addContentTypeParser).toHaveBeenCalledOnce();
    expect(app.instance.addContentTypeParser).toHaveBeenCalledWith(
      FORM,
      { parseAs: 'string' },
      expect.any(Function)
    );

    const done = vi.fn();
    app.getParser()?.({}, 'merchant_oid=ORDER1&status=success', done);
    expect(done).toHaveBeenCalledWith(null, 'merchant_oid=ORDER1&status=success');
  });

  it('normalizes the body and headers before calling the handler', async () => {
    const app = fastify(true);
    const handle = vi.fn(async (input: BetterPaymentRequest): Promise<BetterPaymentResponse> => ({
      status: 200,
      headers: { 'X-Adapter': 'fastify' },
      body: input.body,
    }));
    await toFastifyPlugin(source(handle))(app.instance);
    const route = app.routes.get('/*');
    expect(route).toBeDefined();
    const res = reply();

    await route?.(
      {
        method: 'post',
        url: '/mock/callback',
        headers: {
          accept: ['application/json', 'text/plain'],
          'x-omitted': undefined,
        },
        body: '',
      },
      res
    );

    expect(handle).toHaveBeenCalledWith({
      method: 'POST',
      url: '/mock/callback',
      headers: { accept: 'application/json, text/plain' },
      body: undefined,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers).toEqual({ 'X-Adapter': 'fastify' });
    expect(res.body).toBeUndefined();
  });

  it('lets handler rejections propagate to Fastify', async () => {
    const error = new Error('route failed');
    const app = fastify(true);
    await toFastifyPlugin(source(async () => Promise.reject(error)))(app.instance);
    const route = app.routes.get('/');
    const res = reply();

    await expect(route?.({ method: 'POST', url: '/', headers: {}, body: 'raw' }, res)).rejects.toBe(
      error
    );
    expect(res.statusCode).toBeUndefined();
    expect(res.body).toBeUndefined();
  });
});
