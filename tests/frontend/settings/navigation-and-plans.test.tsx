import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SettingsSidebar } from "../../../apps/frontend/app/settings/_components/settings-sidebar";
import { PlansSettingsBody } from "../../../apps/frontend/app/settings/_components/plans-settings-body";
import { appDictionaries } from "../../../apps/frontend/lib/i18n/app-dictionaries";
import type { AccountBranding } from "../../../packages/shared/src/branding";
const state = vi.hoisted(() => ({
  branding: null as AccountBranding | null | undefined,
  isTestMode: false,
  isPending: false,
  setTestMode: vi.fn(),
}));
vi.mock(
  "../../../apps/frontend/components/branding/account-branding-provider",
  () => ({ useAccountBranding: () => state.branding }),
);
vi.mock("../../../apps/frontend/lib/hooks/use-test-mode", () => ({
  useTestMode: () => state,
}));
vi.mock("../../../apps/frontend/lib/i18n/use-app-i18n", async () => {
  const { appDictionaries } =
    await import("../../../apps/frontend/lib/i18n/app-dictionaries");
  return { useAppI18n: () => ({ dictionary: appDictionaries.en }) };
});
beforeEach(() => {
  vi.clearAllMocks();
  state.branding = null;
  state.isTestMode = false;
  state.isPending = false;
});
it("links each available settings area, marks the current section and disables the unfinished embedding area", () => {
  render(<SettingsSidebar active="Teams" />);
  expect(
    screen.getByRole("navigation", { name: "Settings sections" }),
  ).toBeTruthy();
  expect(screen.getByRole("link", { name: "Teams" }).getAttribute("href")).toBe(
    "/settings/teams",
  );
  expect(
    screen
      .getByRole("link", { name: appDictionaries.en.common.back })
      .getAttribute("href"),
  ).toBe("/templates");
  expect(screen.queryByRole("link", { name: "Embedding" })).toBeNull();
  expect(screen.getByText("License")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "support@signa.local" })
      .getAttribute("href"),
  ).toBe("mailto:support@signa.local");
});
it("changes test mode and disables changes while an account mode switch is in progress", () => {
  const view = render(<SettingsSidebar active="API" />);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(state.setTestMode).toHaveBeenCalledWith(true);
  state.isPending = true;
  state.isTestMode = true;
  view.rerender(<SettingsSidebar active="API" />);
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
});
it("hides platform support chrome while branding is unresolved or whitelabeled", () => {
  state.branding = undefined;
  const view = render(<SettingsSidebar active="Account" />);
  expect(
    screen.queryByRole("link", { name: "support@signa.local" }),
  ).toBeNull();
  state.branding = {
    account_name: "Organization",
    primary_color: null,
    white_label: true,
    logo: null,
  };
  view.rerender(<SettingsSidebar active="Account" />);
  expect(screen.queryByText(appDictionaries.en.settings.help)).toBeNull();
});
it("switches billing terms and recalculates the displayed monthly equivalent", () => {
  render(<PlansSettingsBody />);
  expect(screen.getByText("$560")).toBeTruthy();
  expect(screen.getByText("Approx. $47 / month equivalent")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "3 years" }));
  expect(screen.getByText("$1380")).toBeTruthy();
  expect(screen.getByText("Approx. $38 / month equivalent")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Annual" }));
  expect(screen.getByText("$560")).toBeTruthy();
});
