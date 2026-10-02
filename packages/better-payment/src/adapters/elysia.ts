/**
 * better-payment/elysia: an Elysia handler.
 *
 * @example
 * ```ts
 * import { Elysia } from 'elysia';
 * import { toElysiaHandler } from 'better-payment/elysia';
 *
 * new Elysia().all('/api/pay/*', toElysiaHandler(payment)).listen(3000);
 * ```
 */
import { toFetchHandler, type HandlerSource } from 'better-payment';

export type { HandlerSource };

/** The part of Elysia's `Context` the adapter uses */
export interface ElysiaContextLike {
  request: Request;
}

export function toElysiaHandler(source: HandlerSource): (context: ElysiaContextLike) => Promise<Response> {
  const handler = toFetchHandler(source);
  return (context) => handler(context.request);
}
