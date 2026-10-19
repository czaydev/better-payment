import { describe, expect, it, vi } from 'vitest';
import type { BetterPaymentRequest, BetterPaymentResponse } from 'better-payment';
import {
  toExpressHandler,
  type HandlerSource,
  type NodeRequestLike,
  type NodeResponseLike,
} from 'better-payment/express';

function source(
  handle: (request: BetterPaymentRequest) => Promise<BetterPaymentResponse>
): HandlerSource {
  return { handle } as unknown as HandlerSource;
}

function request({
  method = 'POST',
  chunks = [],
  headers = {},
  streamError,
}: {
  method?: string;
  chunks?: Array<string | Uint8Array>;
  headers?: NodeRequestLike['headers'];
  streamError?: Error;
} = {}): NodeRequestLike {
  return {
    method,
    url: '/api/pay/mock/callback',
    headers,
    async *[Symbol.asyncIterator]() {
      if (streamError) throw streamError;
      yield* chunks;
    },
  };
}

function response(): NodeResponseLike & {
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

const ok = (body: unknown = { ok: true }): BetterPaymentResponse => ({
  status: 200,
  headers: {},
  body,
});

describe('Express adapter boundaries', () => {
  it.each(['handler', 'request stream'] as const)(
    'forwards a %s error to next without changing it',
    async (origin) => {
      const error = new Error(`${origin} failed`);
      const handle = vi.fn(async () => {
        if (origin === 'handler') throw error;
        return ok();
      });
      const req = request({
        streamError: origin === 'request stream' ? error : undefined,
      });
      const res = response();
      const next = vi.fn();

      await toExpressHandler(source(handle))(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith(error);
      expect(res.statusCode).toBe(0);
      expect(res.body).toBeUndefined();
    }
  );

  it('returns an empty 500 response when next is unavailable', async () => {
    const error = new Error('private failure detail');
    const res = response();

    await toExpressHandler(source(async () => Promise.reject(error)))(request(), res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain(error.message);
  });

  it.each(['GET', 'HEAD'])('does not consume the request stream for %s', async (method) => {
    let reads = 0;
    const req: NodeRequestLike = {
      method,
      url: '/api/pay/health',
      headers: {},
      async *[Symbol.asyncIterator]() {
        reads += 1;
        throw new Error('the stream must not be read');
      },
    };
    const handle = vi.fn(async (input: BetterPaymentRequest) => ok(input.body));

    await toExpressHandler(source(handle))(req, response());

    expect(reads).toBe(0);
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ body: undefined }));
  });

  it('measures string chunks in bytes and accepts the exact limit', async () => {
    const handle = vi.fn(async (input: BetterPaymentRequest) => ok(input.body));
    const exact = response();

    await toExpressHandler(source(handle), { maxBodySize: 4 })(request({ chunks: ['éé'] }), exact);

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ body: 'éé' }));
    expect(exact.statusCode).toBe(200);

    handle.mockClear();
    const oversized = response();
    await toExpressHandler(source(handle), { maxBodySize: 4 })(
      request({ chunks: ['ééa'] }),
      oversized
    );

    expect(handle).not.toHaveBeenCalled();
    expect(oversized.statusCode).toBe(413);
  });

  it('reassembles UTF-8 characters split across byte chunks', async () => {
    const handle = vi.fn(async (input: BetterPaymentRequest) => ok(input.body));
    const bytes = new TextEncoder().encode('A€B');

    await toExpressHandler(source(handle))(
      request({ chunks: [bytes.slice(0, 2), bytes.slice(2, 3), bytes.slice(3)] }),
      response()
    );

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ body: 'A€B' }));
  });
});
