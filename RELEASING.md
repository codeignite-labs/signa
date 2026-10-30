# Releasing Signa

## Two release lanes

| Artifact                                                      | Version authority                                            | Release mechanism                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Backend + frontend, shipped together in the product container | Root `package.json`, synchronized app manifests and defaults | Release Please PR → reviewed draft GitHub release → published `vMAJOR.MINOR.PATCH` tag → container workflow |
| `@signajs/react` and `@signajs/react-native`                  | Each SDK manifest                                            | Changesets version PR → existing npm publish procedure                                                      |

Marketing and internal packages are not separately released by the application
workflow. The backend version is aligned to the existing application baseline
of 0.1.0; this does not publish an initial application release. Historical SDK
versions/tags and releases remain independent.

## Repository setup (maintainers)

1. Enable Actions, with read-only default token permissions. Allow Actions to
   create pull requests in repository settings. Only the release preparation job
   requests contents/PR/issues write access; only container publication requests
   packages write access. Actions are pinned to commit SHAs.
2. Protect `main`: require reviewed PRs and the `Verify` CI check; disallow force
   pushes and deletion. These rules must be configured by a repository admin;
   merely committing workflows does not create branch protection.
3. Optionally configure `RELEASE_PLEASE_TOKEN` with a dedicated GitHub App
   installation token or a narrowly scoped bot token for this repository, with
   contents, pull requests and issues write access. App installation tokens are
   short-lived; use an external automation to supply a fresh token for a run, or
   use a fine-grained bot token with expiration and rotation. Do not store an
   expired installation token as a permanent secret. Without this secret, Release Please uses the
   built-in `GITHUB_TOKEN`.
4. GitHub does not trigger ordinary PR workflows for PRs created using
   `GITHUB_TOKEN`. With the default token, explicitly run CI on the bot's release
   branch before review/merge, for example
   `gh workflow run ci.yml --ref release-please--branches--main`. Confirm the
   branch name on the release PR. A bot/App identity that triggers PR workflows
   avoids that manual step. Never bypass a required check.
5. Confirm GHCR organization policy permits publishing this repository's image.
   Choose package visibility explicitly after initial publication. No registry
   password is needed: the publishing job uses its scoped `GITHUB_TOKEN`.
6. Protect application release tags (`v*`) against update/deletion while allowing
   the release bot to create them. Configure that ruleset separately from SDK
   tags. Do not change a published tag or overwrite a versioned container.

No production environment, deployment credential or npm token is required by
application CI. Fork PRs run without release secrets and without write tokens;
these workflows do not use `pull_request_target`. No production deployment is
performed automatically. Repository protections and optional bot credentials
are activation steps; they are not silently installed by this PR.

## Application version policy

Public application contracts include HTTP API behavior, persisted data and
migration compatibility, supported configuration, and document signing behavior.
Use Conventional Commits in merged history or squash titles:

- `fix:` produces a patch release.
- `feat:` produces a minor release.
- `!` or `BREAKING CHANGE:` records an incompatible change. Before 1.0 this bumps
  the minor version; after 1.0 it bumps the major version.
- `docs:`, `chore:` and other non-runtime changes are not themselves a reason to
  release the application.

Inspect the proposed version; do not infer compatibility from a green test alone.
Release Please updates root/backend/frontend versions, its manifest, CHANGELOG,
Docker/Compose defaults and backend metadata fallbacks in one reviewable PR.
`pnpm release:check` rejects drift; `pnpm test:release` tests that guard. SDK
versions are not updated by that process.

## Prepare, review and publish

1. Merge reviewed changes to `main`. CI runs frozen-lockfile installation,
   lint, types, workspace builds, backend tests, PostgreSQL migration checks,
   membership HTTP tests, SDK tests and coverage, and package dry runs. Backend
   tests allow 30 seconds per test for real OpenSSL certificate generation on
   shared runners; builds finish before those tests start.
2. The preparation workflow runs the same verification before Release Please
   creates or updates a release PR. Review its changelog and compatibility notes.
   Ensure CI ran on that PR's actual head, including when using the default bot
   token as described above. Merge only after required checks and review.
3. The next successful preparation run creates a **draft** release. Review its
   source revision, migrations, configuration changes, backup/restore plan and
   known limitations. Check source-offer and attribution obligations in
   [LICENSING.md](./LICENSING.md), particularly white-label deployments. A CI pass
   does not certify legal, signing or capacity compliance.
4. A maintainer publishes the draft in GitHub. This intentional human action
   triggers `Publish application container`. Do not mark an application release
   as a prerelease: this lane currently supports stable SemVer versions only.
5. That workflow checks the exact tag, manifest and version defaults, requires
   its commit to be on `main`, requires a published non-draft/non-prerelease
   GitHub release, and reruns CI before publishing to GHCR.
6. The resulting image has exact-version and full-commit tags, OCI source/version
   metadata, BuildKit provenance and an SBOM. The job summary records its digest.
   Deployment is a separate operational decision: pin that digest, not a moving
   `latest` tag. No moving major/minor aliases are published.

On failure, fix the source and cut a new version if the source must change. For
transient failures before an image was published, manually run
`release-container.yml` with the existing published tag. The workflow refuses
republishing an existing version image. A GitHub release and a container push
are separate operations: a failed container build leaves a release without an
image; inspect Actions before announcing it as installable. Attestations are
build metadata, not a substitute for an independent vulnerability assessment.

Rollback by selecting the prior known-good image digest. Check database migration
compatibility and backups first; do not assume every migration is reversible.
Do not retag an old image as a new release or rewrite release history.

## SDK testing and coverage

`pnpm test:sdk:coverage` runs Vitest with V8 coverage on both SDKs' TypeScript/
React runtime code and the React SDK's packaged browser bridges. Every runtime
file must reach at least **95% statements, branches, functions and lines**.
Type-only files have no executable statements. Test fixtures, generated `dist`
and unrelated platform code are outside this explicitly SDK-scoped denominator;
no SDK runtime files are excluded to improve the percentage.

Tests exercise React mounting/unmounting and events, SSR, browser script selection,
iframe messages/URLs and theme updates. Native platform and WebView primitives
are mocked so the JavaScript wrapper's lifecycle and callbacks run in CI. This
is not Android/iOS device coverage, a physical WebView performance benchmark, or
95% backend/frontend coverage. Device and full signing UAT remain separate.

CI uploads HTML, LCOV and JSON reports as the `sdk-coverage` artifact. README
coverage badges report the CI gate status against the 95% minimum, not a made-up
current percentage. npm badges report registry versions/downloads independently
from GitHub app releases. SDK publishing still requires configured npm access;
no package is published by the application release workflows.

## References

- [Semantic Versioning](https://semver.org/)
- [Release Please action](https://github.com/googleapis/release-please-action)
- [Manifest configuration](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md)
- [GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use)
