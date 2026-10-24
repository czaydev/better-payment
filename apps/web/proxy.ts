import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from "./lib/i18n/config";

const LOCALE_COOKIE = "bp_locale";
const ONE_YEAR = 60 * 60 * 24 * 365;
// Crawlers are never redirected: they index each locale at its own URL (hreflang)
const BOT = /bot|crawl|spider|slurp|bing|google|yandex|baidu|duckduck|facebookexternalhit|embedly|preview|lighthouse|headless/i;
const SUPPORTED = new Set<string>(LOCALES);

/**
 * Best supported language for an Accept-Language header: q values decide, `de-DE`
 * matches `de`, ties go to the language that appears first. A language only wins
 * over the default when its q is strictly higher, and a header naming no supported
 * language at all keeps the default.
 */
function negotiate(header: string | null): Locale | null {
  if (!header) return null;
  const quality = new Map<string, number>();
  const order: string[] = [];
  for (const part of header.split(",")) {
    const [rawTag, ...params] = part.trim().toLowerCase().split(";");
    const tag = rawTag.trim();
    if (!tag) continue;
    const qParam = params.find((p) => p.trim().startsWith("q="));
    const q = qParam ? Number(qParam.trim().slice(2)) : 1;
    if (!(q > 0)) continue;
    const primary = tag.split("-")[0];
    if (!SUPPORTED.has(primary)) continue;
    if (!order.includes(primary)) order.push(primary);
    quality.set(primary, Math.max(quality.get(primary) ?? 0, q));
  }
  const defaultQuality = quality.get(DEFAULT_LOCALE) ?? 0;
  let best: Locale | null = null;
  let bestQuality = defaultQuality;
  for (const code of order) {
    const q = quality.get(code) ?? 0;
    if (code !== DEFAULT_LOCALE && q > bestQuality) {
      best = code as Locale;
      bestQuality = q;
    }
  }
  return best;
}

/**
 * Client-side navigations and link prefetches fetch RSC payloads. They must not change
 * the remembered language: a prefetch of the language switch link would flip it without
 * a click, and the router cache would keep pages of the old language under unprefixed
 * URLs. The cookie only changes on full page loads (the language switch does one).
 */
function isRouterRequest(request: NextRequest): boolean {
  return request.headers.has("rsc") || request.headers.has("next-router-prefetch");
}

function remember(request: NextRequest, response: NextResponse, locale: Locale): NextResponse {
  if (isRouterRequest(request)) return response;
  response.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
  return response;
}

function withLocale(request: NextRequest, prefix: string): URL {
  const { pathname } = request.nextUrl;
  const url = request.nextUrl.clone();
  url.pathname = `${prefix}${pathname === "/" ? "" : pathname}`;
  return url;
}

/**
 * - `/<locale>/...` is that language; visiting it remembers the choice.
 * - `/en/...` (the default language) redirects to the unprefixed URL (the switcher uses it).
 * - Unprefixed URLs are English. On the first visit, a browser that prefers another
 *   supported language is redirected to `/<locale>/...`; the choice is remembered in a cookie.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const segment = pathname.split("/")[1];
  // /beta is the beta docs deployment (next.config.ts rewrites it); it handles languages itself
  if (segment === "beta" && !request.nextUrl.basePath) return NextResponse.next();
  const cookie = request.cookies.get(LOCALE_COOKIE)?.value;
  const remembered = isLocale(cookie) ? cookie : null;

  if (isLocale(segment) && segment !== DEFAULT_LOCALE) {
    const response = NextResponse.next();
    return remembered === segment ? response : remember(request, response, segment);
  }

  if (segment === DEFAULT_LOCALE) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(DEFAULT_LOCALE.length + 1) || "/";
    return remember(request, NextResponse.redirect(url), DEFAULT_LOCALE);
  }

  const isBot = BOT.test(request.headers.get("user-agent") ?? "");
  const target = remembered ?? (isBot ? null : negotiate(request.headers.get("accept-language")));

  if (target && target !== DEFAULT_LOCALE) {
    return remember(request, NextResponse.redirect(withLocale(request, `/${target}`)), target);
  }

  const response = NextResponse.rewrite(withLocale(request, `/${DEFAULT_LOCALE}`));
  return remembered || isBot ? response : remember(request, response, DEFAULT_LOCALE);
}

export const config = {
  // Pages only: not API routes, Next.js internals, metadata routes or static files
  matcher: ["/((?!api|_next|sitemap.xml|robots.txt|favicon.ico|.*\\..*).*)"],
};
