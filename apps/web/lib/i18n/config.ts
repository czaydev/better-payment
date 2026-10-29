import { defineI18n } from "fumadocs-core/i18n";
import locales from "./locales.json";

/**
 * Per-language settings. Everything the site knows about its languages comes from
 * `lib/i18n/locales.json`: URLs, redirects, the switcher menu, the sitemap, hreflang
 * alternates and the translation checks are all derived from it, so adding a language
 * is a config change, not a code change (see TRANSLATIONS.md → Adding a language).
 * `scripts/locales.mjs` validates the file in the docs scripts and in CI.
 */
export type DocsMode = "required" | "optional";
export type TextDirection = "ltr" | "rtl";

export interface LocaleSettings {
  /** Locale code; must equal the registry key (used in URLs and content file names) */
  code: string;
  /** Switcher labels for the English and Turkish UIs, e.g. `{ en: "Turkish", tr: "Türkçe" }` */
  names: Record<string, string>;
  /** the language's own name, used by the docs UI and the generated llms index */
  nativeName: string;
  /** SVG file under public/brand/flags used by the navbar language switcher */
  flag: string;
  /** text direction; `rtl` sets dir="rtl" on <html> */
  dir: TextDirection;
  /** false declares a language without routing, listing or checking it yet */
  enabled: boolean;
  /** Open Graph locale tag, e.g. "en_US" */
  ogLocale: string;
  /** BCP 47 tag for Intl.DateTimeFormat, e.g. "en-US" */
  intlLocale: string;
  docs: DocsMode;
  /** true when this repo has a CONTRIBUTING.<code>.md for the language */
  contribGuide?: boolean;
  /** social preview file under public/brand/social/; defaults to og-<code>.png */
  socialImage?: string;
}

type LocaleCode = keyof typeof locales.languages;
const settings = locales.languages as unknown as Record<LocaleCode, LocaleSettings>;

export type Locale = LocaleCode;

/** Every language declared in the registry, enabled or not */
export const ALL_LOCALES = Object.keys(settings) as Locale[];
/** Languages the site serves: routing, switcher, sitemap, hreflang and checks use these */
export const LOCALES = ALL_LOCALES.filter((lang) => settings[lang].enabled);
/** Declared but not served yet (prepared for the translation issues #112-#114) */
export const DISABLED_LOCALES = ALL_LOCALES.filter((lang) => !settings[lang].enabled);

/**
 * English is the default and keeps the unprefixed URLs (`/docs/...`), so existing
 * links keep working. Other languages live under `/<code>/...`.
 */
export const DEFAULT_LOCALE: Locale = locales.defaultLanguage as Locale;

if (!LOCALES.includes(DEFAULT_LOCALE)) {
  throw new Error(`locales.json: defaultLanguage "${DEFAULT_LOCALE}" must be an enabled language`);
}

export const i18n = defineI18n({
  languages: LOCALES,
  defaultLanguage: DEFAULT_LOCALE,
  hideLocale: "default-locale",
  parser: "dot",
  // A page missing in one language falls back to English (with a notice)
  fallbackLanguage: DEFAULT_LOCALE,
});

export const LOCALE_COOKIE = "bp_locale";
export const SITE_URL = "https://better-payment.czaylabs.com";

/** Native display names of every declared locale (docs UI, generated llms index) */
export const LOCALE_NAMES: Record<Locale, string> = Object.fromEntries(
  ALL_LOCALES.map((lang) => [lang, settings[lang].nativeName])
) as Record<Locale, string>;

/** Per-locale settings (code, names, nativeName, dir, enabled, ogLocale, intlLocale, docs) */
export function localeSettings(lang: Locale): LocaleSettings {
  return settings[lang];
}

/**
 * Name of a language in the UI's language: ("tr", "en") → "Turkish", ("tr", "tr") → "Türkçe".
 * Falls back to the language's own name when the UI language has no label for it.
 */
export function localeName(lang: Locale, uiLang: Locale = DEFAULT_LOCALE): string {
  return settings[lang].names[uiLang] ?? settings[lang].nativeName;
}

/** Flag asset file configured for a language in the locale registry */
export function localeFlag(lang: Locale): string {
  return settings[lang].flag;
}

/** Open Graph locale tag for a language, e.g. "en_US" */
export function openGraphLocale(lang: Locale): string {
  return settings[lang].ogLocale;
}

/** Text direction of a language, from the registry */
export function textDirection(lang: Locale): TextDirection {
  return settings[lang].dir;
}

/** True for right-to-left languages (`<html dir="rtl">`) */
export function isRtl(lang: Locale): boolean {
  return textDirection(lang) === "rtl";
}

/** True when this repo ships a CONTRIBUTING.<code>.md for the language */
export function hasContribGuide(lang: Locale): boolean {
  return settings[lang].contribGuide === true;
}

/**
 * Social preview image (under `public/brand/social/`) for a language. Defaults to
 * `og-<code>.png`; a language without its own artwork points at another file with
 * the `socialImage` registry key (e.g. `"socialImage": "og-en.png"`).
 */
export function socialImageFile(lang: Locale): string {
  return settings[lang].socialImage ?? `og-${lang}.png`;
}

/** Enabled locale codes with regex metacharacters stripped, longest first (`de-AT` before `de`) */
const CODES_BY_LENGTH = [...LOCALES]
  .map((code) => code.replace(/[^a-z0-9-]/gi, ""))
  .sort((a, b) => b.length - a.length);

export function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (LOCALES as string[]).includes(value);
}

/**
 * Picks the text written for a language, falling back to English for languages that
 * do not have their own copy yet. Keep the `en` entry complete; it is the fallback.
 */
export function localeText<T>(texts: { en: T } & Partial<Record<Locale, T>>, lang: Locale): T {
  return texts[lang] ?? texts.en;
}

/** Adds the locale prefix to an internal path: ("tr", "/docs") → "/tr/docs" */
export function localePath(lang: Locale, path: string): string {
  if (!path.startsWith("/") || lang === DEFAULT_LOCALE) return path;
  if (path === "/") return `/${lang}`;
  if (path.startsWith("/#")) return `/${lang}${path.slice(1)}`;
  return `/${lang}${path}`;
}

/** Matches a leading locale segment for any enabled language */
const localePrefix = new RegExp(`^\\/(${CODES_BY_LENGTH.join("|")})(?=\\/|$)`);

/** Matches the locale suffix of a content file name: "reference/api.de.mdx" → "de" */
const localeSuffix = new RegExp(`\\.(${CODES_BY_LENGTH.join("|")})\\.mdx?$`);

/** The language a content file is written in, or null for a default-language file */
export function localeOfPath(path: string): Locale | null {
  const match = localeSuffix.exec(path);
  return match && isLocale(match[1]) ? match[1] : null;
}

/** Removes a locale prefix: "/tr/docs/x" → "/docs/x" */
export function stripLocale(path: string): string {
  const match = localePrefix.exec(path);
  if (!match) return path;
  return path.slice(match[0].length) || "/";
}

/** hreflang alternates for a path without locale prefix */
export function alternates(path: string, lang: Locale) {
  const clean = stripLocale(path);
  return {
    canonical: localePath(lang, clean),
    languages: {
      ...Object.fromEntries(LOCALES.map((code) => [code, localePath(code, clean)])),
      "x-default": localePath(DEFAULT_LOCALE, clean),
    },
  };
}
