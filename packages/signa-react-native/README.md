# @signajs/react-native

React Native components for embedding Signa signing flows in mobile apps.

The package uses `react-native-webview` and keeps the signing UI hosted by
Signa. This mirrors the web embed security model while giving native apps typed
completion, decline, load, and error callbacks.

See the [Signa embedding guide](https://signa-docs.vercel.app/docs/embedding)
for supported surfaces and hosted-flow guidance.

## Installation

```sh
pnpm add @signajs/react-native react-native-webview
```

For Expo projects, install the WebView peer through Expo so the native version
matches your SDK:

```sh
npx expo install react-native-webview
pnpm add @signajs/react-native
```

For bare React Native apps, install pods after adding the dependency:

```sh
cd ios
pod install
```

## Basic Usage

```tsx
import { SignaSigningView } from "@signajs/react-native";

export function ContractSigningScreen() {
  return (
    <SignaSigningView
      src="https://signa.example.com/s/submitter-slug"
      onComplete={(submitter) => {
        console.log("Completed", submitter.id);
      }}
      onDecline={(submitter) => {
        console.log("Declined", submitter.id);
      }}
      onError={(error) => {
        console.warn(error.message);
      }}
    />
  );
}
```

## Host + Slug Usage

```tsx
<SignaSigningView
  host="https://signa.example.com"
  slug="submitter-slug"
  token="optional-signed-embed-token"
/>
```

## Props

| Prop | Description |
| --- | --- |
| `src` | Full public signing URL, usually `https://signa.example.com/s/{submitterSlug}`. |
| `host` | Signa host used with `slug` when `src` is not provided. |
| `slug` | Submitter slug used with `host` to build `/s/{slug}`. |
| `token` | Optional signed embed token where supported by the host. |
| `preview`, `dryRun`, `expand`, `minimize` | Signing display and flow options passed as query params. |
| `language`, `email`, `name`, `role`, `externalId` | Signer identity, locale, and routing values passed as query params. |
| `style`, `webViewStyle` | Container and WebView style overrides. |
| `showsLoadingIndicator` | Enables the built-in loading state. Defaults to `true`. |
| `allowsInlineMediaPlayback` | Passed to `WebView`. Defaults to `true`. |
| `mixedContentMode` | Passed to Android WebView. Defaults to `compatibility`. |
| `javaScriptEnabled`, `domStorageEnabled` | Required WebView features. Both default to `true`. |
| `originWhitelist` | WebView origin whitelist. Defaults to `["https://*", "http://*"]`. |
| `onLoad` | Called when Signa posts `signa:loaded`. |
| `onComplete` | Called when Signa posts `signa:completed`. |
| `onDecline` | Called when Signa posts `signa:declined`. |
| `onError` | Called when Signa posts `signa:error`. |
| `onMessage` | Receives every validated `signa:*` message. |

## Native signing flow

| Step | What happens |
| --- | --- |
| Create a submission | Your backend calls Signa and receives a submitter signing URL or slug. |
| Open the WebView | Your app renders `SignaSigningView` with `src` or `host` plus `slug`. |
| Signer completes fields | The hosted Signa UI handles PDF rendering, field validation, signatures, and completion. |
| Native callback fires | The page posts `signa:completed`, `signa:declined`, `signa:loaded`, or `signa:error` to React Native. |
| App continues workflow | Navigate back, refresh your backend state, or show the completed-document action. |

## Mobile App Permissions

If signers need to upload files, images, or use camera-backed fields, configure
the host app permissions:

- iOS: camera, photo library, and document picker usage descriptions.
- Android: camera and media/document permissions appropriate for your target SDK.

For local development, do not use `localhost` inside a simulator or device
unless it resolves to the Signa server from that environment. Use a LAN IP,
reverse proxy, or tunnel:

```tsx
<SignaSigningView
  src="http://192.168.100.30:3000/s/submitter-slug"
/>
```

## Signa Host Requirements

The Signa signing page should post lifecycle events when loaded inside a React
Native WebView:

```js
window.ReactNativeWebView?.postMessage(
  JSON.stringify({ type: "signa:completed", payload: submitter }),
);
```

The web signing page already remains usable inside a WebView. These postMessage
events are the native bridge that lets the app react without polling.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| The WebView is blank. | Open the same `src` in the mobile browser, confirm the route is public, and check TLS/certificate trust. |
| Android cannot load local Signa. | Use your machine LAN IP or `10.0.2.2` for Android emulator networking where applicable. |
| File upload does not open. | Configure native camera, photo, and document permissions in the host app. |
| Completion callback does not fire. | Confirm the deployed Signa signing page includes the React Native postMessage bridge. |
| The host refuses to render. | Configure Signa embed/frame policy for the application origin or use the hosted public signing route. |

## Development and release

From the repository root:

```sh
pnpm --filter @signajs/react-native typecheck
pnpm --filter @signajs/react-native build
pnpm --filter @signajs/react-native pack --dry-run
```

Publish through the monorepo Changesets flow:

```sh
pnpm changeset
pnpm version:packages
pnpm release:packages
```

## Organization branding and host themes

The hosted signing page loads the document owner's saved logo, business title and
primary color automatically. The embedding app does not need to copy that data.

Set `theme="light"`, `theme="dark"`, or `theme="system"` to control appearance.
An optional `primaryColor="#7c3aed"` overrides the accent for this view only; Signa
still derives readable text/control colors. It does not update the organization's
saved branding or change the logo/title. Omit the props to use organization defaults.
Live theme changes use the appearance bridge and preserve unsaved fields.

```tsx
<SignaSigningView
  src="https://signa.example.com/s/submitter-slug"
  theme={colorScheme === "dark" ? "dark" : "light"}
  primaryColor="#7c3aed"
  loadingLabel="Loading your document…"
  onError={(error) => reportSigningError(error)}
/>
```

The native loader follows the requested mode. `theme="system"` follows the native
system appearance. WebView HTTP/load failures now reach `onError`. Keep the view
mounted while editing; a changed signing URL intentionally starts a new document.
Use HTTPS for production. Benchmark on physical Android/iOS devices with a release
build and the production Signa URL; a desktop mobile viewport cannot reproduce
WebView startup, keyboard behavior or device performance.
