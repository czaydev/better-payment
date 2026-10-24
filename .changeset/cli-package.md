---
"better-payment-cli": minor
---

Add the `better-payment-cli` package: `init` generates the config, route and `.env.example` for every framework, `doctor` verifies sandbox credentials, mode/base URL and the handler setup with read-only probes, and `listen` opens a Cloudflare quick tunnel and logs callbacks as provider/route/status only

<!-- docs -->
en: **[CLI](/docs/guides/cli):** a new `better-payment-cli` package with `init` (generate the integration files), `doctor` (read-only sandbox checks with the credentials-rejected vs wrong-mode distinction) and `listen` (public tunnel plus callback logs without bodies or card data).
tr: **[CLI](/docs/guides/cli):** yeni `better-payment-cli` paketi: `init` (entegrasyon dosyalarını üretir), `doctor` (salt okunur sandbox kontrolleri; kimlik bilgisi reddedildi ile yanlış mod ayrımı) ve `listen` (genel tünel; gövde ve kart verisi içermeyen callback günlükleri).
