import { beforeEach, expect, it, vi } from "vitest";
import { brandPalette } from "../../../packages/shared/src/branding";
import {
  brandingBootstrapScript,
  initializeBranding,
} from "../../../apps/frontend/lib/branding/branding-bootstrap";
import {
  brandingCacheConfig as config,
  parseBrandingSnapshot,
} from "../../../apps/frontend/lib/branding/branding-cache";
const neutral = {
  light: brandPalette("#737373"),
  dark: brandPalette("#737373", true),
};
const branding = {
  account_name: "Example Organization",
  primary_color: "#123456",
  white_label: true,
  show_business_name: true,
  logo: null,
};
let prefersDark: boolean;
function initialize() {
  initializeBranding(parseBrandingSnapshot, config, neutral);
}
function style() {
  return document.getElementById("signa-branding-bootstrap");
}
function session(
  access_token = "opaque-token",
  accountId: unknown = "account",
) {
  localStorage.setItem(
    "signa.auth",
    JSON.stringify({ access_token, account: { id: accountId } }),
  );
}
function remember(overrides: Record<string, unknown> = {}) {
  localStorage.setItem(
    config.prefix + "account",
    JSON.stringify({
      version: config.version,
      accountId: "account",
      updatedAt: Date.now(),
      branding,
      light: brandPalette("#123456"),
      dark: brandPalette("#123456", true),
      ...overrides,
    }),
  );
}
function token(payload: unknown) {
  return (
    "header." +
    btoa(JSON.stringify(payload))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "") +
    ".signature"
  );
}
beforeEach(() => {
  prefersDark = false;
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  vi.stubGlobal("matchMedia", () => ({ matches: prefersDark }));
  window.history.replaceState({}, "", "/templates");
  document.documentElement.classList.remove("dark");
  document
    .querySelectorAll("#signa-branding-bootstrap,link[rel=preload]")
    .forEach((node) => node.remove());
});
it.each([
  ["dark", false, true],
  ["light", true, false],
  ["system", true, true],
  ["system", false, false],
  [null, true, true],
  ["unknown", false, false],
])(
  "applies stored theme %s with OS dark preference %s before React loads",
  (mode, systemDark, expected) => {
    prefersDark = systemDark;
    if (mode !== null) localStorage.setItem("signa.theme", mode);
    initialize();
    expect(document.documentElement.classList.contains("dark")).toBe(expected);
    expect(style()).toBeNull();
  },
);
it.each([
  ["/s/slug?theme=light", false],
  ["/d/slug?theme=dark", true],
  ["/s/slug?theme=system", true],
  ["/d/slug?theme=invalid", true],
  ["/auth/login", true],
  ["/", true],
])(
  "handles public route %s without restoring an account brand",
  (path, expectedDark) => {
    prefersDark = true;
    localStorage.setItem("signa.theme", "dark");
    session();
    remember();
    window.history.replaceState({}, "", path);
    initialize();
    expect(document.documentElement.classList.contains("dark")).toBe(
      expectedDark,
    );
    expect(style()).toBeNull();
  },
);
it.each([
  undefined,
  null,
  {},
  { account: { id: 42 }, access_token: "token" },
  { account: { id: "account" }, access_token: "" },
])("ignores absent or incomplete saved sessions", (value) => {
  if (value !== undefined)
    localStorage.setItem("signa.auth", JSON.stringify(value));
  initialize();
  expect(style()).toBeNull();
});
it("does not trust cached palettes from another account and supplies a neutral first paint instead", () => {
  session();
  remember({ accountId: "foreign" });
  initialize();
  expect(style()?.textContent).toContain(
    `--primary:${neutral.light["--primary"]}`,
  );
  expect(style()?.textContent).not.toContain(
    brandPalette("#123456")["--primary"],
  );
});
it("restores validated light/dark palettes with no account names or secrets in generated CSS", () => {
  session(token({ exp: Date.now() / 1000 + 3600 }));
  remember({
    branding: {
      ...branding,
      account_name: "</style><script>untrusted-name</script>",
    },
  });
  initialize();
  expect(style()?.textContent).toContain(
    `--primary:${brandPalette("#123456")["--primary"]}`,
  );
  expect(style()?.textContent).toContain(":root.dark{");
  expect(style()?.textContent).not.toContain("untrusted-name");
  expect(style()?.textContent).not.toContain("signature");
  expect(document.querySelector("script")).toBeNull();
});
it.each([0, 15, -1])(
  "does not restore branding for a session expiring in %i seconds",
  (seconds) => {
    session(token({ exp: Date.now() / 1000 + seconds || 1 }));
    remember();
    initialize();
    expect(style()).toBeNull();
  },
);
it("tolerates opaque tokens and tokens without expiry while rejecting malformed JWT payloads", () => {
  session(token({ sub: "user" }));
  initialize();
  expect(style()).toBeTruthy();
  style()?.remove();
  session("header.not-json.signature");
  initialize();
  expect(style()).toBeNull();
});
it.each([config.maxAge + 1, -1000])(
  "rejects expired or future cache ages %s and paints a neutral palette",
  (age) => {
    session();
    remember({ updatedAt: Date.now() - age });
    initialize();
    expect(style()?.textContent).toContain(
      `--primary:${neutral.light["--primary"]}`,
    );
  },
);
it("preloads a validated organization logo and reserves its background before hydration", () => {
  session();
  remember({
    branding: {
      ...branding,
      logo: {
        url: "https://cdn.example.test/logo.png",
        background: "transparent",
      },
    },
  });
  initialize();
  expect(style()?.textContent).toContain(
    '[data-brand-placeholder]{background-image:url("https://cdn.example.test/logo.png")',
  );
  const preload = document.querySelector<HTMLLinkElement>("link[rel=preload]");
  expect(preload?.href).toBe("https://cdn.example.test/logo.png");
});
it("ignores an unsafe logo URL instead of inserting it into HTML or CSS", () => {
  session();
  remember({
    branding: {
      ...branding,
      logo: { url: "javascript:alert(1)", background: "transparent" },
    },
  });
  initialize();
  expect(document.querySelector("link[rel=preload]")).toBeNull();
  expect(style()?.textContent).not.toContain("javascript:");
});
it("keeps a neutral first paint when cache access fails after the session was read", () => {
  session();
  const read = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
    this: Storage,
    key: string,
  ) {
    if (key.startsWith(config.prefix)) throw new Error("Storage denied");
    return read.call(this, key);
  });
  initialize();
  expect(style()?.textContent).toContain(
    `--primary:${neutral.light["--primary"]}`,
  );
});
it("follows OS theme and leaves the page operational if storage is fully blocked or corrupted", () => {
  prefersDark = true;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  expect(initialize).not.toThrow();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(style()).toBeNull();
});
it("does not block rendering if persisted session JSON is corrupt", () => {
  localStorage.setItem("signa.auth", "broken JSON");
  expect(initialize).not.toThrow();
  expect(style()).toBeNull();
});
it("keeps the serialized bootstrap equivalent to its directly tested initializer", () => {
  session();
  remember();
  initialize();
  const expected = style()?.textContent;
  style()?.remove();
  Function(brandingBootstrapScript)();
  expect(style()?.textContent).toBe(expected);
  expect(brandingBootstrapScript).not.toContain("Example Organization");
});
