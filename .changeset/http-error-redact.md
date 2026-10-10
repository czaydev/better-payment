---
"better-payment": patch
---

`HttpError.config` no longer keeps the request body and headers. The error is passed to the logger, and the body carried card data and Parampos credentials, the headers the iyzico authorization.

<!-- docs -->
en: Errors passed to the logger no longer contain the provider request's body or headers (card data, credentials).
tr: Logger'a verilen hatalar artık sağlayıcı isteğinin gövdesini ve başlıklarını (kart verisi, kimlik bilgileri) içermiyor.
