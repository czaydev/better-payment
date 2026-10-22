---
"better-payment": minor
---

QNB's `completeThreeDSPayment()` takes the order from your records as a separate second argument (`{ orderId, amount }`, never read from the callback body). A callback for another order than `orderId` is rejected, 3D Pay checks the bank's amount against `amount` when given, and on a timeout the result no longer carries the callback's order id unless you pass `orderId`

<!-- docs -->
en: **[QNB](/docs/banks/qnb):** pass `{ orderId, amount }` from your records as the second argument of `completeThreeDSPayment()`; on a timeout, the order id is returned only when you pass `orderId`.
tr: **[QNB](/docs/banks/qnb):** kendi kayıtlarınızdaki `{ orderId, amount }` değerlerini `completeThreeDSPayment()`'ın ikinci argümanı olarak verin; zaman aşımında sipariş numarası yalnızca `orderId` verdiyseniz döner.
