import type { BetterPaymentLogger } from './logger';
import type { RetryConfig } from './retry';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface HttpRequestConfig {
  method?: HttpMethod;
  /** Path relative to the client's baseURL, or an absolute URL */
  url?: string;
  /** Request body, already serialized */
  data?: string;
  headers?: Record<string, string>;
  /**
   * Marks the request as safe to retry (read-only queries sent with POST).
   * Payment, refund and cancel requests are never retried without it.
   */
  retryable?: boolean;
  /** 'json' (default) parses JSON bodies and falls back to text; 'text' returns the raw text */
  responseType?: 'json' | 'text';
  /** Statuses that resolve instead of throwing. Default: 2xx. */
  validateStatus?: (status: number) => boolean;
  /** Timeout in ms. Default: the client's timeout. */
  timeout?: number;
}

export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

export interface HttpClientOptions {
  /** Provider name used in log messages */
  provider: string;
  baseURL?: string;
  /** Timeout in ms */
  timeout: number;
  headers?: Record<string, string>;
  /** Custom fetch implementation. Default: globalThis.fetch */
  fetch?: typeof fetch;
  logger?: BetterPaymentLogger;
  retry?: RetryConfig;
}

/**
 * Error thrown by HttpClient.
 *
 * - `response` is set when the server answered with a status that failed `validateStatus`.
 * - `isNetworkError` is set when no response was received (timeout, connection reset,
 *   DNS failure). The provider may still have processed the request.
 * - `config` is the request without its body and headers: they carry card data and
 *   credentials, and the error is passed to the logger.
 */
export class HttpError extends Error {
  readonly isNetworkError: boolean;
  /** Transport error code, e.g. ETIMEDOUT or ECONNRESET */
  readonly code?: string;
  readonly response?: HttpResponse;
  readonly config: HttpRequestConfig;

  constructor(
    message: string,
    config: HttpRequestConfig,
    details: { response?: HttpResponse; code?: string; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'HttpError';
    this.config = { ...config, data: undefined, headers: undefined };
    this.response = details.response;
    this.code = details.code;
    this.isNetworkError = !details.response;
    if (details.cause !== undefined) {
      (this as { cause?: unknown }).cause = details.cause;
    }
  }
}

const IDEMPOTENT_METHODS: HttpMethod[] = ['GET', 'HEAD', 'OPTIONS'];

function joinUrl(baseURL: string | undefined, url: string | undefined): string {
  const path = url ?? '';
  if (/^https?:\/\//i.test(path) || !baseURL) return path;
  if (!path) return baseURL;
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Transport error code and message from a fetch rejection (undici puts them in `cause`) */
function transportError(error: unknown): { code?: string; message: string } {
  const e = error as { name?: unknown; message?: unknown; cause?: unknown };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return { code: 'ETIMEDOUT', message: 'Request timed out' };
  }
  const cause = e?.cause as { code?: unknown; message?: unknown } | undefined;
  const code = typeof cause?.code === 'string' ? cause.code : undefined;
  const message =
    (typeof cause?.message === 'string' && cause.message) ||
    (typeof e?.message === 'string' && e.message) ||
    'Network error';
  return { code, message };
}

function parseBody(text: string, responseType: 'json' | 'text'): unknown {
  if (responseType === 'text' || text === '') return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Minimal HTTP client on `fetch`, so the library runs on Node.js, Deno, Bun and edge
 * runtimes. Logs requests without bodies (they contain card data and credentials),
 * and retries only idempotent requests: GET/HEAD/OPTIONS or requests marked
 * `retryable`. Payment, refund and cancel requests are never retried, because a
 * timeout after the provider received the request would otherwise charge or refund
 * twice.
 */
export class HttpClient {
  constructor(private readonly options: HttpClientOptions) {}

  get<T = unknown>(url: string, config: HttpRequestConfig = {}): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: 'GET', url });
  }

  post<T = unknown>(
    url: string,
    data?: string,
    config: HttpRequestConfig = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: 'POST', url, data });
  }

  async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    const retry = this.options.retry;
    const method = config.method ?? 'GET';
    const safe = config.retryable === true || IDEMPOTENT_METHODS.includes(method);
    const attempts = safe && retry && retry.attempts > 1 ? retry.attempts : 1;

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.send<T>({ ...config, method });
      } catch (error: unknown) {
        const retryableError =
          error instanceof HttpError &&
          (error.isNetworkError ||
            (!!error.response && !!retry?.statusCodes?.includes(error.response.status)));
        if (!retryableError || attempt >= attempts) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, retry?.delay ?? 1000));
      }
    }
  }

  private async send<T>(
    config: HttpRequestConfig & { method: HttpMethod }
  ): Promise<HttpResponse<T>> {
    const { provider, logger } = this.options;
    const url = joinUrl(this.options.baseURL, config.url);
    const fetchImpl = this.options.fetch ?? globalThis.fetch;
    const timeout = config.timeout ?? this.options.timeout;

    logger?.debug(`[${provider}] ${config.method} ${url}`, {
      provider,
      method: config.method,
      url,
    });

    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(url, {
        method: config.method,
        headers: { ...this.options.headers, ...config.headers },
        body: config.method === 'GET' || config.method === 'HEAD' ? undefined : config.data,
        signal: AbortSignal.timeout(timeout),
      });
      text = await response.text();
    } catch (error: unknown) {
      const transport = transportError(error);
      const httpError = new HttpError(transport.message, config, {
        code: transport.code,
        cause: error,
      });
      logger?.error(`[${provider}] Request failed: ${httpError.message}`, httpError, {
        provider,
        url,
      });
      throw httpError;
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const result: HttpResponse<T> = {
      data: parseBody(text, config.responseType ?? 'json') as T,
      status: response.status,
      headers,
    };

    const validateStatus = config.validateStatus ?? ((status) => status >= 200 && status < 300);
    if (!validateStatus(response.status)) {
      const httpError = new HttpError(
        `Request failed with status code ${response.status}`,
        config,
        {
          response: result,
        }
      );
      logger?.error(`[${provider}] Request failed: ${httpError.message}`, httpError, {
        provider,
        url,
        status: response.status,
      });
      throw httpError;
    }

    logger?.debug(`[${provider}] ${response.status} ${url}`, {
      provider,
      status: response.status,
      url,
    });
    return result;
  }
}
