# Contributing to Signa

Bug reports, documentation, accessibility improvements and code contributions
are welcome. This guide takes inspiration from
[Anthony Fu's contribution guide](https://github.com/antfu/contribute), with
Signa-specific setup, testing and release instructions. It is written for this
repository rather than copied from that guide.

## Start with the problem

Search [issues](https://github.com/codeignite-labs/signa/issues) and open PRs
before starting. A bug report should include the running revision, environment,
steps to reproduce, expected behavior and actual behavior. Supply a minimal
reproduction or synthetic document when possible. Remove personal data, API
tokens, private keys and customer documents from logs and attachments.

Discuss substantial features, architecture changes and breaking APIs in an issue
before implementing them. Small corrections can go straight to a PR. Keep each
PR focused on one outcome and batch related documentation corrections together.

Communicate respectfully and explain disagreements with concrete examples.
Maintainers may request a smaller scope or decline changes that do not fit the
project. Do not post credentials, signing keys or exploit details in public
issues. Use GitHub's private vulnerability reporting option if available;
otherwise contact a repository maintainer through their published contact
details to arrange a private report first.

## Work locally

Use Node.js 24, matching the Docker image, and the exact pnpm version in the root
`package.json` (`pnpm@11.21.0` at the time of writing). Corepack can select it:

```bash
corepack enable
git clone https://github.com/YOUR-USERNAME/signa.git
cd signa
git remote add upstream https://github.com/codeignite-labs/signa.git
pnpm install --frozen-lockfile
cp .env.example .env
git switch -c fix/describe-the-problem
```

Fork the canonical repository before cloning your fork. Check the example's
comments and the [README](./README.md) for database, Redis, storage and signing
configuration. The backend reads the root `.env`; never commit its contents.
Use an isolated development database and synthetic users/documents. Configure a
local mail catcher instead of real delivery credentials.

For PostgreSQL development, create a dedicated database, set `DATABASE_URL`, and
apply existing migrations with `pnpm db:migration:run`. Redis is needed when
queues are enabled; configure the example's Redis settings for a local instance.
Docker's bundled Redis behavior does not automatically apply to `pnpm dev`.
SQLite setup and its separate initialization behavior are documented in README.

Start all apps with `pnpm dev`, or run only what you need:

| Command              | Purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| `pnpm dev:frontend`  | Product UI at `http://localhost:3000`                      |
| `pnpm dev:backend`   | API at `http://localhost:3001/api`; Swagger at `/api/docs` |
| `pnpm dev:marketing` | Documentation and marketing at `http://localhost:3002`     |
| `pnpm build`         | Build the workspace                                        |
| `pnpm typecheck`     | Check workspace types                                      |
| `pnpm lint`          | Run workspace lint scripts                                 |

The marketing app has its own `.env.example`; follow its README if your change
needs its connected services. Read [AGENTS.md](./AGENTS.md) for the architecture
rules, even when working without an AI agent.

## Make changes that are easy to review

Keep shared API contracts in `packages/shared`, tenant ownership explicit, and
authorization checks on the server. Test account boundaries when changing users,
teams or document access. Do not introduce unscoped tenant lookups or log private
document contents and credentials.

DocuSeal is the reference implementation for compatible behavior. Compare the
matching upstream code before changing a cloned workflow, and cite the source
revision when porting material. Explain intentional differences. Preserve
upstream licenses and notices; do not copy proprietary features. See
[LICENSING.md](./LICENSING.md) for the platform/SDK license boundaries.

For backend scaffolding, use the Nest CLI. For PostgreSQL schema changes, update
entities, generate the migration with `pnpm db:migration:generate`, inspect it,
apply it to the development database, and run `pnpm db:migration:check`. Do not
handwrite migrations or enable PostgreSQL schema synchronization. Flag
unexpected default/index churn rather than accepting it silently.

Follow existing TypeScript and component conventions. Keep functions focused,
avoid unrelated formatting or dependency upgrades, and update docs when behavior
changes. Signa uses ESLint and Prettier; format only touched files with
`pnpm exec prettier --write <files>` rather than reformatting the whole repo.

## Validate the change

Run checks relevant to the changed packages and report the results. Start with
focused tests, then broaden when the risk warrants it. Add regression coverage
for behavioral bugs; a documentation-only change does not need runtime tests.

```bash
pnpm typecheck
pnpm lint
pnpm --filter backend test --runInBand
pnpm --filter @signajs/react build
pnpm --filter @signajs/react test
pnpm --filter @signajs/react-native build
pnpm --filter @signajs/react-native test
git diff --check
```

The SDK tests use built output, so build before running them. Backend PDF tests
can require OpenSSL and Playwright's matching Chromium runtime. HTTP membership
tests also require a dedicated PostgreSQL database; review fixture configuration
before running `pnpm --filter backend test:e2e --runInBand`. Never point tests at
production. Explain missing prerequisites or unrelated baseline failures instead
of claiming a check passed.

For UI changes, inspect light and dark themes, narrow screens, keyboard access,
loading, empty and error states. Attach screenshots made with synthetic data.
For signing changes, check completed-PDF integrity, failure paths and validation
evidence; a successful preview alone does not prove signing compliance.

## Submit a pull request

Target `main` from your feature branch. Use a Conventional Commit title such as
`fix(signing): preserve input when the host theme changes` or
`docs: clarify certificate configuration`. Commit messages should describe the
change; use `docs:` or `chore:` for work that does not change runtime behavior.

Explain the problem, resulting behavior, validation and any deployment or
migration steps. Link the relevant issue using `Closes #123` only when the PR
actually resolves it. Label incomplete work as a draft and identify what remains.
Respond to review feedback with follow-up commits; there is no need to force-push
just to tidy history. Merge decisions and release timing belong to maintainers.

AI tools are welcome as assistance. Review and understand every submitted line,
verify claims and tests yourself, and take responsibility for the result. Keep
issues and review replies concise, specific and in your own voice. Disclose
material uncertainty or unverified generated output rather than passing it off
as established fact.

## SDK changes and releases

Public SDK behavior or packaging changes need a changeset:

```bash
pnpm changeset
```

Choose the affected `@signajs/react` and/or `@signajs/react-native` package and an
appropriate semver level. Describe the user-visible effect. Contributors should
not bump package versions or publish packages themselves. Maintainers prepare a
version PR with `pnpm version:packages`, verify SDK builds/tests and
`pnpm pack:signa-react` / `pnpm pack:signa-react-native`, then follow the
[release process](./README.md#react-package-versioning) after it is merged.

## Contribution licenses

Submit only work you have permission to contribute. Contributions are licensed
under the license applicable to their files: AGPL-3.0-only by default, with MIT
for the two SDK directories and existing third-party notices preserved. Identify
imported material and its source/license in the PR. No copyright assignment or
additional commercial licensing grant is required by this guide.
