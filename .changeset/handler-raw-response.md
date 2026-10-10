---
"better-payment": minor
---

Handler: responses no longer include the provider's `rawResponse`, which can hold merchant data (commission rates, fraud status) and stored-card keys. `onCallback`, `callbackRedirect` and events still receive it. Set `exposeRawResponse: true` to keep the previous behavior. New `idempotency.scope(ctx)` option keeps the `Idempotency-Key` responses of different callers apart.

<!-- docs -->

en: Handler responses leave out the provider's `rawResponse` unless `exposeRawResponse: true` is set, and `idempotency.scope` keeps the Idempotency-Key responses of different callers apart.
tr: Handler yanıtları `exposeRawResponse: true` verilmedikçe sağlayıcının `rawResponse` alanını içermez; `idempotency.scope` farklı çağıranların Idempotency-Key yanıtlarını birbirinden ayırır.
