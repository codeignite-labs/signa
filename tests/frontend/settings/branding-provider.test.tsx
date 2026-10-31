import { beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AccountBranding } from "../../../packages/shared/src/branding";
import {
  AccountBrandingProvider,
  useAccountBranding,
} from "../../../apps/frontend/components/branding/account-branding-provider";
import { BrandLogo } from "../../../apps/frontend/components/branding/brand-logo";
import { BrandName } from "../../../apps/frontend/components/branding/brand-name";
import { BrandAttribution } from "../../../apps/frontend/components/branding/brand-attribution";
import { BrandStyle } from "../../../apps/frontend/components/branding/brand-style";
import { getAccountBranding } from "../../../apps/frontend/lib/api/branding";
import {
  brandingCacheConfig,
  clearBrandingCache,
  rememberBranding,
} from "../../../apps/frontend/lib/branding/branding-cache";
const state = vi.hoisted(() => ({
  accountId: "account-1" as string | null,
  pathname: "/templates",
  listeners: new Set<() => void>(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("../../../apps/frontend/lib/api/auth", () => ({
  getAuthSession: () =>
    state.accountId ? { account: { id: state.accountId } } : null,
  subscribeToAuthSessionChange: (listener: () => void) => {
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  },
}));
vi.mock("../../../apps/frontend/lib/api/branding", () => ({
  getAccountBranding: vi.fn(),
}));
const branding: AccountBranding = {
  account_name: "Example Organization",
  primary_color: "#112233",
  white_label: true,
  show_business_name: true,
  logo: { url: "/example-logo.png", background: "transparent" },
};
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  clearBrandingCache();
  state.accountId = "account-1";
  state.pathname = "/templates";
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(getAccountBranding).mockResolvedValue(branding);
});
function BrandConsumer() {
  const brand = useAccountBranding();
  return (
    <>
      <span data-testid="brand-state">
        {brand === undefined
          ? "pending"
          : brand === null
            ? "none"
            : brand.account_name}
      </span>
      <BrandLogo />
      <span data-testid="brand-name">
        <BrandName />
      </span>
    </>
  );
}
function Provider() {
  return (
    <QueryClientProvider client={client}>
      <AccountBrandingProvider>
        <BrandConsumer />
      </AccountBrandingProvider>
    </QueryClientProvider>
  );
}
it("keeps identity neutral while branding loads, then renders the organization without the default logo", async () => {
  let finish!: (value: AccountBranding) => void;
  vi.mocked(getAccountBranding).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<Provider />);
  expect(screen.getByTestId("brand-state").textContent).toBe("pending");
  expect(document.querySelector("[data-brand-placeholder]")).toBeTruthy();
  expect(document.querySelector("img")).toBeNull();
  await act(async () => {
    finish(branding);
  });
  await screen.findByText("Example Organization", {
    selector: "[data-brand-name]",
  });
  expect(screen.getByTestId("brand-name").textContent).toBe(
    "Example Organization",
  );
  expect(document.querySelector("img")?.getAttribute("src")).toContain(
    "/example-logo.png",
  );
});
it("uses the account-specific local snapshot immediately and refreshes it authoritatively", async () => {
  rememberBranding(
    "account-1",
    { ...branding, account_name: "Cached Organization" },
    Date.now(),
  );
  render(<Provider />);
  expect(screen.getByTestId("brand-state").textContent).toBe(
    "Cached Organization",
  );
  await waitFor(() =>
    expect(screen.getByTestId("brand-state").textContent).toBe(
      "Example Organization",
    ),
  );
  expect(getAccountBranding).toHaveBeenCalled();
});
it.each(["/s/signer", "/d/document", "/auth/login", "/"])(
  "does not apply signed-in organization branding to public route %s",
  async (pathname) => {
    state.pathname = pathname;
    client.setQueryData(["account-branding", "account-1"], branding);
    render(<Provider />);
    await waitFor(() =>
      expect(screen.getByTestId("brand-state").textContent).toBe("none"),
    );
    expect(getAccountBranding).not.toHaveBeenCalled();
    expect(screen.getByTestId("brand-name").textContent).toBe("Signa");
    expect(document.querySelector("style[data-account-branding]")).toBeNull();
  },
);
it("does not fetch account branding without an authenticated account", async () => {
  state.accountId = null;
  render(<Provider />);
  await waitFor(() =>
    expect(screen.getByTestId("brand-state").textContent).toBe("none"),
  );
  expect(getAccountBranding).not.toHaveBeenCalled();
});
it("shows a neutral identity when branding cannot be loaded instead of leaking a previous account", async () => {
  client.setQueryData(["account-branding", "foreign-account"], branding);
  vi.mocked(getAccountBranding).mockRejectedValue(new Error("offline"));
  render(<Provider />);
  await waitFor(() =>
    expect(screen.getByTestId("brand-state").textContent).toBe("none"),
  );
  expect(screen.getByTestId("brand-name").textContent).toBe("Signa");
});
it("switches branding by account id and drops account branding when entering a public route", async () => {
  render(<Provider />);
  await waitFor(() =>
    expect(screen.getByTestId("brand-state").textContent).toBe(
      "Example Organization",
    ),
  );
  vi.mocked(getAccountBranding).mockResolvedValue({
    ...branding,
    account_name: "Second Organization",
  });
  act(() => {
    state.accountId = "account-2";
    for (const listener of state.listeners) listener();
  });
  await waitFor(() =>
    expect(screen.getByTestId("brand-state").textContent).toBe(
      "Second Organization",
    ),
  );
  expect(client.getQueryData(["account-branding", "account-1"])).toMatchObject({
    account_name: branding.account_name,
  });
});
it("does not carry authenticated branding to a public page after route navigation", async () => {
  const view = render(<Provider />);
  await waitFor(() =>
    expect(screen.getByTestId("brand-state").textContent).toBe(
      branding.account_name,
    ),
  );
  state.pathname = "/s/signer";
  view.rerender(<Provider />);
  await waitFor(() =>
    expect(screen.getByTestId("brand-state").textContent).toBe("none"),
  );
  expect(document.querySelector("style[data-account-branding]")).toBeNull();
});
it("persists loaded branding, removes the prepaint fallback and receives matching cross-tab updates", async () => {
  const fallback = document.createElement("style");
  fallback.id = "signa-branding-bootstrap";
  document.head.append(fallback);
  render(<Provider />);
  await waitFor(() =>
    expect(screen.getByTestId("brand-state").textContent).toBe(
      branding.account_name,
    ),
  );
  expect(document.getElementById("signa-branding-bootstrap")).toBeNull();
  const next = { ...branding, account_name: "Updated Across Tabs" };
  rememberBranding("account-1", next, Date.now());
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: brandingCacheConfig.prefix + "foreign-account",
      }),
    ),
  );
  expect(screen.getByTestId("brand-state").textContent).toBe(
    branding.account_name,
  );
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: brandingCacheConfig.prefix + "account-1",
      }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByTestId("brand-state").textContent).toBe(
      next.account_name,
    ),
  );
  localStorage.removeItem(brandingCacheConfig.prefix + "account-1");
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: brandingCacheConfig.prefix + "account-1",
      }),
    ),
  );
  expect(screen.getByTestId("brand-state").textContent).toBe(next.account_name);
});
it("renders a loading placeholder when used without a branding provider and supports explicit default branding", () => {
  const view = render(<BrandLogo />);
  expect(document.querySelector("[data-brand-placeholder]")).toBeTruthy();
  view.rerender(<BrandLogo branding={null} />);
  expect(
    new URL(
      screen.getByAltText("Signa").getAttribute("src")!,
      window.location.origin,
    ).searchParams.get("url"),
  ).toBe("/images/logo.png");
});
it("uses the organization title when whitelabeling has no logo or its image fails", () => {
  const view = render(<BrandLogo branding={{ ...branding, logo: null }} />);
  expect(screen.getByText(branding.account_name)).toBeTruthy();
  expect(document.querySelector("img")).toBeNull();
  view.rerender(<BrandLogo branding={branding} />);
  fireEvent.error(document.querySelector("img")!);
  expect(screen.getByText(branding.account_name)).toBeTruthy();
  expect(document.querySelector("img")).toBeNull();
});
it("hides the business title when configured and keeps an accessible organization label on its logo", () => {
  render(<BrandLogo branding={{ ...branding, show_business_name: false }} />);
  expect(screen.getByAltText(branding.account_name)).toBeTruthy();
  expect(document.querySelector("[data-brand-name]")).toBeNull();
});
it("hides Signa attribution for whitelabel organizations and keeps it for normal branding", () => {
  const view = render(<BrandAttribution branding={branding} />);
  expect(screen.queryByText(/Powered by/)).toBeNull();
  view.rerender(<BrandAttribution branding={null} />);
  expect(screen.getByText(/Powered by/)).toBeTruthy();
});
it("validates colors before writing theme CSS and restores document title and favicon on unmount", () => {
  document.title = "Original title";
  const view = render(
    <BrandStyle
      branding={{
        ...branding,
        primary_color: "</style><script>invalid</script>",
      }}
    />,
  );
  expect(document.title).toBe(branding.account_name);
  const css = document.querySelector(
    "style[data-account-branding]",
  )!.textContent!;
  expect(css).toContain(":root.dark");
  expect(css).not.toContain("<script>");
  expect(document.querySelector("link[rel=icon]")).toBeTruthy();
  view.unmount();
  expect(document.title).toBe("Original title");
  expect(document.querySelector("link[rel=icon]")).toBeNull();
});
it("does not write theme overrides for unresolved branding", () => {
  const view = render(<BrandStyle />);
  expect(document.querySelector("style[data-account-branding]")).toBeNull();
  view.rerender(
    <BrandStyle
      branding={{ ...branding, white_label: false, primary_color: null }}
    />,
  );
  expect(document.querySelector("style[data-account-branding]")).toBeTruthy();
});
