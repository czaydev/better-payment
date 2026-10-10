---
"better-payment": patch
---

Akbank: `completeThreeDSPayment()` confirms the 3D Secure result with an order history query (txnCode 1010) and rejects a callback that does not match Akbank's record for the order as `INVALID_HASH`. A query that gets no response returns `pending` with `NETWORK_ERROR`.

<!-- docs -->
en: Akbank: 3D Secure callbacks are confirmed with an order history query; a callback that does not match the order at Akbank is rejected.
tr: Akbank: 3D Secure callback'leri sipariş geçmişi sorgusuyla doğrulanır; Akbank'taki sipariş kaydıyla eşleşmeyen callback reddedilir.
