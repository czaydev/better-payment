# next-shop — a complete better-payment example

A small storefront that shows the whole `better-payment` flow in one place:

```
product list -> cart -> order created on the server -> 3D Secure
             -> callback verified by the handler -> order updated by payment events
             -> admin refund (privileged route)
```

The stack is Next.js App Router, Prisma with SQLite (zero setup) and
`better-payment` from this workspace. `MockProvider` is the default provider, so
the flow runs without an account, without network access to a provider and
without real money.

This is documentation, not a product. Read it, copy the parts you need, and
replace the demo shortcuts listed under [Production](#production-checklist).

## Run it

Requirements: Node.js 20+ and pnpm 10.33 (`corepack` ships with Node.js).

```bash
corepack pnpm@10.33.0 install
corepack pnpm@10.33.0 --filter next-shop dev
```

Open <http://localhost:3000>. `dev` runs `prisma generate`, creates the SQLite
database with `prisma db push`, and starts Next.js, so the first run needs no
extra step.

Other commands:

```bash
corepack pnpm@10.33.0 --filter next-shop prisma:generate  # regenerate the Prisma client
corepack pnpm@10.33.0 --filter next-shop prisma:push      # create/update prisma/dev.db
corepack pnpm@10.33.0 --filter next-shop lint
corepack pnpm@10.33.0 --filter next-shop typecheck
corepack pnpm@10.33.0 --filter next-shop build
corepack pnpm@10.33.0 --filter next-shop test:e2e        # Playwright, MockProvider
```

`prisma generate` runs offline: the engines are installed by `pnpm install`.
Run it explicitly after a fresh checkout when you want to typecheck or build
without starting the dev server; `dev`, `setup` and `build` already run it.

## Configuration

Copy `.env.example` to `.env.local` (git-ignored). Every value in the example
file is a placeholder:

| Variable            | Required | Meaning                                                           |
| ------------------- | -------- | ----------------------------------------------------------------- |
| `IYZICO_API_KEY`    | no       | iyzico sandbox API key. Empty selects `MockProvider`.             |
| `IYZICO_SECRET_KEY` | no       | iyzico sandbox secret key. Must be set together with the API key. |
| `DEMO_ADMIN_KEY`    | no       | Key for the demo `/admin` login. Default: `demo-admin`.           |

Which providers need credentials:

- **MockProvider** (default): none. It lives in `better-payment/testing`, keeps
  payments in memory and simulates the full 3D Secure round trip. Magic cards
  are listed on the checkout page and in `MOCK_CARDS`:
  `4242424242424242` succeeds, `4000000000000002` is declined,
  `4000008400001629` fails 3D Secure, `4000000000000341` completes as pending
  (`NETWORK_ERROR`).
- **iyzico sandbox**: `IYZICO_API_KEY` and `IYZICO_SECRET_KEY` are both
  required. Use only the test cards published by iyzico; never a real card.
  The example never ships credentials.

The provider is chosen once at server start in `lib/payment.ts`, so restart
`dev` after changing the environment.

## What each file does

| File                                  | Purpose                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `app/page.tsx`                        | Product list; "Add to cart" is a server action.                                        |
| `app/cart/page.tsx`                   | Cart with unit prices and totals read from the database.                               |
| `app/checkout/[orderId]/page.tsx`     | Card form for an order that already exists.                                            |
| `app/orders/[orderId]/page.tsx`       | Return page; shows the **database** status, not the query string.                      |
| `app/admin/page.tsx`                  | Demo admin login and order list with a refund button.                                  |
| `app/api/pay/[...path]/route.ts`      | `toNextJsHandler(getBetterPayment)` — the whole payment API.                           |
| `app/api/orders/installment/route.ts` | Saves the installment count the shopper picked.                                        |
| `components/CheckoutForm.tsx`         | Card fields, installment quote, calls `payment/init-3ds`.                              |
| `components/RefundButton.tsx`         | Calls the privileged `refund` action and refreshes.                                    |
| `lib/payment.ts`                      | `betterPayment` singleton: providers, `transformRequest`, `authorize`, payment events. |
| `lib/orders.ts`                       | Server-side order creation and status helpers.                                         |
| `lib/cart.ts`                         | Cookie cart that only stores product ids and quantities.                               |
| `lib/cart-actions.ts`                 | Server actions: add/update cart, create order, demo admin login.                       |
| `lib/products.ts`, `lib/catalog.ts`   | Demo catalog and price formatting.                                                     |
| `lib/admin.ts`                        | Demo admin cookie checked by the handler's `authorize` hook.                           |
| `lib/db.ts`                           | One Prisma client per process.                                                         |
| `prisma/schema.prisma`                | Product, Order, OrderItem and Refund tables.                                           |
| `e2e/shop.spec.ts`                    | Playwright happy path: cart, 3DS, paid order, refund.                                  |

## How the flow uses better-payment

1. **The amount never comes from the browser.** The cart cookie holds product
   ids and quantities. `createOrderFromCart()` sums the database prices into
   `Order.amountKurus` (integer kuruş). The checkout request sends only
   `orderId` and the card.
2. **`transformRequest` rebuilds the payment request.** In `lib/payment.ts`
   the `payment/init-3ds` branch ignores client amounts, loads the order, and
   builds `price`, `paidPrice`, `basketItems`, `buyer` and `callbackUrl` on the
   server. For installments it asks the provider for the quoted total of the
   chosen count and stores it as `paidPriceKurus`, so a refund returns exactly
   what was charged.
3. **3D Secure goes through the handler.** The route is a catch-all served by
   `toNextJsHandler`, with `basePath: '/api/pay'`. The browser renders
   `threeDSHtmlContent`; the mock bank posts the signed result to
   `/api/pay/mock/payment/complete-3ds`. The handler verifies the signature and
   `callbackRedirect` sends the browser to `/orders/<id>`.
4. **Orders change only on payment events.** `payment.succeeded`,
   `payment.pending`, `payment.failed` and `refund.succeeded` write the order
   status. A browser return and a provider notification therefore behave the
   same, and a forged callback emits no event at all.
5. **Refunds are a privileged route.** `allowedActions` enables only the four
   actions this demo needs. The `authorize` hook lets provider callbacks and the
   customer checkout through, and requires the demo admin cookie for `refund`.
   The refund amount and payment id are loaded from the order in
   `transformRequest`.

## Card data

The Prisma schema has **no card-data fields**: no PAN, no CVV, no expiry, no
cardholder name. `readCard()` in `lib/payment.ts` passes the submitted fields to
the provider and returns; nothing writes them to the database or logs them. The
demo card form exists because a copyable example is more useful than a hosted
form integration, but a production shop should not let card data transit its
own server: use the provider's hosted fields or hosted checkout.

## Production checklist

- **Shared idempotency store.** The handler deduplicates callbacks with an
  in-memory store by default. With more than one instance, pass a shared
  `IdempotencyStore` (`handler.idempotency.store`), for example Redis or a table
  in your database, so a retried callback cannot run twice on another process.
- **Real authentication and authorization.** Replace the `demo_admin` cookie
  with your session and an `admin` role check in `authorize`. The demo key has a
  known default and the cookie is not signed.
- **HTTPS callback URL.** Derive `callbackUrl` from a configured public origin,
  not from `request.url`, and use HTTPS. The provider must be able to reach it.
- **Migrations, not `db push`.** Use `prisma migrate deploy` in production.
- **Hosted card fields.** Keep card data out of your server (PCI scope).
- **Reconciliation.** For a `pending` result, verify the payment with
  `getPayment()` on the server before retrying; never assume success or execute
  a second charge on an unknown outcome.
- **Logging.** Do not log request or response bodies; they contain card data and
  personal data.

## Tests

`e2e/shop.spec.ts` drives the full happy path in Chromium against the dev server
that Playwright starts itself:

```bash
corepack pnpm@10.33.0 --filter next-shop test:e2e
```

It adds a product to the cart, creates the order, pays with the MockProvider
success card, waits for the 3D Secure callback, checks that the order is `PAID`,
logs in to the demo admin, refunds, and checks the order is `REFUNDED` with a
recorded refund. No credentials are needed.
