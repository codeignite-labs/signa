"use client";

import { BrandDocumentIdentity } from "./brand-document-identity";
import {
  brandPalette,
  defaultBrandColor,
  normalizeBrandColor,
  type AccountBranding,
} from "@repo/shared/branding";

const serialize = (palette: Record<string, string>) =>
  Object.entries(palette)
    .map(([key, value]) => `${key}:${value}`)
    .join(";");

export function BrandStyle({
  branding,
}: {
  branding?: AccountBranding | null;
}) {
  if (!branding) return null;
  const color =
    normalizeBrandColor(branding.primary_color ?? "") ?? defaultBrandColor;
  // All interpolated values are derived from validated hex, never raw account input.
  const css = `:root{${serialize(brandPalette(color))}}:root.dark{${serialize(brandPalette(color, true))}}
    :root :focus-visible{outline:2px solid var(--ring);outline-offset:3px}
    :root [data-slot=input]:not(:disabled),:root [data-slot=textarea]:not(:disabled),:root [data-slot=select-trigger],:root [data-slot=button][data-variant=outline]{background-color:var(--card)}
    :root [data-slot=button][data-variant=outline]:hover{background-color:var(--muted)}
    :root [data-slot=switch][data-state=unchecked]{background-color:var(--input)}
    :root [data-slot=switch-thumb]{background-color:var(--card)}
    :root [data-slot=switch][data-state=checked] [data-slot=switch-thumb]{background-color:var(--primary-foreground)}`;
  return (
    <>
      <BrandDocumentIdentity branding={branding} />
      <style data-account-branding>{css}</style>
    </>
  );
}
