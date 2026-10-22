# Security Policy

better-payment handles payments, so we take security reports seriously.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a security problem.**

Report it privately through GitHub: [open a private vulnerability report](https://github.com/czaydev/better-payment/security/advisories/new) (Security tab → "Report a vulnerability").

Please include:

- what the problem is and what an attacker could do (for example: forge a successful 3D Secure callback, bypass the handler's `authorize` hook, leak credentials in logs)
- the affected version and provider
- steps or code to reproduce, with test credentials or placeholders only

We aim to acknowledge a report within 3 working days and to keep you updated until it is fixed. When a fix is released, we publish a GitHub security advisory and credit you, unless you prefer to stay anonymous.

## Supported versions

| Version | Supported |
| ------- | --------- |
| latest `0.x` release | Yes |
| older `0.x` releases | No, upgrade to the latest release |
| `1.x`–`3.x` (before the version reset) | No, deprecated; see the [changelog](packages/better-payment/CHANGELOG.md) |

## Scope

In scope: the `better-payment` package (including `better-payment/client`, `/testing`, `/plugins` and the framework adapters) and the documentation's security guidance.

Out of scope: vulnerabilities in the payment providers' own APIs (report them to the provider), and issues that require an already compromised server or leaked merchant credentials.

## Supply chain

The package is published from GitHub Actions, so the pipeline is part of what you are trusting when you install `better-payment`.

- **Provenance.** Releases are published with npm trusted publishing (OIDC, no `NPM_TOKEN` stored anywhere) and `npm publish --provenance`, which attaches SLSA build provenance attestations to the tarball. Check what you are about to install, or what you already have:

  ```bash
  npm view better-payment dist.attestations
  ```

  A `provenance` entry means the tarball is tied to a commit of this repository by a signed attestation the registry, not us, produced.

- **The pipeline is measured, not just asserted.** `.github/workflows/scorecard.yml` runs the [OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/czaydev/better-payment) analysis over this repository weekly and on every push to `main`, and uploads the SARIF report as a workflow artifact. It publishes nothing and asks for no write grant beyond reading, so the report is ours to read rather than a number to advertise; the README badge appears only when a maintainer opts the run into publishing (see [CONTRIBUTING.md](CONTRIBUTING.md) → CI and supply chain).

- **CI actions are pinned by commit.** Every third-party action in `.github/workflows` is referenced by a full commit SHA with its release in a trailing comment, so moving a release tag cannot change what CI runs. `node scripts/check-workflow-hygiene.mjs` (a CI job) rejects a tag reference, and `--verify` re-resolves each tag through the GitHub API to prove the SHA and the comment still agree.
- **Least-privilege tokens.** Each workflow and each job declares its own `permissions:`; only `Publish to NPM` and `Release PR` get write access, and only for what they do (a tag and a release, the release pull request, the `id-token` for npm).
- **Dependency updates come through Dependabot.** `.github/dependabot.yml` covers the pnpm workspace (dev and runtime grouped separately, at most five open pull requests) and the pinned actions. New direct dependencies and any change to `pnpm.onlyBuiltDependencies` — the allowlist of packages allowed to run an install script — are review points.
- **No binaries in the tree.** Nothing in the repository is a precompiled artifact: the package builds from TypeScript source in CI.

If a published version has no `dist.attestations` entry, or a dependency's install script runs without being listed in `pnpm.onlyBuiltDependencies`, report it privately as above.

What a report about this repository's pipeline is **not**: the branch protection, required-review and Dependabot toggles live in the repository settings and are a maintainer's decision (see [CONTRIBUTING.md](CONTRIBUTING.md) → CI and supply chain).
