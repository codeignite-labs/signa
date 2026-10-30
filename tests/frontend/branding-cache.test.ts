import { beforeEach, expect, it, vi } from "vitest";
import {
  brandPalette,
  defaultBrandColor,
  type AccountBranding,
} from "../../packages/shared/src/branding";
import {
  brandingCacheConfig as config,
  clearBrandingCache,
  parseBrandingSnapshot,
  readBrandingSnapshot,
  rememberBranding,
} from "../../apps/frontend/lib/branding/branding-cache";

const brand: AccountBranding = {
  account_name: "Example Organization",
  primary_color: "#123456",
  white_label: true,
  show_business_name: true,
  logo: { url: "/logo.png", background: "transparent" },
};
function snapshot() {
  return {
    version: config.version,
    accountId: "one",
    updatedAt: Date.now(),
    branding: structuredClone(brand),
    light: brandPalette("#123456"),
    dark: brandPalette("#123456", true),
  };
}
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
});
it("persists only public tenant branding and derives both palettes", () => {
  rememberBranding(
    "one",
    { ...brand, secret: "must-not-persist" } as AccountBranding,
    Date.now(),
  );
  const raw = localStorage.getItem(config.prefix + "one")!;
  expect(raw).not.toContain("must-not-persist");
  expect(readBrandingSnapshot("one")).toEqual(snapshot());
  expect(readBrandingSnapshot("two")).toBeNull();
  const write = vi.spyOn(Storage.prototype, "setItem");
  rememberBranding("one", brand, Date.now());
  expect(write).not.toHaveBeenCalled();
  rememberBranding(
    "two",
    {
      ...brand,
      primary_color: null,
      logo: null,
      show_business_name: undefined,
    } as unknown as AccountBranding,
    Date.now(),
  );
  expect(readBrandingSnapshot("two")).toMatchObject({
    branding: { show_business_name: true, logo: null },
    light: brandPalette(defaultBrandColor),
  });
});
it.each([
  [
    "schema version",
    (s: any) => {
      s.version = -1;
    },
  ],
  [
    "wrong account",
    (s: any) => {
      s.accountId = "two";
    },
  ],
  [
    "future timestamp",
    (s: any) => {
      s.updatedAt += 1;
    },
  ],
  [
    "expired timestamp",
    (s: any) => {
      s.updatedAt -= config.maxAge + 1;
    },
  ],
  [
    "non-numeric timestamp",
    (s: any) => {
      s.updatedAt = "today";
    },
  ],
  [
    "non-finite timestamp",
    (s: any) => {
      s.updatedAt = Infinity;
    },
  ],
  [
    "missing branding",
    (s: any) => {
      s.branding = null;
    },
  ],
  [
    "invalid title",
    (s: any) => {
      s.branding.account_name = 12;
    },
  ],
  [
    "oversized title",
    (s: any) => {
      s.branding.account_name = "x".repeat(501);
    },
  ],
  [
    "invalid hex",
    (s: any) => {
      s.branding.primary_color = "red;display:none";
    },
  ],
  [
    "non-string hex",
    (s: any) => {
      s.branding.primary_color = 3;
    },
  ],
  [
    "invalid white label",
    (s: any) => {
      s.branding.white_label = "true";
    },
  ],
  [
    "invalid display title",
    (s: any) => {
      s.branding.show_business_name = null;
    },
  ],
  [
    "missing logo URL",
    (s: any) => {
      s.branding.logo = {};
    },
  ],
  [
    "executable logo URL",
    (s: any) => {
      s.branding.logo.url = "javascript:alert(1)";
    },
  ],
  [
    "protocol-relative logo",
    (s: any) => {
      s.branding.logo.url = "//example.test/logo";
    },
  ],
  [
    "oversized URL",
    (s: any) => {
      s.branding.logo.url = "/" + "x".repeat(4096);
    },
  ],
  [
    "missing light palette",
    (s: any) => {
      s.light = null;
    },
  ],
  [
    "missing dark palette",
    (s: any) => {
      s.dark = {};
    },
  ],
  [
    "unsafe palette token",
    (s: any) => {
      s.light[config.paletteKeys[0]] = "red;display:none";
    },
  ],
])("rejects cached %s without cross-account or CSS injection", (_, mutate) => {
  const value = snapshot();
  mutate(value);
  expect(
    parseBrandingSnapshot(JSON.stringify(value), "one", config),
  ).toBeNull();
});
it("handles malformed and oversized storage, including blocked storage", () => {
  for (const raw of [null, "null", "bad json", "x".repeat(24001)])
    expect(parseBrandingSnapshot(raw, "one", config)).toBeNull();
  localStorage.setItem("unrelated", "keep");
  rememberBranding("one", brand, Date.now());
  rememberBranding("two", brand, Date.now());
  clearBrandingCache();
  expect(localStorage.getItem("unrelated")).toBe("keep");
  expect(readBrandingSnapshot("one")).toBeNull();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw Error("blocked");
  });
  expect(readBrandingSnapshot("one")).toBeNull();
  expect(() => rememberBranding("one", brand, Date.now())).not.toThrow();
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw Error("blocked");
  });
  Object.defineProperty(localStorage, config.prefix + "test", {
    enumerable: true,
    configurable: true,
    value: "cache",
  });
  expect(() => clearBrandingCache()).not.toThrow();
  delete localStorage[config.prefix + "test"];
});
