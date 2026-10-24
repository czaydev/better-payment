---
"better-payment": minor
---

Add the `fraudRules` plugin for card-testing protection: velocity counters per IP, card, BIN, email or buyer (with consecutive-decline and distinct-value rules), blocked BIN ranges, an amount limit, your own rule functions and an optional challenge hook, all checked before the provider is called. Every counter key is a salted HMAC digest, so a card number never reaches the store, the log or a message, and nothing is read from `X-Forwarded-For` unless you name that header and your proxies. It ships as its own `better-payment/fraud` entry point, so `better-payment/plugins` stays the same size. Closes #105

<!-- docs -->
section: added
en: **[Fraud rules](/docs/plugins/fraud-rules):** `fraudRules()` counts payment attempts per IP, card, BIN, email or buyer, refuses card-testing runs, blocked BIN ranges and amounts over your limit before the provider is called, and exposes `FRAUD_BLOCKED` and `RATE_LIMITED` through `$ERROR_CODES`; counters are keyed by salted hashes and available under `better-payment/fraud`.
tr: **[Fraud kuralları](/docs/plugins/fraud-rules):** `fraudRules()` ödeme denemelerini IP, kart, BIN, e-posta veya alıcı bazında sayar; kart testi saldırılarını, engellenmiş BIN aralıklarını ve limitinizin üstündeki tutarları sağlayıcı çağrılmadan reddeder; `FRAUD_BLOCKED` ve `RATE_LIMITED` kodlarını `$ERROR_CODES` üzerinden verir. Sayaç anahtarları tuzlanmış hash'lerden türetilir ve giriş noktası `better-payment/fraud` adındadır.
