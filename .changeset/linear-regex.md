---
"better-payment": patch
---

Validation: the `buyer.email` check and the handler's path trimming no longer use regular expressions that can backtrack on long input. Emails with an empty domain label (`a@b..c`, `a@.b.c`) are now rejected.

<!-- docs -->
en: `buyer.email` validation rejects empty domain labels and no longer uses a backtracking regular expression.
tr: `buyer.email` doğrulaması boş alan adı bölümlerini reddeder ve artık geri izleme yapan bir düzenli ifade kullanmaz.
