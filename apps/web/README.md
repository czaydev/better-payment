# Better Payment website and docs

The homepage and English/Turkish documentation use Next.js App Router, React and Fumadocs. This app consumes the local `better-payment` workspace package.

For contribution workflow and payment-library development, see [CONTRIBUTING.md](../../CONTRIBUTING.md) or [CONTRIBUTING.tr.md](../../CONTRIBUTING.tr.md). Documentation translation rules are in [TRANSLATIONS.md](TRANSLATIONS.md).

## Local setup

Use Node.js 22 (at least 22.12) or Node 24, and Corepack. The pnpm version is pinned by the root [package.json](../../package.json). If your Node installation does not include Corepack, install it with `npm install --global corepack`.

Clone your fork, then run all commands below from the **repository root**, not `apps/web`. Commands use `corepack pnpm` to select the pinned version even if a different pnpm is installed globally.

```sh
git clone https://github.com/YOUR-USERNAME/better-payment.git
cd better-payment
corepack pnpm install --frozen-lockfile
corepack pnpm --filter better-payment build
corepack pnpm --filter web dev --hostname localhost
```

The package build supplies the workspace exports used by the app. Re-run it after changing package source. The web dev command generates the API reference and Markdown exports before starting Next.js; the first startup can take a little longer.

Open [localhost:3000](http://localhost:3000). English uses `/` and `/docs`, Turkish uses `/tr` and `/tr/docs`. The language choice is remembered in a cookie, and a first visit may follow the browser's language. Use `/en` or `/en/docs` to explicitly select English; these redirect to the unprefixed URLs.

No payment-provider credentials or `.env` file are needed to preview the homepage and docs. The separate payment API uses [lib/payment.ts](lib/payment.ts), which expects `IYZICO_API_KEY` and `IYZICO_SECRET_KEY` when invoked, with an optional `IYZICO_BASE_URL`. Do not call it as a site smoke test or commit credentials. See the [payment configuration guide](content/docs/concepts/configuration.mdx) for payment integrations.

Keep `NEXT_PUBLIC_BASE_PATH` and `BETA_ORIGIN` unset for an ordinary stable preview. If port 3000 is in use, append `--port 3001` to the dev or start command.

## Source layout

Paths in this table are relative to `apps/web`.

| Area | Source |
| --- | --- |
| Homepage and root layout | `app/[lang]/page.tsx`, `app/[lang]/layout.tsx` |
| Documentation routes | `app/[lang]/docs/` |
| Shared UI and styles | `components/`, `app/globals.css` |
| Localized docs content | `content/docs/<path>.mdx` (English), `content/docs/<path>.<code>.mdx` (other languages) |
| Sidebar order and titles | `content/docs/<dir>/meta.json`, `meta.<code>.json` |
| Homepage text and docs UI labels | `lib/i18n/dictionary.ts`, `lib/i18n/ui.ts` |
| Languages (code, names, dir, enabled) | `lib/i18n/locales.json` |
| Language routing | `proxy.ts`, `lib/i18n/config.ts` |
| Logos and artwork | `public/brand/` |

Typography is configured in `app/[lang]/layout.tsx`: Manrope for headings, Inter for body text and JetBrains Mono for code. Next.js downloads these Google Fonts during compilation, so development/build requires access to the font service as well as package installation access.

Update both languages together. Keep code blocks identical and preserve heading IDs as described in [TRANSLATIONS.md](TRANSLATIONS.md).

## Checks and production preview

After local setup, stop the dev server before starting the production server on the same port:

```sh
corepack pnpm --filter web lint
node apps/web/scripts/check-translations.mjs
corepack pnpm --filter web docs:test
corepack pnpm --filter web build
corepack pnpm --filter web docs:check
corepack pnpm --filter web start --hostname localhost
```

`build` runs documentation generation and the Next.js production build, including TypeScript checks. `start` serves that build; it does not rebuild. The root `build` and `lint` scripts target the payment package, so use the explicit `--filter web` commands for the website.

### Generated documentation

The web `dev` and `build` scripts generate TypeDoc from public package entries and Markdown from the MDX pages. To regenerate without building Next.js:

```sh
corepack pnpm --filter web docs:generate
corepack pnpm --filter web docs:check
```

Generated files live in `public/api-reference/`, `public/llms/`, `public/llms.txt` and `public/llms-full.txt`. They are ignored by Git; edit package source comments or `content/docs/`, not generated output. After editing source comments or MDX while the dev server is running, run `docs:generate` again to refresh these exports. Use the same base-path environment for generation and `docs:check`.

## Beta preview

There are two separate settings in [next.config.ts](next.config.ts):

- `NEXT_PUBLIC_BASE_PATH=/beta` builds this app under `/beta`. Set it before dev/build and keep it set for start/check. It is compiled into the output, so changing it requires a new build. This previews the current checkout under the beta path; it does **not** switch Git branches or fetch beta features.
- `BETA_ORIGIN` belongs to the **stable** deployment. It points to a separately running beta deployment and enables rewrites from `/beta` to that origin, plus the docs version picker. It does not build the beta app and is unnecessary for a standalone beta preview. Leave `NEXT_PUBLIC_BASE_PATH` unset on that stable deployment.

Production beta is built from the `beta` branch. For a local standalone base-path check, stop any web server using this checkout and run one of the following from the repository root. These commands reuse `.next`, so stable and beta builds must not run simultaneously in the same checkout.

POSIX shell (macOS/Linux):

```sh
export NEXT_PUBLIC_BASE_PATH=/beta
unset BETA_ORIGIN
corepack pnpm --filter web build
corepack pnpm --filter web docs:check
corepack pnpm --filter web start --hostname localhost --port 3001
# After stopping the server with Ctrl+C:
unset NEXT_PUBLIC_BASE_PATH
```

On Windows Git Bash, first run `export MSYS2_ENV_CONV_EXCL=NEXT_PUBLIC_BASE_PATH` in that shell to stop MSYS from converting `/beta` into a Windows filesystem path. Alternatively, use PowerShell below.

PowerShell:

```powershell
$env:NEXT_PUBLIC_BASE_PATH = "/beta"
Remove-Item Env:BETA_ORIGIN -ErrorAction SilentlyContinue
corepack pnpm --filter web build
corepack pnpm --filter web docs:check
corepack pnpm --filter web start --hostname localhost --port 3001
# After stopping the server with Ctrl+C:
Remove-Item Env:NEXT_PUBLIC_BASE_PATH
```

Open [English beta docs](http://localhost:3001/beta/en/docs) or [Turkish beta docs](http://localhost:3001/beta/tr/docs). `/beta/en/docs` selects English and redirects to `/beta/docs`; `/beta` also redirects to the documentation.

After clearing the beta variables, rebuild before serving stable again. If you put these variables in `apps/web/.env.local`, clear them there too. Do not set the stable server's `BETA_ORIGIN` to its own URL; use the other deployment's origin (for example, `http://localhost:3001` for a separate local beta server).

For asset URLs and full-page navigation, use `withBasePath()` from `lib/base-path.ts`. `next/link` already applies the base path. See the [beta release workflow](../../CONTRIBUTING.md#beta-releases) for branch and deployment conventions.
