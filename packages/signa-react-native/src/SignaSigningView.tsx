import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import type {
  SignaErrorPayload,
  SignaLoadPayload,
  SignaNativeMessage,
  SignaSubmitterPayload,
} from "./signa-events";
import { dispatchSignaMessage } from "./signa-message";
import {
  buildSignaSigningUrl,
  type SignaSigningUrlOptions,
} from "./signa-url";

export type SignaSigningViewProps = {
  src?: string;
  host?: string;
  slug?: string;
  token?: string;
  preview?: boolean;
  dryRun?: boolean;
  expand?: boolean;
  minimize?: boolean;
  language?: string;
  email?: string;
  name?: string;
  role?: string;
  externalId?: string;
  theme?: "light" | "dark" | "system";
  primaryColor?: string;
  loadingLabel?: string;
  style?: StyleProp<ViewStyle>;
  webViewStyle?: StyleProp<ViewStyle>;
  showsLoadingIndicator?: boolean;
  allowsInlineMediaPlayback?: boolean;
  mixedContentMode?: "always" | "never" | "compatibility";
  javaScriptEnabled?: boolean;
  domStorageEnabled?: boolean;
  originWhitelist?: string[];
  onLoad?: (payload: SignaLoadPayload) => void;
  onComplete?: (payload: SignaSubmitterPayload) => void;
  onDecline?: (payload: SignaSubmitterPayload) => void;
  onError?: (payload: SignaErrorPayload) => void;
  onMessage?: (message: SignaNativeMessage) => void;
};

export function SignaSigningView(
  props: SignaSigningViewProps,
): React.ReactElement {
  const signingUrl = useSignaSigningUrl(props);
  const handleMessage = useSignaMessageHandler(props);
  const webViewProps = getWebViewDefaults(props);
  const webView = React.useRef<WebView<object>>(null);
  const systemTheme = useColorScheme();
  const theme = props.theme === "system" ? systemTheme === "dark" ? "dark" : "light" : props.theme;
  const appearance = { theme, primaryColor: props.primaryColor };
  const appearanceRef = React.useRef(appearance);
  appearanceRef.current = appearance;
  // Appearance changes use the bridge, preserving the document and unsaved fields.
  const source = React.useMemo(() => ({ uri: buildSignaSigningUrl({ src: signingUrl, ...appearanceRef.current }) }), [signingUrl]);
  const updateAppearance = React.useCallback(() => {
    webView.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('signa:appearance',{detail:${JSON.stringify(appearanceRef.current)}}));true;`);
  }, []);
  React.useEffect(updateAppearance, [theme, props.primaryColor, updateAppearance]);
  const backgroundColor = theme === "dark" ? "#101114" : "#ffffff";
  const foregroundColor = theme === "dark" ? "#ffffff" : "#171717";

  return (
    <View style={[styles.container, { backgroundColor }, props.style]}>
      <WebView<object>
        ref={webView}
        cacheEnabled
        allowsInlineMediaPlayback={webViewProps.allowsInlineMediaPlayback}
        domStorageEnabled={webViewProps.domStorageEnabled}
        javaScriptEnabled={webViewProps.javaScriptEnabled}
        mixedContentMode={webViewProps.mixedContentMode}
        onMessage={(event) => {
          try {
            if (JSON.parse(event.nativeEvent.data)?.type === "signa:appearance-ready") {
              updateAppearance();
              return;
            }
          } catch { /* The normal dispatcher ignores malformed messages. */ }
          handleMessage(event);
        }}
        originWhitelist={webViewProps.originWhitelist}
        onLoadEnd={updateAppearance}
        onError={(event) => props.onError?.({ code: "webview_load_failed", message: event.nativeEvent.description })}
        onHttpError={(event) => props.onError?.({ code: "webview_http_error", message: `Signing page returned HTTP ${event.nativeEvent.statusCode}` })}
        renderLoading={() => (
          <View style={[styles.loadingState, { backgroundColor }]}>
            <ActivityIndicator color={foregroundColor} />
            <Text style={[styles.loadingText, { color: foregroundColor }]}>{props.loadingLabel ?? "Loading document…"}</Text>
          </View>
        )}
        sharedCookiesEnabled
        source={source}
        startInLoadingState={webViewProps.showsLoadingIndicator}
        style={[styles.webView, props.webViewStyle]}
      />
    </View>
  );
}

function useSignaSigningUrl(props: SignaSigningViewProps): string {
  const signingOptions = getSigningUrlOptions(props);

  return React.useMemo(
    () => buildSignaSigningUrl(signingOptions),
    getSigningUrlDependencies(signingOptions),
  );
}

function getSigningUrlOptions(
  props: SignaSigningViewProps,
): SignaSigningUrlOptions {
  return {
    dryRun: props.dryRun,
    email: props.email,
    expand: props.expand ?? true,
    externalId: props.externalId,
    host: props.host,
    language: props.language,
    minimize: props.minimize ?? false,
    name: props.name,
    preview: props.preview,
    role: props.role,
    slug: props.slug,
    src: props.src,
    token: props.token,
  };
}

function getSigningUrlDependencies(options: SignaSigningUrlOptions) {
  return [
    options.dryRun,
    options.email,
    options.expand,
    options.externalId,
    options.host,
    options.language,
    options.minimize,
    options.name,
    options.preview,
    options.role,
    options.slug,
    options.src,
    options.token,
  ];
}

function useSignaMessageHandler(
  props: SignaSigningViewProps,
): (event: WebViewMessageEvent) => void {
  return React.useCallback(
    (event: WebViewMessageEvent) => {
      dispatchSignaMessage(event.nativeEvent.data, {
        onComplete: props.onComplete,
        onDecline: props.onDecline,
        onError: props.onError,
        onLoad: props.onLoad,
        onMessage: props.onMessage,
      });
    },
    [
      props.onComplete,
      props.onDecline,
      props.onError,
      props.onLoad,
      props.onMessage,
    ],
  );
}

function getWebViewDefaults(props: SignaSigningViewProps) {
  return {
    allowsInlineMediaPlayback: props.allowsInlineMediaPlayback ?? true,
    domStorageEnabled: props.domStorageEnabled ?? true,
    javaScriptEnabled: props.javaScriptEnabled ?? true,
    mixedContentMode: props.mixedContentMode ?? "compatibility",
    originWhitelist: props.originWhitelist ?? ["https://*", "http://*"],
    showsLoadingIndicator: props.showsLoadingIndicator ?? true,
  };
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#f7fbff",
    flex: 1,
    minHeight: 560,
    overflow: "hidden",
  },
  loadingState: {
    alignItems: "center",
    backgroundColor: "#f7fbff",
    gap: 10,
    inset: 0,
    justifyContent: "center",
    position: "absolute",
  },
  loadingText: {
    color: "#496b8b",
    fontSize: 14,
    fontWeight: "600",
  },
  webView: {
    backgroundColor: "transparent",
    flex: 1,
  },
});
