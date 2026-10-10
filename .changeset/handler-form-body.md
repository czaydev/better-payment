---
"better-payment": patch
---

Handler: only provider callbacks accept form bodies. Other actions answer 415 for `application/x-www-form-urlencoded`, `multipart/form-data` and `text/plain`, which a cross-site HTML form can send with the user's cookies and without a CORS preflight.

<!-- docs -->
en: The HTTP handler accepts form bodies only for provider callbacks; other actions answer 415, so a form on another site cannot call them with the user's cookies.
tr: HTTP handler form gövdesini yalnızca sağlayıcı callback'lerinde kabul eder; diğer aksiyonlar 415 döner, böylece başka bir sitedeki form bunları kullanıcının cookie'leriyle çağıramaz.
