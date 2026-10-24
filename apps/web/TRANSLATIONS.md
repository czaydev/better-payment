# Docs translations / Doküman çevirileri

The website and docs are published in English (default, `/docs/...`) and Turkish (`/tr/docs/...`).
More languages are supported: everything the site knows about languages comes from one registry file, `lib/i18n/locales.json`. URLs, redirects, the navbar language menu, the sitemap, hreflang alternates, metadata, the docs sidebar fallback, the generated docs and the CI checks are all derived from it.

German, Russian and Arabic are already declared in the registry with `enabled: false` (see the translation issues #112-#114). They are not routed, listed or checked until their content lands; enabling one is a one-line change plus translated pages.

## Files

| What | English | Turkish | A new language |
| ---- | ------- | ------- | -------------- |
| Language registry | `lib/i18n/locales.json` | `lib/i18n/locales.json` | one entry in `lib/i18n/locales.json` |
| Docs page | `content/docs/<path>.mdx` | `content/docs/<path>.tr.mdx` | `content/docs/<path>.<code>.mdx` |
| Sidebar titles and order | `content/docs/<dir>/meta.json` | `content/docs/<dir>/meta.tr.json` | `content/docs/<dir>/meta.<code>.json` |
| Homepage and site texts | `lib/i18n/dictionary.ts` (`en`) | `lib/i18n/dictionary.ts` (`tr`) | a partial dictionary in `lib/i18n/dictionary.ts` |
| Docs UI labels (search, TOC, …) | fumadocs defaults | `lib/i18n/ui.ts` | optional overrides in `lib/i18n/ui.ts` |

## Adding a language / Dil ekleme

Adding a language is a config change, not a code change:

1. **`lib/i18n/locales.json`** — add one entry under `languages`, keyed by the locale code used in URLs and file names (`"de": { … }`), validated by `scripts/locales.mjs`:
   - `code`: must equal the key (`"de"`).
   - `names`: how the navbar switcher labels the language in the English and Turkish UIs, e.g. `{ "en": "German", "tr": "Almanca" }`.
   - `nativeName`: the language's own name (`"Deutsch"`); it feeds the docs UI and the generated `llms.txt`.
   - `dir`: `"ltr"` or `"rtl"`. `"rtl"` sets `dir="rtl"` on `<html>`; mirroring the homepage and docs layouts is a follow-up. Code blocks stay LTR.
   - `enabled`: `true` to route, list and check the language. A prepared language stays `false` until its content lands — a disabled language must not have content files yet.
   - `ogLocale`: the Open Graph tag (`"de_DE"`); `intlLocale`: the BCP 47 tag used for dates (`"de-DE"`).
   - `docs`: `"required"` means every page must have a translation (English and Turkish today). `"optional"` — the usual choice to start — lets a language ship with zero or a few pages: untranslated pages fall back to English with the existing notice, and the pages that do exist are checked just as strictly.
   - Optional: `contribGuide: true` when a `CONTRIBUTING.<code>.md` exists, and `socialImage` to reuse another language's preview (`"og-en.png"`).
2. **`lib/i18n/dictionary.ts`** — add a partial dictionary and register it in `translations`. Keys you omit fall back to English per key, so you can translate the homepage later. Always provide `docs.fallbackNotice` (readers of a not-yet-translated page see it) and the `meta` block (page titles and descriptions).
3. **Translate pages** as `content/docs/<path>.<code>.mdx` (plus `meta.<code>.json`), one directory at a time. Progress per language is printed by `node scripts/check-translations.mjs` (`de: 12/38 pages`). Sidebar titles and order fall back to the English `meta.json` until a `meta.<code>.json` exists.
4. Optional: docs UI labels (search, "On this page", …) in `lib/i18n/ui.ts`; languages without entries keep fumadocs' English defaults.

No other file has to change. Flip `enabled` to `true` when the language should go live, and `docs` to `"required"` once it is complete; CI then enforces page parity like it does for Turkish. A language configured as `docs: "required"` fails `check-translations.mjs` with a per-language missing-page summary.

## Rules

1. **Translate prose only.** Code blocks are shared: keep them byte-for-byte identical to the English page, including comments. This applies to every locale, including partial ones.
2. **Keep the structure.** Same headings (same levels, same order), same tables and callouts. Every translated heading keeps the English heading's id: `## Taksit [#installments]`. Run `node scripts/check-translations.mjs --fix` to add the ids.
3. **Links** to other docs pages are written without a locale (`/docs/concepts/testing`); they are localized automatically.
4. **Frontmatter** values must not contain a second `: `. Use `—` or quote the value.
5. When you change an English page, update its Turkish page in the same PR (and vice versa). A page without a translation falls back to English with a notice. For `docs: "required"` languages CI rejects the missing page; for `docs: "optional"` languages it only reports progress.

```bash
cd apps/web
node scripts/check-translations.mjs        # what CI runs
node scripts/check-translations.mjs --fix  # add/fix heading ids
corepack pnpm docs:test                    # MDX conversion and registry tests
```

## Glossary / Terimler

Keep a glossary per language under this section. Code identifiers (`capture()`, `paymentId`, …) are never translated in any language.

### Turkish / Türkçe

| English | Türkçe |
| ------- | ------ |
| payment provider / gateway | ödeme sağlayıcısı |
| payment institution | ödeme kuruluşu |
| virtual POS | sanal POS |
| merchant | üye işyeri |
| pre-authorization | ön provizyon |
| capture | capture (provizyon kapama) |
| void | void / iptal |
| refund / partial refund | iade / kısmi iade |
| cancel | iptal |
| installment | taksit |
| stored card / tokenization | kayıtlı kart / tokenizasyon |
| callback | callback |
| notification (PayTR) | bildirim |
| order id | sipariş numarası |
| request / response | istek / yanıt |
| request validation | istek doğrulama |
| error code | hata kodu |
| retry | yeniden deneme |
| edge runtime | edge ortamı |
| handler, adapter, route, hook, token, sandbox | (English term kept) |
| plugin, endpoint | (English term kept) |
| payment event / listener | ödeme olayı / dinleyici |
| payment object | ödeme nesnesi |
| custom provider | özel sağlayıcı |
| non-3D | 3D'siz |
