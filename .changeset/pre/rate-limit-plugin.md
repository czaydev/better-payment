---
'better-payment': minor
---

Add `rateLimit` plugin for HTTP handler endpoints with per-route throttling, a customizable key extractor, sliding window store, and callback exclusion. The client identity defaults to a safe source: proxy headers are only read with `trustProxy`, otherwise an explicit `key` is required.

<!-- docs -->
section: added
en: **[Rate Limiting](/docs/plugins/rate-limit):** New `rateLimit` plugin throttles handler endpoints per route; the key defaults to an app-controlled source and only reads `X-Forwarded-For` when `trustProxy` is enabled.
tr: **[Rate Limiting](/docs/plugins/rate-limit):** Yeni `rateLimit` plugin'i handler uç noktalarını rota bazında sınırlandırır; kimlik varsayılan olarak uygulamanın kontrol ettiği bir kaynaktan gelir ve `X-Forwarded-For` yalnızca `trustProxy` etkinken okunur.
