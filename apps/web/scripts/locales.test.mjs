import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fileLocale,
  localeRoute,
  readLocaleRegistry,
  resolveLocaleRegistry,
  routeLocale,
} from './locales.mjs';

/** A complete registry entry; tests override only the field they exercise. */
function entry(code, overrides = {}) {
  return {
    code,
    names: { en: `${code}-en`, tr: `${code}-tr` },
    nativeName: `${code}-native`,
    dir: 'ltr',
    enabled: true,
    ogLocale: `${code}_XX`,
    intlLocale: `${code}-XX`,
    docs: 'required',
    ...overrides,
  };
}

function fixture() {
  return {
    defaultLanguage: 'en',
    languages: {
      en: entry('en'),
      tr: entry('tr'),
      de: entry('de', { enabled: false, docs: 'optional' }),
      ar: entry('ar', { enabled: false, docs: 'optional', dir: 'rtl' }),
    },
  };
}

test('the registry derives enabled, translated, required and disabled lists', () => {
  const registry = resolveLocaleRegistry(fixture());
  assert.equal(registry.defaultLanguage, 'en');
  assert.deepEqual(registry.declared, ['en', 'tr', 'de', 'ar']);
  assert.deepEqual(registry.enabled, ['en', 'tr']);
  assert.deepEqual(registry.codes, ['en', 'tr']);
  assert.deepEqual(registry.translated, ['tr']);
  assert.deepEqual(registry.required, ['en', 'tr']);
  assert.deepEqual(registry.disabled, ['de', 'ar']);
});

test('disabled languages keep their direction and are not routed or checked', () => {
  const registry = resolveLocaleRegistry(fixture());
  assert.equal(registry.settings.ar.dir, 'rtl');
  assert.equal(registry.settings.de.enabled, false);
  assert.equal(fileLocale(registry, 'reference/api.de.mdx'), 'en');
  assert.equal(routeLocale(registry, '/de/docs'), 'en');
});

test('content file locales and routes follow the enabled list', () => {
  const registry = resolveLocaleRegistry(fixture());
  assert.equal(fileLocale(registry, 'guides/testing.tr.mdx'), 'tr');
  assert.equal(fileLocale(registry, 'guides\\testing.tr.mdx'), 'tr');
  assert.equal(fileLocale(registry, 'guides/testing.mdx'), 'en');
  assert.equal(fileLocale(registry, 'guides/testing.tr.json'), 'tr');
  assert.equal(localeRoute(registry, 'tr', '/docs/testing'), '/tr/docs/testing');
  assert.equal(localeRoute(registry, 'en', '/docs/testing'), '/docs/testing');
  assert.equal(routeLocale(registry, '/tr/docs/testing'), 'tr');
  assert.equal(routeLocale(registry, '/docs/testing'), 'en');
});

test('invalid registry entries fail with a clear message', () => {
  const cases = [
    ['not an object', null, /expected an object/],
    ['no languages', { defaultLanguage: 'en', languages: {} }, /no languages registered/],
    ['missing default', { ...fixture(), defaultLanguage: 'fr' }, /defaultLanguage "fr" is not a listed language/],
    [
      'disabled default',
      { defaultLanguage: 'en', languages: { en: entry('en', { enabled: false, docs: 'optional' }) } },
      /defaultLanguage "en" must be enabled/,
    ],
  ];
  for (const [name, registry, error] of cases) assert.throws(() => resolveLocaleRegistry(registry), error, name);

  const mutate = (change) => {
    const registry = fixture();
    change(registry.languages.tr);
    return registry;
  };
  assert.throws(
    () => resolveLocaleRegistry({ defaultLanguage: 'TR', languages: { TR: entry('tr') } }),
    /not a usable locale code/
  );
  assert.throws(() => resolveLocaleRegistry(mutate((tr) => (tr.code = 'de'))), /\.code must be "tr"/);
  assert.throws(() => resolveLocaleRegistry(mutate((tr) => delete tr.names.tr)), /names\.tr must be a non-empty string/);
  assert.throws(() => resolveLocaleRegistry(mutate((tr) => (tr.nativeName = ' '))), /non-empty nativeName/);
  assert.throws(() => resolveLocaleRegistry(mutate((tr) => (tr.dir = 'sideways'))), /expected "ltr" or "rtl"/);
  assert.throws(() => resolveLocaleRegistry(mutate((tr) => (tr.enabled = 'yes'))), /boolean enabled flag/);
  assert.throws(() => resolveLocaleRegistry(mutate((tr) => (tr.docs = 'partial'))), /expected "required" or "optional"/);
  assert.throws(() => resolveLocaleRegistry(mutate((tr) => (tr.ogLocale = ''))), /needs an ogLocale/);
  assert.throws(() => resolveLocaleRegistry(mutate((tr) => (tr.intlLocale = ''))), /needs an intlLocale/);
  assert.throws(
    () => resolveLocaleRegistry(mutate((tr) => (tr.socialImage = 'https://example.com/og.png'))),
    /socialImage must be a file name/
  );
  assert.throws(
    () => resolveLocaleRegistry(mutate((tr) => Object.assign(tr, { enabled: false }))),
    /cannot be docs "required" while disabled/
  );
});

test('the real locales.json is valid and keeps English and Turkish enabled', () => {
  const registry = readLocaleRegistry();
  assert.ok(registry.enabled.includes('en'));
  assert.ok(registry.enabled.includes('tr'));
  assert.ok(registry.enabled.includes(registry.defaultLanguage));
  assert.ok(registry.required.every((code) => registry.enabled.includes(code)));
  assert.ok(registry.disabled.every((code) => !registry.enabled.includes(code)));
  for (const code of registry.declared) assert.equal(registry.settings[code].code, code);
});
