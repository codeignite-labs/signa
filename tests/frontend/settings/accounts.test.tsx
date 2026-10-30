import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import AccountsPage from "../../../apps/frontend/app/settings/accounts/page";
import { getAuthSession } from "../../../apps/frontend/lib/api/auth";
import {
  enterAccount,
  listAccountMemberships,
  type AccountMembership,
} from "../../../apps/frontend/lib/api/account-memberships";
import { user } from "./settings-fixtures";
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock(
  "../../../apps/frontend/app/settings/_components/settings-header",
  () => ({ SettingsHeader: () => null }),
);
vi.mock("../../../apps/frontend/lib/api/auth", () => ({
  getAuthSession: vi.fn(),
}));
vi.mock("../../../apps/frontend/lib/api/account-memberships", () => ({
  enterAccount: vi.fn(),
  listAccountMemberships: vi.fn(),
}));
const accounts: AccountMembership[] = [
  { id: "1", name: "Current Organization", role: "admin", status: "active" },
  { id: "2", name: "Partner Organization", role: "viewer", status: "active" },
  { id: "3", name: "Inviting Organization", role: "member", status: "invited" },
  { id: "4", name: "Expired Organization", role: "member", status: "expired" },
];
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listAccountMemberships).mockResolvedValue(accounts);
  vi.mocked(getAuthSession).mockReturnValue({
    access_token: "token",
    user,
    account: {
      id: "1",
      name: "Current Organization",
      timezone: "UTC",
      locale: "en-US",
    },
  });
  vi.mocked(enterAccount).mockResolvedValue(undefined);
});
it("loads all account memberships and distinguishes current, active, invited and expired accounts", async () => {
  render(<AccountsPage />);
  expect(screen.getByRole("status").textContent).toContain("Loading accounts");
  await screen.findByText("Partner Organization");
  expect(screen.queryByRole("status")).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Current account" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: "Invitation expired" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: "Switch account" })
      .hasAttribute("disabled"),
  ).toBe(false);
  expect(
    screen
      .getByRole("button", { name: "Accept invitation" })
      .hasAttribute("disabled"),
  ).toBe(false);
});
it.each([
  ["Switch account", "2", "switch"],
  ["Accept invitation", "3", "accept"],
])(
  "uses the correct account action for %s and prevents concurrent switching",
  async (label, id, action) => {
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: label }));
    await waitFor(() => expect(enterAccount).toHaveBeenCalledWith(id, action));
    for (const button of screen.getAllByRole("button"))
      expect(button.hasAttribute("disabled")).toBe(true);
  },
);
it.each([new Error("Membership expired"), "failure"])(
  "re-enables account switching and displays the failure %s",
  async (failure) => {
    vi.mocked(enterAccount).mockRejectedValue(failure);
    render(<AccountsPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Switch account" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        failure instanceof Error ? failure.message : "Unable to open account",
      ),
    );
    expect(
      screen
        .getByRole("button", { name: "Switch account" })
        .hasAttribute("disabled"),
    ).toBe(false);
  },
);
it("shows a load error and removes the loading indicator", async () => {
  vi.mocked(listAccountMemberships).mockRejectedValue(new Error("offline"));
  render(<AccountsPage />);
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Accounts could not be loaded.",
  );
  expect(screen.queryByRole("status")).toBeNull();
});
it("renders empty accounts and tolerates a missing local session", async () => {
  vi.mocked(getAuthSession).mockReturnValue(null);
  vi.mocked(listAccountMemberships).mockResolvedValue([]);
  render(<AccountsPage />);
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  expect(screen.queryByRole("button")).toBeNull();
});
it("allows entering an active account when there is no matching locally selected account", async () => {
  vi.mocked(getAuthSession).mockReturnValue(null);
  vi.mocked(listAccountMemberships).mockResolvedValue([accounts[0]]);
  render(<AccountsPage />);
  expect(
    (
      await screen.findByRole("button", { name: "Switch account" })
    ).hasAttribute("disabled"),
  ).toBe(false);
});
