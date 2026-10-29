---
"better-payment": minor
---

Add e-Fatura / e-Arşiv invoicing plugin (`invoicing`) with an official Paraşüt adapter, shipped as the tree-shakable `better-payment/invoicing` subpath: sales-invoice creation plus a separate, provider-confirmed issuance step (e-Fatura / e-Arşiv chosen by the buyer's registered inbox), required OAuth password-grant credentials, a pluggable `InvoicingStore` for legally-relevant records, automatic retries with failure hooks, a guard that drops a redelivered notification instead of issuing a second invoice for the same payment, and refund automation. It is exported only from `better-payment/invoicing`, not from `better-payment/plugins`, so applications that do not invoice pay no bundle cost for the plugin or the Paraşüt adapter.

<!-- docs -->
section: added
en: **[Invoicing plugin](/docs/plugins/invoicing):** Two-phase e-Fatura / e-Arşiv invoicing with a provider-confirmed issuance step, required Paraşüt password-grant credentials and a pluggable persistent record store, shipped as the `better-payment/invoicing` subpath so it stays out of the `better-payment/plugins` barrel.
tr: **[Fatura eklentisi](/docs/plugins/invoicing):** Sağlayıcı onaylı düzenleme adımı, zorunlu Paraşüt password-grant kimlik bilgileri ve takılabilir kalıcı kayıt store'u ile iki aşamalı e-Fatura / e-Arşiv faturalaması; `better-payment/plugins` barrel'ında yer kaplamaması için `better-payment/invoicing` alt yolu olarak sunuluyor.
