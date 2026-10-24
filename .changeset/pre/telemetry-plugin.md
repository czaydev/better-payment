---
"better-payment": minor
---

Add the `telemetry` plugin: one OpenTelemetry-compatible span per provider call with the provider, operation, result, normalized error code, HTTP status, retry count and duration, plus a `payment.calls` counter and a `payment.duration` histogram. It has no dependencies — it accepts any structurally compatible `tracer` and `meter`, so a real `@opentelemetry/api` tracer works and applications without OpenTelemetry can pass nothing at all. Attributes are low-cardinality and never contain card data, and a throwing tracer is reported through the logger without changing the payment.

<!-- docs -->
section: added
en: **[Telemetry](/docs/plugins/telemetry):** OpenTelemetry-compatible spans and metrics for every provider call, with no card data in attributes and no dependencies.
tr: **[Telemetri](/docs/plugins/telemetry):** Her sağlayıcı çağrısı için OpenTelemetry uyumlu span ve metrikler; niteliklerde kart verisi yok, bağımlılık yok.
