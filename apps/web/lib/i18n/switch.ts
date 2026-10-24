import { DEFAULT_LOCALE, LOCALE_COOKIE, localePath, stripLocale, type Locale } from "@/lib/i18n/config";
import { withBasePath } from "@/lib/base-path";

/**
 * URL of the current page in another language: ("en", "/tr/docs/x") → "/en/docs/x".
 * The proxy remembers the default language for "/en/..." and redirects to the unprefixed
 * URL, so the link also works when opened in a new tab. Prefixed URLs behave the same for
 * every other language: "/de/docs/x".
 */
export function switchLocalePath(lang: Locale, pathname: string): string {
  const path = stripLocale(pathname || "/");
  if (lang === DEFAULT_LOCALE) return `/${lang}${path === "/" ? "" : path}`;
  return localePath(lang, path);
}

/**
 * Remembers the chosen language and opens the page in it with a full load.
 * Unprefixed URLs follow the cookie in the proxy, and a client-side navigation
 * could reuse layouts or pages cached in the other language.
 */
export function switchLocale(lang: Locale, pathname: string) {
  document.cookie = `${LOCALE_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
  window.location.assign(withBasePath(switchLocalePath(lang, pathname)) + window.location.search);
}
