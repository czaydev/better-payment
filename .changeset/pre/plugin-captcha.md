---
'better-payment': minor
---

feat(plugins): add captcha plugin supporting Turnstile, reCAPTCHA, and hCaptcha (#173)

- Add `captcha` plugin to verify tokens before payment execution
- Support Cloudflare Turnstile, Google reCAPTCHA v3 (with `minScore`), and hCaptcha
- Read token from HTTP headers or request body candidates
- Normalize failure error codes to `CAPTCHA_MISSING` and `CAPTCHA_INVALID`
- Exclude provider callback and 3DS completion operations

<!-- docs -->
en: **[Captcha verification](/docs/plugins/captcha):** the `captcha` plugin verifies Cloudflare Turnstile, Google reCAPTCHA v3 or hCaptcha tokens server-side before a payment runs, so card-testing bots are stopped before they reach the provider. Callbacks and 3DS completions are never blocked.
tr: **[Captcha doğrulaması](/docs/plugins/captcha):** `captcha` eklentisi, ödeme çalıştırılmadan önce Cloudflare Turnstile, Google reCAPTCHA v3 veya hCaptcha jetonlarını sunucu tarafında doğrular; kart test eden botlar sağlayıcıya ulaşamadan durdurulur. Callback'ler ve 3DS tamamlama adımları asla engellenmez.
