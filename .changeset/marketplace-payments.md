---
"better-payment": minor
---

Marketplace split payments: register, update and retrieve iyzico sub-merchants, split a basket with `BasketItem.subMerchant { key, price }` in direct, 3D Secure and checkout-form payments, and approve or disapprove each seller's item payout through `payment.iyzico.marketplace.*`, the HTTP handler and the browser client. Shares are validated before any HTTP call (never above the item price, every item once one is split, IBAN MOD-97), and providers without a split API reject the basket with `NOT_SUPPORTED` instead of charging the full amount to the marketplace. PayTR's published Platform Transfer Request API is documented but not implemented, because its per-transfer IBAN/amount flow and panel-based seller onboarding do not fit the shared sub-merchant/payout model.

<!-- docs -->
en: **[Marketplace split payments](/docs/payments/marketplace):** register iyzico sub-merchants, split basket items with `subMerchant: { key, price }`, and approve or disapprove each seller's payout. Providers without a split API reject the basket with `NOT_SUPPORTED`; PayTR's separate Platform Transfer Request flow is documented but not implemented.
tr: **[Pazaryeri bölüşmeli ödemeler](/docs/payments/marketplace):** iyzico alt satıcılarını kaydedin, sepet kalemlerini `subMerchant: { key, price }` ile bölün ve her satıcının hakedişini onaylayın ya da geri alın. Bölüşmeli ödeme API'si olmayan sağlayıcılar sepeti `NOT_SUPPORTED` ile reddeder; PayTR'ın ayrı Platform Transfer Request akışı belgelenmiştir ancak uygulanmamıştır.
