import "./browser-settings-fixture";
import { beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { toast } from "sonner";
import { ProfileSettingsBody } from "../../../apps/frontend/app/settings/_components/profile-settings-body";
import * as auth from "../../../apps/frontend/lib/api/auth";
import { ApiError } from "../../../apps/frontend/lib/api/http";
import { user } from "./settings-fixtures";
const state = vi.hoisted(() => ({
  push: vi.fn(),
  clear: vi.fn(),
  empty: true,
}));
vi.mock("next/navigation", () => ({ useRouter: () => state }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(
  "../../../apps/frontend/app/settings/_components/settings-sidebar",
  () => ({ SettingsSidebar: () => null }),
);
vi.mock("react-signature-canvas", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    default: forwardRef(function TestPad(_props, ref) {
      useImperativeHandle(ref, () => ({
        clear: state.clear,
        isEmpty: () => state.empty,
        getTrimmedCanvas: () => ({
          toDataURL: () => "data:image/png;base64,aW1hZ2U=",
        }),
      }));
      return <canvas aria-label="Signature drawing surface" />;
    }),
  };
});
vi.mock("qr-creator", () => ({ default: { render: vi.fn() } }));
vi.mock("../../../apps/frontend/lib/api/auth", () => ({
  getAuthSession: vi.fn(),
  getProfile: vi.fn(),
  getProfileAsset: vi.fn(),
  getMfaStatus: vi.fn(),
  updateProfile: vi.fn(),
  updatePassword: vi.fn(),
  uploadProfileAsset: vi.fn(),
  deleteProfileAsset: vi.fn(),
  startMfaSetup: vi.fn(),
  enableMfa: vi.fn(),
  disableMfa: vi.fn(),
}));
const asset = {
  uuid: "asset-1",
  filename: "signature.png",
  content_type: "image/png",
  url: "/signature.png",
};
beforeEach(() => {
  vi.clearAllMocks();
  state.empty = true;
  vi.mocked(auth.getAuthSession).mockReturnValue({
    access_token: "token",
    user,
    account: { id: "1", name: "Org", locale: "en-US", timezone: "UTC" },
  });
  vi.mocked(auth.getProfile).mockResolvedValue(user);
  vi.mocked(auth.getProfileAsset).mockResolvedValue(null);
  vi.mocked(auth.getMfaStatus).mockResolvedValue({
    otp_required_for_login: false,
  });
  vi.mocked(auth.updateProfile).mockImplementation(async (patch) => ({
    ...user,
    ...patch,
  }));
  vi.mocked(auth.updatePassword).mockResolvedValue(user);
  vi.mocked(auth.uploadProfileAsset).mockResolvedValue(asset);
  vi.mocked(auth.deleteProfileAsset).mockResolvedValue(null);
});
async function renderProfile() {
  render(<ProfileSettingsBody />);
  await screen.findByDisplayValue(user.email);
  await waitFor(() => expect(auth.getProfile).toHaveBeenCalled());
}
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function submitProfile() {
  fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
}
it("loads profile details and saved assets and exposes the Gmail integration settings link", async () => {
  vi.mocked(auth.getProfileAsset).mockResolvedValue(asset);
  await renderProfile();
  await screen.findByAltText("Signature");
  expect(screen.getByAltText("Initials")).toBeTruthy();
  expect(auth.getProfileAsset).toHaveBeenCalledWith("signature");
  expect(auth.getProfileAsset).toHaveBeenCalledWith("initials");
  expect(
    screen.getByRole("link", { name: "CONNECT GMAIL" }).getAttribute("href"),
  ).toBe("/settings/integrations");
});
it("renders blank profile defaults without a local session and normalizes null profile names", async () => {
  vi.mocked(auth.getAuthSession).mockReturnValue(null);
  vi.mocked(auth.getProfile).mockResolvedValue({
    ...user,
    first_name: null,
    last_name: null,
  });
  await renderProfile();
  expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe(
    "",
  );
  expect((screen.getByLabelText("Last name") as HTMLInputElement).value).toBe(
    "",
  );
});
it.each([
  new ApiError("Unauthorized", 401),
  new ApiError("Profile denied", 403),
  new Error("offline"),
  null,
])("handles profile loading failure %s", async (failure) => {
  vi.mocked(auth.getProfile).mockRejectedValue(failure);
  render(<ProfileSettingsBody />);
  await waitFor(() => {
    if (failure instanceof ApiError && failure.status === 401)
      expect(state.push).toHaveBeenCalledWith("/auth/login");
    else
      expect(toast.error).toHaveBeenCalledWith(
        "Profile could not be loaded",
        expect.objectContaining({
          description:
            failure instanceof Error ? failure.message : "Something went wrong",
        }),
      );
  });
});
it("skips unchanged submissions and sends only changed profile fields", async () => {
  await renderProfile();
  submitProfile();
  expect(auth.updateProfile).not.toHaveBeenCalled();
  fill("First name", "Grace");
  fill("Last name", "Hopper");
  fill("Email", "grace@example.test");
  submitProfile();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Profile updated",
      expect.any(Object),
    ),
  );
  expect(auth.updateProfile).toHaveBeenCalledWith({
    first_name: "Grace",
    last_name: "Hopper",
    email: "grace@example.test",
  });
  expect(
    screen
      .getAllByRole("button", { name: "UPDATE" })[0]
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("retains profile form edits and exposes validation messages when the update fails", async () => {
  vi.mocked(auth.updateProfile).mockRejectedValue(
    new ApiError("Email unavailable", 422),
  );
  await renderProfile();
  fill("Email", "changed@example.test");
  submitProfile();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Profile update failed",
      expect.objectContaining({ description: "Email unavailable" }),
    ),
  );
  expect(screen.getByText("Email unavailable")).toBeTruthy();
});
it("changes a password and clears all password fields after success", async () => {
  await renderProfile();
  const passwordForm = screen.getByLabelText("New password").closest("form")!;
  fireEvent.submit(passwordForm);
  expect(auth.updatePassword).not.toHaveBeenCalled();
  fill("New password", "new-password");
  fill("Confirm password", "new-password");
  fill("Current password", "old-password");
  fireEvent.submit(passwordForm);
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Password updated"),
  );
  expect(auth.updatePassword).toHaveBeenCalledWith({
    current_password: "old-password",
    password: "new-password",
    password_confirmation: "new-password",
  });
  for (const label of ["New password", "Confirm password", "Current password"])
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("");
});
it("preserves password entries and permits retry after password validation fails", async () => {
  vi.mocked(auth.updatePassword).mockRejectedValue(
    new Error("Current password invalid"),
  );
  await renderProfile();
  fill("New password", "new-password");
  fireEvent.submit(screen.getByLabelText("New password").closest("form")!);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Password update failed",
      expect.objectContaining({ description: "Current password invalid" }),
    ),
  );
  expect(
    (screen.getByLabelText("New password") as HTMLInputElement).value,
  ).toBe("new-password");
});
it("removes a saved signature after a successful backend deletion", async () => {
  vi.mocked(auth.getProfileAsset).mockImplementation(async (key) =>
    key === "signature" ? asset : null,
  );
  await renderProfile();
  await screen.findByAltText("Signature");
  fireEvent.click(screen.getByRole("button", { name: "REMOVE" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Signature removed"),
  );
  expect(auth.deleteProfileAsset).toHaveBeenCalledWith("signature");
  expect(screen.queryByAltText("Signature")).toBeNull();
});
it("retains a saved signature when deletion fails", async () => {
  vi.mocked(auth.getProfileAsset).mockImplementation(async (key) =>
    key === "signature" ? asset : null,
  );
  vi.mocked(auth.deleteProfileAsset).mockRejectedValue(
    new Error("Asset locked"),
  );
  await renderProfile();
  await screen.findByAltText("Signature");
  fireEvent.click(screen.getByRole("button", { name: "REMOVE" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Signature removal failed",
      expect.objectContaining({ description: "Asset locked" }),
    ),
  );
  expect(screen.getByAltText("Signature")).toBeTruthy();
});
async function uploadAsset(kind: "Signature" | "Initials") {
  await renderProfile();
  fireEvent.click(
    screen.getByRole("button", { name: "UPDATE " + kind.toUpperCase() }),
  );
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Upload" }), {
    button: 0,
    ctrlKey: false,
  });
  const dialog = screen.getByRole("dialog");
  await waitFor(() =>
    expect(dialog.querySelector("input[type=file]")).toBeTruthy(),
  );
  return dialog;
}
it.each(["Signature", "Initials"] as const)(
  "uploads and displays a saved %s asset",
  async (kind) => {
    const dialog = await uploadAsset(kind);
    const file = new File(["image"], kind.toLowerCase() + ".png", {
      type: "image/png",
    });
    fireEvent.change(dialog.querySelector("input[type=file]")!, {
      target: { files: [file] },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "SAVE" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(kind + " saved"),
    );
    expect(auth.uploadProfileAsset).toHaveBeenCalledWith(
      kind.toLowerCase(),
      file,
    );
    expect(screen.getByAltText(kind)).toBeTruthy();
  },
);
it("validates that an asset file is provided and reports upload errors without closing", async () => {
  const dialog = await uploadAsset("Signature");
  fireEvent.click(within(dialog).getByRole("button", { name: "SAVE" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Signature save failed",
      expect.objectContaining({ description: "Add a signature first" }),
    ),
  );
  vi.mocked(auth.uploadProfileAsset).mockRejectedValue(
    new Error("File not accepted"),
  );
  fireEvent.change(dialog.querySelector("input[type=file]")!, {
    target: { files: [new File(["image"], "signature.png")] },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "SAVE" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Signature save failed",
      expect.objectContaining({ description: "File not accepted" }),
    ),
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
});
it("closes the asset editor without saving", async () => {
  await renderProfile();
  fireEvent.click(screen.getByRole("button", { name: "UPDATE INITIALS" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(auth.uploadProfileAsset).not.toHaveBeenCalled();
});
it("requires a drawn mark before saving and clears the drawing surface", async () => {
  await renderProfile();
  fireEvent.click(screen.getByRole("button", { name: "UPDATE SIGNATURE" }));
  await screen.findByLabelText("Signature drawing surface");
  fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Signature save failed",
      expect.objectContaining({ description: "Add a signature first" }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(state.clear).toHaveBeenCalledTimes(1);
});
it("turns a nonempty drawn signature into a PNG upload", async () => {
  state.empty = false;
  await renderProfile();
  fireEvent.click(screen.getByRole("button", { name: "UPDATE SIGNATURE" }));
  await screen.findByLabelText("Signature drawing surface");
  fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
  await waitFor(() =>
    expect(auth.uploadProfileAsset).toHaveBeenCalledWith(
      "signature",
      expect.objectContaining({
        name: "signature.png",
        type: "image/png",
        size: 5,
      }),
    ),
  );
  expect(toast.success).toHaveBeenCalledWith("Signature saved");
});
it("clears a previously selected upload when the file picker is canceled", async () => {
  const dialog = await uploadAsset("Signature");
  const input = dialog.querySelector("input[type=file]")!;
  fireEvent.change(input, {
    target: { files: [new File(["image"], "signature.png")] },
  });
  fireEvent.change(input, { target: { files: [] } });
  fireEvent.click(within(dialog).getByRole("button", { name: "SAVE" }));
  expect(auth.uploadProfileAsset).not.toHaveBeenCalled();
});
