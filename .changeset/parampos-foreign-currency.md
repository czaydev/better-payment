---
"better-payment": minor
---

Add Parampos foreign-currency payments: USD, EUR and GBP through `TP_Islem_Odeme_WD` (Doviz_Kodu 1001/1002/1003), returning UCD_URL as `redirectUrl` and verifying `TURKPOS_RETVAL_Hash` on the signed callback; TRY stays on TP_WMD_UCD and refunds/cancels of foreign-currency payments fail instead of sending the TRY message

<!-- docs -->
section: added
en: **[Parampos](/docs/providers/parampos#foreign-currency-3d-secure):** USD, EUR and GBP payments through `TP_Islem_Odeme_WD`, with `redirectUrl` and verified `TURKPOS_RETVAL_*` callbacks.
tr: **[Parampos](/docs/providers/parampos#foreign-currency-3d-secure):** `TP_Islem_Odeme_WD` ile USD, EUR ve GBP ödemeleri; `redirectUrl` ve doğrulanan `TURKPOS_RETVAL_*` callback'leri.
