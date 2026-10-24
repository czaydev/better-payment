---
"better-payment": minor
---

Add `pendingResolver` plugin to query and resolve timed out payments (`NETWORK_ERROR`) on a schedule, preventing double charging and emitting final outcome events.

<!-- docs -->

en: **[Pending Payment Resolver](/docs/plugins/pending-resolver):** Recovers timed out payments by read-only provider status checks, emitting exactly one terminal event per payment even when resolvers run concurrently.
tr: **[Bekleyen Ödeme Çözümleyici](/docs/plugins/pending-resolver):** Zaman aşımına uğrayan ödemeleri salt okunur durum sorgularıyla kurtarır; eşzamanlı çözümleyiciler çalışsa bile her ödeme için yalnızca tek bir nihai olay yayınlanır.
