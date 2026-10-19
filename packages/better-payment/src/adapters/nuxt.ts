/**
 * better-payment/nuxt: a Nuxt/Nitro (h3) event handler.
 *
 * @example
 * ```ts
 * // server/api/pay/[...path].ts
 * import { toH3Handler } from 'better-payment/nuxt';
 * import { getBetterPayment } from '~/server/utils/payment';
 *
 * export default toH3Handler(getBetterPayment);
 * ```
 */
import { toFetchHandler, type AdapterOptions, type HandlerSource } from 'better-payment';

export type { AdapterOptions, HandlerSource };

/** The web-request parts exposed by h3 v2 and h3 v1 */
export interface H3EventLike {
  /** h3 v2 */
  req?: Request;
  /** h3 v1 when a web request is already available */
  web?: { request: Request };
}

type H3V1Module = {
  toWebRequest?: (event: unknown) => Request;
};

let h3Module: Promise<H3V1Module> | undefined;

async function requestOf(event: H3EventLike): Promise<Request> {
  if (event.req) return event.req;
  if (event.web?.request) return event.web.request;

  // A Node-hosted h3 v1 event does not always expose `event.web`. Nuxt/Nitro
  // already provides h3, so load its v1 converter only for that legacy shape.
  h3Module ??= import('h3') as Promise<H3V1Module>;
  const { toWebRequest } = await h3Module;
  if (toWebRequest) return toWebRequest(event);

  throw new TypeError('Unsupported h3 event: no web Request is available');
}

export function toH3Handler(
  source: HandlerSource,
  options: AdapterOptions = {}
): (event: H3EventLike) => Promise<Response> {
  const handler = toFetchHandler(source, options);
  return async (event) => handler(await requestOf(event));
}
