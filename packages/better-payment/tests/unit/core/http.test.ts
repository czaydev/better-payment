import { describe, it, expect, vi } from 'vitest';
import { HttpClient, HttpError } from '../../../src/core/http';
import { isNetworkError } from '../../../src/core/utils';
import { failureResult } from '../../../src/core/failure';
import { betterPayment, PaymentStatus, ProviderType, iyzico } from '../../../src';
import type { BetterPaymentLogger } from '../../../src/core/logger';

function recordingFetch(response: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response();
  };
  return { calls, fetchImpl };
}

const http = (
  fetchImpl: typeof fetch,
  extra: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}
) =>
  new HttpClient({
    provider: 'test',
    baseURL: 'https://api.example.com/',
    timeout: 1000,
    fetch: fetchImpl,
    ...extra,
  });

describe('HttpClient', () => {
  it('joins baseURL and path, merges headers and sends the body as is', async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response('{"a":1}'));
    const client = http(fetchImpl, { headers: { 'Content-Type': 'application/json', 'X-A': '1' } });
    const res = await client.post('/payment/auth', '{"x":1}', { headers: { 'X-B': '2' } });

    expect(calls[0].url).toBe('https://api.example.com/payment/auth');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBe('{"x":1}');
    expect(calls[0].init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-A': '1',
      'X-B': '2',
    });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(res).toMatchObject({ status: 200, data: { a: 1 } });
  });

  it('posts to the baseURL itself for an empty path, and keeps absolute URLs', async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response('ok'));
    await http(fetchImpl).post('', '<xml/>');
    await http(fetchImpl).get('https://other.example.com/x');
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.example.com/',
      'https://other.example.com/x',
    ]);
    expect(calls[1].init.body).toBeUndefined();
  });

  it('returns non-JSON bodies as text, and raw text for responseType text', async () => {
    const { fetchImpl } = recordingFetch(() => new Response('OK'));
    expect((await http(fetchImpl).get('/')).data).toBe('OK');
    const json = recordingFetch(() => new Response('{"a":1}'));
    expect((await http(json.fetchImpl).get('/', { responseType: 'text' })).data).toBe('{"a":1}');
  });

  it('throws HttpError with the parsed response for non-2xx statuses', async () => {
    const { fetchImpl } = recordingFetch(
      () => new Response('{"errorCode":"5001","errorMessage":"Bad"}', { status: 400 })
    );
    const error = await http(fetchImpl)
      .post('/x', '{}')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).isNetworkError).toBe(false);
    expect((error as HttpError).response).toMatchObject({
      status: 400,
      data: { errorCode: '5001' },
    });
    expect(isNetworkError(error)).toBe(false);

    const result = failureResult('Test', error, 'failed');
    expect(result).toMatchObject({
      status: PaymentStatus.FAILURE,
      errorCode: '5001',
      errorMessage: 'Bad',
    });
  });

  it('resolves statuses accepted by validateStatus', async () => {
    const { fetchImpl } = recordingFetch(() => new Response('{"code":"X"}', { status: 422 }));
    const res = await http(fetchImpl).post('/x', '{}', { validateStatus: (s) => s < 500 });
    expect(res).toMatchObject({ status: 422, data: { code: 'X' } });
  });

  it('reports transport errors as network errors with the underlying code', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
      });
    };
    const error = await http(fetchImpl)
      .post('/x', '{}')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      isNetworkError: true,
      code: 'ECONNRESET',
      message: 'read ECONNRESET',
    });
    expect(isNetworkError(error)).toBe(true);

    const result = failureResult('iyzico', error, 'failed');
    expect(result.status).toBe(PaymentStatus.PENDING);
    expect(result.errorMessage).toContain('No response from iyzico (ECONNRESET: read ECONNRESET)');
  });

  it('times out with ETIMEDOUT', async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const error = await http(fetchImpl, { timeout: 20 })
      .get('/slow')
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ isNetworkError: true, code: 'ETIMEDOUT' });
  });

  it('logs method, URL and status without bodies', async () => {
    const logger: BetterPaymentLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const ok = recordingFetch(() => new Response('{}'));
    await http(ok.fetchImpl, { logger }).post('/pay', '{"cardNumber":"5528790000000008"}');
    expect(logger.debug).toHaveBeenCalledWith(
      '[test] POST https://api.example.com/pay',
      expect.anything()
    );
    expect(logger.debug).toHaveBeenCalledWith(
      '[test] 200 https://api.example.com/pay',
      expect.anything()
    );
    expect(JSON.stringify((logger.debug as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
      '5528'
    );

    const bad = recordingFetch(() => new Response('{}', { status: 500 }));
    await http(bad.fetchImpl, { logger })
      .get('/x')
      .catch(() => undefined);
    expect(logger.error).toHaveBeenCalledWith(
      '[test] Request failed: Request failed with status code 500',
      expect.any(HttpError),
      expect.objectContaining({ status: 500 })
    );
  });

  it('does not keep the request body or headers on HttpError (it is logged)', async () => {
    const logger: BetterPaymentLogger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    const failing = [
      recordingFetch(() => new Response('{}', { status: 500 })).fetchImpl,
      (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    ];
    for (const fetchImpl of failing) {
      const error = await http(fetchImpl, { logger })
        .post('/pay', '{"cardNumber":"5528790000000008","cvc":"123"}', {
          headers: { Authorization: 'IYZWSv2 secret' },
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).config).toMatchObject({ method: 'POST', url: '/pay' });
      const logged = JSON.stringify((logger.error as ReturnType<typeof vi.fn>).mock.calls, (_k, v) =>
        v instanceof Error ? { ...v } : v
      );
      expect(logged).not.toContain('5528790000000008');
      expect(logged).not.toContain('IYZWSv2 secret');
    }
  });

  it('uses the fetch passed to BetterPayment for provider calls', async () => {
    const { calls, fetchImpl } = recordingFetch(
      () =>
        new Response(
          JSON.stringify({ status: 'success', binNumber: '552879', cardType: 'CREDIT_CARD' })
        )
    );
    const payment = betterPayment({
      mode: 'sandbox',
      fetch: fetchImpl,
      providers: {
        [ProviderType.IYZICO]: iyzico({ apiKey: 'k', secretKey: 's' }),
      },
    });
    const result = await payment.use(ProviderType.IYZICO).binCheck('552879');
    expect(result.cardType).toBe('CREDIT_CARD');
    expect(calls[0].url).toBe('https://sandbox-api.iyzipay.com/payment/bin/check');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toMatch(/^IYZWSv2 /);
  });
});
