// Shared locale registry for the Node scripts (check-translations, docs-content, generate-docs).
// The single source of truth is lib/i18n/locales.json, the same file the app code imports,
// so a language added there needs no script changes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** A locale code is used in URLs, file names and regular expressions, so it is kept strict. */
const CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Languages the website UI is translated into; every locale needs a label in each. */
const UI_LANGUAGES = ['en', 'tr'];

function fail(message) {
  throw new Error(`locales.json: ${message}`);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates a parsed locales.json and derives the lists every script uses. Kept free of
 * file-system access so tests can feed fixtures; `readLocaleRegistry` reads the real file.
 */
export function resolveLocaleRegistry(registry) {
  if (!isObject(registry)) fail('expected an object');
  if (!isObject(registry.languages)) fail('"languages" must be an object');
  const declared = Object.keys(registry.languages);
  if (!declared.length) fail('no languages registered');
  const defaultLanguage = registry.defaultLanguage;
  if (typeof defaultLanguage !== 'string' || !declared.includes(defaultLanguage))
    fail(`defaultLanguage "${defaultLanguage}" is not a listed language`);

  for (const [code, settings] of Object.entries(registry.languages)) {
    if (!CODE.test(code))
      fail(`"${code}" is not a usable locale code (lowercase letters, digits, hyphens)`);
    if (!isObject(settings)) fail(`"${code}" must be an object`);
    if (settings.code !== code) fail(`"${code}".code must be "${code}"`);
    if (!isObject(settings.names)) fail(`"${code}" needs names: { en, tr }`);
    for (const ui of UI_LANGUAGES)
      if (!isText(settings.names[ui])) fail(`"${code}".names.${ui} must be a non-empty string`);
    if (!isText(settings.nativeName)) fail(`"${code}" needs a non-empty nativeName`);
    if (settings.dir !== 'ltr' && settings.dir !== 'rtl')
      fail(`"${code}" has dir "${settings.dir}", expected "ltr" or "rtl"`);
    if (typeof settings.enabled !== 'boolean') fail(`"${code}" needs a boolean enabled flag`);
    if (!isText(settings.ogLocale)) fail(`"${code}" needs an ogLocale`);
    if (!isText(settings.intlLocale)) fail(`"${code}" needs an intlLocale`);
    if (settings.docs !== 'required' && settings.docs !== 'optional')
      fail(`"${code}" has docs "${settings.docs}", expected "required" or "optional"`);
    if (settings.docs === 'required' && !settings.enabled)
      fail(`"${code}" cannot be docs "required" while disabled; enable it first`);
    if (settings.contribGuide !== undefined && typeof settings.contribGuide !== 'boolean')
      fail(`"${code}".contribGuide must be a boolean`);
    if (
      settings.socialImage !== undefined &&
      (typeof settings.socialImage !== 'string' || !/^[\w.-]+\.(png|jpe?g|webp|svg)$/.test(settings.socialImage))
    )
      fail(`"${code}".socialImage must be a file name under public/brand/social`);
  }

  const enabled = declared.filter((code) => registry.languages[code].enabled);
  if (!enabled.includes(defaultLanguage)) fail(`defaultLanguage "${defaultLanguage}" must be enabled`);

  return {
    defaultLanguage,
    /** every declared code, enabled or not */
    declared,
    /** served languages: routing, docs generation and checks use these */
    codes: enabled,
    enabled,
    /** declared but not served yet; content files for them are not allowed */
    disabled: declared.filter((code) => !enabled.includes(code)),
    /** enabled languages except the default one (which owns the unprefixed URLs) */
    translated: enabled.filter((code) => code !== defaultLanguage),
    /** enabled codes whose docs must be complete; others may be partial and fall back to English */
    required: enabled.filter((code) => registry.languages[code].docs === 'required'),
    settings: registry.languages,
  };
}

export function readLocaleRegistry() {
  const file = fileURLToPath(new URL('../lib/i18n/locales.json', import.meta.url));
  return resolveLocaleRegistry(JSON.parse(readFileSync(file, 'utf8')));
}

/** Locale of a content file name: "guides/testing.tr.mdx" → "tr", "guides/testing.mdx" → default */
export function fileLocale(registry, file) {
  const match = /\.([a-z0-9-]+)\.(mdx|json)$/.exec(file.replaceAll('\\', '/'));
  return match && registry.codes.includes(match[1]) ? match[1] : registry.defaultLanguage;
}

/** Adds the URL prefix of a locale: ("tr", "/docs/x") → "/tr/docs/x"; default keeps the path */
export function localeRoute(registry, lang, path) {
  return lang === registry.defaultLanguage ? path : `/${lang}${path}`;
}

/** Locale a route is prefixed with, or the default language for unprefixed routes */
export function routeLocale(registry, route) {
  const segment = route.split('/')[1];
  return registry.translated.includes(segment) ? segment : registry.defaultLanguage;
}
