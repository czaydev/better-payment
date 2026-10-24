---
"better-payment": patch
---

`refundApproval`: the approve and reject endpoints take the approver from the new `getActor` option instead of the request body (and answer 403 without it), a request body can no longer mark a refund as already approved, cancellations wait for approval unless the new `cancelAmount` option puts them under the threshold, amounts are parsed strictly, and approving the same request twice refunds once.

<!-- docs -->
en: **[Refund approval](/docs/plugins/refund-approval):** the approver of the HTTP endpoints comes from your session through `getActor`, never from the request body; cancellations and unreadable amounts wait for approval, and a double approval refunds once.
tr: **[İade onayı](/docs/plugins/refund-approval):** HTTP uç noktalarında onaylayan, istek gövdesinden değil `getActor` ile oturumunuzdan alınır; iptaller ve okunamayan tutarlar onaya düşer, iki kez onaylanan talep bir kez iade edilir.
