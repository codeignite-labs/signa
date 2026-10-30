import React from "react";
import { vi } from "vitest";
export const injectJavaScript = vi.fn();
export let webViewProps: Record<string, any>;
export const WebView = React.forwardRef(function WebView(
  props: Record<string, any>,
  ref,
) {
  webViewProps = props;
  React.useImperativeHandle(ref, () => ({ injectJavaScript }));
  return <div data-testid="webview">{props.renderLoading()}</div>;
});
