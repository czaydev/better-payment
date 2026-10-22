# Changelog

Version history was reset. `0.0.1` is the first release of the reworked package;
earlier `1.x`–`3.x` releases are superseded and should not be used (see "Why the reset").

Upgrading from `3.x`? Read the migration guide:
https://better-payment.czaylabs.com/docs/whats-new

## 0.12.0-beta.2

### Added

- Add `commissionRouter` (subpath `better-payment/commission-router`), which routes each payment to the cheapest eligible provider from merchant-defined commission rate tables, with quotes that explain every choice, tie/share-cap/override policies, safe fallbacks and same-provider refunds Thanks to @Enard52.
- Plugin: currency conversion with TCMB exchange rates, markup, and refund protection Thanks to @Enard52.
- Plugin: provider failover with circuit breaker and zero double-charge guarantee Thanks to @Enard52 (#247).
- Add the `fraudRules` plugin for card-testing protection: velocity counters per IP, card, BIN, email or buyer (with consecutive-decline and distinct-value rules), blocked BIN ranges, an amount limit, your own rule functions and an optional challenge hook, all checked before the provider is called. Every counter key is a salted HMAC digest, so a card number never reaches the store, the log or a message, and nothing is read from `X-Forwarded-For` unless you name that header and your proxies. It ships as its own `better-payment/fraud` entry point, so `better-payment/plugins` stays the same size. Closes #105 Thanks to @Enard52.
- Add the Garanti BBVA provider (GVP, XML API 512): non-3D and 3D Secure payments (3D, 3D_PAY), GarantiPay (`securityLevel: 'GARANTI_PAY'`), refund, void and order inquiry. 3D callbacks are verified from `hashparams` and confirmed with the bank Thanks to @sizinajans (#195).
- Rename the `localizedErrors` plugin to `i18n` and make it work like the i18n plugin of Better Auth: `i18n({ translations, defaultLocale, detection, localeCookie, getLocale })`. English is built in, and the built-in Turkish, German, Russian and Arabic translations come in `locales`. HTTP handler responses pick their language with the `header` (`Accept-Language`), `cookie` and `callback` strategies, in the order you choose; `payment.errors.detectLocale(request)` runs the same detection. `localizedErrors`, `errorMessages`, `LocalizedErrorsOptions` and `ErrorMessageDictionary` still work and are deprecated.
- Add Model Context Protocol (MCP) server plugin (`mcp`) for AI agents and assistants. Thanks to @Enard52.
- Add the `better-payment/nestjs` framework adapter: `toNestHandler(payment)` returns a single request handler for a NestJS controller that works on both the Express and the Fastify platform. It has no `@nestjs/*` dependency and reads the request and response objects injected by `@Req()` and `@Res()` Thanks to @Enard52 (#270).
- Add `examples/next-shop`, a complete Next.js App Router and Prisma shop: server-side cart totals, 3D Secure through the handler, orders updated by payment events and a privileged refund route, with a Playwright happy-path test and a MockProvider that needs no credentials Thanks to @Enard52 (#287).
- Add the `openAPI` plugin: generates an OpenAPI 3.1.0 document and serves an interactive Scalar API reference page for all HTTP handler routes, configured providers, and registered plugin endpoints. The document lists only the routes the handler serves, under its `basePath`. The reference is off in `mode: 'production'` unless `disabled: false` is set, and `privileged: true` puts it behind the handler's `authorize` hook. Plugin endpoint contexts now always have `html()`, and plugins get a read-only `endpoints` list. Thanks to @Enard52.
- Add `pendingResolver` plugin to query and resolve timed out payments (`NETWORK_ERROR`) on a schedule, preventing double charging and emitting final outcome events. Thanks to @Enard52.
- feat(plugins): add captcha plugin supporting Turnstile, reCAPTCHA, and hCaptcha (#173)

  - Add `captcha` plugin to verify tokens before payment execution
  - Support Cloudflare Turnstile, Google reCAPTCHA v3 (with `minScore`), and hCaptcha
  - Read token from HTTP headers or request body candidates
  - Normalize failure error codes to `CAPTCHA_MISSING` and `CAPTCHA_INVALID`
  - Exclude provider callback and 3DS completion operations Thanks to @Enard52.
- Add `rateLimit` plugin for HTTP handler endpoints with per-route throttling, a customizable key extractor, sliding window store, and callback exclusion. The client identity defaults to a safe source: proxy headers are only read with `trustProxy`, otherwise an explicit `key` is required. Thanks to @Enard52.
- Plugin: redact card data and personal data from logs and events (PCI DSS & KVKK) Thanks to @Enard52.
- Add the `refundApproval` plugin: requires manager approval before processing refunds and cancellations above a specified threshold, with in-memory or custom store, approval/rejection methods, self-approval prevention, Slack/webhook notify callback, and handler endpoints (`/refunds/pending`, `/refunds/approve`, `/refunds/reject`). Thanks to @Enard52.
- Add `routing` (subpath `better-payment/routing`): rule-based provider routing with BIN, bank, card family, card type, card origin, amount, currency, installment, 3D Secure, operation and custom predicate conditions; ordered and deterministic weighted targets; injected health, BIN and key-value store hooks; explainable decisions and audit listeners; follow-up operations that stay on the provider that handled the payment; and no re-routing after a possible charge. Thanks to @Enard52.
- Add the `telemetry` plugin: one OpenTelemetry-compatible span per provider call with the provider, operation, result, normalized error code, HTTP status, retry count and duration, plus a `payment.calls` counter and a `payment.duration` histogram. It has no dependencies — it accepts any structurally compatible `tracer` and `meter`, so a real `@opentelemetry/api` tracer works and applications without OpenTelemetry can pass nothing at all. Attributes are low-cardinality and never contain card data, and a throwing tracer is reported through the logger without changing the payment. Thanks to @Enard52.
- feat(plugins): add threeDSTimeout plugin to expire abandoned 3D Secure payments (#180)

  - Add `threeDSTimeout` plugin tracking initiated 3D Secure payments across providers
  - Support configurable timeout duration (e.g. `'15m'`), pluggable `ThreeDSFlowStore`, and `onExpire` callback
  - Query provider before expiring to protect against late successful callbacks
  - Provide `payment.threeDS.expireStale()` for serverless and cron schedulers Thanks to @Enard52.
- Add the `webhookForwarding` plugin: forwards payment events to external microservices as HMAC-SHA256 signed JSON webhooks with configurable event filtering, exponential backoff retries, sensitive card data sanitization, and the `verifyForwardedWebhook` helper for receivers. Thanks to @Enard52.

### Fixed

- `failover`: a payment that failed with an HTTP 500, 502 or 504 answer no longer moves to a backup provider, because the provider may have charged the card before the error. These statuses are out of the default `on` codes and are ignored even when listed; 503 still fails over.
- Plugin endpoints refuse HTML form bodies on `POST` with 415, like the built-in actions, so another site cannot post to them with the visitor's cookies (CSRF); an endpoint a third party posts a form to sets the new `acceptForm: true`. An `onRequest` hook that throws now stops the request with 503 instead of letting it through, and `rateLimit` gets `passOnStoreError` for applications that prefer to stay open while their store is down.
- `redact`: `fields` and `custom` now add to the defaults instead of replacing them, so listing one extra field no longer unmasks the CVC or the TCKN pattern; `cardHolderName`, `securityCode` and provider secrets (`storeKey`, `hashKey`, `apiSecret`, `clientSecret`, `terminalProvPassword`) are masked by default; and the result the call returns keeps `paymentId`, `conversationId`, the 3D Secure and checkout form pages and the stored card tokens as the provider sent them.
- `refundApproval`: the approve and reject endpoints take the approver from the new `getActor` option instead of the request body (and answer 403 without it), a request body can no longer mark a refund as already approved, cancellations wait for approval unless the new `cancelAmount` option puts them under the threshold, amounts are parsed strictly, and approving the same request twice refunds once.

## 0.12.0-beta.1

### Added

- Add QNBpay, which runs on Sipay's platform: `qnbpay()` or `sipay({ brand: 'qnbpay' })` uses QNBpay's hosts and provider id, with the same payments, 3D Secure, refunds, pre-authorization and installment queries as Sipay Thanks to @sizinajans (#232).

## 0.12.0-beta.0

### Added

- Add the Albaraka Türk provider (e-POS, Posnet JSON API): non-3D sale, 3D Secure completed with the 3D data and the order values from your records, refund, cancel, order inquiry and pre-authorization. Generate bank-compatible order ids when conversationId is omitted.
- Add the Denizbank provider (InterVPos): non-3D sale, 3D Secure (3D Model) verified from HASHPARAMS and charged with the 3D Secure data, refund and cancel
- EST: Girogate alternative payment methods (iDEAL, Sofort, giropay, EPS, Bancontact, Przelewy24, Trustly and more) with `initThreeDSPayment({ girogate: { method, country } })` on the 3d_pay store types. A `Pending` callback returns `pending` with the order id. The EST currency list gains the methods' currencies (PLN, SEK, CHF, ...)
- Add two banks to the EST provider: `est({ bank: 'akbankest' })` for Akbank's older virtual POS (sanalakpos.com) and `est({ bank: 'halkbankmkd' })` for Halkbank Macedonia, with Macedonian denars (`MKD`, sent as `807`)
- PayTR: `threeDSMode: 'direct'` runs 3D Secure payments with a new card through the Direct API (your own card form, posted from the customer's browser) instead of the iFrame
- Add the QNB provider (PayFor): non-3D sale, 3D Secure (3D Model and 3D Pay) verified with the ResponseHash and confirmed with the bank, refund, cancel and order inquiry
- Add the VakıfBank provider (VPOS 7/24): non-3D sale, 3D Secure through the MPI and VakıfBank's 3DS product, refund and cancel (no payment status query: VakıfBank's record search cannot see cancels and refunds)
- Add the Yapı Kredi provider (Posnet XML): non-3D sale, 3D Secure through Posnet OOS (resolved and charged with a MAC over your order, the bank's answer MACs checked), refund, cancel and order inquiry (agreement). Generate bank-compatible order ids when conversationId is omitted.

### Fixed

- Serialize PayTR Direct API baskets as JSON for new-card and stored-card payments, including 3D Secure forms. Keep iFrame baskets Base64-encoded and preserve their token signatures.

## 0.11.1

### Fixed

- Parampos failures now carry a specific `code` instead of `UNKNOWN`: the bank's ISO 8583 code in `Banka_Sonuc_Kod` is used first, then Param's `Sonuc` codes, exported as `PARAMPOS_ERROR_CODES`. Closes #82.

## 0.11.0

### Added

- `chaos` plugin in `better-payment/plugins`: inject declines, lost responses (`NETWORK_ERROR`) and delays into operations to test error handling. Refuses to run in `production` mode unless `allowProduction` is set.
- Add the EST (Asseco) provider for İş Bankası, Ziraat Bankası, Halkbank, TEB and Şekerbank: non-3D and 3D Secure payments (3d, 3d_pay, 3d_pay_hosting, 3d_host) signed with hash ver3, refund, void and order status. The banks are also provider types (`isbank`, `ziraat`, `halkbank`, `teb`, `sekerbank`) with default URLs
- `notifications` plugin in `better-payment/plugins`: sends payment events as readable messages to Slack, Discord, Telegram or a custom channel (email, SMS...), in English, Turkish, German, Russian or Arabic. Messages are sent in the background, without card data; a failing channel never affects the payment.
- Add the Sipay provider: non-3D and 3D Secure payments (paySmart2D / paySmart3D), callbacks verified with the encrypted `hash_key`, full and partial refunds, cancel, status queries, pre-authorization with capture and void, and BIN / installment queries

## 0.10.0

### Added

- Add the Kuveyt Türk provider (KT Pay Gate): 3D Secure payments completed with `Provision`, same-day cancel, full and partial refunds, and status queries

## 0.9.0

### Added

- Handler: responses no longer include the provider's `rawResponse`, which can hold merchant data (commission rates, fraud status) and stored-card keys. `onCallback`, `callbackRedirect` and events still receive it. Set `exposeRawResponse: true` to keep the previous behavior. New `idempotency.scope(ctx)` option keeps the `Idempotency-Key` responses of different callers apart.

### Fixed

- Validation: the `buyer.email` check and the handler's path trimming no longer use regular expressions that can backtrack on long input. Emails with an empty domain label (`a@b..c`, `a@.b.c`) are now rejected.

## 0.8.1

### Fixed

- Adapters: the Express/Node and fetch-based adapters read at most 1 MiB of a request body and answer 413 for larger ones, instead of buffering bodies of any size. Change the limit with `maxBodySize` on `toExpressHandler`, `toNodeHandler` or `toFetchHandler`.
- Akbank: `completeThreeDSPayment()` confirms the 3D Secure result with an order history query (txnCode 1010) and rejects a callback that does not match Akbank's record for the order as `INVALID_HASH`. A query that gets no response returns `pending` with `NETWORK_ERROR`.
- Handler: only provider callbacks accept form bodies. Other actions answer 415 for `application/x-www-form-urlencoded`, `multipart/form-data` and `text/plain`, which a cross-site HTML form can send with the user's cookies and without a CORS preflight.
- `HttpError.config` no longer keeps the request body and headers. The error is passed to the logger, and the body carried card data and Parampos credentials, the headers the iyzico authorization.
- iyzico: a failed `completeThreeDSPayment()` result no longer carries `paymentId` or `conversationId` taken from the callback request or echoed by iyzico's error response. They are set only for a successful payment, from iyzico's response.

## 0.8.0

### Added

- Add React Router v7 (Remix v2) framework adapter: `better-payment/react-router` returns a `loader` and an `action` for a splat resource route

## 0.7.0

### Changed (breaking)

- iyzico: `refund()` takes the payment's `paymentId`, like `cancel()` and `getPayment()`, and
  refunds an amount of the whole payment (`/v2/payment/refund`). To refund one basket item, pass its
  `paymentTransactionId` as well. Code that passed a `paymentTransactionId` as `paymentId` must
  move it to the new `paymentTransactionId` field.

### Added

- `buildBasket()`: spreads discounts and shipping over basket items so they add up to the payment
  total, to the kuruş.
- `localizedErrors`: Arabic (`ar`) messages. `Accept-Language: ar` picks Arabic in the handler.
  Thanks to @poyrazavsever (#136).

## 0.6.0

### Added

- `better-payment/elysia`: `toElysiaHandler(payment)` mounts the handler on Elysia (Bun). Register
  the route with `{ parse: 'none' }` so bank callbacks keep their raw body. Thanks to
  @ScottHallchico (#128).

## 0.5.2

### Added

- `localizedErrors`: Russian (`ru`) messages. `Accept-Language: ru-RU` picks Russian in the
  handler. Thanks to @ius-sharma (#117).

## 0.5.1

### Added

- `localizedErrors`: German (`de`) messages. `Accept-Language: de-DE` picks German in the
  handler. Thanks to @ius-sharma (#100).

### Changed

- The repository moved to https://github.com/czaydev/better-payment. Package metadata and links
  point to the new address.

## 0.5.0

Plugins and typed payment events. **Breaking:** the payment object is created with
`betterPayment()` instead of `new BetterPayment()`, and providers with factories. Provider methods,
results, handler options, adapters and the browser client are unchanged. Migration guide:
https://better-payment.czaylabs.com/docs/guides/migration-0-5

```ts
// 0.4
new BetterPayment({ providers: { iyzico: { enabled: true, config: { apiKey, secretKey } } } });
// 0.5
betterPayment({ providers: { iyzico: iyzico({ apiKey, secretKey }) } });
```

### Changed (breaking)

- `betterPayment(options)` replaces the `BetterPayment` class. `BetterPayment` is now a type, and
  `BetterPaymentConfig` is `BetterPaymentOptions`.
- Providers are created with `iyzico()`, `paytr()`, `akbank()` and `parampos()`; `MockProvider` is
  passed as an instance (`mock: new MockProvider()`). The `enabled` flag is gone: leave a provider
  out instead. The per-provider config types (`IyzicoProviderConfig`, ...) and `ProviderInstances`
  are removed.
- Any key of `providers` is a provider id (`payment.use(id)`, handler routes). `payment.<id>` exists
  only for configured providers and is typed per provider; `payment.use(id)` throws
  `ProviderNotEnabledError` for other ids.
- `getEnabledProviders()` returns `string[]`. `HandlerContext.provider` is a `string` (`undefined` for
  plugin endpoints); `onCallback` and `callbackRedirect` get a `CallbackContext`.

### Added

- **Plugins** (`plugins: [...]`): an object with an `id` and the parts it needs, created with
  `definePlugin()` to keep its type.
  - `hooks.before` / `hooks.after` for the provider operations, called on the payment object, on a
    provider or through the handler. A before hook can replace the request, return a result without
    calling the provider, or choose the provider (for calls made on the payment object only). An
    after hook can replace the result.
  - `init`, `methods` (typed members of the payment object), handler `endpoints` (the `authorize`
    hook runs for them; `privileged` ones require it), `onResponse` for handler responses and
    `$ERROR_CODES`.
  See https://better-payment.czaylabs.com/docs/plugins/writing-plugins
- **Typed payment events:** `payment.succeeded`, `payment.authorized`, `payment.pending`,
  `payment.failed`, `payment.cancelled`, `refund.succeeded`, `refund.failed`, with `payment.on()` or
  a plugin's `events`. Emitted for every provider and flow, only for verified results. A failing
  listener throws `EventListenerError`, which carries the result; the handler retries callback
  events with the stored result and never answers a payment route with an error after the payment
  went through. See https://better-payment.czaylabs.com/docs/plugins/events
- **`better-payment/plugins`** with the first official plugin, **`localizedErrors()`**: customer-facing
  `errorMessage` by normalized error code, in English and Turkish, with your own wording or
  languages, and per request from `Accept-Language` in the handler. The provider's text moves to the
  new `providerMessage` field. See https://better-payment.czaylabs.com/docs/plugins/localized-errors
- **Custom providers:** `defineProvider()` gives a `PaymentProvider` subclass the shared settings
  (mode, logger, retry, fetch). WebCrypto helpers (`hmac`, `digest`, `safeEqual`, `toHex`,
  `toBase64`, `randomHex`) are exported for signing and verifying.
  See https://better-payment.czaylabs.com/docs/plugins/custom-providers
- `client.use(id)` in `better-payment/client` for provider ids other than the built-in ones.

## 0.4.0

Testing without a sandbox and one-line framework integration. Existing 0.3.0 code keeps working;
the only type-level change is `PROVIDER_DEFAULT_URLS` (see "Changed").

### Added

- **`better-payment/testing`:** `MockProvider`, an in-memory provider for application tests, with no
  credentials and no network access. Enable it with
  `providers.mock: { enabled: true, provider: new MockProvider() }`; handler routes are
  `/api/pay/mock/...` and the browser client has `client.mock`.
  - Magic card numbers (`MOCK_CARDS`) for success, declines per `PaymentErrorCode`, 3D Secure
    required or failed, lost responses (`NETWORK_ERROR` while the payment went through) and failing
    refunds. `failNext()` / `networkErrorNext()` override the next operation.
  - Payments, refunds, pre-authorizations and saved cards are kept in memory, so `getPayment()`,
    `refund()` and `cancel()` reflect earlier calls; `getRecord()` exposes them for assertions.
  - 3D Secure callbacks are HMAC-signed and go through the real handler (signature check, duplicate
    callbacks, `onCallback`).
  See https://better-payment.czaylabs.com/docs/guides/testing
- **Framework adapters** that mount the HTTP handler in one line, with raw bodies for form-urlencoded
  bank callbacks, PayTR's plain-text `OK`, and redirects that keep `Location`:
  - `better-payment/next`: `export const { GET, POST } = toNextJsHandler(getBetterPayment)`
  - `better-payment/express`: `toExpressHandler(payment)` (no body parser needed) and `toNodeHandler`
    for plain `node:http`
  - `better-payment/fastify`: `toFastifyPlugin(payment)`, with a form-urlencoded parser scoped to its
    own routes (Fastify rejects that content type by default)
  - `better-payment/hono`: `toHonoHandler(payment)`
  - `toFetchHandler(payment)` in the main entry for Cloudflare Workers, Deno and Bun
  Adapters accept a handler, a `BetterPayment` instance or a function returning either (lazy
  initialization), and have no dependencies.
  See https://better-payment.czaylabs.com/docs/integrations/frameworks
- `ProviderType.MOCK`.

### Changed

- `PROVIDER_DEFAULT_URLS` is keyed by the new `RemoteProviderType` (every provider except `mock`).
  Code that indexes it with a plain `ProviderType` needs the narrower type.

The documentation is now also available in Turkish: https://better-payment.czaylabs.com/tr/docs

## 0.3.0

Edge runtimes and zero runtime dependencies. The server entry point now uses only `fetch` and
WebCrypto, so the same package runs on Node.js 20+, Vercel Edge, Cloudflare Workers, Deno and Bun.
Application code that uses `BetterPayment`, the providers or the HTTP handler keeps working
unchanged. Only custom providers that extend `PaymentProvider` need an update (see "Changed").

### Added

- **Edge runtime support.** Signatures, callback verification and hashes use WebCrypto
  (`crypto.subtle`); no `node:crypto` or `Buffer`. Every release runs the built bundle in the
  Vercel Edge Runtime VM and checks the signatures of all four providers against `node:crypto`.
  See https://better-payment.czaylabs.com/docs/integrations/edge
- **`fetch` option** (top level or per provider) to use a custom fetch implementation, for example
  a proxy-aware fetch or a stub in tests.
- `HttpClient`, `HttpError` and the `HttpRequestConfig` / `HttpResponse` / `HttpMethod` types are
  exported for custom providers.

### Changed

- **No runtime dependencies:** axios is removed. Provider calls use an internal fetch client with
  the same timeouts (30 s; 60 s for Parampos), logging (method, URL and status, never bodies) and
  retry rules (only idempotent requests are retried).
- Custom providers that extend `PaymentProvider`: `setupAxiosLogging()` and `setupAxiosRetry()` are
  replaced by `createHttpClient(name, { timeout, headers })`. Transport errors are `HttpError`s
  (`isNetworkError`, `code`, `response`); results keep reporting them as `PENDING` with
  `NETWORK_ERROR`.
- Log metadata reports the HTTP method in upper case (`POST` instead of `post`).
- The published bundle is 23.1 kB gzip (it now includes the HTTP client that replaced axios).

## 0.2.0

Pre-authorization and stored cards. Existing 0.1.0 code keeps working; the only type-level
change is that `PaymentRequest.paymentCard` is now optional (see "Changed"). Both features are
tested against the real iyzico sandbox every night.

### Added

- **Pre-authorization:** `authorize()` and `initThreeDSAuthorize()` block an amount on the card,
  `capture({ paymentId, amount, ip })` charges it (partial capture supported) and
  `voidAuthorization({ paymentId, ip })` releases it. Supported on iyzico, Parampos and Akbank;
  PayTR throws `NOT_SUPPORTED` for now (#60).
  See https://better-payment.czaylabs.com/docs/guides/pre-authorization
- **Stored cards:** pass `saveCard` with a payment to save the card with the provider, then pay
  with `storedCard: { customerToken, cardToken }` instead of `paymentCard`. Results carry the
  tokens in `storedCard`. `saveCard()`, `listCards()` and `deleteCard()` manage saved cards
  (iyzico card storage API; PayTR Kart Saklama `capi/list` and `capi/delete`, cards are saved
  during a Direct API payment). Only tokens are stored, never card numbers. Parampos and Akbank
  reject stored cards for now (#65).
  See https://better-payment.czaylabs.com/docs/guides/stored-cards
- HTTP handler routes `authorize`, `authorize/init-3ds`, `capture`, `void`, `cards/save`,
  `cards/list` and `cards/delete`. Capture, void and the card routes require an `authorize` hook;
  the mutating ones accept an `Idempotency-Key` header.
- Browser client methods for all of the above (`client.iyzico.capture(...)`,
  `client.iyzico.listCards(...)`, ...).

### Changed

- `PaymentRequest.paymentCard` is optional in the types. At runtime one of `paymentCard` or
  `storedCard` is still required; code that reads `request.paymentCard` from a `PaymentRequest`
  needs a check.
- The HTTP handler answers `400` (instead of `500`) when a provider does not support the
  requested operation (`NOT_SUPPORTED`).

## 0.1.0

The first feature release after the reset. Existing 0.0.1 code keeps working; behavior
changes are listed under "Changed". The iyzico integration is now tested against
the real iyzico sandbox every night.

### Added

- **Unified error codes.** Every failed result carries `code`, a provider-independent
  `PaymentErrorCode` (`INSUFFICIENT_FUNDS`, `CARD_DECLINED`, `INVALID_CARD`, `EXPIRED_CARD`,
  `INVALID_CVC`, `THREEDS_FAILED`, `FRAUD_SUSPECTED`, `LIMIT_EXCEEDED`, `DUPLICATE_ORDER`,
  `CANCELLED_BY_CUSTOMER`, `INVALID_REQUEST`, `NETWORK_ERROR`, `INVALID_HASH`, `PROVIDER_ERROR`,
  `UNKNOWN`). `errorCode` keeps the provider's raw code. iyzico payment errors, PayTR
  `failed_reason_code` and Akbank's ISO 8583 host codes are mapped; unmapped codes are
  `UNKNOWN`. See https://better-payment.czaylabs.com/docs/api/error-codes
- **Request validation** before the provider is called: card number (Luhn), expiry, CVC,
  amounts, iyzico basket totals, buyer email/IP/GSM formats and provider-required fields.
  Invalid requests return `code: 'INVALID_REQUEST'` and list every invalid field, without an
  HTTP call. `ValidationError` carries `issues` and `field`. Turn it off with `validate: false`.
- **Parampos installments:** `installmentInfo()` returns the card's available installment
  counts with Param's totals, `calculatePaidPrice()` computes `paidPrice` (Toplam_Tutar), and
  `getInstallmentRates()` returns the rate table. `InstallmentDetail` gains `commissionRate`.
- **Duplicate callbacks are processed once.** A repeated PayTR notification or browser
  re-post gets the stored response, without calling the provider or `onCallback` again, so
  Parampos payments are never finalized twice. If `onCallback` fails, the retry reuses the
  stored provider result.
- **`Idempotency-Key` header** on payment, refund, cancel and iyzico management routes of the
  HTTP handler. A repeated key replays the first response.
- `IdempotencyStore` interface with an in-memory default (use Redis or a database with
  several instances). Configure with `handler.idempotency`, or turn off with `idempotency: false`.
- `PaymentErrorCode` and `PaymentStatus` are exported from `better-payment/client`.

### Changed

- Request validation errors (missing `callbackUrl`, unsupported currency, invalid amount,
  invalid PayTR order id, ...) return `errorCode: 'VALIDATION_ERROR'`; `errorCode` used to be empty.
- Stricter public types, with no `any`: `rawResponse` is `unknown`, and the handler request and
  response bodies are `unknown`. `HandlerContext.body` is `Record<string, unknown> | undefined`,
  and `onCallback` / `callbackRedirect` receive a `PaymentResponse`. Code that read fields of
  `rawResponse` without narrowing needs a cast.
- `NETWORK_ERROR` messages name the transport error, e.g. `No response from iyzico
(ECONNRESET: read ECONNRESET)`.
- Akbank `installmentInfo()` explains that Akbank's API has no installment-rate query.
- The published build is minified (names kept, source maps included): about 19 kB gzip
  instead of 29.6 kB; the browser client is 1.2 kB.

## 0.0.1

### Why the reset

An audit found that several provider integrations in `1.x`–`3.x` did not match the
providers' APIs and that some callback checks could be bypassed. Do not use those
versions. `0.0.1` contains the corrected implementations described below.

### Security

- **Parampos:** the 3D callback hash is verified only with the GUID from your
  configuration. Earlier versions read the GUID from the callback payload, which
  let anyone forge a successful payment.
- **Parampos / Akbank:** a 3D callback no longer counts as a successful payment on
  its own. Parampos finalizes with `TP_WMD_Pay`; Akbank uses the 3D_PAY model with an
  HMAC-signed result. A missing result code is no longer treated as success.
- **HTTP handler:** secure by default. By default it only exposes provider
  callbacks, `installment` and `bin-check`. Refund, cancel, payment lookup and
  subscription management require an `authorize` hook.
- **Retries** only re-send idempotent requests (GET or read-only queries). Payment,
  refund and cancel requests are never retried, so a timeout cannot cause a double
  charge or double refund.
- Signatures are compared in constant time.

### Provider fixes

- **PayTR:** requests are signed with `merchant_key`, with `merchant_salt` appended
  to the signed data. `user_basket` is base64 JSON with TL prices. `merchant_oid`
  must be alphanumeric. `test_mode` follows sandbox mode. Refund amounts are in TL.
  Status queries use `/odeme/durum-sorgu`. The handler answers notifications with
  plain `OK`. Secrets are no longer sent in request bodies.
- **Parampos:** uses `TP_WMD_UCD` / `TP_WMD_Pay`, comma-decimal amounts and the
  documented hash. Refunds and cancels use `TP_Islem_Iptal_Iade_Kismi2`, status
  queries `TP_Islem_Sorgulama4` and BIN lookups `BIN_SanalPos`. Made-up
  installment rates were removed, and `UCD_HTML` is now unescaped.
- **Akbank:** rewritten against the Akbank Sanal POS JSON API: `auth-hash`
  signatures, transaction codes 1000/1002/1003/1010, and the 3D_PAY gateway.
- **iyzico:** Checkout Form and PWI results report the payment's own status
  (`paymentStatus`), not whether the API call succeeded. 3DS completion requires
  `mdStatus=1`. `retrieveSubscription` uses GET. Subscription responses map
  `status` to the shared `PaymentStatus` values.

### Breaking changes (compared with 3.x)

- Provider configuration:
  - PayTR: `{ merchantId, merchantKey, merchantSalt, testMode? }`
  - Akbank: `{ merchantSafeId, terminalSafeId, secretKey, subMerchantId?, testMode? }`
  - Parampos: `{ clientCode, clientUsername, clientPassword, guid }`
  - PayTR, Akbank and Parampos no longer take `apiKey` / `secretKey`.
- For PayTR, Akbank and Parampos, `paymentId` is the order id (`conversationId`,
  or an id generated for you). `refund`, `cancel` and `getPayment` take this order id.
- Network errors and timeouts return `status: 'pending'` with
  `errorCode: 'NETWORK_ERROR'`: the outcome is unknown, so check it with `getPayment()`.
- Handler: failed operations return HTTP 422, unexpected errors return a generic 500,
  and the health check no longer lists providers. New options: `basePath`,
  `allowedActions`, `authorize`, `transformRequest`, `onCallback`, `callbackRedirect`.
- Unsupported currencies throw an error instead of silently falling back to TRY.
