/**
 * better-payment/nestjs: a request handler for a NestJS controller, on either the
 * Express or the Fastify platform. No decorators and no `@nestjs/*` dependency: you
 * inject the platform's request and response and call the handler in one line.
 *
 * The platform is detected from the response object, so the same handler works for
 * `@Res()` on platform-express (an Express `Response`) and on platform-fastify (a
 * Fastify `Reply`).
 *
 * @example
 * ```ts
 * import { All, Controller, Req, Res } from '@nestjs/common';
 * import { toNestHandler } from 'better-payment/nestjs';
 *
 * @Controller('api/pay')
 * export class PaymentController {
 *   private readonly handle = toNestHandler(() => getPayment());
 *
 *   @All('*')
 *   pay(@Req() req: unknown, @Res() res: unknown) {
 *     return this.handle(req, res);
 *   }
 * }
 * ```
 */
import {
  resolveHandler,
  serializeResponse,
  type AdapterOptions,
  type HandlerSource,
} from 'better-payment';
import {
  toExpressHandler,
  type NodeNext,
  type NodeRequestLike,
  type NodeResponseLike,
} from './express';

export type { AdapterOptions, HandlerSource, NodeNext, NodeRequestLike, NodeResponseLike };

/** The parts of a platform-fastify request the adapter uses (Nest injects Fastify's) */
export interface NestFastifyRequestLike {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

/** The parts of a platform-fastify reply the adapter uses (Nest injects Fastify's) */
export interface NestFastifyReplyLike {
  code(statusCode: number): unknown;
  header(name: string, value: string): unknown;
  send(payload?: unknown): unknown;
}

/** Either platform's request, as injected by `@Req()` */
export type NestRequestLike = NodeRequestLike | NestFastifyRequestLike;

/** Either platform's response, as injected by `@Res()` */
export type NestResponseLike = NodeResponseLike | NestFastifyReplyLike;

function isFastifyReply(res: NestResponseLike): res is NestFastifyReplyLike {
  return 'code' in res && 'header' in res && 'send' in res;
}

function flattenHeaders(headers: NestFastifyRequestLike['headers']): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) result[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

/**
 * A single handler for both Nest platforms. Pass the `@Req()` and `@Res()` objects
 * of a wildcard controller route. On platform-express it is the Express
 * `(req, res, next)` middleware: it reads the raw body itself, so the default body
 * parser never breaks the form-urlencoded bank callbacks, and unexpected errors go
 * to `next(error)`. On platform-fastify it uses the request body Fastify already
 * parsed. Base path, `404`/`405`, redirect `Location` and plain-text `OK` behave
 * exactly as in the Express and Fastify adapters.
 */
export function toNestHandler(
  source: HandlerSource,
  options: AdapterOptions = {}
): (req: NestRequestLike, res: NestResponseLike, next?: NodeNext) => Promise<void> {
  const expressHandler = toExpressHandler(source, options);
  return async (req, res, next) => {
    if (isFastifyReply(res)) {
      const request = req as NestFastifyRequestLike;
      const { status, headers, body } = serializeResponse(
        await resolveHandler(source).handle({
          method: request.method.toUpperCase(),
          url: request.url,
          headers: flattenHeaders(request.headers),
          body: request.body === '' ? undefined : request.body,
        })
      );
      res.code(status);
      for (const [name, value] of Object.entries(headers)) res.header(name, value);
      res.send(body ?? undefined);
      return;
    }
    await expressHandler(req as NodeRequestLike, res, next);
  };
}
