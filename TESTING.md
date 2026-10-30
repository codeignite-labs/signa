# Testing Signa

## Coverage gates and measured scope

Both main applications enforce **95% statements, branches, functions and lines**
in CI. The implementation is tracked by [#17](https://github.com/codeignite-labs/signa/issues/17),
following the measurement foundation in [#15](https://github.com/codeignite-labs/signa/issues/15).
The overall [#14](https://github.com/codeignite-labs/signa/issues/14) tracking issue
closes through the implementation PR when it merges.

Complete reports measured on 2026-10-31 (backend with the configured local PostgreSQL service mode used by CI):

| Scope                 | Tests | Statements | Branches | Functions |  Lines |
| --------------------- | ----: | ---------: | -------: | --------: | -----: |
| Backend               | 1,899 |     98.21% |   95.13% |    98.36% | 98.24% |
| Frontend              | 1,342 |     97.41% |   95.03% |    96.68% | 97.39% |
| SDKs, separate report |    22 |     99.68% |   99.65% |      100% | 99.67% |

These are dated measurements. CI uploads the current JSON, LCOV and HTML reports.
SDK gates remain independent and apply per runtime file.

The historical foundation measured backend emitted-JavaScript coverage at
43.57% statements / 36.82% branches / 41.62% functions / 43.48% lines, and the
first 70 frontend tests at 3.18% / 3.46% / 1.62% / 3.21%, respectively. Backend
instrumentation changed explicitly in [#52](https://github.com/codeignite-labs/signa/issues/52);
its old and new percentages are **not directly comparable**. Frontend still uses
Vitest/V8, and backend still uses Jest/Istanbul. Source collection remains broad.

The backend transformer instruments authored TypeScript before compilation.
TypeScript adds decorator metadata fallbacks and property assignments that are
not authored branches; instrumenting them attributed unreachable misses to
constructor type annotations. The transformer uses Jest's supported
`canInstrument` contract, Istanbul's TypeScript parser and composed source maps.
It does not remove runtime paths or manufacture covered outcomes. Four
regressions verify retained Nest dependency metadata, both outcomes of an
authored conditional, an intentionally untested outcome, zero counters for
unexecuted source and the real compiler pipeline. Run them with
`pnpm --filter backend test:coverage-tools`; CI runs this before backend coverage.
See [Jest code transformation](https://jestjs.io/docs/code-transformation) and
[Istanbul's instrumenter API](https://github.com/istanbuljs/istanbuljs/blob/main/packages/istanbul-lib-instrument/api.md).

Functions sent through `page.evaluate` execute outside Node. Real browser tests
use a test-only bridge to initialize the same authored counter maps in Chromium
and merge actual executions with `istanbul-lib-coverage`. Regressions check
independent files, exact counts across repeated calls, untaken branches remaining
zero and subsequent Node execution. Synthetic fixture maps are cleaned up;
application code contains no coverage workaround or ignored browser functions.

## Run the tests

Use the Node and pnpm versions documented in CONTRIBUTING.md. From the root:

```bash
pnpm test:frontend
pnpm test:frontend:types
pnpm test:frontend:coverage
pnpm test:backend:coverage
pnpm test:sdk:coverage
```

The backend coverage command uses two workers and recycles a worker after its
idle heap exceeds 768 MB. A full run in one retained process exceeded Node's
4 GB default heap after the suite expanded; this bounds runner memory without
changing coverage scope. See [Jest worker memory configuration](https://jestjs.io/docs/30.0/configuration#workeridlememorylimit-numberstring).

Backend coverage requires the same OpenSSL and matching Playwright Chromium
runtime as backend unit tests. Install Chromium with:

```bash
pnpm --filter backend exec playwright install chromium
```

On a clean Linux CI runner, use `--with-deps` as the workflow does. Backend application HTTP and migration tests create a randomly named disposable
PostgreSQL database, run the real migrations and drop only that database afterward.
Set `TEST_DATABASE_ADMIN_URL` (or the CI `DATABASE_URL`) to a local PostgreSQL
administrator with database-creation privileges. Remote hosts are rejected. If
neither variable is set, the fixture starts its own temporary PostgreSQL 16
cluster using `/usr/lib/postgresql/16/bin`; set `PG_BIN` for another local binary
directory. The configured administrator database is never migrated or dropped.

Never point tests at production databases or delivery services. Actual HTTP
workflows use synthetic identities and files, isolated storage, disabled mail
and recording queue adapters. CI uses an ephemeral PostgreSQL service.

## Denominators and enforced thresholds

The frontend report includes **all** TypeScript/TSX runtime files under
`apps/frontend/app`, `components`, and `lib`, including modules no test imports.
Only declaration files are explicitly excluded. It does not include the separate
marketing app, generated Next output or the development browser-agent tooling.

The backend retains its existing full-source collection glob. Jest excludes test
files; report entries include controllers, services, entities, wiring and
migrations even when unexecuted. No backend feature directories are hidden to
improve coverage. The disposable-database application HTTP and migration specs run inside this
Jest suite, so their executed application code contributes to its report. The
separate membership end-to-end command remains an additional check.

Both application reports enforce 95% for all four metrics. Keep all runtime
paths included, including unimported modules. Do not lower thresholds, add ignore
comments, call unreachable private methods or invent invalid producer outputs to
make a report pass. An intentionally incomplete backend test selection was also
checked to fail all four global gates.

In addition, the HTTP client, authentication route guard, auth form validation
and tenant branding cache already have 95% minimums for all four metrics. They
currently report 100%. Their coverage does not stand in for coverage of the
whole app. Browser APIs and fetch responses are controlled at the boundary;
production functions execute normally.

## Regression coverage

- Browser/server API URL resolution, explicit locale/timezone headers, file
  uploads, empty responses, structured/non-JSON errors and network failures.
- Session persistence, token expiry/skew, account/profile cache updates,
  membership-role preservation, revoked tokens, logout and test-account switches.
- Public/private route boundaries, auth redirects, session-change subscriptions
  and cleanup; signing links stay accessible without a workspace session.
- Tenant branding-cache isolation, expiry, schema validation, unsafe URLs/CSS
  values, storage failures and public-data-only serialization.
- Auth form validation and field-level error paths.

Component, service and focused HTTP/browser integration tests do not establish
a full signing browser UAT, physical Android/iOS coverage, load capacity or a
regulatory compliance certificate.

## Maintaining coverage

Coverage includes authentication and account permissions; team/user imports and
concurrent role changes; template editing and document conversion; PDF signatures,
timestamps and revocation evidence; submission lifecycle/export; storage;
mail/SMS/webhooks, retries and runtime health. Frontend suites exercise signing,
editor, branding, settings, invitation/account switching and failure states.

Actual PostgreSQL tests create documents and submissions, enforce tenant access,
exercise concurrent password resets and team mutations, migrate up/down and
check Mailgun replay transactions. Cryptographic tests use real signed PDF,
PKCS#12, CMS, OCSP, CRL and OpenSSL timestamp fixtures. Browser tests verify HTML
and XFA rendering and private-network isolation. Provider network responses,
SMTP, queues, OS/native APIs and device primitives are controlled where noted.

Keep new tests tied to observable behavior. Review covered assertions, not only
percentages. Wire additional end-to-end/device coverage as distinct evidence;
do not claim a mocked component test validates a physical WebView.

CI uploads HTML, LCOV and JSON reports as `main-app-coverage`. Download them from
the relevant run to inspect remaining files and branches. Issue #14 stays open
until its full acceptance criteria are met.
