# better-payment

> Unified, type-safe payment gateway for Node.js & TypeScript.

One API for Turkish payment providers — iyzico, PayTR, Parampos and Akbank.

[![npm](https://img.shields.io/npm/v/better-payment)](https://www.npmjs.com/package/better-payment)
[![license](https://img.shields.io/npm/l/better-payment)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

> **0.0.1 is a fresh start.** The version history was reset on purpose.
> Releases `1.x`–`3.x` are deprecated. See [What's new in 0.0.1](#whats-new-in-001).

---

## What's new in 0.0.1

`0.0.1` is not a patch on top of `3.x`. It is the first release of a rebuilt
library. A review found that the old releases had provider integrations that
did not match the providers' APIs, and callback checks that could be bypassed
(for example, forging a Parampos "success" callback). Fixing that required
breaking changes. Rather than stacking another major version on top of those
releases, we reset the version history. `0.0.1` is the new baseline.

What changed:

- **Callbacks are verified, not trusted.** Every 3D Secure callback and PayTR
  notification is checked with your own credentials. Parampos payments are
  finalized with the bank before they count as successful.
- **Real provider APIs.** PayTR signing, Parampos `TP_WMD_*`, the Akbank Sanal POS
  JSON API and iyzico payment statuses now match the official specifications.
- **Clear statuses.** `success`, `failure`, `pending` and `cancelled`. A timeout is
  `pending` with `NETWORK_ERROR` (the outcome is unknown), never a silent failure.
  Payments are never retried automatically.
- **Your order id is the payment id** for PayTR, Parampos and Akbank.
- **Secure-by-default HTTP handler:** routes are opt-in, sensitive actions require
  `authorize`, and amounts can be set on the server.
- **One config per provider**, validated at startup.

Upgrading from `3.x`: `npm install better-payment@latest` (a `^3` range will never
resolve to `0.0.1`), then follow the
[migration guide](https://better-payment.czaylabs.com/docs/whats-new).

## Install

```bash
npm install better-payment
# or
pnpm add better-payment
```

No runtime dependencies. Runs on Node.js 20+ and on edge runtimes (Vercel Edge,
Cloudflare Workers, Deno, Bun): it only uses `fetch` and WebCrypto. See the
[edge runtimes guide](https://better-payment.czaylabs.com/docs/integrations/edge).
`better-payment/client` is browser-safe.

## Quick Start

```typescript
import { betterPayment, iyzico, paytr, parampos, akbank } from 'better-payment';

const payment = betterPayment({
  mode: 'sandbox', // sandbox URLs + provider test modes
  providers: {
    iyzico: iyzico({
      apiKey: process.env.IYZICO_API_KEY!,
      secretKey: process.env.IYZICO_SECRET_KEY!,
    }),
    paytr: paytr({
      merchantId: process.env.PAYTR_MERCHANT_ID!,
      merchantKey: process.env.PAYTR_MERCHANT_KEY!,
      merchantSalt: process.env.PAYTR_MERCHANT_SALT!,
    }),
    parampos: parampos({
      clientCode: process.env.PARAMPOS_CLIENT_CODE!,
      clientUsername: process.env.PARAMPOS_CLIENT_USERNAME!,
      clientPassword: process.env.PARAMPOS_CLIENT_PASSWORD!,
      guid: process.env.PARAMPOS_GUID!,
    }),
    akbank: akbank({
      merchantSafeId: process.env.AKBANK_MERCHANT_SAFE_ID!,
      terminalSafeId: process.env.AKBANK_TERMINAL_SAFE_ID!,
      secretKey: process.env.AKBANK_SECRET_KEY!,
    }),
  },
  defaultProvider: 'iyzico',
});

// Start a 3D Secure payment and render result.threeDSHtmlContent in the browser
const result = await payment.iyzico.initThreeDSPayment({
  price: '100.00',
  paidPrice: '100.00',
  currency: 'TRY',
  basketId: 'B1',
  callbackUrl: 'https://yoursite.com/api/pay/iyzico/payment/complete-3ds',
  paymentCard: { ... },
  buyer: { ... },
  shippingAddress: { ... },
  billingAddress: { ... },
  basketItems: [ ... ],
});
```

## Results and statuses

Every operation resolves to a result with `status`:

| status      | meaning                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------- |
| `success`   | The provider confirmed the operation (payment captured, refund accepted, ...)               |
| `failure`   | The provider rejected it; see `errorCode` / `errorMessage` / `rawResponse`                  |
| `pending`   | Waiting for the customer (3DS, bank transfer) **or** the outcome is unknown                 |
| `cancelled` | The payment was voided or fully refunded (status queries)                                   |

When a request times out or the connection drops, the result is `pending` with
`errorCode: 'NETWORK_ERROR'`. The provider may still have processed the
payment. Check it with `getPayment()` before you retry. Payment, refund and cancel
requests are never retried automatically.

Failed results also carry `code`, a provider-independent `PaymentErrorCode`
(`INSUFFICIENT_FUNDS`, `CARD_DECLINED`, `THREEDS_FAILED`, `INVALID_HASH`, ...).
The provider's raw code stays in `errorCode`. Unmapped codes are `UNKNOWN`. See
[Error Codes](https://better-payment.czaylabs.com/docs/reference/error-codes) for the
list and suggested customer messages.

```typescript
if (result.code === PaymentErrorCode.INSUFFICIENT_FUNDS) askForAnotherCard();
```

For PayTR, Parampos and Akbank, `paymentId` is your **order id**: the
`conversationId` you pass in, or an alphanumeric id generated for you. Pass
this id to `refund`, `cancel` and `getPayment`.

## Providers

| Provider | Non-3D                    | 3D Secure                   | Refund | Cancel             | Status | BIN | Installments      |
| -------- | ------------------------- | --------------------------- | :----: | ------------------ | :----: | :-: | ----------------- |
| iyzico   | ✓                         | ✓                           |   ✓    | ✓                  |   ✓    |  ✓  | ✓                 |
| PayTR    | ✓ (needs non-3D approval) | ✓ iFrame                    |   ✓    | ✓ (full refund)    |   ✓    |  ✓  | ✓ (account rates) |
| Parampos | ✓ (TRY)                   | ✓ `TP_WMD_UCD`/`TP_WMD_Pay` |   ✓    | ✓                  |   ✓    |  ✓  | ✓ (account rates) |
| Akbank   | ✓                         | ✓ 3D_PAY                    |   ✓    | ✓                  |   ✓    |  —  | —                 |

### 3D Secure completion

- **iyzico / Parampos / Akbank:** the bank POSTs to your `callbackUrl`. Pass the
  POST body to `completeThreeDSPayment()`. The signature is verified with your
  credentials before anything is trusted. Parampos then finalizes the payment
  with `TP_WMD_Pay`.
- **PayTR:** `callbackUrl` is only where the customer's browser returns. The
  result is sent to the **notification URL** set in the PayTR panel. Point it at
  `/api/pay/paytr/callback`; the handler verifies the notification and replies
  `OK`.

Pre-authorization (block now, charge later) works on iyzico, Parampos and Akbank:
`authorize()` / `initThreeDSAuthorize()`, then `capture({ paymentId, amount, ip })` or
`voidAuthorization({ paymentId, ip })`. See the
[pre-authorization guide](https://better-payment.czaylabs.com/docs/payments/pre-authorization).

Stored cards (iyzico, PayTR): pass `saveCard: true` with a payment, then pay with
`storedCard: { customerToken, cardToken }` instead of `paymentCard`. `listCards()` and
`deleteCard()` manage saved cards. Only tokens are stored, never card numbers. See the
[stored cards guide](https://better-payment.czaylabs.com/docs/payments/stored-cards).

Installments: pass `installment` in the request. For Parampos, set `paidPrice`
to the total including commission: `payment.parampos.calculatePaidPrice({ binNumber,
price, installment })` computes it from your Param rates. Akbank has no
installment-rate API; use your contracted rates. The library never invents
commission rates.

## HTTP Handler

A framework-agnostic handler that exposes REST endpoints under `/api/pay`. It is
**secure by default**: out of the box it exposes only the provider callbacks and
the card queries (`installment`, `bin-check`).

```typescript
const payment = betterPayment({
  providers: { ... },
  handler: {
    // opt in to what your frontend needs
    allowedActions: ['payment/init-3ds', 'payment/complete-3ds', 'callback', 'refund'],

    // required for refund/cancel/payment lookup/subscription management
    authorize: async (ctx) => {
      if (ctx.action === 'callback' || ctx.action === 'payment/complete-3ds') return true;
      return isAdmin(ctx.request.headers.authorization);
    },

    // never trust amounts from the browser
    transformRequest: async (ctx) => {
      if (ctx.action !== 'payment/init-3ds') return ctx.body;
      const order = await db.orders.find(ctx.body?.orderId);
      return buildPaymentRequest(order, ctx.body?.paymentCard);
    },

    // update your order from verified callbacks
    onCallback: async (result) => {
      await db.orders.markPaid(result.paymentId, result.status);
    },

    // send the customer somewhere after 3D Secure
    callbackRedirect: (result) => `/orders/${result.paymentId}?status=${result.status}`,
  },
});
```

Mount it with an adapter. Each adapter handles raw form callbacks, PayTR's plain `OK` and redirects:

```typescript
// Next.js — app/api/pay/[...path]/route.ts
import { toNextJsHandler } from 'better-payment/next';
export const { GET, POST } = toNextJsHandler(getBetterPayment);

// Express:  app.all('/api/pay/*path', toExpressHandler(payment))        — better-payment/express
// Fastify:  app.register(toFastifyPlugin(payment), { prefix: '/api/pay' }) — better-payment/fastify
// Hono:     app.all('/api/pay/*', toHonoHandler(payment))               — better-payment/hono
// Workers, Deno, Bun: toFetchHandler(payment)                            — better-payment
```

| Route (under `basePath`)              | Action                   | Enabled by default                    |
| ------------------------------------- | ------------------------ | ------------------------------------- |
| `POST /:provider/payment/complete-3ds` | `payment/complete-3ds`   | ✓                                     |
| `POST /:provider/callback`             | `callback`               | ✓ (PayTR replies `OK`)                |
| `POST /:provider/installment`          | `installment`            | ✓                                     |
| `POST /:provider/bin-check`            | `bin-check`              | ✓                                     |
| `POST /:provider/payment`              | `payment`                | —                                     |
| `POST /:provider/payment/init-3ds`     | `payment/init-3ds`       | —                                     |
| `POST /:provider/payment/token`        | `payment/token` (PayTR)  | —                                     |
| `GET  /:provider/payment/:id`          | `payment/get`            | — (needs `authorize`)                 |
| `POST /:provider/refund`, `/cancel`    | `refund`, `cancel`       | — (needs `authorize`)                 |
| `POST /:provider/authorize[/init-3ds]` | `authorize`, `authorize/init-3ds` | —                          |
| `POST /:provider/capture`, `/void`     | `capture`, `void`        | — (needs `authorize`)                 |
| `POST /:provider/cards/{save,list,delete}` | `cards/*`            | — (needs `authorize`)                 |
| `POST /iyzico/checkout/*`, `/pwi/*`    | iyzico only              | —                                     |
| `POST /iyzico/subscription/*`          | iyzico only              | — (management actions need `authorize`) |
| `GET  /health`                        | health check             | ✓                                     |

Failed operations return HTTP 422 with the result body. Unexpected errors return a
generic 500 unless you set `exposeErrors: true`.

## Plugins and events

Plugins add behaviour without changing the library: react to payment events,
route payments, add methods and routes. A plugin is an object with an `id` and
only the parts it needs:

```typescript
import { betterPayment, definePlugin } from 'better-payment';

const auditLog = definePlugin({
  id: 'audit-log',
  events: {
    '*': (event) => console.log(event.type, event.provider, event.paymentId),
  },
});

const payment = betterPayment({ providers: { ... }, plugins: [auditLog] });

// Typed payment events, for every provider and flow, after verification
payment.on('payment.succeeded', (event) => orders.markPaid(event.conversationId));
```

Official plugins ship under `better-payment/plugins`. `localizedErrors` puts
customer-facing error messages in `errorMessage`, in the customer's language
(English, Turkish, German, and Russian included; per request from `Accept-Language` in the handler):

```typescript
import { localizedErrors } from 'better-payment/plugins';

const payment = betterPayment({ providers: { ... }, plugins: [localizedErrors({ locale: 'tr' })] });
```

See [Plugins](https://better-payment.czaylabs.com/docs/concepts/plugins),
[payment events](https://better-payment.czaylabs.com/docs/concepts/events) and
[writing a plugin](https://better-payment.czaylabs.com/docs/guides/writing-plugins).
Upgrading from 0.4? See [Migrating to 0.5](https://better-payment.czaylabs.com/docs/guides/migration-0-5).

## Testing

`better-payment/testing` has an in-memory `MockProvider`. It needs no credentials and no network access, and uses magic card numbers for declines, 3D Secure failures and lost responses. Its 3D Secure callbacks are signed and go through the real handler.

```typescript
import { MockProvider, MOCK_CARDS } from 'better-payment/testing';

const mock = new MockProvider();
const payment = betterPayment({ providers: { mock } });

await payment.mock.createPayment({ ...order, paymentCard: { ...card, cardNumber: MOCK_CARDS.INSUFFICIENT_FUNDS } });
// → { status: 'failure', code: 'INSUFFICIENT_FUNDS' }
```

See the [testing guide](https://better-payment.czaylabs.com/docs/concepts/testing).

## Logging & Retry

```typescript
const payment = betterPayment({
  logger: {
    debug: (msg, meta) => console.debug(msg, meta),
    info: (msg, meta) => console.info(msg, meta),
    error: (msg, err, meta) => console.error(msg, err, meta),
  },
  // Only idempotent requests (status/BIN/installment queries) are retried
  retry: { attempts: 3, delay: 1000, statusCodes: [429, 503] },
  providers: { ... },
});
```

The logger receives method, URL and status only. Request bodies (card data,
credentials) are never logged.

## Documentation

[https://better-payment.czaylabs.com](https://better-payment.czaylabs.com)

## Contributing

Contributions are welcome, from a typo fix to a new provider. Start with
[CONTRIBUTING.md](https://github.com/czaydev/better-payment/blob/main/CONTRIBUTING.md)
([Türkçe](https://github.com/czaydev/better-payment/blob/main/CONTRIBUTING.tr.md)) and the
[good first issues](https://github.com/czaydev/better-payment/labels/good%20first%20issue).
Report security problems privately, as described in
[SECURITY.md](https://github.com/czaydev/better-payment/blob/main/SECURITY.md).

## License

MIT

## Repository layout

- `packages/better-payment` — the npm package
- `apps/web` — documentation site

```bash
pnpm install
pnpm test        # package tests
pnpm lint
pnpm typecheck
pnpm build
```
