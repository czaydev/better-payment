/**
 * better-payment/elysia: an Elysia handler.
 *
 * @example
 * ```ts
 * import { Elysia } from 'elysia';
 * import { toElysiaHandler } from 'better-payment/elysia';
 *
 * new Elysia().all('/api/pay/*', toElysiaHandler(payment), { parse: 'none' }).listen(3000);
 * ```
 *
 * `{ parse: 'none' }` keeps the raw body for the handler. Without it, any hook
 * that reads `body` (`onTransform`, `derive`, `onBeforeHandle`, plugins) makes
 * Elysia consume the request first, and bank callbacks fail.
 */
import { toFetchHandler, type HandlerSource } from 'better-payment';

export type { HandlerSource };

/** The part of Elysia's `Context` the adapter uses */
export interface ElysiaContextLike {
  request: Request;
}

export function toElysiaHandler(
  source: HandlerSource
): (context: ElysiaContextLike) => Promise<Response> {
  const handler = toFetchHandler(source);
  return (context) => handler(context.request);
}
