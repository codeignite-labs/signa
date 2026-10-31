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
import { MfaSection } from "../../../apps/frontend/app/settings/_components/profile-mfa-section";
import {
  startMfaSetup,
  enableMfa,
  disableMfa,
} from "../../../apps/frontend/lib/api/auth";
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("qr-creator", () => ({ default: { render: vi.fn() } }));
vi.mock("../../../apps/frontend/lib/api/auth", () => ({
  startMfaSetup: vi.fn(),
  enableMfa: vi.fn(),
  disableMfa: vi.fn(),
}));
const setup = {
  secret: "TEST-SECRET",
  provisioning_uri: "otpauth://totp/Signa?secret=TEST",
  otp_required_for_login: false,
};
let onChange: (enabled: boolean) => void;
beforeEach(() => {
  vi.clearAllMocks();
  onChange = vi.fn<(enabled: boolean) => void>();
  vi.mocked(startMfaSetup).mockResolvedValue(setup);
  vi.mocked(enableMfa).mockResolvedValue({ otp_required_for_login: true });
  vi.mocked(disableMfa).mockResolvedValue({ otp_required_for_login: false });
});
it("opens MFA enrollment, displays the setup secret, sanitizes the code and enables MFA", async () => {
  render(<MfaSection enabled={false} onChange={onChange} />);
  expect(screen.getByText("2FA is not configured")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "SET UP 2FA" }));
  await screen.findByText(setup.secret);
  fireEvent.change(screen.getByPlaceholderText("XXX-XXX"), {
    target: { value: "12-a345678" },
  });
  expect(
    (screen.getByPlaceholderText("XXX-XXX") as HTMLInputElement).value,
  ).toBe("123456");
  fireEvent.submit(
    screen.getByRole("button", { name: "SAVE" }).closest("form")!,
  );
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(true));
  expect(enableMfa).toHaveBeenCalledWith("123456");
  expect(toast.success).toHaveBeenCalledWith("2FA has been configured");
});
it("blocks enrollment submission while a new secret is still loading", () => {
  vi.mocked(startMfaSetup).mockReturnValue(new Promise(() => {}));
  render(<MfaSection enabled={false} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "SET UP 2FA" }));
  expect(screen.getByText("Generating QR code...")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "SAVE" }).hasAttribute("disabled"),
  ).toBe(true);
});
it.each([new Error("Setup refused"), null])(
  "reports MFA setup failure %s",
  async (failure) => {
    vi.mocked(startMfaSetup).mockRejectedValue(failure);
    render(<MfaSection enabled={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "SET UP 2FA" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "2FA setup failed",
        expect.objectContaining({
          description:
            failure instanceof Error ? failure.message : "Please try again.",
        }),
      ),
    );
    expect(onChange).not.toHaveBeenCalled();
  },
);
it("retains a rejected enrollment code and keeps the setup dialog open", async () => {
  vi.mocked(enableMfa).mockRejectedValue(new Error("Invalid one-time code"));
  render(<MfaSection enabled={false} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "SET UP 2FA" }));
  await screen.findByText(setup.secret);
  fireEvent.change(screen.getByPlaceholderText("XXX-XXX"), {
    target: { value: "123456" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "SAVE" }).closest("form")!,
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "2FA code is invalid",
      expect.objectContaining({ description: "Invalid one-time code" }),
    ),
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});
it("requires a verification code to remove MFA and updates the parent after success", async () => {
  render(<MfaSection enabled onChange={onChange} />);
  expect(screen.getByText("2FA has been configured")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "REMOVE 2FA" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByPlaceholderText("XXX-XXX"), {
    target: { value: "654321" },
  });
  fireEvent.submit(
    within(dialog).getByRole("button", { name: "REMOVE 2FA" }).closest("form")!,
  );
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(false));
  expect(disableMfa).toHaveBeenCalledWith("654321");
  expect(toast.success).toHaveBeenCalledWith("2FA has been removed");
});
it("reports MFA removal failure without altering the parent enabled state", async () => {
  vi.mocked(disableMfa).mockRejectedValue("failure");
  render(<MfaSection enabled onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "REMOVE 2FA" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByPlaceholderText("XXX-XXX"), {
    target: { value: "654321" },
  });
  fireEvent.submit(
    within(dialog).getByRole("button", { name: "REMOVE 2FA" }).closest("form")!,
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "2FA removal failed",
      expect.objectContaining({ description: "Please try again." }),
    ),
  );
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeTruthy();
});
