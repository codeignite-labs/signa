# Testing Signa

## Coverage goals and current scope

[Issue #14](https://github.com/codeignite-labs/signa/issues/14) tracks the
approximately 95% main-app coverage goal. It is **not yet achieved**. The first
foundation batch is tracked in
[issue #15](https://github.com/codeignite-labs/signa/issues/15).

Baseline measured on 2026-10-31:

| Scope                                    | Statements | Branches | Functions |  Lines |
| ---------------------------------------- | ---------: | -------: | --------: | -----: |
| Backend, 240 existing unit tests         |     43.57% |   36.82% |    41.62% | 43.48% |
| Full frontend, first 70 regression tests |      3.18% |    3.46% |     1.62% |  3.21% |

These are dated baseline measurements, not live badges. CI artifacts contain the
current results. The frontend previously had no automated component/unit suite;
70 new tests do not establish application-wide coverage. SDK coverage and its
95% per-runtime-file gate remain separate.

Backend uses Jest/Istanbul after TypeScript transformation; frontend uses
Vitest/V8 with source mapping. Keep providers and source inclusion stable when
comparing baselines. Do not compare a Jest V8 fallback report that counts
unimported TypeScript source lines with this executable-code baseline.

## Run the tests

Use the Node and pnpm versions documented in CONTRIBUTING.md. From the root:

```bash
pnpm test:frontend
pnpm test:frontend:types
pnpm test:frontend:coverage
pnpm test:backend:coverage
pnpm test:sdk:coverage
```

Backend coverage requires the same OpenSSL and matching Playwright Chromium
runtime as backend unit tests. Install Chromium with:

```bash
pnpm --filter backend exec playwright install chromium
```

On a clean Linux CI runner, use `--with-deps` as the workflow does. Backend HTTP
membership tests additionally require an isolated PostgreSQL database with
migrations applied. Never point tests at production databases or delivery
services. CI uses an ephemeral PostgreSQL service and synthetic fixtures.

## Denominators and regression floors

The frontend report includes **all** TypeScript/TSX runtime files under
`apps/frontend/app`, `components`, and `lib`, including modules no test imports.
Only declaration files are explicitly excluded. It does not include the separate
marketing app, generated Next output or the development browser-agent tooling.

The backend retains its existing full-source collection glob. Jest excludes test
files; report entries include controllers, services, entities, wiring and
migrations even when unexecuted. No backend feature directories are hidden to
improve coverage. PostgreSQL HTTP tests and migration checks remain additional
checks; their coverage is not merged into this unit-test report.

Global minimums are initially pinned just below the measured baseline to prevent
regression while feature-area batches increase coverage. These floors are
**not** the 95% completion criterion. They must increase as meaningful tests are
added; do not lower them or shrink the source denominator to pass CI.

In addition, the HTTP client, authentication route guard, auth form validation
and tenant branding cache already have 95% minimums for all four metrics. They
currently report 100%. Their coverage does not stand in for coverage of the
whole app. Browser APIs and fetch responses are controlled at the boundary;
production functions execute normally.

## What the first frontend tests verify

- Browser/server API URL resolution, explicit locale/timezone headers, file
  uploads, empty responses, structured/non-JSON errors and network failures.
- Session persistence, token expiry/skew, account/profile cache updates,
  membership-role preservation, revoked tokens, logout and test-account switches.
- Public/private route boundaries, auth redirects, session-change subscriptions
  and cleanup; signing links stay accessible without a workspace session.
- Tenant branding-cache isolation, expiry, schema validation, unsafe URLs/CSS
  values, storage failures and public-data-only serialization.
- Auth form validation and field-level error paths.

These are component/unit tests, not a full signing browser UAT, physical Android/
iOS coverage, performance measurement or a regulatory compliance certificate.

## Next coverage batches

Prioritize security and signing behavior, with dedicated assigned issues and
focused PRs linked back to #14:

1. Backend authorization/membership roles, authentication failures and storage
   isolation; add focused service and HTTP tests.
2. Signing, certificate/timestamp/revocation failure paths, submitter transitions,
   completion and download permissions.
3. Template editing, submission generation/export, uploads and document-format
   branches.
4. Frontend signing/field interactions, template editor state, settings and
   users/teams/account-switch flows, with loading/error/empty states.
5. Mail/queue/webhook delivery and retry handling, health/runtime wiring, then
   remaining component and helper branches.

Keep new tests tied to observable behavior. Review covered assertions, not only
percentages. Wire additional end-to-end/device coverage as distinct evidence;
do not claim a mocked component test validates a physical WebView.

CI uploads HTML, LCOV and JSON reports as `main-app-coverage`. Download them from
the relevant run to inspect remaining files and branches. Issue #14 stays open
until its full acceptance criteria are met.
