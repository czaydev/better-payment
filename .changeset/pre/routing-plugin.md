---
"better-payment": minor
---

Add `routing` (subpath `better-payment/routing`): rule-based provider routing with BIN, bank, card family, card type, card origin, amount, currency, installment, 3D Secure, operation and custom predicate conditions; ordered and deterministic weighted targets; injected health, BIN and key-value store hooks; explainable decisions and audit listeners; follow-up operations that stay on the provider that handled the payment; and no re-routing after a possible charge.

<!-- docs -->
section: added
en: **[Routing](/docs/plugins/routing):** picks the provider of each payment from your own rules (card family, card origin, amount, installment, health), with a dry-run `explain()`, deterministic 70/30 splits, audit listeners, and refunds that always reach the provider that took the payment.
tr: **[Yönlendirme](/docs/plugins/routing):** her ödemeyi kendi kurallarınıza göre (kart ailesi, kartın menşei, tutar, taksit, sağlık) doğru sağlayıcıya gönderir; kuru çalışan `explain()`, belirleyici 70/30 dağıtımı, denetim dinleyicileri ve her zaman ödemeyi alan sağlayıcıya giden iadeler sunar.
