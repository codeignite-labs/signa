import "./browser-settings-fixture";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { AccountSettingsBody } from "../../../apps/frontend/app/settings/_components/account-settings-body";
import * as auth from "../../../apps/frontend/lib/api/auth";
import { ApiError } from "../../../apps/frontend/lib/api/http";
import { appDictionaries } from "../../../apps/frontend/lib/i18n/app-dictionaries";
import { preferences } from "./preferences-fixture";
import { user } from "./settings-fixtures";
const state = vi.hoisted(() => ({ push: vi.fn(), setLocale: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => state }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(
  "../../../apps/frontend/app/settings/_components/settings-sidebar",
  () => ({ SettingsSidebar: () => null }),
);
vi.mock("../../../apps/frontend/lib/i18n/use-app-i18n", async () => {
  const { appDictionaries } =
    await import("../../../apps/frontend/lib/i18n/app-dictionaries");
  return {
    useAppI18n: () => ({
      dictionary: appDictionaries.en,
      setLocale: state.setLocale,
    }),
  };
});
vi.mock("../../../apps/frontend/lib/api/auth", () => ({
  getAuthSession: vi.fn(),
  getAccount: vi.fn(),
  getAccountPreferences: vi.fn(),
  updateAccount: vi.fn(),
  updateAccountPreferences: vi.fn(),
  deleteAccount: vi.fn(),
}));
const account = {
  id: "account-1",
  name: "Example Organization",
  locale: "en-US",
  timezone: "UTC",
};
const dictionary = appDictionaries.en;
let queryClient: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  vi.mocked(auth.getAuthSession).mockReturnValue({
    access_token: "token",
    user,
    account,
  });
  vi.mocked(auth.getAccount).mockResolvedValue(account);
  vi.mocked(auth.getAccountPreferences).mockResolvedValue(preferences);
  vi.mocked(auth.updateAccount).mockImplementation(async (patch) => ({
    ...account,
    ...patch,
  }));
  vi.mocked(auth.updateAccountPreferences).mockImplementation(
    async (patch) => ({ ...preferences, ...patch }),
  );
  vi.mocked(auth.deleteAccount).mockResolvedValue({
    ...account,
    archived_at: "2026-01-01",
  });
});
async function renderAccount() {
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettingsBody />
    </QueryClientProvider>,
  );
  await screen.findByDisplayValue(account.name);
  await waitFor(() =>
    expect(
      screen
        .getByRole("switch", {
          name: dictionary.preferences.with_signature_id.label,
        })
        .getAttribute("aria-checked"),
    ).toBe("true"),
  );
}
function submitAccount() {
  fireEvent.submit(
    screen.getByLabelText(dictionary.account.companyName).closest("form")!,
  );
}
async function chooseAt(index: number, name: string | RegExp) {
  fireEvent.keyDown(screen.getAllByRole("combobox")[index], {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("option", { name }));
}
it("loads account details, seeds the local form and renders signing and compliance preference controls", async () => {
  await renderAccount();
  expect(auth.getAccount).toHaveBeenCalledTimes(1);
  expect(
    screen
      .getByRole("button", { name: dictionary.common.update })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getAllByRole("switch")).toHaveLength(14);
  expect(
    screen.getByRole("heading", { name: dictionary.compliance.hipaa.label }),
  ).toBeTruthy();
});
it("falls back to blank organization and Nairobi timezone when no session is locally cached", async () => {
  vi.mocked(auth.getAuthSession).mockReturnValue(null);
  vi.mocked(auth.getAccount).mockReturnValue(new Promise(() => {}));
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettingsBody />
    </QueryClientProvider>,
  );
  expect(
    (screen.getByLabelText(dictionary.account.companyName) as HTMLInputElement)
      .value,
  ).toBe("");
  expect(screen.getAllByRole("combobox")[0].textContent).toContain("Nairobi");
  fireEvent.click(
    screen.getByRole("switch", {
      name: dictionary.preferences.force_mfa.label,
    }),
  );
  expect(auth.updateAccountPreferences).not.toHaveBeenCalled();
});
it.each([
  new ApiError("Unauthorized", 401),
  new ApiError("Server unavailable", 503),
  new Error("raw internal message"),
])("handles account load failure %s", async (failure) => {
  vi.mocked(auth.getAccount).mockRejectedValue(failure);
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettingsBody />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    if (failure instanceof ApiError && failure.status === 401)
      expect(state.push).toHaveBeenCalledWith("/auth/login");
    else
      expect(toast.error).toHaveBeenCalledWith(
        dictionary.account.loadedError,
        expect.objectContaining({
          description:
            failure instanceof ApiError
              ? failure.message
              : "Something went wrong. Please try again.",
        }),
      );
  });
});
it("does not submit unchanged details and updates organization branding in the query cache immediately on rename", async () => {
  queryClient.setQueryData(["account-branding", account.id], {
    account_name: account.name,
    logo: null,
    primary_color: null,
    white_label: false,
  });
  await renderAccount();
  submitAccount();
  expect(auth.updateAccount).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(dictionary.account.companyName), {
    target: { value: "Updated Organization" },
  });
  submitAccount();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      dictionary.account.updated,
      expect.any(Object),
    ),
  );
  expect(auth.updateAccount).toHaveBeenCalledWith({
    name: "Updated Organization",
  });
  expect(
    queryClient.getQueryData(["account-branding", account.id]),
  ).toMatchObject({ account_name: "Updated Organization" });
  expect(state.setLocale).toHaveBeenCalledWith("en");
});
it("handles a rename without a cached branding record and supports a changed timezone", async () => {
  await renderAccount();
  await chooseAt(0, /Nairobi/);
  fireEvent.change(screen.getByLabelText(dictionary.account.companyName), {
    target: { value: "Updated" },
  });
  submitAccount();
  await waitFor(() =>
    expect(auth.updateAccount).toHaveBeenCalledWith({
      name: "Updated",
      timezone: "Africa/Nairobi",
    }),
  );
  expect(
    queryClient.getQueryData(["account-branding", account.id]),
  ).toBeUndefined();
});
it("preserves unsaved account values and reports API error text on update failure", async () => {
  vi.mocked(auth.updateAccount).mockRejectedValue(
    new ApiError("Account locked", 403),
  );
  await renderAccount();
  fireEvent.change(screen.getByLabelText(dictionary.account.companyName), {
    target: { value: "Changed" },
  });
  submitAccount();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      dictionary.account.updateFailed,
      expect.objectContaining({ description: "Account locked" }),
    ),
  );
  expect(
    (screen.getByLabelText(dictionary.account.companyName) as HTMLInputElement)
      .value,
  ).toBe("Changed");
});
it("saves language changes immediately and clears their dirty state", async () => {
  await renderAccount();
  await chooseAt(1, "Français");
  await waitFor(() =>
    expect(auth.updateAccount).toHaveBeenCalledWith({ locale: "fr-FR" }),
  );
  expect(state.setLocale).toHaveBeenCalledWith("fr");
  expect(
    screen
      .getByRole("button", { name: dictionary.common.update })
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("rolls the language and local dictionary back if the server rejects a locale change", async () => {
  vi.mocked(auth.updateAccount).mockRejectedValue(
    new ApiError("Locale unavailable", 422),
  );
  await renderAccount();
  await chooseAt(1, "Français");
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      dictionary.account.updateFailed,
      expect.objectContaining({ description: "Locale unavailable" }),
    ),
  );
  expect(state.setLocale).toHaveBeenLastCalledWith("en");
  expect(screen.getAllByRole("combobox")[1].textContent).toContain("English");
});
it.each([
  "force_mfa",
  "with_signature_id",
  "require_signing_reason",
  "allow_typed_signature",
  "allow_to_resubmit",
  "allow_to_decline",
  "allow_to_delegate",
  "form_prefill_signature",
  "download_links_expire",
  "download_links_auth",
  "combine_pdf_result_key",
] as const)(
  "saves the %s account setting without replacing unrelated preferences",
  async (key) => {
    await renderAccount();
    fireEvent.click(
      screen.getByRole("switch", { name: dictionary.preferences[key].label }),
    );
    await waitFor(() =>
      expect(auth.updateAccountPreferences).toHaveBeenCalledWith({
        [key]: !preferences[key],
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      dictionary.account.preferenceUpdated,
      expect.objectContaining({
        description: dictionary.preferences[key].label,
      }),
    );
  },
);
it.each(["hipaa", "cfr_part_11", "knowledge_based_authentication"] as const)(
  "saves the %s compliance control",
  async (key) => {
    await renderAccount();
    fireEvent.click(document.getElementById("account-preference-" + key)!);
    await waitFor(() =>
      expect(auth.updateAccountPreferences).toHaveBeenCalledWith({
        [key]: true,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      dictionary.account.preferenceUpdated,
      expect.objectContaining({
        description: dictionary.compliance[key].label,
      }),
    );
  },
);
it("rolls preferences back after a failed save", async () => {
  vi.mocked(auth.updateAccountPreferences).mockRejectedValue(
    new ApiError("Policy restricted", 403),
  );
  await renderAccount();
  const control = screen.getByRole("switch", {
    name: dictionary.preferences.force_mfa.label,
  });
  fireEvent.click(control);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      dictionary.account.preferenceFailed,
      expect.objectContaining({ description: "Policy restricted" }),
    ),
  );
  expect(control.getAttribute("aria-checked")).toBe("false");
  expect(control.hasAttribute("disabled")).toBe(false);
});
it("requires explicit account deletion confirmation and navigates after deletion", async () => {
  await renderAccount();
  fireEvent.click(
    screen.getByRole("button", { name: dictionary.account.deleteAccount }),
  );
  expect(auth.deleteAccount).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: dictionary.common.keepMyAccount }),
  );
  expect(auth.deleteAccount).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: dictionary.account.deleteAccount }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: dictionary.common.deleteAnyway }),
  );
  await waitFor(() =>
    expect(state.push).toHaveBeenCalledWith("/auth/register"),
  );
  expect(auth.deleteAccount).toHaveBeenCalledTimes(1);
});
it("retains the account and reports an error if deletion fails", async () => {
  vi.mocked(auth.deleteAccount).mockRejectedValue(
    new ApiError("Delete denied", 403),
  );
  await renderAccount();
  fireEvent.click(
    screen.getByRole("button", { name: dictionary.account.deleteAccount }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: dictionary.common.deleteAnyway }),
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      dictionary.account.updateFailed,
      expect.objectContaining({ description: "Delete denied" }),
    ),
  );
  expect(state.push).not.toHaveBeenCalled();
});
it("displays the fallback language label for an organization with an unsupported saved locale", async () => {
  vi.mocked(auth.getAccount).mockResolvedValue({ ...account, locale: "xx-XX" });
  await renderAccount();
  expect(screen.getAllByRole("combobox")[1].textContent).toContain("English");
});
