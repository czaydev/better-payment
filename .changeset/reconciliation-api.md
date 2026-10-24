---
"better-payment": minor
---

Add the reconciliation API: `better-payment/reconciliation` lists PayTR, iyzico, Akbank and Parampos daily transactions as normalized, deduplicated rows and matches them against local orders without changing any payment; other providers answer `NOT_SUPPORTED`

<!-- docs -->
en: **[Reconciliation](/docs/guides/reconciliation):** list a provider's daily transactions and match them against your orders with `reconciliationPlugin()` or `createReconciliation()`, without changing any payment
tr: **[Mutabakat](/docs/guides/reconciliation):** bir sağlayıcının günlük işlemlerini listeleyin ve `reconciliationPlugin()` ya da `createReconciliation()` ile siparişlerinizle eşleştirin; hiçbir ödeme değişmez
