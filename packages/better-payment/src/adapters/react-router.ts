/**
 * better-payment/react-router: a `loader` and an `action` for a React Router v7
 * (or Remix v2) resource route.
 *
 * @example
 * ```ts
 * // app/routes/api.pay.$.ts
 * import { toReactRouterHandler } from 'better-payment/react-router';
 * import { getBetterPayment } from '~/lib/payment.server';
 *
 * export const { loader, action } = toReactRouterHandler(getBetterPayment);
 * ```
 */
import { toFetchHandler, type HandlerSource } from 'better-payment';

export type { HandlerSource };

/** The part of React Router's loader and action arguments the adapter uses */
export interface ReactRouterArgsLike {
  request: Request;
}

export type ReactRouterRouteHandler = (args: ReactRouterArgsLike) => Promise<Response>;

export function toReactRouterHandler(source: HandlerSource): {
  loader: ReactRouterRouteHandler;
  action: ReactRouterRouteHandler;
} {
  const handler = toFetchHandler(source);
  const route: ReactRouterRouteHandler = ({ request }) => handler(request);
  return { loader: route, action: route };
}
