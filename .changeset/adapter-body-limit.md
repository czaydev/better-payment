---
"better-payment": patch
---

Adapters: the Express/Node and fetch-based adapters read at most 1 MiB of a request body and answer 413 for larger ones, instead of buffering bodies of any size. Change the limit with `maxBodySize` on `toExpressHandler`, `toNodeHandler` or `toFetchHandler`.

<!-- docs -->
en: Framework adapters answer 413 for request bodies over 1 MiB instead of reading them into memory; change the limit with `maxBodySize`.
tr: Framework adapter'ları 1 MiB'tan büyük istek gövdelerini belleğe okumak yerine 413 ile yanıtlar; sınırı `maxBodySize` ile değiştirebilirsiniz.
