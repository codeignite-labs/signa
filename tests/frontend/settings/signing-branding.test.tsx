import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import type { AccountBranding } from "../../../packages/shared/src/branding";
import {
  SigningBrandStyle,
  signingNavigationUrl,
} from "../../../apps/frontend/components/branding/signing-brand-style";
const state = vi.hoisted(() => ({ pathname: "/s/signer" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
const branding: AccountBranding = {
  account_name: "Organization",
  primary_color: "#112233",
  white_label: false,
  logo: null,
};
let media: {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.classList.remove("dark");
  media = {
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
});
afterEach(() => {
  window.history.replaceState({}, "", "/");
  document.documentElement.classList.remove("dark");
});
function css() {
  return document.querySelector("style[data-account-branding]")?.textContent;
}
it("uses organization branding by default and preserves it for invalid host override values", () => {
  window.history.replaceState(
    {},
    "",
    "/s/signer?theme=invalid&primary-color=invalid",
  );
  render(<SigningBrandStyle branding={branding} />);
  expect(css()).toContain("--brand-original:#112233");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(matchMedia).not.toHaveBeenCalled();
});
it("accepts a valid URL primary color override and restores the prior theme after unmount", () => {
  window.history.replaceState(
    {},
    "",
    "/s/signer?theme=dark&primary-color=%23AbC",
  );
  const view = render(<SigningBrandStyle branding={branding} />);
  expect(css()).toContain("--brand-original:#aabbcc");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(media.addEventListener).toHaveBeenCalledWith(
    "change",
    expect.any(Function),
  );
  view.unmount();
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(media.removeEventListener).toHaveBeenCalled();
});
it("applies an explicit light theme over an existing dark app theme and restores it on unmount", () => {
  document.documentElement.classList.add("dark");
  window.history.replaceState({}, "", "/s/signer?theme=light");
  const view = render(<SigningBrandStyle branding={branding} />);
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  view.unmount();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});
it("tracks system appearance changes while a system override is active", () => {
  window.history.replaceState({}, "", "/s/signer?theme=system");
  render(<SigningBrandStyle branding={branding} />);
  const listener = media.addEventListener.mock.calls[0][1] as () => void;
  media.matches = true;
  act(listener);
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  media.matches = false;
  act(listener);
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});
it("receives React Native appearance events, validates their payload and announces readiness", async () => {
  const postMessage = vi.fn();
  vi.stubGlobal("ReactNativeWebView", { postMessage });
  render(<SigningBrandStyle branding={branding} />);
  expect(postMessage).toHaveBeenCalledWith(
    JSON.stringify({ type: "signa:appearance-ready" }),
  );
  act(() =>
    window.dispatchEvent(
      new CustomEvent("signa:appearance", {
        detail: { theme: "dark", primaryColor: "#334455" },
      }),
    ),
  );
  await waitFor(() =>
    expect(document.documentElement.classList.contains("dark")).toBe(true),
  );
  expect(css()).toContain("--brand-original:#334455");
  act(() =>
    window.dispatchEvent(new CustomEvent("signa:appearance", { detail: null })),
  );
  expect(css()).toContain("--brand-original:#112233");
  act(() =>
    window.dispatchEvent(
      new CustomEvent("signa:appearance", {
        detail: { theme: 42, primaryColor: 5 },
      }),
    ),
  );
  expect(css()).toContain("--brand-original:#112233");
});
it("only accepts iframe appearance messages from its parent with the expected protocol", async () => {
  const host = { postMessage: vi.fn() } as unknown as Window;
  vi.spyOn(window, "parent", "get").mockReturnValue(host);
  render(<SigningBrandStyle branding={branding} />);
  expect(host.postMessage).toHaveBeenCalledWith(
    { source: "signa", type: "appearance-ready" },
    "*",
  );
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          source: "signa:host",
          type: "appearance",
          appearance: { primaryColor: "#ffffff" },
        },
      }),
    ),
  );
  expect(css()).toContain("--brand-original:#112233");
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: host,
        data: {
          source: "unknown",
          type: "appearance",
          appearance: { primaryColor: "#ffffff" },
        },
      }),
    ),
  );
  expect(css()).toContain("--brand-original:#112233");
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: host,
        data: { source: "signa:host", type: "unknown" },
      }),
    ),
  );
  expect(css()).toContain("--brand-original:#112233");
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: host,
        data: {
          source: "signa:host",
          type: "appearance",
          appearance: { primaryColor: "#ffffff", theme: "dark" },
        },
      }),
    ),
  );
  await waitFor(() => expect(css()).toContain("--brand-original:#ffffff"));
});
it("ignores cross-window appearance messages when signing is not embedded", () => {
  render(<SigningBrandStyle branding={branding} />);
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          source: "signa:host",
          type: "appearance",
          appearance: { primaryColor: "#ffffff" },
        },
      }),
    ),
  );
  expect(css()).toContain("--brand-original:#112233");
});
it("does not invent an organization brand when no branding is supplied", () => {
  render(<SigningBrandStyle />);
  expect(css()).toBeUndefined();
});
it("retains only embed appearance settings when navigating between public signing routes", () => {
  window.history.replaceState(
    {},
    "",
    "/s/signer?embed=true&theme=dark&primary-color=%23112233&token=secret&field=x",
  );
  expect(signingNavigationUrl("/s/signer/completed")).toBe(
    "/s/signer/completed?embed=true&theme=dark&primary-color=%23112233",
  );
  window.history.replaceState(
    {},
    "",
    "/s/signer?embed=&theme=&primary-color=&token=secret",
  );
  expect(signingNavigationUrl("/s/signer/completed")).toBe(
    "/s/signer/completed",
  );
});
