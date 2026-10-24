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
- [Beta releases](#beta-releases)
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

1. Create a branch from an up-to-date `main` (or `beta` for a new feature, see [Beta releases](#beta-releases)): `feature/…`, `fix/…`, `docs/…`, `refactor/…`, `test/…` or `chore/…`.
2. Make the change, with tests.
3. Run the checks from [Setup](#setup). For formatting, run `pnpm --filter better-payment format`.
4. Add a changeset for anything users notice: `pnpm changeset`. Pick `patch` for fixes, `minor` for features. Breaking changes are `minor` while the version is 0.x, and the changeset explains how to migrate. Below the summary, add the docs changelog entry in English and Turkish, with links to the docs (CI checks it):

   ```md
   ---
   "better-payment": minor
   ---

   Add React Router v7 (Remix v2) framework adapter: `better-payment/react-router` returns a `loader` and an `action`

   <!-- docs -->
   en: **[React Router adapter](/docs/integrations/frameworks#react-router):** `better-payment/react-router` returns a `loader` and an `action` for a splat resource route.
   tr: **[React Router adaptörü](/docs/integrations/frameworks#react-router):** `better-payment/react-router`, bir splat resource route için `loader` ve `action` döndürür.
   ```

   The entry goes under `Added` (minor), `Fixed` (patch) or `Changed (breaking)` (major). Add a `section:` line (`added`, `changed`, `changed-breaking` or `fixed`) to pick another, for example `section: changed-breaking` for a breaking change in 0.x. Contributors are thanked automatically: the release adds "Thanks to @user (#123)." from the pull request that added the changeset (`scripts/credits.mjs`), to both `CHANGELOG.md` and the docs changelog. Write your own "Thanks to ..." only to credit someone else, and the automatic one is skipped.
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

The website and docs are published in English (`/docs/...`) and Turkish (`/tr/docs/...`). Every `content/docs/<path>.mdx` has a `<path>.tr.mdx`, and every `meta.json` a `meta.tr.json`. More languages can be added by config: the registry is `apps/web/lib/i18n/locales.json` and records each language's code, labels, text direction and `enabled` flag. A new language with `docs: "optional"` may start with zero or a few translated pages (untranslated pages fall back to English with a notice); it stays `enabled: false` until its content lands.

- Translate prose only. Code blocks stay byte-for-byte identical to the English page, in every language.
- Keep the headings. Every Turkish heading keeps the English heading's id: `## Taksit [#installments]`.
- Update both languages in the same pull request.
- Adding a language (registry entry, partial dictionary, `dir` and `enabled` flags): follow [apps/web/TRANSLATIONS.md → Adding a language](apps/web/TRANSLATIONS.md#adding-a-language--dil-ekleme). It is a config change; no other code should need edits.
- Mark new user-facing features with `<Since version="x.y.z" />` in both languages. A page for a new provider or plugin also gets `since: x.y.z` in its frontmatter, which puts the same badge under the title and a "Beta" badge in the sidebar. The badge follows `packages/better-payment/package.json`: "Not released yet" while the version is lower, "Beta" while it is a prerelease of that version (`x.y.z-beta.N`, on the `beta` branch), and "Added in x.y.z" once it is released. Nothing has to be removed by hand after a beta becomes stable. On the homepage roadmap (`apps/web/components/Banks.tsx`), give a new provider `since: "x.y.z"` instead of `live: true`.
- The beta docs are a second deployment of the website, built from `beta` with `NEXT_PUBLIC_BASE_PATH=/beta` and served under `/beta` on the same domain when the main deployment has `BETA_ORIGIN` set (`apps/web/next.config.ts`). A Stable / Beta picker in the docs sidebar switches between them. `next/link` adds the base path itself; wrap paths of files in `public/` (images, videos) with `withBasePath()` from `apps/web/lib/base-path.ts`.

Rules and glossary: [apps/web/TRANSLATIONS.md](apps/web/TRANSLATIONS.md). CI runs:

```bash
cd apps/web
node scripts/check-translations.mjs        # missing pages, different code blocks, heading ids
node scripts/check-translations.mjs --fix  # adds heading ids
```

**Generated documentation:** the web `dev` and `build` commands generate the TypeDoc API reference and the `llms.txt` / `llms-full.txt` files. Edit source comments or MDX, never the generated files in `apps/web/public/api-reference` and `apps/web/public/llms`. TypeDoc covers the public package entries, not every internal source file. Its HTML is shared by both locales. CI checks the stable and `/beta` outputs.

```bash
pnpm --filter web docs:test       # MDX conversion and route tests
pnpm --filter web docs:generate   # TypeDoc + Markdown, without a Next.js build
pnpm --filter web docs:check      # generated pages and public API destinations
```

Generation rejects unknown MDX components or executable expressions instead of dropping content. Add an explicit conversion and a test in `apps/web/scripts/docs-content.mjs` when introducing a docs component. Code blocks are kept as code, never evaluated.

**Error message languages** (the `i18n` plugin) are one file per language in `packages/better-payment/src/plugins/i18n/locales/`. Write messages that read naturally for customers. Never shorten them to fit the bundle size check (`pnpm --filter better-payment size`): if a new language goes over the budget, say so in the pull request and a maintainer raises it.

## Releases

Maintainers release with [Changesets](https://github.com/changesets/changesets).

1. Every user-facing pull request includes a changeset (`pnpm changeset`).
2. When changesets land on `main`, the **Release PR** workflow opens or updates the `chore(release): version packages` pull request. It runs `pnpm version-packages`, which consumes the changesets into `package.json`, `src/version.ts`, `CHANGELOG.md`, the docs changelog (from each changeset's `<!-- docs -->` entry) and the `VERSION` example in the installation docs.
3. Before merging it, edit the release PR (push to its `changeset-release/main` branch):
   - `CHANGELOG.md`: the new section lists each changeset summary under `Added` (minor), `Fixed` (patch) or `Changed (breaking)` (major). Reword it for users, move entries to `Changed` where that fits, and keep the "Thanks to ..." lines the release added.
   - The docs changelog (`apps/web/content/docs/reference/changelog.mdx` and `changelog.tr.mdx`) gets the new version's section from the changesets. Add a one-line intro for a large release if you like. **Publish to NPM** stops if it has no section for the new version.
4. Merging the release PR publishes the release: the **Publish to NPM** workflow runs on every push to `main` and publishes when the package version has no GitHub release yet. It runs lint, typecheck and tests, publishes on the `latest` tag with npm trusted publishing (provenance, no tokens) and creates the GitHub release from the `CHANGELOG.md` section. If it stopped (for example, the docs changelog section was missing), fix it on `main` and the next push publishes. Run the workflow by hand for a dry run or another `npm_tag`. Prereleases from `beta` work the same way on the `beta` tag (see [Beta releases](#beta-releases)).

The release PR is opened with the default `GITHUB_TOKEN`, so CI does not run on it unless a `RELEASE_PR_TOKEN` secret (a fine-grained token with Contents and Pull requests write access) is set. The repository setting *Allow GitHub Actions to create and approve pull requests* must be on.

## Beta releases

New features, providers and plugins ship as a beta first (`0.12.0-beta.0`, `0.12.0-beta.1` ...), on the npm `beta` tag, and become a stable release when they are ready. `main` stays stable the whole time: fixes keep shipping from it.

| Branch | npm tag | Versions | Pull requests |
| ------ | ------- | -------- | ------------- |
| `main` | `latest` (`npm i better-payment`) | `0.11.0`, `0.11.1` | fixes, security, docs (`patch` changesets) |
| `beta` | `beta` (`npm i better-payment@beta`) | `0.12.0-beta.0` | new features, providers, plugins (`minor` changesets) |

Not sure where a pull request goes? Open it against `main`; a maintainer retargets it.

- `beta` is in Changesets pre mode (`.changeset/pre.json`). Changesets landing on `beta` open the `chore(release): version packages (beta)` pull request, and merging it publishes the prerelease on the `beta` tag, with a GitHub prerelease. Each beta lists only the changesets added since the previous one.
- After every push to `main`, the **Sync beta** workflow opens a `chore: merge main into beta` pull request when `beta` is behind. Merge it with a merge commit (never squash or rebase). After a stable release, resolve the version conflicts in favour of `beta`.

**Starting a beta round** (maintainers), from an up-to-date `main`:

```bash
git checkout -B beta origin/main
pnpm changeset pre enter beta
git commit -am "chore: enter beta prerelease mode" && git push -u origin beta
```

**Promoting a beta to stable:**

1. On `beta`, run `pnpm changeset pre exit` and merge it into `beta` in a pull request.
2. Open a pull request from `beta` into `main` and merge it with a merge commit. CI refuses it while `.changeset/pre.json` is still in pre mode.
3. The release PR on `main` makes the stable version (`0.12.0`) from all the beta changesets and replaces the `-beta.N` sections of both changelogs with it. Merging it publishes on `latest`.
4. Start the next beta round as above when there is something new for it.

**Leaving a feature out of a promotion:** `beta` reaches `main` as a whole, so take out what is not ready before step 1 above. This works cleanly because every feature lands on `beta` as one squash-merged pull request with its own changeset.

1. On `beta`, open a pull request that reverts the feature's commit (`git revert <sha>`). If the feature was already in a beta release, Changesets has moved its changeset to `.changeset/pre/`: delete it there too, or the stable changelog lists the feature.
2. Promote the rest as above.
3. In the next beta round, bring the feature back by reverting that revert in a pull request to `beta`, with a new changeset.

Don't cherry-pick ready features from `beta` into `main`: their changesets and changelog entries end up on both branches, and the next main → beta sync conflicts.

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
