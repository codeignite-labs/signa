import {
  brandPalette,
  defaultBrandColor,
  type AccountBranding,
} from "@repo/shared/branding";

export const brandingCacheConfig = {
  prefix: "signa.branding.",
  version: 2,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  paletteKeys: Object.keys(brandPalette(defaultBrandColor)),
};

export type BrandingSnapshot = {
  version: number;
  accountId: string;
  updatedAt: number;
  branding: AccountBranding;
  light: Record<string, string>;
  dark: Record<string, string>;
};

// Self-contained: this same validator is serialized into the pre-paint script.
export function parseBrandingSnapshot(
  raw: string | null,
  accountId: string,
  config: typeof brandingCacheConfig,
): BrandingSnapshot | null {
  try {
    if (!raw || raw.length > 24_000) return null;
    const value = JSON.parse(raw) as BrandingSnapshot;
    if (value.version !== config.version || value.accountId !== accountId)
      return null;
    if (typeof value.updatedAt !== "number") return null;
    const age = Date.now() - value.updatedAt;
    if (!Number.isFinite(age) || age < 0 || age > config.maxAge) return null;
    const brand = value.branding;
    if (
      !brand ||
      typeof brand.account_name !== "string" ||
      brand.account_name.length > 500
    )
      return null;
    if (
      brand.primary_color !== null &&
      (typeof brand.primary_color !== "string" ||
        !/^#[a-f\d]{6}$/i.test(brand.primary_color))
    )
      return null;
    if (
      typeof brand.white_label !== "boolean" ||
      typeof brand.show_business_name !== "boolean"
    )
      return null;
    if (
      brand.logo !== null &&
      (!brand.logo ||
        typeof brand.logo.url !== "string" ||
        brand.logo.url.length > 4096 ||
        !/^(https?:\/\/|\/(?!\/))[^\s<>"'\\]+$/i.test(brand.logo.url))
    )
      return null;
    for (const palette of [value.light, value.dark]) {
      if (
        !palette ||
        !config.paletteKeys.every(
          (key) =>
            typeof palette[key] === "string" &&
            /^#[a-f\d]{6}$/i.test(palette[key]),
        )
      )
        return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function readBrandingSnapshot(
  accountId: string,
): BrandingSnapshot | null {
  try {
    return parseBrandingSnapshot(
      localStorage.getItem(brandingCacheConfig.prefix + accountId),
      accountId,
      brandingCacheConfig,
    );
  } catch {
    return null;
  }
}

export function rememberBranding(
  accountId: string,
  brand: AccountBranding,
  updatedAt: number,
): void {
  const branding = {
    account_name: brand.account_name,
    primary_color: brand.primary_color,
    white_label: brand.white_label,
    logo: brand.logo
      ? { url: brand.logo.url, background: "transparent" }
      : null,
    show_business_name: brand.show_business_name !== false,
  };
  const color = branding.primary_color ?? defaultBrandColor;
  const snapshot: BrandingSnapshot = {
    version: brandingCacheConfig.version,
    accountId,
    updatedAt,
    branding,
    light: brandPalette(color),
    dark: brandPalette(color, true),
  };
  try {
    const key = brandingCacheConfig.prefix + accountId;
    const raw = JSON.stringify(snapshot);
    if (
      parseBrandingSnapshot(raw, accountId, brandingCacheConfig) &&
      localStorage.getItem(key) !== raw
    )
      localStorage.setItem(key, raw);
  } catch {
    // Storage can be blocked/full; the live API-backed UI must still work.
  }
}

export function clearBrandingCache(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(brandingCacheConfig.prefix))
        localStorage.removeItem(key);
    }
  } catch {
    // Nothing is persisted when browser storage is unavailable.
  }
}
