# Contributing to better-payment

Thanks for helping! This guide gets you from clone to a merged pull request.

> Türkçe: [CONTRIBUTING.tr.md](CONTRIBUTING.tr.md)

- [Ways to contribute](#ways-to-contribute)
- [Picking an issue](#picking-an-issue)
- [Setup](#setup)
- [Project layout](#project-layout)
- [Making a change](#making-a-change)
- [Rules for payment code](#rules-for-payment-code)
- [Adding a provider](#adding-a-provider)
- [Writing a plugin](#writing-a-plugin)
- [Tests](#tests)
- [Translations](#translations)
- [Releases](#releases)
- [Labels](#labels)

## Ways to contribute

- **Report a bug:** open an issue with the bug template. Remove credentials, card numbers and personal data from what you paste.
- **Report a security problem:** never in a public issue. Use [private vulnerability reporting](https://github.com/czaydev/better-payment/security/advisories/new) (see [SECURITY.md](SECURITY.md)).
- **Ask or discuss an idea:** [Discussions](https://github.com/czaydev/better-payment/discussions).
- **Propose a feature, a provider or a plugin:** open an issue with the matching template. Larger changes need an agreed issue before a pull request.
- **Verify a provider in its sandbox:** see the `sandbox-verification` issues. Test credentials are often the hardest part.
- **Improve the docs:** English and Turkish, see [Translations](#translations).

## Picking an issue

1. Look for [`good first issue`](https://github.com/czaydev/better-payment/labels/good%20first%20issue) and [`help wanted`](https://github.com/czaydev/better-payment/labels/help%20wanted). The [roadmap](https://github.com/czaydev/better-payment/issues/44) lists what comes next.
2. Comment on the issue to claim it, so nobody else starts on it. A maintainer assigns it to you.
3. If you stop working on it, say so in the issue. Claimed issues with no activity for two weeks may be reassigned.
4. Questions are welcome in the issue, before and while you work.

## Setup

Requirements: Node.js 20 or newer, and pnpm. The pnpm version is pinned in `package.json` (`packageManager`), so `corepack enable` is enough.

```bash
git clone https://github.com/<your-user>/better-payment.git
cd better-payment
git remote add upstream https://github.com/czaydev/better-payment.git
corepack enable
pnpm install
```

Or open the repository in a dev container (VS Code, GitHub Codespaces): `.devcontainer/` installs everything.

Check that everything works; CI runs the same commands:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The docs site runs with `pnpm dev` (http://localhost:3000).

Tests never call real providers. You do not need any credentials.

## Project layout

```
packages/better-payment/        the npm package
  src/core/                     betterPayment(), plugin runner, events, handler, errors, HTTP client
  src/providers/<provider>/     iyzico, PayTR, Parampos, Akbank
  src/plugins/                  official plugins (better-payment/plugins)
  src/adapters/                 framework adapters (next, express, fastify, hono, fetch)
  src/testing/                  MockProvider (better-payment/testing)
  src/client/                   browser client (better-payment/client)
  tests/unit, tests/integration unit and integration tests (no network)
  tests/sandbox/                tests against real provider sandboxes (opt-in)
  examples/                     typechecked examples, also used by the docs
apps/web/                       website and docs (Next.js + fumadocs)
  content/docs/                 docs pages: x.mdx (English) and x.tr.mdx (Turkish)
```

## Making a change

1. Create a branch from an up-to-date `main`: `feature/…`, `fix/…`, `docs/…`, `refactor/…`, `test/…` or `chore/…`.
2. Make the change, with tests.
3. Run the checks from [Setup](#setup). For formatting, run `pnpm --filter better-payment format`.
4. Add a changeset for anything users notice: `pnpm changeset`. Pick `patch` for fixes, `minor` for features. Breaking changes are `minor` while the version is 0.x, and the changeset explains how to migrate.
5. Update the docs in English and Turkish when behaviour changes.
6. Open a pull request against `main`. The template has a short checklist. Link the issue with `Closes #123`.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(paytr): add pre-authorization
fix(iyzico): map error 10051 to INSUFFICIENT_FUNDS
docs: add test cards page
feat(core)!: rename option X to Y
```

Keep pull requests focused: one issue, one pull request. A maintainer reviews every pull request, and CI must be green before it is merged.

## Rules for payment code

This library moves money. These rules are not negotiable, and reviews check them:

- **Never trust a callback.** Verify its signature with the merchant's secret before reading the result, compare with `safeEqual` (constant time), and return `failure` with `errorCode: 'INVALID_HASH'` for forged or incomplete callbacks.
- **`success` only when the provider confirmed it.** When there is no response (timeout, network error), return `pending` with `errorCode: 'NETWORK_ERROR'`: the payment may have gone through.
- **Never retry payments, refunds or cancels.** Only read-only queries may be retried (`retryable: true`).
- **Never log request or response bodies.** They contain card data and credentials.
- **Amounts are strings.** Use the helpers (`formatDecimal`, `toMinorUnits`); no floating-point arithmetic. Reject unsupported currencies instead of converting them.
- **No runtime dependencies,** and no Node.js-only APIs in `src`: the package runs on edge runtimes (use `fetch` and the WebCrypto helpers).
- **No real credentials or card numbers** anywhere in the repository: use the providers' published test data and placeholders.

## Adding a provider

Open a "New provider" issue first. A provider extends `PaymentProvider` and implements `createPayment`, `initThreeDSPayment`, `completeThreeDSPayment`, `refund`, `cancel` and `getPayment`. The [Custom providers](https://better-payment.czaylabs.com/docs/guides/custom-providers) page walks through it. For a built-in provider, also:

- add it under `src/providers/<provider>/` (`index.ts`, `types.ts`, `utils.ts`) with a factory (`export const xbank = (config) => defineProvider(...)`, using `withProviderDefaults`);
- add its id to `ProviderType` and its URLs to `PROVIDER_DEFAULT_URLS` (`src/core/BetterPaymentConfig.ts`);
- map its error codes to `PaymentErrorCode` (`errorCodeTable()`);
- export the class, the factory and the types from `src/index.ts`;
- test signatures against the provider's published test vectors, and test that forged callbacks are rejected;
- add a sandbox test in `tests/sandbox/` and a docs page (English and Turkish).

## Writing a plugin

Behaviour that does not depend on a provider (routing, notifications, translations, fraud rules, …) belongs in a plugin, not in the core. See [Write a plugin](https://better-payment.czaylabs.com/docs/guides/writing-plugins). Official plugins live in `src/plugins/` and are exported from `better-payment/plugins`. Community plugins are published as `better-payment-plugin-<name>`.

## Tests

```bash
pnpm test                                  # all unit and integration tests
pnpm --filter better-payment test:watch    # watch mode
pnpm --filter better-payment test:coverage # coverage, with the thresholds from vitest.config.ts
pnpm --filter better-payment test:edge     # the suite in the edge runtime
```

Use `MockProvider` (`better-payment/testing`) or stub `fetch` for provider tests; never call real APIs in unit tests.

**Sandbox tests** (`tests/sandbox/`) call the providers' real test environments. They are skipped for every provider whose credentials are not set, so `pnpm --filter better-payment test:sandbox` is always safe to run. The variables are listed in [CONTRIBUTING.tr.md](CONTRIBUTING.tr.md#sandbox-testleri) (for example `IYZICO_SANDBOX_API_KEY`); CI runs them every night with repository secrets.

## Translations

The website and docs are published in English (`/docs/...`) and Turkish (`/tr/docs/...`). Every `content/docs/<path>.mdx` has a `<path>.tr.mdx`, and every `meta.json` a `meta.tr.json`.

- Translate prose only. Code blocks stay byte-for-byte identical to the English page.
- Keep the headings. Every Turkish heading keeps the English heading's id: `## Taksit [#installments]`.
- Update both languages in the same pull request.

Rules and glossary: [apps/web/TRANSLATIONS.md](apps/web/TRANSLATIONS.md). CI runs:

```bash
cd apps/web
node scripts/check-translations.mjs        # missing pages, different code blocks, heading ids
node scripts/check-translations.mjs --fix  # adds heading ids
```

**Error message languages** (`localizedErrors`) are one file per language in `packages/better-payment/src/plugins/localized-errors/`. Write messages that read naturally for customers. Never shorten them to fit the bundle size check (`pnpm --filter better-payment size`): if a new language goes over the budget, say so in the pull request and a maintainer raises it.

## Releases

Maintainers release with [Changesets](https://github.com/changesets/changesets): a release pull request consumes the changesets into `package.json` and `CHANGELOG.md`, and the **Publish to NPM** workflow publishes with npm trusted publishing (provenance, no tokens).

## Labels

| Label | Meaning |
| ----- | ------- |
| `good first issue` | Small and self-contained, with steps in the issue. A good start. |
| `help wanted` | Contributions welcome. |
| `area: provider` | A payment provider (new or existing). |
| `area: plugin` | Plugins and the plugin API. |
| `area: docs` | Documentation and translations. |
| `area: web` | The website. |
| `area: handler` | The HTTP handler and framework adapters. |
| `sandbox-verification` | Needs someone with provider test credentials. |
| `priority: high` | Do this first. |
| `roadmap`, `phase-*` | Planned work, grouped by roadmap phase. |

## Code of conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
