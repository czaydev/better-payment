---
"better-payment": patch
---

Plugin endpoints refuse HTML form bodies on `POST` with 415, like the built-in actions, so another site cannot post to them with the visitor's cookies (CSRF); an endpoint a third party posts a form to sets the new `acceptForm: true`. An `onRequest` hook that throws now stops the request with 503 instead of letting it through, and `rateLimit` gets `passOnStoreError` for applications that prefer to stay open while their store is down.

<!-- docs -->
en: **[Writing plugins](/docs/guides/writing-plugins):** plugin `POST` endpoints refuse form bodies (CSRF) unless they set `acceptForm`, and a failing `onRequest` hook answers 503; [rate limit](/docs/plugins/rate-limit) no longer turns off silently when its store fails (`passOnStoreError` to keep the old behavior).
tr: **[Plugin yazma](/docs/guides/writing-plugins):** plugin `POST` endpoint'leri `acceptForm` verilmedikçe form gövdelerini reddeder (CSRF), hata fırlatan bir `onRequest` hook'u 503 döner; [hız sınırı](/docs/plugins/rate-limit) store hata verdiğinde artık sessizce kapanmaz (eski davranış için `passOnStoreError`).
