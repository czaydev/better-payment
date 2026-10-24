---
"better-payment": minor
---

Add `verifyCard()`: verify a card without charging it with a small 3D Secure pre-authorization (1 TRY by default, configurable per provider via `verifyCard: { amount, currency }`) that is released automatically once the authentication succeeds. The callback result is marked `verification: 'card'` with `voided` and, when `saveCard` was set, the stored-card tokens. New `verification.pending/succeeded/failed/void_failed` events; the automatic release runs through hooks and emits `payment.cancelled`, and a failed release emits `verification.void_failed`. Providers without pre-authorization throw `NOT_SUPPORTED`. New handler route `POST /:provider/verify-card/init-3ds`

<!-- docs -->

en: **[Card verification](/docs/payments/verify-card):** `verifyCard()` checks a card with a small 3D Secure hold that is released automatically — before saving the card or starting a subscription. Works on providers with pre-authorization (iyzico, Parampos, Akbank, Sipay, Albaraka Türk); others throw `NOT_SUPPORTED`.
tr: **[Kart doğrulama](/docs/payments/verify-card):** `verifyCard()` kartı, kimlik doğrulama başarılır başarılmaz otomatik serbest bırakılan küçük bir 3D Secure blokesiyle kontrol eder — kartı kaydetmeden ya da abonelik başlatmadan önce. Ön provizyonu olan sağlayıcılarda çalışır (iyzico, Parampos, Akbank, Sipay, Albaraka Türk); diğerleri `NOT_SUPPORTED` fırlatır.
