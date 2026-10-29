---
'better-payment': minor
---

feat(bin): add offline Turkish BIN table lookup (`better-payment/bin`) (#153)

- Add standalone, tree-shakable `lookupBin(bin)` subpath export
- Cover major Turkish bank card families (Bonus, World, Maximum, Axess, CardFinans, Paraf, Bankkart Combo, Sağlam Kart) and prepaid cards
- Zero network latency and zero bundle size impact on the core package
- Add dataset regeneration script and unit tests

<!-- docs -->
en: **[Offline BIN lookup](/docs/guides/bin-lookup):** `lookupBin(bin)` from `better-payment/bin` returns the bank, card programme and card type from a bundled Turkish BIN table, with no network call.
tr: **[Çevrimdışı BIN sorgusu](/docs/guides/bin-lookup):** `better-payment/bin` içindeki `lookupBin(bin)`, yerleşik Türk BIN tablosundan bankayı, kart programını ve kart tipini ağ çağrısı yapmadan döndürür.
