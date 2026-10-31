import "./browser-settings-fixture";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { NotificationsSettingsBody } from "../../../apps/frontend/app/settings/_components/notifications-settings-body";
import {
  getAccountPreferences,
  updateAccountPreferences,
} from "../../../apps/frontend/lib/api/auth";
import { ApiError } from "../../../apps/frontend/lib/api/http";
import { preferences } from "./preferences-fixture";
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(
  "../../../apps/frontend/app/settings/_components/settings-sidebar",
  () => ({ SettingsSidebar: () => null }),
);
vi.mock("../../../apps/frontend/lib/api/auth", () => ({
  getAccountPreferences: vi.fn(),
  updateAccountPreferences: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAccountPreferences).mockResolvedValue(preferences);
  vi.mocked(updateAccountPreferences).mockImplementation(async (patch) => ({
    ...preferences,
    ...patch,
  }));
});
async function renderNotifications() {
  render(<NotificationsSettingsBody />);
  await waitFor(() => expect(getAccountPreferences).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "true",
    ),
  );
}
async function choose(label: string, option: string) {
  fireEvent.keyDown(screen.getByLabelText(label), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}
it("initializes notification and reminder forms from account preferences", async () => {
  vi.mocked(getAccountPreferences).mockResolvedValue({
    ...preferences,
    bcc_emails: "legal@example.test",
    submitter_reminders: {
      first_duration: "one_hour",
      second_duration: null,
      third_duration: "two_days",
    },
  });
  render(<NotificationsSettingsBody />);
  await screen.findByDisplayValue("legal@example.test");
  expect(screen.getByLabelText("First reminder in").textContent).toContain(
    "1 hour",
  );
  expect(screen.getByLabelText("Third reminder in").textContent).toContain(
    "2 days",
  );
  for (const button of screen.getAllByRole("button", { name: "SAVE" }))
    expect(button.hasAttribute("disabled")).toBe(true);
});
it.each([new ApiError("Unauthorized", 401), new Error("offline"), false])(
  "handles notification settings load error %s",
  async (failure) => {
    vi.mocked(getAccountPreferences).mockRejectedValue(failure);
    render(<NotificationsSettingsBody />);
    await waitFor(() => {
      if (failure instanceof ApiError)
        expect(navigation.push).toHaveBeenCalledWith("/auth/login");
      else
        expect(toast.error).toHaveBeenCalledWith(
          "Notification settings could not be loaded",
          expect.objectContaining({
            description:
              failure instanceof Error ? failure.message : "Please try again.",
          }),
        );
    });
  },
);
it("sends only changed email notification values and clears dirty state after save", async () => {
  await renderNotifications();
  fireEvent.change(
    screen.getByLabelText("Completed documents notification BCC address"),
    { target: { value: "legal@example.test" } },
  );
  fireEvent.click(screen.getByRole("switch"));
  fireEvent.click(screen.getAllByRole("button", { name: "SAVE" })[0]);
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Notification settings saved"),
  );
  expect(updateAccountPreferences).toHaveBeenCalledWith({
    bcc_emails: "legal@example.test",
    receive_completed_email: false,
  });
  expect(
    screen.getAllByRole("button", { name: "SAVE" })[0].hasAttribute("disabled"),
  ).toBe(true);
});
it("does not submit unchanged forms even when submitted programmatically", async () => {
  await renderNotifications();
  for (const button of screen.getAllByRole("button", { name: "SAVE" }))
    fireEvent.submit(button.closest("form")!);
  expect(updateAccountPreferences).not.toHaveBeenCalled();
});
it("retains notification changes after save failure", async () => {
  vi.mocked(updateAccountPreferences).mockRejectedValue(
    new Error("save denied"),
  );
  await renderNotifications();
  fireEvent.click(screen.getByRole("switch"));
  fireEvent.click(screen.getAllByRole("button", { name: "SAVE" })[0]);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Notification settings failed to save",
      expect.objectContaining({ description: "save denied" }),
    ),
  );
  expect(
    screen.getAllByRole("button", { name: "SAVE" })[0].hasAttribute("disabled"),
  ).toBe(false);
});
it("merges changed reminder durations and normalizes None back to null", async () => {
  await renderNotifications();
  await choose("First reminder in", "1 hour");
  await choose("Second reminder in", "2 days");
  await choose("Third reminder in", "30 days");
  fireEvent.click(screen.getAllByRole("button", { name: "SAVE" })[1]);
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Email reminders saved"),
  );
  expect(updateAccountPreferences).toHaveBeenLastCalledWith({
    submitter_reminders: {
      first_duration: "one_hour",
      second_duration: "two_days",
      third_duration: "thirty_days",
    },
  });
  await choose("Second reminder in", "None");
  fireEvent.click(screen.getAllByRole("button", { name: "SAVE" })[1]);
  await waitFor(() =>
    expect(updateAccountPreferences).toHaveBeenLastCalledWith({
      submitter_reminders: {
        first_duration: "one_hour",
        second_duration: null,
        third_duration: "thirty_days",
      },
    }),
  );
});
it("reports reminder save errors and preserves the selected duration for retry", async () => {
  vi.mocked(updateAccountPreferences).mockRejectedValue(null);
  await renderNotifications();
  await choose("First reminder in", "1 hour");
  fireEvent.click(screen.getAllByRole("button", { name: "SAVE" })[1]);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Email reminders failed to save",
      expect.objectContaining({ description: "Please try again." }),
    ),
  );
  expect(screen.getByLabelText("First reminder in").textContent).toContain(
    "1 hour",
  );
});
