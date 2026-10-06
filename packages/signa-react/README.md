# @signajs/react

React components for embedding Signa signing forms and template builder workflows.

The API intentionally mirrors `@docuseal/react` so existing DocuSeal-style embeds can migrate with minimal changes. The components load Signa browser custom elements from your Signa host and pass configuration through `data-*` attributes.

See the [Signa embedding guide](https://signa-docs.vercel.app/docs/embedding)
for browser integration patterns and hosted-flow guidance.

## Install

```bash
npm install @signajs/react
```

```bash
pnpm add @signajs/react
```

The package expects a running Signa instance because it embeds the hosted Signa browser custom elements from `/js/form.js` and `/js/builder.js`.

For local development against this monorepo:

```bash
pnpm install
pnpm dev
```

Then point the React package at the local frontend host:

```tsx
<SignaForm host="http://localhost:3000" src="http://localhost:3000/s/submitter-slug" />
```

## Signing Form

```tsx
import { SignaForm } from "@signajs/react";

export function ContractSigning() {
  return (
    <SignaForm
      host="https://signa.example.com"
      src="https://signa.example.com/s/submitter-slug"
      withDownloadButton
      withSendCopyButton
      onComplete={(data) => {
        console.log("completed", data);
      }}
    />
  );
}
```

DocuSeal-compatible aliases are also exported:

```tsx
import { DocusealForm } from "@signajs/react";
```

### Signing Form Props

`SignaForm` mirrors `@docuseal/react` and supports the same public prop contract:

| Prop | Description |
| --- | --- |
| `src` | Public signing URL, usually `https://signa.example.com/s/{submitterSlug}` or `https://signa.example.com/d/{templateSlug}`. |
| `token` | Signed embed token where supported by the host. |
| `host` | Signa app origin used for self-hosted script loading and relative iframe URLs. When omitted, the package loads the custom element script from jsDelivr. |
| `scriptUrl` | Exact custom element script URL. Use this to pin a CDN version or point at a private CDN. |
| `email`, `name`, `role`, `submitter`, `externalId`, `applicationKey` | Submitter identity and routing values. |
| `preview`, `dryRun`, `expand`, `minimize`, `orderAsOnPage` | Display and flow options. |
| `backgroundColor`, `logo`, `language`, `completedMessage`, `completedRedirectUrl`, `completedButton` | Branding, locale, and completion controls. |
| `goToLast`, `skipFields`, `autoscrollFields`, `onlyRequiredFields` | Navigation and field traversal controls. |
| `withTitle`, `withDecline`, `withFieldNames`, `withFieldPlaceholder`, `withDownloadButton`, `withSendCopyButton`, `withCompleteButton` | Signing UI toggles. |
| `allowToResubmit`, `allowTypedSignature`, `rememberSignature`, `reuseSignature` | Signer behavior toggles. |
| `signature`, `values`, `metadata`, `fields`, `readonlyFields`, `i18n` | Saved signature, prefilled values, field schema overrides, and runtime configuration. |
| `className`, `customCss`, `style` | Host application styling hooks. |
| `onInit`, `onLoad`, `onComplete`, `onDecline` | Lifecycle callbacks. |

### Signing callbacks

| Callback | When it fires | Typical use |
| --- | --- | --- |
| `onInit` | The custom element is initialized. | Start loading state and analytics. |
| `onLoad` | The hosted signing UI has loaded. | Hide skeletons and show the signing area. |
| `onComplete` | The signer completes or the submission reaches completion. | Update local state, navigate, or fetch completed documents from your backend. |
| `onDecline` | The signer declines. | Record the decline and route the user back to your workflow. |

## Template Builder

```tsx
import { SignaBuilder } from "@signajs/react";

export function EmbeddedBuilder() {
  return (
    <SignaBuilder
      host="https://signa.example.com"
      token="builder-token"
      onSave={(template) => {
        console.log("saved", template);
      }}
    />
  );
}
```

### Template Builder Props

`SignaBuilder` follows the same prop shape as `@docuseal/react`:

| Prop | Description |
| --- | --- |
| `token` | Builder token for the hosted Signa builder flow. |
| `host` | Signa app origin used for self-hosted script loading and relative iframe URLs. When omitted, the package loads the custom element script from jsDelivr. |
| `scriptUrl` | Exact custom element script URL. Use this to pin a CDN version or point at a private CDN. |
| `withRecipientsButton`, `withSendButton`, `withTitle`, `withDocumentsList`, `withFieldsList` | Builder UI toggles. |
| `withDynamicDocuments`, `withFieldsDetection`, `withFieldPlaceholder`, `withPrefillable`, `withCustomFieldsTab`, `onlyDefinedFields` | Field and document-management options. |
| `preview`, `previewMode`, `inputMode`, `language`, `autosave` | Builder mode, locale, preview, and persistence options. |
| `roles`, `fieldTypes`, `drawFieldType`, `fields`, `submitters`, `requiredFields`, `dateFormats` | Builder defaults and constraints. |
| `withSignYourselfButton`, `withUploadButton`, `withSignatureId`, `withRevisions`, `withAddPageButton` | Advanced builder feature toggles. |
| `customButton`, `emailMessage`, `backgroundColor`, `saveButtonText`, `sendButtonText`, `customCss` | Presentation and copy controls. |
| `className`, `style` | Host application styling hooks. |
| `onLoad`, `onUpload`, `onSend`, `onSave`, `onChange` | Builder lifecycle callbacks. |

### Builder callbacks

| Callback | When it fires | Typical use |
| --- | --- | --- |
| `onLoad` | The hosted builder has loaded. | Hide loading state. |
| `onUpload` | A document is uploaded into the builder. | Track onboarding progress or update surrounding UI. |
| `onChange` | Fields, roles, documents, or settings change. | Autosave external drafts or mark the parent form dirty. |
| `onSave` | The template is saved. | Persist the returned template id in your application. |
| `onSend` | Recipients are sent from the embedded builder. | Navigate to a completion screen or refresh submission lists. |

## Backend setup checklist

| Step | What to do |
| --- | --- |
| Create a template | Use the Signa console or `POST /api/templates/pdf` / `POST /api/templates/docx`. |
| Create a submission | Use `POST /api/submissions` with `template_id`, `submitters`, and optional `metadata` / `external_id`. |
| Embed the signer | Pass the returned submitter `url` to `SignaForm.src`. |
| Listen for completion | Configure `submission.completed` and `form.completed` webhooks in Settings > Webhooks. |
| Download output | Use the completed submission document endpoint from your backend. |

## Runtime Scripts

By default the package loads the custom-element scripts from the npm package through jsDelivr:

- `https://cdn.jsdelivr.net/npm/@signajs/react@latest/dist/form.js`
- `https://cdn.jsdelivr.net/npm/@signajs/react@latest/dist/builder.js`

These files are included in the published npm tarball. You can confirm them locally with:

```bash
pnpm pack:signa-react
```

The tarball must include:

```text
dist/form.js
dist/builder.js
```

For production, prefer pinning the CDN URL to an exact package version:

```tsx
<SignaForm
  scriptUrl="https://cdn.jsdelivr.net/npm/@signajs/react@0.1.4/dist/form.js"
  src="https://signa.company.com/s/abc123"
/>
```

The same files are also available from unpkg after publish:

```text
https://unpkg.com/@signajs/react@0.1.4/dist/form.js
https://unpkg.com/@signajs/react@0.1.4/dist/builder.js
```

For self-hosted deployments, pass your Signa frontend origin through `host`.
The origin must serve the bundled browser custom element scripts from:

- `/js/form.js`
- `/js/builder.js`

Example:

```tsx
<SignaForm host="signa.company.com" src="https://signa.company.com/s/abc123" />
```

When `host` includes a scheme, it is used directly. This is useful for local development:

```tsx
<SignaForm host="http://localhost:3000" src="http://localhost:3000/s/abc123" />
```

If you want to use your own CDN instead of npm CDN, upload these package build outputs:

- `packages/signa-react/dist/form.js`
- `packages/signa-react/dist/builder.js`

The CDN should preserve the same paths, for example:

- `https://cdn.company.com/js/form.js`
- `https://cdn.company.com/js/builder.js`

Then pass the exact script URL:

```tsx
<SignaForm
  scriptUrl="https://cdn.company.com/js/form.js"
  src="https://signa.company.com/s/abc123"
/>
```

For builder embeds that use relative template routes, pass `host` as the Signa app origin and `scriptUrl` as the CDN script:

```tsx
<SignaBuilder
  host="https://signa.company.com"
  scriptUrl="https://cdn.company.com/js/builder.js"
  token="123"
/>
```

That separation keeps the JavaScript file cacheable on the CDN while the iframe still opens the correct Signa app URL.

## Events

The wrapper listens for the same custom events as DocuSeal:

- form: `completed`, `init`, `declined`, `load`
- builder: `send`, `load`, `upload`, `save`, `change`

Callbacks receive the event `detail` payload emitted by the hosted Signa custom element.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| The iframe says the host refused to connect. | Use a Signa host that allows embedding for your application origin and pass the same origin through `host` / `src`. |
| Localhost works in web but not mobile. | Use your machine LAN IP or a tunnel; mobile simulators cannot always reach `localhost` on your laptop. |
| The script fails to load from CDN. | Pin `scriptUrl` to a published package version or serve `/js/form.js` from your Signa frontend. |
| Callbacks do not fire. | Confirm the hosted Signa version emits `completed`, `init`, `declined`, `load`, `send`, `upload`, `save`, and `change` custom events. |
| TypeScript cannot find declarations. | Build or install the published package; declarations are emitted into `dist/*.d.ts`. |

## Development

From the repository root:

```bash
pnpm --filter @signajs/react typecheck
pnpm --filter @signajs/react build
pnpm pack:signa-react
```

The build emits:

- `dist/index.js`: ESM bundle
- `dist/index.cjs`: CommonJS bundle
- `dist/*.d.ts`: TypeScript declarations

The package intentionally keeps `react` as a peer dependency so applications control their React version.

## Publishing to npm

1. Confirm the package name and npm scope are available. The current package name is `@signajs/react`; publishing this requires access to the `signajs` npm organization or scope.

2. Authenticate with npm:

```bash
npm login
```

3. Run the package checks:

```bash
pnpm --filter @signajs/react typecheck
pnpm --filter @signajs/react build
pnpm --filter @signajs/react pack --dry-run
```

4. Create a Changeset from the repo root. Use the semver level that matches the change:

```bash
pnpm changeset
```

Use `minor` for backward-compatible features and `major` for breaking API changes.

5. Prepare the release version and changelog:

```bash
pnpm version:packages
pnpm --filter @signajs/react typecheck
pnpm --filter @signajs/react build
pnpm pack:signa-react
```

Commit the generated version/changelog changes, then merge them through the normal review flow.

6. Publish the package:

```bash
pnpm release:packages
```

7. Verify the published package:

```bash
npm view @signajs/react version
```

8. Tag the release in git after the publish succeeds:

```bash
git tag signa-react-v$(node -p "require('./packages/signa-react/package.json').version")
git push origin --tags
```

For CI, use npm trusted publishing with provenance instead of long-lived npm tokens where possible.

If the `@signajs` scope is unavailable, rename `name` in `packages/signa-react/package.json` before publishing, for example to `signa-react`, then rerun the checks and publish without `--access public` unless the target package is scoped.

## Organization branding and host themes

The hosted signing page loads the document owner's saved logo, business title and
primary color automatically. The embedding app does not need to copy that data.

Set `theme="light"`, `theme="dark"`, or `theme="system"` to control appearance.
An optional `primaryColor="#7c3aed"` overrides the accent for this view only; Signa
still derives readable text/control colors. It does not update the organization's
saved branding or change the logo/title. Omit the props to use organization defaults.
Live theme changes use the appearance bridge and preserve unsaved fields.

```tsx
<SignaForm
  src="https://signa.example.com/s/submitter-slug"
  host="https://signa.example.com"
  theme="dark"
  primaryColor="#7c3aed"
/>
```

When `host` is supplied and `scriptUrl` is omitted, the component loads the matching
self-hosted `/js/form.js` rather than the CDN build. Explicit `scriptUrl` still wins.
Deploy the updated hosted frontend together with the SDK for the appearance bridge.
