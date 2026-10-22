---
"better-payment": patch
---

`failover`: a payment that failed with an HTTP 500, 502 or 504 answer no longer moves to a backup provider, because the provider may have charged the card before the error. These statuses are out of the default `on` codes and are ignored even when listed; 503 still fails over.

<!-- docs -->
en: **[Failover](/docs/plugins/failover):** no failover after an HTTP 500, 502 or 504 answer, which can come after the card was charged, so a gateway error cannot charge the customer twice.
tr: **[Failover](/docs/plugins/failover):** kart çekildikten sonra da gelebilen HTTP 500, 502 ve 504 cevaplarından sonra yedek sağlayıcıya geçilmez, böylece bir gateway hatası müşteriyi iki kez ödetemez.
