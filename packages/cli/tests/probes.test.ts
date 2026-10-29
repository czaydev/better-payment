import { describe, expect, it } from 'vitest';
import { PROVIDER_DEFAULT_URLS } from 'better-payment';
import {
  classifyProbe,
  clockSkewSeconds,
  createCapturingFetch,
  probeProvider,
  resolveProvider,
  sanitizeMessage,
  signsTimestamp,
  type ProbeObservation,
} from '../src/probes';
import { fakeIo, httpResponse, type FakeIo } from './helpers';

const IYZICO_URLS = PROVIDER_DEFAULT_URLS.iyzico;

function observationOf(overrides: Partial<ProbeObservation>): ProbeObservation {
  return {
    id: 'iyzico',
    mode: 'sandbox',
    baseUrl: IYZICO_URLS.sandbox,
    method: 'binCheck',
    http: [],
    returned: false,
    ...overrides,
  };
}

function httpRecord(status: number, body = '{}', contentType = 'application/json') {
  return { url: IYZICO_URLS.sandbox, status, contentType, bodySample: body };
}

describe('resolveProvider', () => {
  it('collects credentials from the environment', () => {
    const io = fakeIo({
      env: { IYZICO_API_KEY: ' key-123 ', IYZICO_SECRET_KEY: 'sec-456' },
    });
    const resolved = resolveProvider(io, 'iyzico', 'sandbox');
    expect(resolved.credentials).toEqual({ apiKey: 'key-123', secretKey: 'sec-456' });
    expect(resolved.missing).toEqual([]);
    expect(resolved.placeholders).toEqual([]);
    expect(resolved.baseUrl).toBe(IYZICO_URLS.sandbox);
    expect(resolved.modeMismatch).toBeUndefined();
  });

  it('reports missing variables', () => {
    const resolved = resolveProvider(fakeIo({}), 'iyzico', 'sandbox');
    expect(resolved.missing).toEqual(['IYZICO_API_KEY', 'IYZICO_SECRET_KEY']);
  });

  it('reports generated placeholders', () => {
    const resolved = resolveProvider(
      fakeIo({ env: { IYZICO_API_KEY: 'your-iyzico-api-key', IYZICO_SECRET_KEY: 'real' } }),
      'iyzico',
      'sandbox'
    );
    expect(resolved.placeholders).toEqual(['IYZICO_API_KEY']);
    expect(resolved.credentials).toEqual({ secretKey: 'real' });
  });

  it('detects a base URL from the other mode', () => {
    const resolved = resolveProvider(
      fakeIo({ env: { IYZICO_API_KEY: 'k', IYZICO_SECRET_KEY: 's' } }),
      'iyzico',
      'sandbox'
    );
    const production = resolveProvider(
      {
        ...fakeIo({}),
        env: { IYZICO_API_KEY: 'k', IYZICO_SECRET_KEY: 's', IYZICO_BASE_URL: IYZICO_URLS.sandbox },
      } as FakeIo,
      'iyzico',
      'production'
    );
    expect(production.modeMismatch).toBe('sandbox');
    expect(resolved.modeMismatch).toBeUndefined();
  });

  it('honours the base-url override', () => {
    const resolved = resolveProvider(
      fakeIo({
        env: {
          IYZICO_API_KEY: 'k',
          IYZICO_SECRET_KEY: 's',
          IYZICO_BASE_URL: 'http://localhost:9999',
        },
      }),
      'iyzico',
      'sandbox'
    );
    expect(resolved.baseUrl).toBe('http://localhost:9999');
  });

  it('trims a trailing slash before comparing hosts', () => {
    const resolved = resolveProvider(
      fakeIo({
        env: {
          IYZICO_API_KEY: 'k',
          IYZICO_SECRET_KEY: 's',
          IYZICO_BASE_URL: `${IYZICO_URLS.production}/`,
        },
      }),
      'iyzico',
      'sandbox'
    );
    expect(resolved.modeMismatch).toBe('production');
  });
});

describe('sanitizeMessage', () => {
  it('masks secret values', () => {
    expect(sanitizeMessage('key abc123 rejected', ['abc123'])).toBe('key *** rejected');
  });

  it('collapses whitespace', () => {
    expect(sanitizeMessage('line1\n  line2\tline3', [])).toBe('line1 line2 line3');
  });

  it('truncates long messages', () => {
    const long = 'x'.repeat(500);
    const result = sanitizeMessage(long, []);
    expect(result.length).toBeLessThanOrEqual(240);
    expect(result.endsWith('...')).toBe(true);
  });

  it('handles a missing message', () => {
    expect(sanitizeMessage(undefined, [])).toBe('no message');
  });
});

describe('classifyProbe', () => {
  it('a network error is a mode/base URL problem', () => {
    const verdict = classifyProbe(observationOf({ networkError: 'getaddrinfo ENOTFOUND' }));
    expect(verdict.verdict).toBe('unreachable');
    expect(verdict.status).toBe('fail');
    expect(verdict.details.join(' ')).toContain('not a key problem');
  });

  it('401 means the credentials were rejected', () => {
    const verdict = classifyProbe(
      observationOf({ http: [httpRecord(401, '{"errorMessage":"Invalid auth"}')] })
    );
    expect(verdict.verdict).toBe('rejected');
    expect(verdict.status).toBe('fail');
    expect(verdict.details.join(' ')).toContain('rotate');
  });

  it('404 means the base URL does not expose the endpoint', () => {
    const verdict = classifyProbe(observationOf({ http: [httpRecord(404)] }));
    expect(verdict.verdict).toBe('unreachable');
    expect(verdict.message).toContain('404');
    expect(verdict.details.join(' ')).toContain('not a key problem');
  });

  it('an HTML page means the wrong host, the key was never checked', () => {
    const verdict = classifyProbe(
      observationOf({
        http: [{ ...httpRecord(200, '<!doctype html><html>login</html>', 'text/html') }],
      })
    );
    expect(verdict.verdict).toBe('unreachable');
    expect(verdict.message).toContain('HTML');
  });

  it('a 5xx is inconclusive', () => {
    const verdict = classifyProbe(observationOf({ http: [httpRecord(503)] }));
    expect(verdict.verdict).toBe('inconclusive');
    expect(verdict.status).toBe('warn');
  });

  it('an authentication wording in the provider message is rejected', () => {
    const verdict = classifyProbe(
      observationOf({
        http: [httpRecord(200)],
        providerMessage: 'kimlik doğrulama başarısız',
      })
    );
    expect(verdict.verdict).toBe('rejected');
  });

  it('a business answer with credentials accepted is a pass', () => {
    const verdict = classifyProbe(
      observationOf({
        http: [httpRecord(200, '{"status":"success"}')],
        returned: true,
        providerMessage: 'BIN not found',
      })
    );
    expect(verdict.verdict).toBe('accepted');
    expect(verdict.status).toBe('pass');
    expect(verdict.message).toContain('BIN not found');
  });

  it('any answer counts as accepted even when the wrapper threw a non-auth error', () => {
    const verdict = classifyProbe(
      observationOf({
        http: [httpRecord(200, '{"status":"failure","errorMessage":"order not found"}')],
      })
    );
    expect(verdict.verdict).toBe('accepted');
  });

  it('nothing at all is inconclusive', () => {
    const verdict = classifyProbe(observationOf({}));
    expect(verdict.verdict).toBe('inconclusive');
    expect(verdict.status).toBe('warn');
  });

  it('classification output stays free of credential values end to end', async () => {
    const io = fakeIo({
      env: { IYZICO_API_KEY: 'sk_live_abc123', IYZICO_SECRET_KEY: 's' },
      fetch: (async () => httpResponse(401, 'bad key sk_live_abc123')) as typeof fetch,
    });
    const observation = await probeProvider(io, resolveProvider(io, 'iyzico', 'sandbox'));
    const verdict = classifyProbe(observation);
    expect(verdict.verdict).toBe('rejected');
    expect(JSON.stringify(verdict)).not.toContain('sk_live_abc123');
  });
});

describe('clockSkewSeconds', () => {
  it('parses the Date header against now', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(clockSkewSeconds('Wed, 01 Jan 2026 12:05:00 GMT', now)).toBe(300);
    expect(clockSkewSeconds('Wed, 01 Jan 2026 11:59:00 GMT', now)).toBe(-60);
  });

  it('returns undefined without a header or a valid date', () => {
    expect(clockSkewSeconds(undefined, 0)).toBeUndefined();
    expect(clockSkewSeconds('not a date', 0)).toBeUndefined();
  });
});

describe('signsTimestamp', () => {
  it('only akbank signs a timestamp', () => {
    expect(signsTimestamp('akbank')).toBe(true);
    expect(signsTimestamp('iyzico')).toBe(false);
    expect(signsTimestamp('paytr')).toBe(false);
    expect(signsTimestamp('parampos')).toBe(false);
  });
});

describe('createCapturingFetch', () => {
  it('records status, url and content type', async () => {
    const http: unknown[] = [];
    let networkErrors = 0;
    const fetchImpl = createCapturingFetch(
      async () => httpResponse(200, '{"ok":true}', { 'content-type': 'application/json' }),
      http as never,
      () => {
        networkErrors += 1;
      }
    );
    const response = await fetchImpl('https://example.com/x');
    expect(response.status).toBe(200);
    expect(http).toHaveLength(1);
    expect(http[0]).toMatchObject({ status: 200, url: 'https://example.com/x' });
    expect(networkErrors).toBe(0);
  });

  it('reports network errors and rethrows', async () => {
    const http: unknown[] = [];
    const messages: string[] = [];
    const fetchImpl = createCapturingFetch(
      async () => {
        throw new Error('ECONNREFUSED');
      },
      http as never,
      (message) => messages.push(message)
    );
    await expect(fetchImpl('https://example.com/x')).rejects.toThrow('ECONNREFUSED');
    expect(messages).toEqual(['ECONNREFUSED']);
    expect(http).toHaveLength(0);
  });
});

describe('probeProvider', () => {
  it('asks iyzico its bin question through the injected fetch', async () => {
    const calls: Request[] = [];
    const io = fakeIo({
      env: { IYZICO_API_KEY: 'k', IYZICO_SECRET_KEY: 's' },
      fetch: (async (input: RequestInfo | URL) => {
        calls.push(new Request(input));
        return httpResponse(200, JSON.stringify({ status: 'success', binNumber: '535387' }));
      }) as typeof fetch,
    });
    const resolved = resolveProvider(io, 'iyzico', 'sandbox');
    const observation = await probeProvider(io, resolved);
    expect(observation.returned).toBe(true);
    expect(observation.method).toBe('binCheck');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/payment/bin/check');
    expect(observation.http[0]?.status).toBe(200);
  });

  it('uses an order-history query for akbank', async () => {
    const io = fakeIo({
      env: { AKBANK_MERCHANT_SAFE_ID: 'm', AKBANK_TERMINAL_SAFE_ID: 't', AKBANK_SECRET_KEY: 's' },
      fetch: (async () =>
        httpResponse(
          200,
          JSON.stringify({ status: 'failure', errorMessage: 'not found' })
        )) as typeof fetch,
    });
    const observation = await probeProvider(io, resolveProvider(io, 'akbank', 'sandbox'));
    expect(observation.method).toBe('order-history');
    expect(observation.returned).toBe(true);
  });

  it('captures the provider error message and sanitizes secrets away', async () => {
    const io = fakeIo({
      env: {
        PAYTR_MERCHANT_ID: 'm',
        PAYTR_MERCHANT_KEY: 'secret-key-value',
        PAYTR_MERCHANT_SALT: 'salt',
      },
      fetch: (async () =>
        httpResponse(
          200,
          JSON.stringify({ status: 'failed', reason: 'bad secret-key-value' })
        )) as typeof fetch,
    });
    const observation = await probeProvider(io, resolveProvider(io, 'paytr', 'sandbox'));
    expect(observation.providerMessage ?? '').not.toContain('secret-key-value');
  });

  it('throws a clear error for a provider without a probe', async () => {
    const io = fakeIo({});
    const observation = await probeProvider(io, {
      ...resolveProvider(io, 'iyzico', 'sandbox'),
      spec: { ...resolveProvider(io, 'iyzico', 'sandbox').spec, id: 'unknown' },
    });
    expect(observation.returned).toBe(false);
    expect(observation.providerMessage).toContain('No harmless probe');
  });
});
