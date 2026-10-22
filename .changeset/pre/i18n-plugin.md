---
'better-payment': minor
---

Rename the `localizedErrors` plugin to `i18n` and make it work like the i18n plugin of Better Auth: `i18n({ translations, defaultLocale, detection, localeCookie, getLocale })`. English is built in, and the built-in Turkish, German, Russian and Arabic translations come in `locales`. HTTP handler responses pick their language with the `header` (`Accept-Language`), `cookie` and `callback` strategies, in the order you choose; `payment.errors.detectLocale(request)` runs the same detection. `localizedErrors`, `errorMessages`, `LocalizedErrorsOptions` and `ErrorMessageDictionary` still work and are deprecated.

<!-- docs -->
en: **[i18n plugin](/docs/plugins/i18n):** `localizedErrors` is now `i18n` and works like Better Auth's i18n plugin: `translations` with the built-in `locales`, `defaultLocale`, and `detection` strategies (`header`, `cookie`, `callback`) for each handler response. The old name still works and is deprecated.
tr: **[i18n plugin'i](/docs/plugins/i18n):** `localizedErrors` artık `i18n` adını taşıyor ve Better Auth'un i18n plugin'i gibi çalışıyor: yerleşik `locales` ile `translations`, `defaultLocale` ve her handler yanıtı için `detection` stratejileri (`header`, `cookie`, `callback`). Eski ad çalışmaya devam ediyor ve kullanımdan kaldırıldı.
