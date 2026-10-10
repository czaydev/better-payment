/**
 * better-payment/express: Express middleware. Also works as a plain `node:http`
 * request listener.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { toExpressHandler } from 'better-payment/express';
 *
 * const app = express();
 * app.all('/api/pay/*', toExpressHandler(payment)); // no body parser needed
 * ```
 */
import {
  resolveHandler,
  serializeResponse,
  payloadTooLarge,
  BodyTooLargeError,
  DEFAULT_MAX_BODY_SIZE,
  type AdapterOptions,
  type BetterPaymentResponse,
  type HandlerSource,
} from 'better-payment';

export type { AdapterOptions, HandlerSource };

/** The parts of Express's (and Node's) request the adapter uses */
export interface NodeRequestLike extends AsyncIterable<Uint8Array | string> {
  method?: string;
  url?: string;
  /** Express: the full URL, also when the middleware is mounted on a path */
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  /** Set by a body parser (express.json(), express.urlencoded(), express.text()) */
  body?: unknown;
  /** True once the request stream has been read (by a body parser) */
  readableEnded?: boolean;
}

/** The parts of Express's (and Node's) response the adapter uses */
export interface NodeResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

export type NodeNext = (error?: unknown) => void;

async function readBody(req: NodeRequestLike, limit: number): Promise<unknown> {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return undefined;

  // A body parser already consumed the stream: use what it produced
  if (req.readableEnded) return req.body;

  if (Number(req.headers['content-length']) > limit) throw new BodyTooLargeError();

  // Read the raw body, so form-urlencoded callbacks reach the handler untouched
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for await (const chunk of req) {
    size += typeof chunk === 'string' ? encoder.encode(chunk).byteLength : chunk.byteLength;
    // Leaving the loop stops reading the stream
    if (size > limit) throw new BodyTooLargeError();
    text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return text === '' ? undefined : text;
}

function flattenHeaders(headers: NodeRequestLike['headers']): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) result[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

/**
 * Express middleware (`(req, res, next)`). Reads the raw body itself, so you do not
 * need `express.json()` / `express.urlencoded()` for the payment routes; if a body
 * parser ran first, its result is used. Unexpected errors go to `next(error)`.
 */
export function toExpressHandler(
  source: HandlerSource,
  { maxBodySize = DEFAULT_MAX_BODY_SIZE }: AdapterOptions = {}
): (req: NodeRequestLike, res: NodeResponseLike, next?: NodeNext) => Promise<void> {
  const send = (res: NodeResponseLike, response: BetterPaymentResponse) => {
    const { status, headers, body } = serializeResponse(response);
    res.statusCode = status;
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    res.end(body ?? undefined);
  };
  return async (req, res, next) => {
    try {
      send(
        res,
        await resolveHandler(source).handle({
          method: (req.method ?? 'GET').toUpperCase(),
          url: req.originalUrl ?? req.url ?? '/',
          headers: flattenHeaders(req.headers),
          body: await readBody(req, maxBodySize),
        })
      );
    } catch (error: unknown) {
      if (error instanceof BodyTooLargeError) send(res, payloadTooLarge());
      else if (next) next(error);
      else {
        res.statusCode = 500;
        res.end();
      }
    }
  };
}

/** Alias for plain `node:http` servers: `http.createServer(toNodeHandler(payment))` */
export const toNodeHandler = toExpressHandler;
