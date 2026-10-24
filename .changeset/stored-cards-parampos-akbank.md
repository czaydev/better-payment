---
"better-payment": minor
---

Add the unified stored-card API to Parampos: `saveCard()`, `listCards()` and `deleteCard()` map to Param's SOAP card-storage service (`KS_Kart_Ekle`, `KS_Kart_Liste`, `KS_Kart_Sil`), and `storedCard` / `saveCard` on payment requests charge a saved card by its `KS_GUID` (`KS_Tahsilat`). Akbank documents a `savedCard` API object but no storage transaction code, so card storage there throws `NOT_SUPPORTED` with an explanation instead of guessing codes

<!-- docs -->

en: **[Stored cards](/docs/payments/stored-cards):** Parampos now supports the unified stored-card API — `saveCard()`, `listCards()`, `deleteCard()` and `storedCard` payments run through Param's SOAP `KS_*` service and charge by `KS_GUID` via `KS_Tahsilat`. Akbank's API shows a `savedCard` object but no storage transaction code, so it throws `NOT_SUPPORTED` with an explanation.
tr: **[Saklanan kartlar](/docs/payments/stored-cards):** Parampos artık birleşik saklanan-kart API'sini destekliyor — `saveCard()`, `listCards()`, `deleteCard()` ve `storedCard` ödemeleri Param'ın SOAP `KS_*` servisi üzerinden çalışır ve `KS_GUID` ile `KS_Tahsilat` üzerinden tahsil edilir. Akbank API'sinde `savedCard` nesnesi görünüyor ama depolama transaction kodu yayınlanmamış; bu yüzden açıklamalı `NOT_SUPPORTED` fırlatır.
