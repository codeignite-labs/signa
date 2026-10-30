# Signa Agent Guide

Signa is a TypeScript recreation of DocuSeal. Keep backend endpoints compatible with DocuSeal where practical, and keep the frontend PDF-signing workflows traceable to the original project.

## Parity Canon

- Default to DocuSeal's behavior, data shape, workflow order, and UI structure when implementing cloned functionality.
- A Signa implementation must be either exact DocuSeal parity or intentionally better with a clear reason such as stronger UX, performance, accessibility, maintainability, or compatibility with our TypeScript/Nest/Next stack.
- Do not silently ship rough approximations for DocuSeal behavior. If exact parity is blocked by missing provider infrastructure, unavailable platform support, or an intentionally deferred subsystem, document the gap in `CONTEXT/progress.md` and keep the code path explicit.
- Before implementing or changing a DocuSeal-cloned feature, inspect the local DocuSeal source for the matching controller/model/view/component and mirror it unless there is a defensible reason not to.
- For signer flows specifically, match DocuSeal's field step components, saved value shapes, attachment handling, and completion rules before adding Signa-specific enhancements.

## Structure

- `apps/frontend`: Next.js App Router frontend generated with `create-next-app`.
- `apps/backend`: NestJS backend generated with the Nest CLI.
- `packages/shared`: shared Zod schemas, API contracts, and types.
- `packages/ts-config`: shared TypeScript configuration.

## Commands

- `pnpm install`: install workspace dependencies.
- `pnpm dev`: run frontend and backend dev servers through Turbo.
- `pnpm build`: build every workspace.
- `pnpm lint`: lint every workspace.
- `pnpm typecheck`: type-check every workspace.

## Issue-first delivery

- Before starting new implementation or a fix, open a GitHub issue with a concrete scope and acceptance criteria. Apply relevant existing labels (or create a descriptive area/type label when needed) and assign the issue to `zedjarvis`.
- Implement and verify that issue's scope on a focused branch. Open a PR after implementation with `Closes #<issue-number>` in its description, validation results, and any material limitations.
- Target the default branch for automatic issue closure. For a stacked PR, state its dependency and retarget to `main` after the prerequisite PR merges; a closing keyword against a non-default branch does not close the issue.
- Keep broad tracking issues open until their full acceptance criteria are met. Close completed batch issues through their PRs rather than claiming a partial batch completes the tracking goal.
- Do not merge or publish merely because a PR was requested; follow the user's current authorization for those actions.

## Backend Persistence

- Use TypeORM with PostgreSQL.
- Use migrations only; keep `synchronize: false` in all environments.
- Do not handwrite migration files. Define entities and keep migration generation wired for the user to run.
- Use the DocuSeal schema file as the main database reference: `../docuseal/db/schema.rb`.
- Keep persistence entities separate from public API Zod schemas.
- Keep TypeORM entities with their owning Nest feature module, not in the `database` module. Example: account/auth entities live under an account/auth module; template entities live under the templates module.
- The `database` module owns only connection/data-source concerns.
- Feature modules that own entities must import `TypeOrmModule.forFeature([...])` locally.
- Use `jsonb` for DocuSeal JSON-serialized fields such as template fields, schema, preferences, values, metadata, variables, and event data.
- Use tenant-scoped indexes for list/query paths, especially `(account_id, id)`, `(account_id, template_id, id)`, and `(account_id, folder_id, id)`.
- Prevent TypeORM default-drift migrations:
  - Do not put PostgreSQL cast-normalized defaults in entity decorators for JSON/UUID columns when TypeORM can compare them unstably. Example: for a `jsonb` empty array default, use `default: () => "'[]'"`, not `default: () => "'[]'::jsonb"`.
  - Before accepting a generated migration, inspect it for repeated no-op `ALTER COLUMN ... SET DEFAULT`, `DROP DEFAULT`/`SET DEFAULT`, or UUID default churn that already appeared in the last migration.
  - If a newly generated migration only repeats a default/index alteration from a previous migration, stop and fix the entity decorator or naming/default expression. Do not keep stacking duplicate migrations.
  - After running a generated migration, run the migration check command before adding new entities: `pnpm db:migration:check`. A clean check is the guard that TypeORM and Postgres agree on metadata.
- Global backend setup lives in `AppModule`: `ConfigModule`, global cache, and global throttling.
- Database wiring lives in the generated `DatabaseModule` and must use `TypeOrmModule.forRootAsync` with `ConfigService`.

## Nest Scaffolding

- When adding Nest modules, services, controllers, guards, or other Nest building blocks, run the official Nest CLI generator first, then edit the generated files.
- Preferred module command: `pnpm --filter backend exec nest generate module <name> --no-spec`.
- Do not manually create Nest scaffold files that the CLI can generate.
- Do not pre-create broad cross-domain entity batches. Add entities only as part of the feature module being implemented.
- Before implementing a module, inspect the matching DocuSeal Rails model, schema section, routes, and controller behavior. Patch Signa toward DocuSeal compatibility before adding new endpoint logic.

## Boundaries

- Use `@repo/shared` for shared contracts; do not import across apps with relative paths.
- Backend routes live under `/api`; Swagger is `/api/docs`; health is `/api/health`.
- Keep Next and Nest as separate services unless static export hosting is explicitly chosen.

## Tenancy

- Match DocuSeal's tenancy model: account-based row isolation, not separate tenant databases.
- Treat `Account` as the tenant root and add `account_id` to every tenant-owned business table.
- Resolve `X-Auth-Token` to a user, then derive tenant context from `user.account_id`.
- Do not trust client-supplied `account_id`; assign tenant ownership from authenticated context.
- Do not use unscoped lookups for tenant-owned records. Repository/service methods must receive tenant context and filter by `account_id`.
- Preserve testing/production account linking semantics when API-key behavior depends on it.
- Keep self-hosted global-config fallback behavior explicit; default implementation should be account-scoped.
- Account preference flags must be stored through account-scoped `account_configs`; keep DocuSeal key names/defaults where practical and do not store these as loose frontend-only state.

## Document Pipeline

- Do not assume one Node package replaces DocuSeal's HexaPDF/PDFium stack.
- Default rendering spike: `@hyzyla/pdfium` plus `sharp`.
- Default simple PDF editing spike: `pdf-lib`; verify every use case with fixtures before committing.
- Default signing spike: `@signpdf/signpdf`; keep Ruby HexaPDF worker as fallback for hard parity gaps.
- Default DOCX conversion path: LibreOffice/soffice in a worker.
- Default HTML-to-PDF path: Playwright/Chromium in a worker.

## Frontend UI Quality

- Buttons that combine an icon and text must keep balanced leading padding and a clear icon/text gap. Do not let `data-icon="inline-start"` or `has-data-[icon=inline-start]` compress the icon against the button edge.
- When button text is hidden at small breakpoints, turn the control into a true centered icon button with square dimensions and no leftover inline-start text spacing.

## Readable TypeScript Guardrail

- Use the local skill at `.agents/skills/write-readable-typescript` for TypeScript/React/Nest work, especially before creating or extending components, hooks, services, controllers, or helpers.
- Before finishing a code change, run `python3 .agents/skills/write-readable-typescript/scripts/check_code_shape.py <changed-file-or-folder>` for touched TypeScript/TSX files where practical.
- Treat files over 500 lines and functions over 30 lines as split candidates. React JSX can exceed the function threshold only when the component remains a single visual unit and state/business logic has already been extracted.
- Do not add new broad catch-all files. Split by feature ownership: components, hooks, model/domain helpers, API adapters, persistence services, or workflow actions.
- If a touched file already exceeds the threshold, avoid making it worse; either split the relevant section in the same pass or leave a clear note in `CONTEXT/progress.md` when a larger follow-up refactor is intentionally deferred.
