---
"better-payment": minor
---

Add the `multiTenant` plugin: resolves provider credentials per merchant for marketplaces and SaaS platforms, provides `payment.forTenant(id)`, caches provider instances with configurable TTL and tags operations and events with `tenantId`. The tenant is read from state your server controls (a `tenant` resolver or `forTenant()`), never from the body of a request that reached the HTTP handler; `trustRequestTenant` opts into body tenancy for calls made on the payment object.

<!-- docs -->
en: **[Multi-tenant credentials plugin](/docs/plugins/multi-tenant):** Resolve provider credentials per merchant with caching, `payment.forTenant(id)` and 3D Secure callbacks routed by tenant state only your server writes.
tr: **[Çok kiracılı (Multi-tenant) plugin](/docs/plugins/multi-tenant):** Pazaryeri ve SaaS platformları için satıcı bazlı dinamik POS kimlik bilgileri, `payment.forTenant(id)`, önbellekleme ve yalnızca sunucunuzun yazdığı mağaza durumuyla yönlendirilen 3D Secure callback işlemleri.
