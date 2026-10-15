---
"better-payment": minor
---

Add the VakıfBank provider (VPOS 7/24): non-3D sale, 3D Secure through the MPI and VakıfBank's 3DS product, refund and cancel (no payment status query: VakıfBank's record search cannot see cancels and refunds)

<!-- docs -->
en: **[VakıfBank provider](/docs/banks/vakifbank):** non-3D sale, 3D Secure (MPI enrollment, then a VPOS authorization that takes the card and amount from VakıfBank's own 3D record), refund and cancel. `getPayment()` is not supported.
tr: **[VakıfBank sağlayıcısı](/docs/banks/vakifbank):** 3D'siz satış, 3D Secure (MPI kaydı ve ardından kartı ve tutarı VakıfBank'ın kendi 3D kaydından alan VPOS provizyonu), iade ve iptal. `getPayment()` desteklenmez.
