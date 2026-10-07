---
"better-payment": patch
---

Parampos failures now carry a specific `code` instead of `UNKNOWN`: the bank's ISO 8583 code in `Banka_Sonuc_Kod` is used first, then Param's `Sonuc` codes, exported as `PARAMPOS_ERROR_CODES`. Closes #82.

<!-- docs -->
en: **[Parampos error codes](/docs/reference/error-codes#what-is-mapped):** failed Parampos payments now return a specific `code` (from the bank's `Banka_Sonuc_Kod`, then Param's `Sonuc`) instead of `UNKNOWN`. The table is exported as `PARAMPOS_ERROR_CODES`.
tr: **[Parampos hata kodları](/docs/reference/error-codes#what-is-mapped):** başarısız Parampos ödemeleri artık `UNKNOWN` yerine belirli bir `code` döndürüyor (önce bankanın `Banka_Sonuc_Kod` alanı, sonra Param'ın `Sonuc` kodu). Tablo `PARAMPOS_ERROR_CODES` olarak dışa açılır.
