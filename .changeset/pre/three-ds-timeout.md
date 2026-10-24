---
'better-payment': minor
---

feat(plugins): add threeDSTimeout plugin to expire abandoned 3D Secure payments (#180)

- Add `threeDSTimeout` plugin tracking initiated 3D Secure payments across providers
- Support configurable timeout duration (e.g. `'15m'`), pluggable `ThreeDSFlowStore`, and `onExpire` callback
- Query provider before expiring to protect against late successful callbacks
- Provide `payment.threeDS.expireStale()` for serverless and cron schedulers

<!-- docs -->
en: **[3D Secure timeout](/docs/plugins/three-ds-timeout):** the `threeDSTimeout` plugin tracks initiated 3D Secure flows and expires the ones the customer abandons after a configurable delay. Each flow is re-checked with the provider first, so a late successful callback is never discarded, and `payment.threeDS.expireStale()` can be run from a cron job or a serverless schedule.
tr: **[3D Secure zaman aşımı](/docs/plugins/three-ds-timeout):** `threeDSTimeout` eklentisi başlatılan 3D Secure akışlarını izler ve müşterinin yarım bıraktıklarını ayarlanabilir süre sonunda düşürür. Her akış önce sağlayıcıdan yeniden sorgulanır, böylece geç gelen başarılı bir bildiri asla yok sayılmaz; `payment.threeDS.expireStale()` metodunu cron görevi veya sunucusuz zamanlı görev içinde çalıştırabilirsiniz.
