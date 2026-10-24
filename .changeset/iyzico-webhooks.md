---
"better-payment": minor
---

feat(iyzico): add webhook signature verification and handler route (#150)

- Add `verifyWebhook(headers, body)` to `IyzicoProvider` with `X-IYZ-SIGNATURE-V3` HMAC-SHA256 verification
- Expose `/api/pay/iyzico/webhook` in `BetterPaymentHandler`: verified notifications emit a payment event, reach `onCallback`, and are deduplicated with the idempotency store
- Map a non-terminal notification `status` to `pending`, so an in-progress 3DS step broadcasts `payment.pending` instead of a false `payment.failed`

<!-- docs -->

en: **[iyzico webhooks](/docs/providers/iyzico#webhook-notifications):** iyzico's merchant notifications now arrive at `POST /api/pay/iyzico/webhook`, where the `X-IYZ-SIGNATURE-V3` HMAC-SHA256 header is verified before the payment is emitted as an event and passed to `onCallback`. Repeated notifications for the same payment are answered from the idempotency store, so the handler runs once per event. `payment.iyzico.verifyWebhook(headers, body)` is also available for routes outside the handler.
tr: **[iyzico webhook'ları](/docs/providers/iyzico#webhook-notifications):** iyzico'nun mağaza bildirimleri artık `POST /api/pay/iyzico/webhook` adresine düşüyor; imza `X-IYZ-SIGNATURE-V3` (HMAC-SHA256) ile doğrulandıktan sonra ödeme olayı yayınlanıp `onCallback`'e iletiliyor. Aynı ödemeye gelen tekrarlı bildirimler idempotency deposundan yanıtlandığı için handler her olay için bir kez çalışıyor. Handler dışındaki rotalarda `payment.iyzico.verifyWebhook(headers, body)` doğrudan kullanılabilir.
