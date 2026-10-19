/**
 * better-payment/sveltekit: SvelteKit route handlers.
 *
 * @example
 * ```ts
 * // src/routes/api/pay/[...path]/+server.ts
 * import { toSvelteKitHandler } from 'better-payment/sveltekit';
 * import { getBetterPayment } from '$lib/payment.server';
 *
 * export const { GET, POST } = toSvelteKitHandler(getBetterPayment);
 * ```
 */
import { toFetchHandler, type AdapterOptions, type HandlerSource } from 'better-payment';

export type { AdapterOptions, HandlerSource };

/** The part of SvelteKit's `RequestEvent` the adapter uses */
export interface SvelteKitRequestEventLike {
  request: Request;
}

export type SvelteKitRouteHandler = (event: SvelteKitRequestEventLike) => Promise<Response>;

export function toSvelteKitHandler(
  source: HandlerSource,
  options: AdapterOptions = {}
): { GET: SvelteKitRouteHandler; POST: SvelteKitRouteHandler } {
  const handler = toFetchHandler(source, options);
  const route: SvelteKitRouteHandler = ({ request }) => handler(request);
  return { GET: route, POST: route };
}
