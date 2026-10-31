import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const routing = vi.hoisted(() => ({ replace: vi.fn() }));
const loader = vi.hoisted(() => ({ start: vi.fn(), done: vi.fn() }));
const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => routing,
  redirect: (path: string) => {
    throw new Error("redirect:" + path);
  },
}));
vi.mock("nextjs-toploader", () => ({ useTopLoader: () => loader }));
vi.mock("sonner", () => ({ toast: notifications }));
import ForgotPasswordPage from "../../../apps/frontend/app/auth/forgot-password/page";
import ResetPasswordPage, {
  metadata,
} from "../../../apps/frontend/app/auth/reset-password/page";
import OtpPage from "../../../apps/frontend/app/auth/otp/page";
import { getAuthSession } from "../../../apps/frontend/lib/api/auth";
import { jsonResponse } from "../signing/signing-fixtures";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  routing.replace.mockClear();
  loader.start.mockClear();
  loader.done.mockClear();
  notifications.success.mockClear();
  notifications.error.mockClear();
  fetchMock = vi
    .fn()
    .mockImplementation(async () => jsonResponse({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/auth/forgot-password");
});
function submit(label: string) {
  fireEvent.submit(
    screen.getByRole("button", { name: label }).closest("form")!,
  );
}
function fillReset() {
  fireEvent.change(screen.getByLabelText("New Password"), {
    target: { value: "new-test-password" },
  });
  fireEvent.change(screen.getByLabelText("Confirm New Password"), {
    target: { value: "new-test-password" },
  });
}
it("sends recovery requests to the backend and shows a generic non-enumerating confirmation", async () => {
  render(<ForgotPasswordPage />);
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "casey@example.test" },
  });
  submit("RESET PASSWORD");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/forgot-password");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    email: "casey@example.test",
  });
  expect(await screen.findByRole("status")).toHaveProperty(
    "textContent",
    expect.stringContaining(
      "If an active account uses that address, we'll email a password reset link.",
    ),
  );
  expect(getAuthSession()).toBeNull();
  expect(loader.done).toHaveBeenCalledOnce();
});
it("validates recovery email before contacting the backend", async () => {
  render(<ForgotPasswordPage />);
  submit("RESET PASSWORD");
  await screen.findByText("Enter a valid email address.");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("submits the decoded emailed reset token and matching password then returns to login", async () => {
  window.history.replaceState(
    {},
    "",
    "/auth/reset-password?token=tok%2Ben%26value",
  );
  render(<ResetPasswordPage />);
  fillReset();
  submit("CHANGE MY PASSWORD");
  await waitFor(() =>
    expect(routing.replace).toHaveBeenCalledWith("/auth/login"),
  );
  expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/reset-password");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    token: "tok+en&value",
    password: "new-test-password",
    password_confirmation: "new-test-password",
  });
  expect(getAuthSession()).toBeNull();
  expect(notifications.success).toHaveBeenCalledWith(
    "Password updated",
    expect.anything(),
  );
});
it("rejects password mismatch before sending a reset request", async () => {
  window.history.replaceState({}, "", "/auth/reset-password?token=token");
  render(<ResetPasswordPage />);
  fillReset();
  fireEvent.change(screen.getByLabelText("Confirm New Password"), {
    target: { value: "different-password" },
  });
  submit("CHANGE MY PASSWORD");
  await screen.findByText("Passwords do not match.");
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["", "?token="])(
  "reports a missing reset token for %s instead of submitting an empty token",
  async (query) => {
    window.history.replaceState({}, "", "/auth/reset-password" + query);
    render(<ResetPasswordPage />);
    fillReset();
    submit("CHANGE MY PASSWORD");
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith(
        "Request failed",
        expect.objectContaining({
          description:
            "Open the password reset link from your email to continue.",
        }),
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loader.done).toHaveBeenCalledOnce();
  },
);
it.each([true, false])(
  "handles reset failures with structured HTTP error %s and retains password fields for retry",
  async (structured) => {
    window.history.replaceState({}, "", "/auth/reset-password?token=expired");
    if (structured)
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          { error: "Password reset token is invalid or expired" },
          422,
        ),
      );
    else fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));
    render(<ResetPasswordPage />);
    fillReset();
    submit("CHANGE MY PASSWORD");
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith(
        "Request failed",
        expect.objectContaining({
          description: structured
            ? "Password reset token is invalid or expired"
            : "Unable to reset your password. Please try again.",
        }),
      ),
    );
    expect(screen.getByLabelText("New Password")).toHaveProperty(
      "value",
      "new-test-password",
    );
    expect(
      screen
        .getByRole("button", { name: "CHANGE MY PASSWORD" })
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(routing.replace).not.toHaveBeenCalled();
  },
);
it.each([true, false])(
  "handles recovery request failures with structured HTTP error %s",
  async (structured) => {
    if (structured)
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: "Too many requests" }, 429),
      );
    else fetchMock.mockRejectedValueOnce(null);
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "casey@example.test" },
    });
    submit("RESET PASSWORD");
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith(
        "Request failed",
        expect.objectContaining({
          description: structured
            ? "Too many requests"
            : "Unable to send a reset link. Please try again.",
        }),
      ),
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(loader.done).toHaveBeenCalledOnce();
  },
);
it("keeps the recovery action pending until the server responds", async () => {
  let resolve: ((response: Response) => void) | undefined;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  render(<ForgotPasswordPage />);
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "casey@example.test" },
  });
  submit("RESET PASSWORD");
  expect(
    await screen.findByRole("button", { name: "RESETTING PASSWORD" }),
  ).toHaveProperty("disabled", true);
  await act(async () => {
    resolve?.(jsonResponse({ ok: true }));
  });
  await screen.findByRole("status");
  expect(
    screen
      .getByRole("button", { name: "RESET PASSWORD" })
      .hasAttribute("disabled"),
  ).toBe(false);
});
it("returns legacy standalone OTP links to login so credentials remain in the supported challenge flow", () => {
  expect(() => OtpPage()).toThrow("redirect:/auth/login");
});

it("prevents reset tokens leaking through referrer headers", () => {
  expect(metadata.referrer).toBe("no-referrer");
});
it("explains that standalone OTP submission needs the normal sign-in challenge context", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => null,
  });
  const { AuthShell } =
    await import("../../../apps/frontend/app/auth/_components/auth-shell");
  render(<AuthShell mode="otp" />);
  fireEvent.change(
    screen.getByLabelText("Two-factor code from authenticator app"),
    { target: { value: "123456" } },
  );
  submit("SIGN IN");
  await waitFor(() =>
    expect(notifications.error).toHaveBeenCalledWith(
      "Request failed",
      expect.objectContaining({
        description: "Sign in again to verify a two-factor code.",
      }),
    ),
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
