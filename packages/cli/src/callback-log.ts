/**
 * The one-line callback log of `listen`.
 *
 * A line only ever contains the provider, the route below it, the HTTP method,
 * the status and the duration. Bodies, headers, cookies, query strings and
 * signatures are never read or printed, so card data and callback hashes cannot
 * end up in the terminal or in a log file.
 */

export interface CallbackRoute {
  provider: string;
  route: string;
  /** The request had a query string; it is not shown */
  hadQuery: boolean;
}

const CALLBACK_SUFFIX = 'payment/complete-3ds';

/** Splits `/api/pay/iyzico/payment/complete-3ds?...` into provider and route */
export function describeCallback(url: string | undefined, basePath = '/api/pay'): CallbackRoute {
  if (!url) return { provider: '-', route: 'unknown', hadQuery: false };
  const hadQuery = url.includes('?');
  const path = url.split('?')[0];
  const base = basePath.replace(/\/+$/, '');
  if (!path.startsWith(`${base}/`)) {
    return { provider: '-', route: 'outside the handler base path', hadQuery };
  }
  const rest = path
    .slice(base.length + 1)
    .split('/')
    .filter(Boolean);
  const provider = rest[0] ?? '-';
  const route = rest.slice(1).join('/') || 'unknown';
  return { provider, route, hadQuery };
}

export interface CallbackLogEntry {
  provider: string;
  route: string;
  method: string;
  status: number;
  durationMs: number;
  hadQuery: boolean;
}

/** Fixed-width, single-line log entry */
export function formatCallback(entry: CallbackLogEntry): string {
  const provider = entry.provider.padEnd(10).slice(0, 10);
  const route = entry.route.padEnd(26).slice(0, 26);
  const method = entry.method.toUpperCase().padEnd(4);
  const query = entry.hadQuery ? ' (query masked)' : '';
  return `callback  ${provider}  ${route}  ${method} ${entry.status}  ${entry.durationMs}ms${query}`;
}

/** True for routes the provider calls back (as opposed to health or read queries) */
export function isCallbackRoute(route: CallbackRoute): boolean {
  return route.provider !== '-' && (route.route === 'callback' || route.route === CALLBACK_SUFFIX);
}
