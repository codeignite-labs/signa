import React from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SignaSigningView } from "../../packages/signa-react-native/src/index";
import { buildSignaSigningUrl } from "../../packages/signa-react-native/src/signa-url";
import { dispatchSignaMessage } from "../../packages/signa-react-native/src/signa-message";
import { injectJavaScript, webViewProps } from "./native-webview";
import { setColorScheme } from "./native-platform";

beforeEach(() => {
  injectJavaScript.mockClear();
  setColorScheme("light");
});
it("preserves WebView source across theme changes, handles ready and load races", () => {
  const view = render(<SignaSigningView src="https://sign.example/s/id" />);
  const initialSource = webViewProps.source;
  expect(initialSource.uri).not.toContain("theme=");
  expect(webViewProps.cacheEnabled).toBe(true);
  view.rerender(
    <SignaSigningView
      src="https://sign.example/s/id"
      theme="dark"
      primaryColor="#123456"
    />,
  );
  expect(webViewProps.source).toBe(initialSource);
  expect(injectJavaScript).toHaveBeenLastCalledWith(
    expect.stringContaining('"theme":"dark"'),
  );
  act(() =>
    webViewProps.onMessage({
      nativeEvent: { data: '{"type":"signa:appearance-ready"}' },
    }),
  );
  act(() => webViewProps.onLoadEnd());
  expect(injectJavaScript.mock.calls.length).toBeGreaterThanOrEqual(3);
  view.rerender(
    <SignaSigningView src="https://sign.example/s/other" theme="system" />,
  );
  expect(webViewProps.source.uri).toContain("/s/other");
  expect(webViewProps.source.uri).toContain("theme=light");
  setColorScheme("dark");
  view.rerender(
    <SignaSigningView src="https://sign.example/s/other" theme="system" />,
  );
  expect(injectJavaScript).toHaveBeenLastCalledWith(
    expect.stringContaining('"theme":"dark"'),
  );
});
it("passes configurable WebView defaults, errors, loading text and lifecycle callbacks", () => {
  const handlers = {
    onLoad: vi.fn(),
    onComplete: vi.fn(),
    onDecline: vi.fn(),
    onError: vi.fn(),
    onMessage: vi.fn(),
  };
  const view = render(
    <SignaSigningView
      host="https://sign.example"
      slug="id"
      {...handlers}
      loadingLabel="Preparing"
      showsLoadingIndicator={false}
      javaScriptEnabled={false}
      domStorageEnabled={false}
      allowsInlineMediaPlayback={false}
      mixedContentMode="never"
      originWhitelist={["https://sign.example"]}
    />,
  );
  expect(view.getByText("Preparing")).toBeTruthy();
  for (const key of [
    "startInLoadingState",
    "javaScriptEnabled",
    "domStorageEnabled",
    "allowsInlineMediaPlayback",
  ])
    expect(webViewProps[key]).toBe(false);
  expect(webViewProps.mixedContentMode).toBe("never");
  expect(webViewProps.originWhitelist).toEqual(["https://sign.example"]);
  for (const [type, callback] of [
    ["loaded", "onLoad"],
    ["completed", "onComplete"],
    ["declined", "onDecline"],
    ["error", "onError"],
  ]) {
    act(() =>
      webViewProps.onMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: `signa:${type}`,
            payload: { message: "detail" },
          }),
        },
      }),
    );
    expect(handlers[callback]).toHaveBeenCalledOnce();
  }
  act(() => webViewProps.onMessage({ nativeEvent: { data: "bad json" } }));
  act(() => webViewProps.onHttpError({ nativeEvent: { statusCode: 503 } }));
  act(() => webViewProps.onError({ nativeEvent: { description: "offline" } }));
  expect(handlers.onError).toHaveBeenLastCalledWith({
    code: "webview_load_failed",
    message: "offline",
  });
  expect(handlers.onMessage).toHaveBeenCalledTimes(4);
});
it("works without handlers, including error events and unknown messages", () => {
  render(<SignaSigningView src="https://sign.example/s/id" theme="dark" />);
  for (const type of ["loaded", "completed", "declined", "error", "other"])
    act(() =>
      webViewProps.onMessage({
        nativeEvent: { data: JSON.stringify({ type: `signa:${type}` }) },
      }),
    );
  act(() => webViewProps.onError({ nativeEvent: {} }));
  act(() => webViewProps.onHttpError({ nativeEvent: { statusCode: 404 } }));
  expect(webViewProps.originWhitelist).toEqual(["https://*", "http://*"]);
});
it("validates URLs, preserves optional fields and both boolean values", () => {
  expect(() => buildSignaSigningUrl({})).toThrow(/requires/);
  expect(() => buildSignaSigningUrl({ src: "javascript:alert(1)" })).toThrow(
    /HTTP/,
  );
  for (const value of [false, true]) {
    const url = new URL(
      buildSignaSigningUrl({
        host: "https://sign.example///",
        slug: "id",
        token: "secret",
        preview: value,
        dryRun: value,
        expand: value,
        minimize: value,
        language: "fr",
        email: "x@example.test",
        name: "A B",
        role: "Signer",
        externalId: "42",
        primaryColor: "#AbC",
        theme: "system",
      }),
    );
    expect(url.searchParams.get("preview")).toBe(String(value));
    expect(url.searchParams.get("dry_run")).toBe(String(value));
    expect(url.searchParams.get("name")).toBe("A B");
    expect(url.searchParams.get("external_id")).toBe("42");
    expect(url.searchParams.get("primary-color")).toBe("#AbC");
  }
  expect(
    buildSignaSigningUrl({
      src: "https://sign.example",
      primaryColor: "invalid",
    }),
  ).not.toContain("primary-color");
});
it("rejects malformed messages and normalizes error payloads", () => {
  const onError = vi.fn();
  for (const raw of [
    "bad",
    "null",
    "1",
    "{}",
    '{"type":1}',
    '{"type":"other"}',
  ])
    dispatchSignaMessage(raw, { onError });
  expect(onError).not.toHaveBeenCalled();
  for (const payload of [null, "offline", {}, { message: 4 }]) {
    dispatchSignaMessage(JSON.stringify({ type: "signa:error", payload }), {
      onError,
    });
    expect(onError).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.any(String),
        details: payload,
      }),
    );
  }
  dispatchSignaMessage(
    '{"type":"signa:error","payload":{"message":"offline"}}',
    { onError },
  );
  expect(onError).toHaveBeenLastCalledWith({ message: "offline" });
});
