"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { normalizeBrandColor, type AccountBranding } from "@repo/shared/branding";
import { BrandStyle } from "./brand-style";

type Appearance = { theme?: "light" | "dark" | "system"; primaryColor?: string };
const subscribeToHydration = () => () => undefined;

function parseAppearance(value: unknown): Appearance {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  return {
    theme: input.theme === "dark" || input.theme === "light" || input.theme === "system"
      ? input.theme : undefined,
    primaryColor: typeof input.primaryColor === "string"
      ? normalizeBrandColor(input.primaryColor) ?? undefined : undefined,
  };
}

export function SigningBrandStyle({ branding }: { branding?: AccountBranding | null }) {
  const [override, setAppearance] = useState<Appearance | null>(null);
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const params = new URLSearchParams(hydrated ? location.search : "");
  const appearance = override ?? parseAppearance({ theme: params.get("theme"), primaryColor: params.get("primary-color") });
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (window.parent === window || event.source !== window.parent) return;
      if (event.data?.source === "signa:host" && event.data.type === "appearance")
        setAppearance(parseAppearance(event.data.appearance));
    };
    const receiveNative = (event: Event) => setAppearance(parseAppearance((event as CustomEvent).detail));
    window.addEventListener("message", receive);
    window.addEventListener("signa:appearance", receiveNative);
    const ready = { source: "signa", type: "appearance-ready" };
    if (window.parent !== window) window.parent.postMessage(ready, "*");
    window.ReactNativeWebView?.postMessage(JSON.stringify({ type: "signa:appearance-ready" }));
    return () => {
      window.removeEventListener("message", receive);
      window.removeEventListener("signa:appearance", receiveNative);
    };
  }, []);
  useEffect(() => {
    if (!appearance.theme) return;
    const root = document.documentElement;
    const previous = root.classList.contains("dark");
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => root.classList.toggle("dark", appearance.theme === "dark" || (appearance.theme === "system" && media.matches));
    update();
    media.addEventListener("change", update);
    return () => { media.removeEventListener("change", update); root.classList.toggle("dark", previous); };
  }, [appearance.theme]);
  return <BrandStyle branding={branding && { ...branding, primary_color: appearance.primaryColor ?? branding.primary_color }} />;
}

export function signingNavigationUrl(path: string): string {
  const current = new URLSearchParams(window.location.search);
  const query = new URLSearchParams();
  for (const key of ["embed", "theme", "primary-color"]) {
    const value = current.get(key);
    if (value) query.set(key, value);
  }
  return query.size ? `${path}?${query}` : path;
}
