---
"better-payment": minor
---

Add the `openAPI` plugin: generates an OpenAPI 3.1.0 document and serves an interactive Scalar API reference page for all HTTP handler routes, configured providers, and registered plugin endpoints. The document lists only the routes the handler serves, under its `basePath`. The reference is off in `mode: 'production'` unless `disabled: false` is set, and `privileged: true` puts it behind the handler's `authorize` hook. Plugin endpoint contexts now always have `html()`, and plugins get a read-only `endpoints` list.

<!-- docs -->
en: **[OpenAPI & Scalar Reference plugin](/docs/plugins/openapi):** Generate OpenAPI 3.1.0 schemas and serve an interactive Scalar API reference documentation page for payment handler endpoints.
tr: **[OpenAPI ve Scalar Referans plugin'i](/docs/plugins/openapi):** Ödeme handler endpoint'leri için OpenAPI 3.1.0 şeması üretir ve etkileşimli Scalar API dokümantasyon sayfası sunar.
