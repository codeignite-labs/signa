# Signa

Signa is a TypeScript and React document-signing platform built for DocuSeal-compatible signing workflows and API behavior. It uses a NestJS backend, Next.js product and marketing applications, TypeORM, PostgreSQL or SQLite, Redis-backed queues, PDF rendering/signing tooling, mail/SMS delivery, webhooks, Supabase-backed marketing data, and shared contracts in a pnpm monorepo.

This scaffold was created from the official framework CLIs:

- Next.js frontend: `pnpm create next-app@latest frontend --yes`
- NestJS backend: `pnpm dlx @nestjs/cli new backend --strict --package-manager pnpm --skip-git`

Clone the canonical repository:

```bash
git clone git@github.com:codeignite-labs/signa.git
cd signa
```

## Workspace

- `apps/frontend`: Next.js App Router frontend.
- `apps/backend`: NestJS backend API.
- `apps/marketing`: standalone full-stack Next.js marketing site for independent Vercel deployment and Supabase-backed marketing data.
- `packages/signa-react`: npm-publishable React embedding package for Signa signing forms and builder workflows.
- `packages/signa-react-native`: npm-publishable React Native WebView package for mobile signing flows.
- `packages/shared`: shared Zod schemas, contracts, and types.
- `packages/ts-config`: shared TypeScript config.

## Local Development

```bash
pnpm install
pnpm dev
```

Default local URLs:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:3001/api`
- Marketing: `http://localhost:3002`
- Swagger: `http://localhost:3001/api/docs`
- Health: `http://localhost:3001/api/health`
- Bull Board, when enabled: `http://localhost:3001/queues`

Frontend and backend run as separate servers in development and production because the frontend uses Next.js server routes. Docker starts both product processes in one app container for simple deployment. The marketing workspace is deployed independently and is not served by the on-prem product container.

## Public Documentation

Signa ships its user, developer, API, compliance, and deployment documentation
from the standalone `apps/marketing` deployment. These routes are public and
do not require an authenticated product account:

Production documentation: [https://signa-docs.vercel.app](https://signa-docs.vercel.app)

| Route                                                                                                               | Purpose                                                                    |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`/docs`](https://signa-docs.vercel.app/docs)                                                                       | Documentation home and navigation.                                         |
| [`/docs/api`](https://signa-docs.vercel.app/docs/api)                                                               | Curated API onboarding, endpoint contracts, examples, and response shapes. |
| [`/docs/embedding`](https://signa-docs.vercel.app/docs/embedding)                                                   | React and React Native embedding guidance.                                 |
| [`/docs/webhooks`](https://signa-docs.vercel.app/docs/webhooks)                                                     | Webhook registration, events, retries, and signature verification.         |
| [`/guides`](https://signa-docs.vercel.app/guides)                                                                   | End-to-end signing, template, verification, and deployment guides.         |
| [`/resources`](https://signa-docs.vercel.app/resources)                                                             | Operational references for teams, branding, integrations, and storage.     |
| [`/compliance`](https://signa-docs.vercel.app/compliance)                                                           | Audit, certificate, PAdES, timestamp, and LTV controls.                    |
| [`/qualified-electronic-signature`](https://signa-docs.vercel.app/qualified-electronic-signature)                   | Signature levels and external qualified trust-provider requirements.       |

The generated NestJS OpenAPI explorer remains available at `/api/docs`. Use
the [public API guide](https://signa-docs.vercel.app/docs/api) for guided
onboarding and `/api/docs` on a running Signa instance for the authoritative,
machine-generated controller and DTO schema.

## React Embed Package

`packages/signa-react` contains the npm-publishable React package for embedding Signa signing forms and builder workflows.
`packages/signa-react-native` contains the npm-publishable React Native package for mobile apps that embed hosted Signa signing flows through `react-native-webview`.

Common package commands:

```bash
pnpm --filter @signajs/react typecheck
pnpm --filter @signajs/react build
pnpm pack:signa-react
pnpm --filter @signajs/react-native typecheck
pnpm --filter @signajs/react-native build
pnpm pack:signa-react-native
```

Basic usage:

```tsx
import { SignaForm } from "@signajs/react";

export function App() {
  return (
    <SignaForm
      host="https://signa.example.com"
      src="https://signa.example.com/s/submitter-slug"
    />
  );
}
```

Publishing notes are documented in `packages/signa-react/README.md`. The current package name is `@signajs/react`, which requires access to the `signajs` npm scope. Package releases use Changesets so version bumps, changelog entries, and npm publishing are reviewed in git before release.
React Native setup notes are documented in `packages/signa-react-native/README.md`. The native package name is `@signajs/react-native` and also requires access to the `signajs` npm scope.

## Versioning and Releases

Signa has two release lanes:

- **Application release:** the deployable Signa app is versioned from the private root `package.json`, git tags, and Docker image tags.
- **Package release:** public npm packages, currently `@signajs/react` and `@signajs/react-native`, are versioned and published with Changesets.

### Application Versioning

Use the root `package.json` `version` as the app semver. A production release should be tagged and built with the matching app metadata:

```bash
git tag app-v0.1.0
git push origin app-v0.1.0

docker build \
  --build-arg APP_VERSION=0.1.0 \
  --build-arg APP_COMMIT_SHA=$(git rev-parse HEAD) \
  --build-arg APP_BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ") \
  -t signa:0.1.0 .
```

`APP_VERSION`, `APP_COMMIT_SHA`, and `APP_BUILD_TIME` are optional runtime metadata. When set, they appear in `/api/health`, `/api/health/live`, `/api/health/ready`, and the root API metadata endpoint. They are intentionally separate from npm package versions because the app is deployed as a Docker artifact, not published to npm.

With Docker Compose, set the same values in `.env` before building:

```env
APP_VERSION=0.1.0
APP_COMMIT_SHA=<git-sha>
APP_BUILD_TIME=2026-07-11T10:00:00Z
```

### React Package Versioning

Create a changeset for every user-visible package change:

```bash
pnpm changeset
```

Choose the semver level for the changed package, such as `@signajs/react` or `@signajs/react-native`:

- `patch`: bug fixes and documentation-only runtime clarifications.
- `minor`: backward-compatible props, events, or behavior.
- `major`: breaking prop, event, bundle, peer dependency, or runtime-script changes.

When ready to prepare a release PR:

```bash
pnpm version:packages
pnpm --filter @signajs/react typecheck
pnpm --filter @signajs/react build
pnpm pack:signa-react
pnpm --filter @signajs/react-native typecheck
pnpm --filter @signajs/react-native build
pnpm pack:signa-react-native
```

After the version PR is merged and npm credentials are available:

```bash
pnpm release:packages
```

For CI, prefer npm trusted publishing with provenance enabled so published package tarballs are tied to the GitHub Actions release workflow. The publish workflow should run the same checks, then execute `pnpm release:packages` with npm provenance/trusted-publisher configuration.

## Docker Deployment

The default image is a complete single-node Signa installation. It serves the
web app and API on one port, stores SQLite, uploads, generated documents,
secrets, and its private Redis data under `/data`, and needs no configuration
for an initial evaluation.

```bash
docker build -t signa .
docker run --name signa -p 3000:3000 -v signa-data:/data signa
```

Open `http://localhost:3000`. The first registered user becomes the owner, and
self-service registration closes after that initial account.

Docker Compose provides the same setup:

```bash
docker compose up -d --build
```

The public documentation includes a copyable installation, health-check,
SMTP, storage, backup, and upgrade runbook at
[Deploy Signa on premise](https://signa-docs.vercel.app/resources/deploy-signa-on-premise).

Useful endpoints:

- App: `http://localhost:3000`
- API docs: `http://localhost:3000/api/docs`
- Health: `http://localhost:3000/api/health`

### Minimal Production Configuration

| Variable            | Required              | Description                                                                                                                                       |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`           | Yes outside localhost | The single public origin, for example `https://signa.example.com`. Signa derives frontend, API, signing, storage, and email links from it.        |
| `DATABASE_URL`      | No                    | Leave empty for SQLite. Set a PostgreSQL URL to switch to Postgres.                                                                               |
| `JWT_SECRET`        | No                    | Generated once into `/data/signa.env` when omitted. Supply your own secret through a secrets manager for stateless or multi-instance deployments. |
| `REGISTRATION_MODE` | No                    | Defaults to `initial_only`. Use `initial_only` for on-prem bootstrap, `open` for public signup, or `disabled` to block self-service registration. |

Run behind an HTTPS reverse proxy or load balancer and set:

```env
APP_URL=https://signa.example.com
```

Optional release metadata:

| Variable         | Required | Description                                                                               |
| ---------------- | -------- | ----------------------------------------------------------------------------------------- |
| `APP_VERSION`    | No       | App semver exposed through health/API metadata. Defaults to the package version fallback. |
| `APP_COMMIT_SHA` | No       | Git commit SHA for the deployed artifact.                                                 |
| `APP_BUILD_TIME` | No       | UTC ISO timestamp for the deployed artifact build.                                        |

### On-Prem Bootstrap Registration

Signa mirrors DocuSeal's non-multitenant deployment posture: public signup is not treated as a normal on-prem entry point. The default `REGISTRATION_MODE=initial_only` allows the first owner account to self-register on a fresh database, then closes self-service registration after a user exists. Additional users should be invited or created from Settings.

Registration modes:

| Mode           | Behavior                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `initial_only` | Default. The first user can register; every later self-service registration and OAuth account creation is blocked.               |
| `open`         | Public signup is enabled. Use this only for controlled SaaS/public deployments.                                                  |
| `disabled`     | Self-service registration is fully disabled, including the first user. Use this when users are seeded or provisioned externally. |

The product root redirects to `/templates`. Existing auth guards send signed-out
users to login and preserve authenticated access to the console. The public
marketing site is the separate `apps/marketing` deployment.

### Database Env Vars

Database selection follows DocuSeal's deployment model:

```env
# SQLite: leave DATABASE_URL empty.
DATABASE_URL=

# PostgreSQL: set one URL.
DATABASE_URL=postgresql://signa:password@database.example.com:5432/signa
```

| Variable                  | Required | Default               | Description                                                                                |
| ------------------------- | -------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `SQLITE_DATABASE_PATH`    | No       | `/data/signa.sqlite`  | SQLite file path inside the container.                                                     |
| `SQLITE_SYNCHRONIZE`      | No       | `true`                | TypeORM synchronize for SQLite quick starts. Disable for controlled production migrations. |
| `DATABASE_URL`            | Optional | empty                 | PostgreSQL URL. If set, PostgreSQL is used.                                                |
| `DATABASE_SSL`            | Optional | `false`               | Encrypts PostgreSQL traffic without requiring a custom CA certificate.                      |
| `DATABASE_MIGRATIONS_RUN` | Optional | `true` for PostgreSQL | Runs TypeORM migrations on container start.                                                |

PostgreSQL example:

```env
DATABASE_URL=postgresql://signa:password@database.example.com:5432/signa
DATABASE_SSL=true
```

`DATABASE_SSL=true` encrypts the PostgreSQL connection but does not validate
the database certificate chain. Keep SSL parameters out of `DATABASE_URL` when
using this flag because PostgreSQL URL parameters can override the driver SSL
configuration. Deployments that require database identity verification should
use a trusted CA configuration instead.

`DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, and
`DATABASE_NAME` remain accepted for backward compatibility, but new
deployments should use `DATABASE_URL`.

### Deployment Recipes

SQLite plus local blob storage is the smallest self-hosted setup. The single
`/data` volume contains the database, files, generated PDFs, Redis persistence,
and generated application secret:

```env
APP_URL=https://signa.example.com
```

PostgreSQL plus local blob storage keeps documents on the app host but moves relational data to PostgreSQL:

```env
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/signa
```

PostgreSQL plus S3 is the recommended production shape when the app container should be disposable. Keep the S3 bucket private; Signa serves files through its own signed `/storage/blobs/...` proxy URLs:

```env
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/signa
S3_ATTACHMENTS_BUCKET=signa-production-blobs
```

That single bucket variable activates S3, matching DocuSeal's deployment
contract. The region defaults to `us-east-1`. Set `AWS_REGION` when the bucket
uses another region. On AWS infrastructure, use an EC2 instance profile, ECS
task role, or EKS workload identity and leave static credentials empty. The AWS
SDK default provider chain also supports standard local AWS profiles and
temporary credentials.

For S3-compatible storage such as MinIO, R2, or LocalStack, add:

```env
S3_ATTACHMENTS_BUCKET=signa-documents
S3_ENDPOINT=https://storage.example.com
```

A custom endpoint automatically enables path-style requests. Existing
`AWS_S3_BUCKET` and `AWS_S3_ENDPOINT` variables remain supported as aliases.
S3 encrypts new objects at rest by default; use
`AWS_S3_SERVER_SIDE_ENCRYPTION` only when an explicit upload encryption header
is required by bucket policy.

The runtime role needs only bucket readiness plus object read/write access:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::signa-production-blobs"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::signa-production-blobs/*"
    }
  ]
}
```

Replace the example bucket name. `s3:ListBucket` is used by the readiness
probe; Signa does not require a public bucket or public object ACLs.

### AWS Deployment

Use the smallest topology that matches the required availability.

**Single-node EC2**

This is the closest equivalent to DocuSeal's one-command deployment. Attach an
encrypted EBS volume, mount it for Docker data, and run the Signa image with one
persistent `/data` volume:

```bash
docker run -d \
  --name signa \
  --restart unless-stopped \
  -p 3000:3000 \
  -e APP_URL=https://signa.example.com \
  -e SMTP_ADDRESS=email-smtp.eu-west-1.amazonaws.com \
  -e SMTP_PORT=587 \
  -e SMTP_USERNAME=SES_SMTP_USERNAME \
  -e SMTP_PASSWORD=SES_SMTP_PASSWORD \
  -e "SMTP_FROM=Signa <signing@example.com>" \
  -v signa-data:/data \
  signa
```

Terminate TLS at an Application Load Balancer, reverse proxy, or managed edge
service and forward traffic to container port `3000`. Back up the `/data`
volume. This shape intentionally keeps SQLite, local storage, and private Redis
on one host and must not be scaled horizontally.

**Stateless ECS**

Use this topology for multiple application tasks or replaceable containers:

| Concern          | AWS service            | Signa configuration                                                                        |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| Container        | ECR and ECS/Fargate    | Expose container port `3000`; ALB health check `/api/health`.                              |
| Relational data  | RDS PostgreSQL         | Set one `DATABASE_URL`; set `DATABASE_SSL=true`.                                           |
| Documents        | Private S3 bucket      | Set `S3_ATTACHMENTS_BUCKET`; grant the ECS task role access to that bucket.                |
| Queues and cache | ElastiCache for Redis  | Set `REDIS_URL`; `QUEUE_REDIS_URL` defaults to the same URL.                               |
| Email            | Amazon SES SMTP        | Set the `SMTP_*` variables. SES SMTP credentials are not IAM access keys.                  |
| Secrets          | Secrets Manager or SSM | Inject `DATABASE_URL`, `JWT_SECRET`, SMTP credentials, and provider secrets into the task. |

Each ECS task remains disposable because persistent state is held by RDS, S3,
and Redis. Use rolling deployments with more than one healthy task only after
all three shared services are configured.

Signa follows the same deployment principle documented by
[DocuSeal](https://www.docuseal.com/install): one public application port,
SQLite when no database URL is supplied, and a database URL for an external
database. AWS recommends task roles for application credentials; do not bake
AWS access keys into the image.

### Queue, Redis, and Cache Env Vars

| Variable                   | Required | Default                        | Description                                                           |
| -------------------------- | -------- | ------------------------------ | --------------------------------------------------------------------- |
| `REDIS_URL`                | No       | private Redis in the container | Set an external Redis URL for multi-instance or managed deployments.  |
| `QUEUE_ENABLED`            | No       | `true` in Docker               | Enables BullMQ workers for mail, SMS, webhooks, and async processing. |
| `QUEUE_REDIS_URL`          | No       | same as `REDIS_URL`            | Redis connection used by BullMQ.                                      |
| `QUEUE_PREFIX`             | No       | `signa`                        | BullMQ key prefix.                                                    |
| `QUEUE_DEFAULT_ATTEMPTS`   | No       | `3`                            | Default retry attempts.                                               |
| `QUEUE_BACKOFF_MS`         | No       | `5000`                         | Default retry backoff.                                                |
| `QUEUE_REMOVE_ON_COMPLETE` | No       | `1000`                         | Number of completed jobs retained.                                    |
| `QUEUE_REMOVE_ON_FAIL`     | No       | `5000`                         | Number of failed jobs retained.                                       |
| `CACHE_NAMESPACE`          | No       | `signa-cache`                  | Cache namespace.                                                      |
| `CACHE_TTL_MS`             | No       | `3600000`                      | Cache TTL in milliseconds.                                            |

### Queue Dashboard Env Vars

| Variable             | Required            | Default   | Description                                    |
| -------------------- | ------------------- | --------- | ---------------------------------------------- |
| `BULL_BOARD_ENABLED` | No                  | `false`   | Enables queue dashboard at `BULL_BOARD_ROUTE`. |
| `BULL_BOARD_ROUTE`   | No                  | `/queues` | Dashboard route on the backend server.         |
| `BULL_BOARD_USER`    | Required if enabled | `admin`   | Basic-auth username.                           |
| `BULL_BOARD_PASS`    | Required if enabled | none      | Use a strong password.                         |

### Mail Env Vars

Mail delivery becomes active as soon as `SMTP_ADDRESS` is present. SMTP
authentication is enabled when both username and password are present.

| Variable               | Required           | Default | Description                                                  |
| ---------------------- | ------------------ | ------- | ------------------------------------------------------------ |
| `SMTP_ADDRESS`         | Yes                | empty   | SMTP hostname. Its presence enables delivery.                |
| `SMTP_PORT`            | No                 | `587`   | SMTP port. Use `587` for STARTTLS or `465` for implicit TLS. |
| `SMTP_USERNAME`        | Provider dependent | empty   | SMTP username.                                               |
| `SMTP_PASSWORD`        | Provider dependent | empty   | SMTP password.                                               |
| `SMTP_FROM`            | Yes                | empty   | Sender, for example `Signa <sign@company.com>`.              |
| `SMTP_DOMAIN`          | No                 | empty   | Client domain used for SMTP EHLO.                            |
| `SMTP_AUTHENTICATION`  | No                 | `plain` | SMTP auth method.                                            |
| `SMTP_REPLY_TO`        | No                 | empty   | Optional reply-to address.                                   |
| `SMTP_ENABLE_STARTTLS` | No                 | `true`  | Require STARTTLS on non-implicit-TLS connections.            |
| `SMTP_ENABLE_SSL`      | No                 | `false` | Enable implicit TLS. Port `465` enables it automatically.    |
| `SMTP_SSL_VERIFY`      | No                 | `true`  | Verify the SMTP server certificate.                          |
| `SMTP_OPEN_TIMEOUT`    | No                 | `15`    | Connection timeout in seconds.                               |
| `SMTP_READ_TIMEOUT`    | No                 | `25`    | Socket timeout in seconds.                                   |

Amazon SES example:

```env
SMTP_ADDRESS=email-smtp.eu-west-1.amazonaws.com
SMTP_PORT=587
SMTP_USERNAME=SES_SMTP_USERNAME
SMTP_PASSWORD=SES_SMTP_PASSWORD
SMTP_FROM=Signa <signing@example.com>
SMTP_ENABLE_STARTTLS=true
SMTP_SSL_VERIFY=true
```

SES SMTP credentials are distinct from normal AWS access keys. Verify the
sender identity in SES and move the account out of the SES sandbox before
sending to arbitrary recipients.

Existing `MAIL_*` variables remain supported as compatibility aliases.

### Google Integrations

Social login OAuth credentials:

| Variable                       | Required | Description                                                                               |
| ------------------------------ | -------- | ----------------------------------------------------------------------------------------- |
| `GOOGLE_AUTH_CLIENT_ID`        | Optional | Google OAuth client ID for Sign in with Google.                                           |
| `GOOGLE_AUTH_CLIENT_SECRET`    | Optional | Google OAuth client secret for backend code exchange.                                     |
| `GOOGLE_AUTH_REDIRECT_URI`     | Optional | Frontend callback URL, for example `http://localhost:3000/auth/oauth/google/callback`.    |

Register the exact redirect URLs above with each provider. The backend creates the authorization URL, validates signed `state` and `nonce`, exchanges the code server-side, validates the provider ID token, then returns the normal Signa session.

Server-side OAuth credentials:

| Variable                        | Required | Description                      |
| ------------------------------- | -------- | -------------------------------- |
| `GMAIL_OAUTH_CLIENT_ID`         | Optional | Gmail OAuth client ID.           |
| `GMAIL_OAUTH_CLIENT_SECRET`     | Optional | Gmail OAuth client secret.       |
| `GMAIL_OAUTH_REDIRECT_URI`      | Optional | Frontend Gmail callback URL.     |

Google Drive Picker frontend build-time credentials:

| Variable                             | Required | Description                                    |
| ------------------------------------ | -------- | ---------------------------------------------- |
| `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` | Optional | Google OAuth client ID exposed to the browser. |
| `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`  | Optional | Google Picker API key.                         |
| `NEXT_PUBLIC_GOOGLE_PICKER_APP_ID`   | Optional | Google Cloud project app ID.                   |

Configure the OAuth client and API key in Google Cloud Console, enable Google Picker API and Google Drive API, then allow the app origin in OAuth and API key restrictions.

### SMS and Phone Verification Env Vars

| Variable                       | Required | Description                                   |
| ------------------------------ | -------- | --------------------------------------------- |
| `TWILIO_ACCOUNT_SID`           | Optional | Twilio account SID.                           |
| `TWILIO_AUTH_TOKEN`            | Optional | Twilio auth token.                            |
| `TWILIO_VERIFY_SERVICE_SID`    | Optional | Twilio Verify service for phone OTP.          |
| `TWILIO_MESSAGING_SERVICE_SID` | Optional | Twilio Messaging Service for SMS invitations. |
| `TWILIO_FROM_PHONE`            | Optional | Fallback Twilio sender number.                |
| `SMS_CALLBACK_SECRET`          | Optional | Secret for SMS provider callbacks.            |

### Webhook Env Vars

| Variable               | Required | Default | Description                          |
| ---------------------- | -------- | ------- | ------------------------------------ |
| `WEBHOOK_TIMEOUT_MS`   | No       | `10000` | HTTP timeout for webhook deliveries. |
| `WEBHOOK_MAX_ATTEMPTS` | No       | `8`     | Maximum webhook retry attempts.      |
| `WEBHOOK_BACKOFF_MS`   | No       | `30000` | Base retry backoff.                  |

### Storage, PDF, Conversion, and Security Env Vars

| Variable                        | Required        | Default              | Description                                                                                                                                      |
| ------------------------------- | --------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STORAGE_SERVICE`               | No              | `auto`               | `auto` uses S3 when a bucket is configured, otherwise local disk. Use `local` or `s3` only to force a backend.                                   |
| `STORAGE_PATH`                  | No              | `/storage` in Docker | Local file storage root, used when the active storage backend is `local`. Existing local blobs remain readable after switching new writes to S3. |
| `S3_ATTACHMENTS_BUCKET`         | Required for S3 | empty                | Preferred private S3 bucket variable. Setting it automatically activates S3.                                                                     |
| `AWS_REGION`                    | No              | `us-east-1`          | AWS region for the S3 bucket. `AWS_DEFAULT_REGION` is also recognized.                                                                           |
| `AWS_ACCESS_KEY_ID`             | Optional        | empty                | Explicit AWS access key. Leave empty on EC2/ECS/EKS/Lambda-style deployments that use IAM roles.                                                 |
| `AWS_SECRET_ACCESS_KEY`         | Optional        | empty                | Explicit AWS secret key. Leave empty when using IAM roles.                                                                                       |
| `AWS_SESSION_TOKEN`             | Optional        | empty                | Temporary session token for STS credentials.                                                                                                     |
| `S3_ENDPOINT`                   | Optional        | empty                | Preferred custom endpoint for S3-compatible providers. It automatically enables path-style requests.                                             |
| `AWS_S3_BUCKET`                 | Optional alias  | empty                | Backward-compatible alias for `S3_ATTACHMENTS_BUCKET`.                                                                                           |
| `AWS_S3_PREFIX`                 | No              | empty                | Optional object key prefix, for example `production/blobs`.                                                                                      |
| `AWS_S3_ENDPOINT`               | Optional alias  | empty                | Backward-compatible alias for `S3_ENDPOINT`.                                                                                                     |
| `AWS_S3_FORCE_PATH_STYLE`       | No              | `false`              | Enable path-style URLs for S3-compatible storage that requires it.                                                                               |
| `AWS_S3_SERVER_SIDE_ENCRYPTION` | Optional        | empty                | Explicit upload encryption header: `AES256` or `aws:kms`. S3 default bucket encryption normally makes this unnecessary.                          |
| `ATTACHMENT_INGEST_MAX_BYTES`   | No              | `10485760`           | Max downloaded attachment size.                                                                                                                  |
| `PDF_PREVIEW_MAX_PAGES`         | No              | `15`                 | Max preview pages generated per PDF.                                                                                                             |
| `PDF_PREVIEW_MAX_WIDTH`         | No              | `1400`               | Preview image width.                                                                                                                             |
| `PDF_SIGNATURE_SUBFILTER`       | No              | `pades`              | `pades` uses `ETSI.CAdES.detached`; `adobe` uses legacy Adobe detached signatures.                                                               |
| `PDF_TIMESTAMP_REQUIRED`        | No              | `false`              | When `true`, completed PDF signing fails if no RFC3161 `/DocTimeStamp` can be embedded. Leave `false` to keep TSA optional.                      |
| `PDF_TIMESTAMP_TIMEOUT_MS`      | No              | `10000`              | Timeout for RFC3161 timestamp server requests.                                                                                                   |
| `PDF_LTV_REQUIRED`              | No              | `false`              | When `true`, completed PDF signing fails if OCSP/CRL evidence cannot be collected and embedded into DSS/VRI.                                     |
| `PDF_LTV_HTTP_TIMEOUT_MS`       | No              | `10000`              | Timeout for OCSP/CRL revocation evidence HTTP requests.                                                                                          |
| `PDF_A_ENABLED`                 | No              | `false`              | Enables pre-signing PDF/A conversion through an external Ghostscript-compatible binary.                                                          |
| `PDF_A_REQUIRED`                | No              | `false`              | When `true`, completed PDF signing fails if PDF/A conversion fails.                                                                              |
| `PDF_A_LEVEL`                   | No              | `2b`                 | Requested PDF/A level: `1b`, `2b`, or `3b`.                                                                                                      |
| `PDF_A_GHOSTSCRIPT_PATH`        | No              | `gs`                 | Ghostscript executable used for PDF/A conversion.                                                                                                |
| `PDF_A_VERAPDF_PATH`            | No              | `verapdf`            | Optional veraPDF executable used for PDF/A validation after conversion.                                                                          |
| `PDF_A_TIMEOUT_MS`              | No              | `60000`              | Timeout for PDF/A conversion and validation commands.                                                                                            |
| `DOCUMENT_CONVERSION_MAX_BYTES` | No              | `15728640`           | Max DOCX/HTML conversion input size.                                                                                                             |
| `HTML_TO_PDF_TIMEOUT_MS`        | No              | `30000`              | HTML-to-PDF render timeout.                                                                                                                      |
| `THROTTLE_TTL_MS`               | No              | `60000`              | API rate-limit window.                                                                                                                           |
| `THROTTLE_LIMIT`                | No              | `120`                | API rate-limit request count.                                                                                                                    |

## PDF Signing, Verification, and Validation

Signa separates visible document completion from cryptographic PDF validation. The visible form values are rendered onto the PDF first, then the final bytes are signed, enriched with long-term validation evidence, and optionally timestamped.

### Completion and Visual Stamping Flow

1. A submitter fills fields in the signing UI.
2. The backend normalizes the submitted values and renders them onto the source PDF.
3. Supported field values are stamped onto pages before cryptographic signing: text, dates, numbers, checkboxes, radio/select/multiple values, typed/drawn/uploaded signatures, initials, images, and file references where applicable.
4. If account settings require a signature ID, Signa stamps signer identity metadata next to the visible signature.
5. The generated completed PDF bytes are hashed with SHA-256 and stored with the completed document metadata.

This stage is the visual/legal representation of what the signer saw and accepted. Cryptographic signing starts after this stage so later validation covers the completed document bytes.

### Cryptographic Signing Flow

1. Signa loads the account default signing certificate from encrypted account config. Certificates are stored as PKCS#12/PFX material, with a generated Signa default certificate available for self-hosted setups.
2. The backend prepares a PDF signature placeholder with `@signpdf/placeholder-pdf-lib`.
3. The PDF is signed with `@signpdf/signer-p12` and `@signpdf/signpdf`.
4. By default, signatures use the PAdES-compatible `ETSI.CAdES.detached` SubFilter. Set `PDF_SIGNATURE_SUBFILTER=adobe` only for legacy `adbe.pkcs7.detached` compatibility.
5. The CMS `SignedData` covers the PDF `ByteRange`, meaning verification can detect changes to signed PDF bytes.

The CMS signing model follows RFC 5652. The certificate chain and revocation model follow RFC 5280. PAdES PDF signature structure follows ETSI EN 319 142-1.

### RFC3161 Timestamping

Timestamping is optional unless explicitly required.

1. Configure a timestamp server URL in account e-signature settings.
2. Signa validates the timestamp server before saving it.
3. During completed PDF generation, Signa requests an RFC3161 timestamp token after PAdES signing and DSS/VRI evidence embedding.
4. If successful, Signa appends a final `/DocTimeStamp` signature dictionary with `/SubFilter /ETSI.RFC3161`, so the timestamp covers the signed PDF plus embedded validation evidence.
5. Timestamp metadata is stored with the completed document.
6. If `PDF_TIMESTAMP_REQUIRED=true`, signing fails when timestamp evidence cannot be embedded.

This allows deployments with stricter evidence requirements to fail closed while keeping normal self-hosted signing usable without a TSA.

### LTV, OCSP, CRL, DSS, and VRI

Long-term validation is optional unless `PDF_LTV_REQUIRED=true`.

During signing, Signa attempts to collect revocation evidence for signer certificates:

1. Parse the CMS signer certificate chain.
2. For Signa autogenerated self-hosted certificates, generate issuer-signed internal CRL evidence and treat the certificate as good when it is absent from the empty CRL.
3. For uploaded/external certificates, read Authority Information Access extensions for OCSP URLs.
4. Read CRL Distribution Point extensions for CRL URLs.
5. Request OCSP evidence first.
6. Fall back to CRL evidence when OCSP is unavailable.
7. Store raw OCSP/CRL bytes in `pdf_revocation_evidence`, keyed by certificate hash, issuer, serial number, and evidence type.
8. Append a PDF DSS/VRI update after signing without rewriting already signed bytes.

The completed PDF signing order is:

```text
visual stamping -> PAdES CMS signature -> DSS/VRI evidence append -> optional RFC3161 DocTimeStamp
```

The DSS/VRI append is a low-level incremental PDF update:

- `/DSS` is added to the PDF catalog.
- `/Certs` stores DER certificate streams.
- `/OCSPs` stores OCSP response streams.
- `/CRLs` stores CRL streams.
- `/VRI` links the exact signature hash to the evidence streams.
- The update writes a new xref/trailer with `/Prev`, preserving the original signed byte ranges.

Evidence status is explicit:

- `good`: revocation evidence validates and does not report revocation.
- `revoked`: evidence reports the signer certificate as revoked.
- `unknown`: evidence exists but cannot be fully classified.
- `unavailable`: revocation endpoints could not be reached.
- `missing`: no usable OCSP/CRL evidence was available.

If `PDF_LTV_REQUIRED=false`, signing continues when evidence is unavailable and the result records `ltv_status=missing`. If `PDF_LTV_REQUIRED=true`, signing fails unless good revocation evidence can be collected and embedded. Signa autogenerated certificates satisfy this requirement through their issuer-signed internal CRL evidence.

### Verification API Flow

`POST /api/tools/verify` accepts a PDF upload and returns checksum, signature, certificate, timestamp, revocation, and LTV status.

Verification performs these checks:

1. Parse the PDF and detect signature dictionaries.
2. Validate the signature `ByteRange` shape and compute the signed byte-range SHA-256.
3. Compare the full PDF SHA-256 against completed Signa documents and generated artifact metadata.
4. Parse CMS `SignedData` from the PDF `/Contents`.
5. Validate the CMS signed `messageDigest` against the PDF `ByteRange` bytes.
6. Verify the CMS signature over signed attributes.
7. Extract signer certificates and classify the chain as trusted, external, expired, invalid, or missing. Trust anchors include the generated Signa root and any account-uploaded root CA certificates from E-Signature settings.
8. Detect PAdES SubFilter compatibility.
9. Detect RFC3161 `/DocTimeStamp` signatures.
10. Read `/DSS` and `/VRI`.
11. Match the VRI entry to the exact CMS signature hash.
12. Parse embedded DER certificates, OCSP responses, and CRLs.
13. Validate OCSP/CRL signatures and certificate revocation status where evidence is present.
14. Return `ltv_status` as `valid`, `missing`, or `invalid`.

DocuSeal-style verification output includes:

- checksum status,
- signature validity,
- trusted or external certificate status,
- certificate chain,
- matched trust anchor and certificate policy errors,
- signer name,
- signing reason,
- signing time,
- PAdES SubFilter status,
- timestamp-signature presence,
- revocation evidence status,
- LTV status.

### Current Validation Boundaries

Implemented:

- RFC 5652 CMS `SignedData` parsing and verification with PKI.js.
- RFC 5280 certificate extraction, CA/basic-constraints checks, validity-window checks, and chain classification against Signa plus account-uploaded trust roots.
- RFC 6960 OCSP request/response parsing and status checks where certificate endpoints exist.
- CRL parsing and revoked-certificate checks.
- Issuer-signed internal CRL evidence for Signa autogenerated self-hosted certificates.
- PAdES `ETSI.CAdES.detached` SubFilter signing.
- RFC3161 document timestamp append after DSS/VRI embedding.
- Incremental DSS/VRI embedding that preserves signed bytes.
- Verifier-side DSS/VRI matching and evidence validation.

Still tracked as hardening work:

- Optional pre-signing PDF/A conversion through Ghostscript and optional veraPDF validation. This is disabled by default and fails open unless `PDF_A_REQUIRED=true`.
- More exhaustive OCSP responder-chain validation.
- Full HexaPDF/PDFium-grade flattening for every PDF edge case.

### PDF/A Conversion Boundary

PDF/A compliance is handled before cryptographic signing:

```text
visual stamping -> optional PDF/A conversion/validation -> PAdES CMS signature -> DSS/VRI evidence append -> optional RFC3161 DocTimeStamp
```

This order is intentional. PDF/A conversion rewrites PDF structure, so it must happen before the final PAdES signature. Signa records conversion and validation metadata on completed-document artifacts. If Ghostscript or veraPDF is not installed and `PDF_A_REQUIRED=false`, signing continues with `conversionStatus=unavailable`; regulated deployments should install those binaries and set `PDF_A_REQUIRED=true`.

References:

- RFC 5652, Cryptographic Message Syntax: `https://www.rfc-editor.org/rfc/rfc5652`
- RFC 5280, X.509 PKI certificate and CRL profile: `https://www.rfc-editor.org/rfc/rfc5280`
- RFC 6960, Online Certificate Status Protocol: `https://www.rfc-editor.org/rfc/rfc6960`
- RFC 3161, Time-Stamp Protocol: `https://www.rfc-editor.org/rfc/rfc3161`
- ETSI EN 319 142-1, PAdES PDF Advanced Electronic Signatures: `https://www.etsi.org/deliver/etsi_en/319100_319199/31914201/`

### Health Env Vars

| Variable                                 | Required | Default  | Description                                         |
| ---------------------------------------- | -------- | -------- | --------------------------------------------------- |
| `HEALTH_HEAP_LIMIT_MB`                   | No       | `512`    | Heap warning threshold.                             |
| `HEALTH_REDIS_REQUIRED`                  | No       | `false`  | Marks health unhealthy when Redis is unavailable.   |
| `HEALTH_REDIS_TIMEOUT_MS`                | No       | `1000`   | Redis health timeout.                               |
| `API_HEALTH_WINDOW_MS`                   | No       | `300000` | Runtime observability window.                       |
| `API_SLOW_REQUEST_WARN_MS`               | No       | `1000`   | Slow request warning threshold.                     |
| `API_HEALTH_P95_DEGRADED_MS`             | No       | `1000`   | Degraded p95 threshold.                             |
| `API_HEALTH_ERROR_RATE_DEGRADED_PERCENT` | No       | `5`      | Degraded error-rate threshold.                      |
| `API_HEALTH_MIN_REQUEST_COUNT`           | No       | `20`     | Minimum requests before degraded error-rate checks. |

### Frontend Build-Time Env Vars

These are read when `next build` runs. Rebuild the Docker image after changing them.

| Variable                             | Required | Default                            | Description                                                                                                                  |
| ------------------------------------ | -------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL`           | No       | empty                              | Empty uses same-origin `/api` and is recommended. Set only when the API is intentionally hosted on a separate public origin. |
| `NEXT_PUBLIC_MARKETING_URL`          | No       | `http://localhost:3002`            | Standalone marketing and documentation origin used by legacy product redirects.                                             |
| `NEXT_PUBLIC_SIGNING_BASE_URL`       | No       | `http://localhost:3000` in Compose | Public signing-page origin, useful for QR signing links.                                                                     |
| `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` | Optional | empty                              | Browser Google OAuth client ID.                                                                                              |
| `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`  | Optional | empty                              | Google Picker API key.                                                                                                       |
| `NEXT_PUBLIC_GOOGLE_PICKER_APP_ID`   | Optional | empty                              | Google Picker app ID.                                                                                                        |
| `NEXT_OUTPUT`                        | Optional | empty                              | Set to `export` only for static export experiments. Do not use for the full app.                                             |

### Marketing Site

`apps/marketing` is a separate full-stack Next.js application. It is intended
for Vercel deployment and does not ship in the on-prem Signa runtime. Run it
locally with:

Production URL: [https://signa-docs.vercel.app](https://signa-docs.vercel.app)

```bash
cp apps/marketing/.env.example apps/marketing/.env.local
pnpm dev:marketing
```

The marketing workspace uses Supabase for newsletter subscriptions and future
licensing records:

| Variable                               | Required | Description                                                                                   |
| -------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `VERCEL_PROJECT_PRODUCTION_URL`        | Vercel   | System-provided production domain used as the canonical marketing and documentation origin on Vercel.                    |
| `NEXT_PUBLIC_MARKETING_URL`            | Fallback | Public origin used locally and on non-Vercel deployments. Use `https://signa-docs.vercel.app` in production.              |
| `NEXT_PUBLIC_APP_URL`                  | Yes      | Product application origin used by sign-in and console links.                                 |
| `SUPABASE_URL`                         | Newsletter | Server-side Supabase project URL for marketing data.                                        |
| `SUPABASE_SECRET_KEY`                  | Newsletter | Server-only secret used by the newsletter Route Handler. Never expose this value to browsers. |

Newsletter schema changes live in `apps/marketing/supabase/migrations`. The
subscriber table enables RLS and grants no public table access; only the
validated server Route Handler writes with the secret key. These variables are
not required to compile the static site; missing runtime configuration makes
newsletter requests return a temporary-unavailable response.

Documentation helpfulness responses use the same protected server integration
and the `docs_page_feedback` migration. The docs footer derives previous and
next destinations from the shared sidebar navigation, preserves each browser's
vote per page, and lets readers revise their response.

The same deployment publishes the indexable `/alternatives` comparison hub and
focused DocuSeal, Docusign, PandaDoc, Adobe Acrobat Sign, Dropbox Sign, and
SignNow comparison routes. Vercel uses `VERCEL_PROJECT_PRODUCTION_URL`; other
deployments use `NEXT_PUBLIC_MARKETING_URL`. Keep that canonical origin aligned
with the public domain so canonical tags, JSON-LD, Open Graph URLs, robots host,
and sitemap entries remain consistent.

## Direct Docker Run

The default container includes its private single-node Redis runtime, so mail,
webhooks, SMS, and document queues work with the same one-container command:

```bash
docker build -t signa .
docker run --name signa \
  -p 3000:3000 \
  -v signa-data:/data \
  signa
```

For a public host:

```bash
docker run --name signa \
  -p 3000:3000 \
  -e APP_URL=https://signa.example.com \
  -v signa-data:/data \
  signa
```

For multi-instance deployment, set `DATABASE_URL`, `REDIS_URL`, and S3
variables so every application container is disposable and shares the same
database, queue, and object store.

## Production Build Without Docker

```bash
pnpm install
pnpm build
NODE_ENV=production \
APP_URL=https://signa.example.com \
DATABASE_URL=postgresql://signa:password@database.example.com:5432/signa \
JWT_SECRET=replace-with-at-least-32-random-characters \
pnpm start:backend:prod

INTERNAL_API_URL=http://127.0.0.1:3001 pnpm start:frontend
```

For production without Docker, run Redis separately and set
`QUEUE_ENABLED=true` plus `REDIS_URL`. The frontend exposes the public
same-origin `/api` route and proxies it to `INTERNAL_API_URL`, so browsers do
not need direct access to backend port `3001`.
