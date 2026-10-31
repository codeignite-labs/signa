// @vitest-environment node
import { expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AccountBrandingProvider,
  useAccountBranding,
} from "../../../apps/frontend/components/branding/account-branding-provider";
import { BrandLogo } from "../../../apps/frontend/components/branding/brand-logo";
import { BrandName } from "../../../apps/frontend/components/branding/brand-name";
import { SigningBrandStyle } from "../../../apps/frontend/components/branding/signing-brand-style";
import { AccountSettingsBody } from "../../../apps/frontend/app/settings/_components/account-settings-body";
import { getAccountBranding } from "../../../apps/frontend/lib/api/branding";
vi.mock("next/navigation", () => ({
  usePathname: () => "/templates",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(
  "../../../apps/frontend/app/settings/_components/settings-sidebar",
  () => ({ SettingsSidebar: () => null }),
);
vi.mock("../../../apps/frontend/lib/api/branding", () => ({
  getAccountBranding: vi.fn(),
}));
vi.mock("../../../apps/frontend/lib/api/auth", () => ({
  getAuthSession: vi.fn(),
  subscribeToAuthSessionChange: vi.fn(),
  getAccount: vi.fn(),
  getAccountPreferences: vi.fn(),
  updateAccount: vi.fn(),
  updateAccountPreferences: vi.fn(),
  deleteAccount: vi.fn(),
}));
function Consumer() {
  const brand = useAccountBranding();
  return (
    <>
      <span>{brand === undefined ? "unresolved" : "resolved"}</span>
      <BrandLogo />
      <BrandName />
    </>
  );
}
it("renders a privacy-preserving brand placeholder on the server and does not request browser account data", () => {
  const html = renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <AccountBrandingProvider>
        <Consumer />
      </AccountBrandingProvider>
    </QueryClientProvider>,
  );
  expect(html).toContain("unresolved");
  expect(html).toContain("data-brand-placeholder");
  expect(html).not.toContain("data-platform-logo");
  expect(getAccountBranding).not.toHaveBeenCalled();
});
it("renders signing branding without accessing URL, iframe or native browser globals during SSR", () => {
  const html = renderToString(
    <SigningBrandStyle
      branding={{
        account_name: "Organization",
        primary_color: "#112233",
        white_label: true,
        logo: null,
      }}
    />,
  );
  expect(html).toContain("--brand-original:#112233");
  expect(html).toContain(":root.dark");
});
it("renders an empty account identity form on the server without reading another browser session", () => {
  const html = renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <AccountSettingsBody />
    </QueryClientProvider>,
  );
  expect(html).toContain('id="company-name"');
  expect(html).toContain('value=""');
});
