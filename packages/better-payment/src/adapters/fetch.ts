import type {
  BetterPaymentHandler,
  BetterPaymentRequest,
  BetterPaymentResponse,
} from '../core/BetterPaymentHandler';

/**
 * Where an adapter gets the handler from: a handler, a BetterPayment instance
 * (its `handler` is used), or a function returning either. A function is called on
 * every request, so the instance can be created lazily (for example to keep
 * Next.js builds working without environment variables).
 */
export type HandlerSource =
  | BetterPaymentHandler
  | { readonly handler: BetterPaymentHandler }
  | (() => BetterPaymentHandler | { readonly handler: BetterPaymentHandler });

export function resolveHandler(source: HandlerSource): BetterPaymentHandler {
  const value = typeof source === 'function' ? source() : source;
  return 'handle' in value ? value : value.handler;
}

const NO_BODY_STATUSES = [204, 205, 301, 302, 303, 304, 307, 308];

/**
 * Serializes a handler response: text bodies (PayTR's `OK`) as is, redirects
 * without a body (keeping `Location`), everything else as JSON.
 */
export function serializeResponse(response: BetterPaymentResponse): {
  status: number;
  headers: Record<string, string>;
  body: string | null;
} {
  const headers = { ...response.headers };
  if (NO_BODY_STATUSES.includes(response.status) || response.body === undefined) {
    return { status: response.status, headers, body: null };
  }
  if (typeof response.body === 'string') {
    return { status: response.status, headers, body: response.body };
  }
  if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }
  return { status: response.status, headers, body: JSON.stringify(response.body) };
}

/** Default limit for request bodies read by the adapters: 1 MiB (bank callbacks are a few kB) */
export const DEFAULT_MAX_BODY_SIZE = 1024 * 1024;

export interface AdapterOptions {
  /** Largest request body read, in bytes. Larger requests get 413. Default: 1 MiB */
  maxBodySize?: number;
}

/** Thrown by the adapters when a request body is larger than `maxBodySize` */
export class BodyTooLargeError extends Error {
  constructor() {
    super('Request body too large');
    this.name = 'BodyTooLargeError';
  }
}

/** The 413 response the adapters send for a body larger than `maxBodySize` */
export function payloadTooLarge(): BetterPaymentResponse {
  return {
    status: 413,
    headers: { 'Content-Type': 'application/json' },
    body: { error: true, message: 'Request body too large' },
  };
}

/** Reads the body as text, stopping as soon as it grows past `limit` bytes */
async function readText(request: Request, limit: number): Promise<string> {
  if (Number(request.headers.get('content-length')) > limit) throw new BodyTooLargeError();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Converts a web `Request` for the handler. The body is passed as raw text.
 * Throws BodyTooLargeError when it is larger than `maxBodySize`.
 */
export async function fromWebRequest(
  request: Request,
  { maxBodySize = DEFAULT_MAX_BODY_SIZE }: AdapterOptions = {}
): Promise<BetterPaymentRequest> {
  const method = request.method.toUpperCase();
  const text = method === 'GET' || method === 'HEAD' ? '' : await readText(request, maxBodySize);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    method,
    url: request.url,
    headers,
    body: text === '' ? undefined : text,
  };
}

export function toWebResponse(response: BetterPaymentResponse): Response {
  const { status, headers, body } = serializeResponse(response);
  return new Response(body, { status, headers });
}

/**
 * `(request: Request) => Promise<Response>` for fetch-based runtimes: Cloudflare
 * Workers, Deno, Bun, Hono, Next.js route handlers.
 *
 * @example
 * ```ts
 * export default { fetch: toFetchHandler(payment) }; // Cloudflare Workers
 * Deno.serve(toFetchHandler(payment));
 * ```
 */
export function toFetchHandler(
  source: HandlerSource,
  options: AdapterOptions = {}
): (request: Request) => Promise<Response> {
  return async (request) => {
    let converted: BetterPaymentRequest;
    try {
      converted = await fromWebRequest(request, options);
    } catch (error) {
      if (error instanceof BodyTooLargeError) return toWebResponse(payloadTooLarge());
      throw error;
    }
    return toWebResponse(await resolveHandler(source).handle(converted));
  };
}
