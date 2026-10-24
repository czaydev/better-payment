---
"better-payment": minor
---

Add provider-independent recurring payments with stored cards: `chargeStoredCard()` charges one billing period on iyzico or PayTR with `storedCard`, `recurring: true` and a `conversationId`, never retries an unknown outcome, and rejects other providers with `NOT_SUPPORTED`. Adds `addBillingMonths()` and `billingOrderId()`, a `recurring/charge` handler action with idempotency, and keeps card data out of payment events.

<!-- docs -->
en: **[Recurring payments](/docs/payments/recurring-payments):** Charge a saved card for each billing period with one provider-independent API, with `addBillingMonths()`, stable billing ids and `NOT_SUPPORTED` elsewhere.
tr: **[Tekrarlayan ödemeler](/docs/payments/recurring-payments):** Kayıtlı kartı her fatura dönemi için sağlayıcıdan bağımsız tek API ile tahsil edin; `addBillingMonths()`, sabit fatura kimlikleri ve diğer sağlayıcılarda `NOT_SUPPORTED`.
