---
"better-payment": patch
---

`redact`: `fields` and `custom` now add to the defaults instead of replacing them, so listing one extra field no longer unmasks the CVC or the TCKN pattern; `cardHolderName`, `securityCode` and provider secrets (`storeKey`, `hashKey`, `apiSecret`, `clientSecret`, `terminalProvPassword`) are masked by default; and the result the call returns keeps `paymentId`, `conversationId`, the 3D Secure and checkout form pages and the stored card tokens as the provider sent them.

<!-- docs -->
en: **[Redaction](/docs/plugins/redact):** `fields` and `custom` add to the defaults instead of replacing them, cardholder name and provider secrets are masked by default, and identifiers and the 3D Secure page come back unmasked.
tr: **[Veri maskeleme](/docs/plugins/redact):** `fields` ve `custom` varsayılanların yerine geçmek yerine onlara eklenir, kart hamili adı ve sağlayıcı sırları varsayılan olarak maskelenir, kimlikler ve 3D Secure sayfası maskelenmeden döner.
