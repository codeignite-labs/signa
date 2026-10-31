import "./browser-settings-fixture";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { PersonalizationSettingsBody } from "../../../apps/frontend/app/settings/_components/personalization-settings-body";
import {
  getAccountPreferences,
  updateAccountPreferences,
} from "../../../apps/frontend/lib/api/auth";
import { preferences } from "./preferences-fixture";
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(
  "../../../apps/frontend/app/settings/_components/settings-sidebar",
  () => ({ SettingsSidebar: () => null }),
);
vi.mock(
  "../../../apps/frontend/app/settings/_components/account-branding-settings",
  () => ({ AccountBrandingSettings: () => null }),
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
async function renderPreferences() {
  render(<PersonalizationSettingsBody />);
  await screen.findByRole("heading", { name: "Personalization" });
}
it("shows loading then email and submission personalization sections", async () => {
  render(<PersonalizationSettingsBody />);
  expect(screen.getByText("Loading personalization...")).toBeTruthy();
  await screen.findByRole("heading", { name: "Personalization" });
  expect(screen.getByText("Email Templates")).toBeTruthy();
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
});
it.each([new Error("Preferences denied"), null])(
  "reports personalization load failure %s",
  async (failure) => {
    vi.mocked(getAccountPreferences).mockRejectedValue(failure);
    render(<PersonalizationSettingsBody />);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Personalization settings could not be loaded",
        {
          description:
            failure instanceof Error ? failure.message : "Request failed",
        },
      ),
    );
  },
);
it.each([
  ["Signature Request Email", "submitter_invitation_email"],
  ["Completed Notification Email", "submitter_completed_email"],
  ["Documents copy Email", "submitter_documents_copy_email"],
] as const)(
  "edits the %s subject without dropping template attachments and flags",
  async (label, key) => {
    await renderPreferences();
    fireEvent.click(screen.getByRole("button", { name: label }));
    await screen.findByLabelText("Subject");
    expect(
      screen.getByRole("button", { name: "SAVE" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Custom subject" },
    });
    fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
    await waitFor(() =>
      expect(updateAccountPreferences).toHaveBeenCalledWith({
        [key]: { ...preferences[key], subject: "Custom subject" },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Personalization settings saved",
    );
  },
);
it("saves the completed form title and body with a fresh clean draft after successful save", async () => {
  await renderPreferences();
  fireEvent.click(
    screen.getByRole("button", { name: "Completed Form Message" }),
  );
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Thank you" },
  });
  fireEvent.change(screen.getByLabelText("Body"), {
    target: { value: "Your signature is complete." },
  });
  fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
  await waitFor(() =>
    expect(updateAccountPreferences).toHaveBeenCalledWith({
      form_completed_message: {
        title: "Thank you",
        body: "Your signature is complete.",
      },
    }),
  );
});
it("saves a completed form redirect button", async () => {
  await renderPreferences();
  fireEvent.click(
    screen.getByRole("button", { name: "Completed Form Redirect Button" }),
  );
  fireEvent.change(screen.getByLabelText("Button title"), {
    target: { value: "Return to account" },
  });
  fireEvent.change(screen.getByLabelText("Button URL"), {
    target: { value: "https://example.test/account" },
  });
  fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
  await waitFor(() =>
    expect(updateAccountPreferences).toHaveBeenCalledWith({
      form_completed_button: {
        title: "Return to account",
        url: "https://example.test/account",
      },
    }),
  );
});
it("toggles completion confetti and reports save failures while preserving other settings", async () => {
  await renderPreferences();
  fireEvent.click(screen.getByRole("switch"));
  await waitFor(() =>
    expect(updateAccountPreferences).toHaveBeenCalledWith({
      form_with_confetti: false,
    }),
  );
  vi.mocked(updateAccountPreferences).mockRejectedValue(
    new Error("Save denied"),
  );
  fireEvent.click(screen.getByRole("switch"));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Personalization settings failed to save",
      { description: "Save denied" },
    ),
  );
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
});
it("updates the email markdown body through the real editor input", async () => {
  await renderPreferences();
  fireEvent.click(
    screen.getByRole("button", { name: "Signature Request Email" }),
  );
  const editor = await screen.findByLabelText("Body");
  fireEvent.input(editor, { target: { textContent: "Custom email body" } });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "SAVE" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
  await waitFor(() =>
    expect(updateAccountPreferences).toHaveBeenCalledWith({
      submitter_invitation_email: {
        ...preferences.submitter_invitation_email,
        body: "Custom email body",
      },
    }),
  );
});
