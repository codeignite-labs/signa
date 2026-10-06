import { brandPalette } from "@repo/shared/branding";
import { brandingCacheConfig, parseBrandingSnapshot } from "./branding-cache";

// Kept self-contained so the browser can run it before React or application JS.
function initializeBranding(
  parse: typeof parseBrandingSnapshot,
  config: typeof brandingCacheConfig,
  neutral: { light: Record<string, string>; dark: Record<string, string> },
) {
  const root = document.documentElement;
  try {
    const embeddedTheme = /^\/(s|d)(\/|$)/.test(location.pathname)
      ? new URLSearchParams(location.search).get("theme") : null;
    const mode = ["light", "dark", "system"].includes(embeddedTheme ?? "")
      ? embeddedTheme : localStorage.getItem("signa.theme");
    root.classList.toggle(
      "dark",
      mode === "dark" ||
        (mode !== "light" &&
          matchMedia("(prefers-color-scheme: dark)").matches),
    );
  } catch {
    root.classList.toggle(
      "dark",
      matchMedia("(prefers-color-scheme: dark)").matches,
    );
  }
  if (
    /^\/(s|d|auth)(\/|$)/.test(location.pathname) ||
    location.pathname === "/"
  )
    return;
  try {
    const session = JSON.parse(localStorage.getItem("signa.auth") || "null");
    const accountId = session?.account?.id;
    if (typeof accountId !== "string" || !session.access_token) return;
    const payload = session.access_token.split(".")[1];
    if (payload) {
      const token = JSON.parse(
        atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
      );
      if (token.exp && token.exp * 1000 <= Date.now() + 15_000) return;
    }
    let snapshot = null;
    try {
      snapshot = parse(
        localStorage.getItem(config.prefix + accountId),
        accountId,
        config,
      );
    } catch {
      // A missing cache still gets a neutral first paint, never a guessed brand.
    }
    const serialize = (palette: Record<string, string>) =>
      config.paletteKeys.map((key) => `${key}:${palette[key]}`).join(";");
    const style = document.createElement("style");
    style.id = "signa-branding-bootstrap";
    style.textContent = `:root{${serialize(snapshot?.light ?? neutral.light)}}:root.dark{${serialize(snapshot?.dark ?? neutral.dark)}}`;
    if (snapshot?.branding.logo) {
      const url = JSON.stringify(snapshot.branding.logo.url);
      style.textContent += `[data-brand-placeholder]{background-image:url(${url});background-repeat:no-repeat;background-position:left center;background-size:contain}`;
      const preload = document.createElement("link");
      preload.rel = "preload";
      preload.as = "image";
      preload.href = snapshot.branding.logo.url;
      document.head.append(preload);
    }
    document.head.append(style);
  } catch {
    // Invalid/blocked storage must never prevent the page from loading.
  }
}

// Contains trusted source and constants only; no account data is interpolated into HTML.
// Native inline script is intentional: Next's beforeInteractive waits for its runtime.
export const brandingBootstrapScript = `(${initializeBranding.toString()})(${parseBrandingSnapshot.toString()},${JSON.stringify(brandingCacheConfig)},${JSON.stringify({ light: brandPalette("#737373"), dark: brandPalette("#737373", true) })});`;
