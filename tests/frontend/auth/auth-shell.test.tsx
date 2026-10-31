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
vi.mock("next/navigation", () => ({ useRouter: () => routing }));
vi.mock("nextjs-toploader", () => ({ useTopLoader: () => loader }));
vi.mock("sonner", () => ({ toast: notifications }));
import {
  AuthShell,
  AuthNotice,
} from "../../../apps/frontend/app/auth/_components/auth-shell";
import LoginPage from "../../../apps/frontend/app/auth/login/page";
import RegisterPage from "../../../apps/frontend/app/auth/register/page";
import ForgotPasswordPage from "../../../apps/frontend/app/auth/forgot-password/page";
import ResetPasswordPage from "../../../apps/frontend/app/auth/reset-password/page";
import {
  getAuthSession,
  getSocialAuthStateKey,
} from "../../../apps/frontend/lib/api/auth";
import { jsonResponse } from "../signing/signing-fixtures";
let fetchMock: ReturnType<typeof vi.fn>;
const session = {
  access_token: "test-token",
  user: {
    id: "user",
    email: "casey@example.test",
    role: "admin",
    first_name: "Casey",
    last_name: "Example",
  },
  account: { id: "account", name: "Example", locale: "en-US", timezone: "UTC" },
};
beforeEach(() => {
  routing.replace.mockClear();
  loader.start.mockClear();
  loader.done.mockClear();
  notifications.success.mockClear();
  notifications.error.mockClear();
  fetchMock = vi
    .fn()
    .mockImplementation(async (url: string) =>
      jsonResponse(
        url.endsWith("/registration-status")
          ? { can_register: true, mode: "open", reason: null }
          : session,
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => null,
  });
  window.history.replaceState({}, "", "/auth/login");
  window.sessionStorage.clear();
});
function fillLogin() {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "casey@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "test-password" },
  });
}
function submitForm(button = "SIGN IN") {
  fireEvent.submit(
    screen.getByRole("button", { name: button }).closest("form")!,
  );
}
it.each([
  ["", "/templates"],
  ["?next=%2Fsubmissions%2F48", "/submissions/48"],
  ["?next=https%3A%2F%2Fevil.example", "/templates"],
  ["?next=%2F%2Fevil.example", "/templates"],
  ["?next=%2Fauth%2Flogin", "/templates"],
  ["?next=%2F", "/"],
])(
  "signs in and validates the redirect query %s",
  async (query, destination) => {
    window.history.replaceState({}, "", "/auth/login" + query);
    render(<LoginPage />);
    fillLogin();
    submitForm();
    await waitFor(() =>
      expect(routing.replace).toHaveBeenCalledWith(destination),
    );
    expect(getAuthSession()?.user.email).toBe("casey@example.test");
    const call = fetchMock.mock.calls.find(([url]) =>
      url.endsWith("/auth/login"),
    )!;
    expect(JSON.parse(call[1].body)).toEqual({
      email: "casey@example.test",
      password: "test-password",
    });
    expect(loader.start).toHaveBeenCalledOnce();
    expect(loader.done).toHaveBeenCalledOnce();
  },
);
it("validates blank inputs without calling the login API", async () => {
  render(<LoginPage />);
  submitForm();
  await screen.findByText("Enter a valid email address.");
  expect(screen.getByText("Password is required.")).toBeTruthy();
  expect(
    fetchMock.mock.calls.some(([url]) => url.endsWith("/auth/login")),
  ).toBe(false);
});
it.each([true, false])(
  "shows OTP challenge with code response %s and signs in after six digits",
  async (viaCode) => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith("/registration-status"))
        return jsonResponse({ can_register: true });
      const body = JSON.parse(init.body as string);
      return body.otp_attempt
        ? jsonResponse(session)
        : jsonResponse(
            viaCode
              ? { error: "Challenge required", code: "otp_required" }
              : { error: "Two-factor authentication required" },
            401,
          );
    });
    render(<LoginPage />);
    fillLogin();
    submitForm();
    await screen.findByLabelText("Two-factor code from authenticator app");
    expect(notifications.error).toHaveBeenCalledWith(
      "Two-factor authentication required",
      expect.anything(),
    );
    submitForm();
    await screen.findByText("Enter your 6-digit code.");
    fireEvent.change(
      screen.getByLabelText("Two-factor code from authenticator app"),
      { target: { value: "123456" } },
    );
    submitForm();
    await waitFor(() =>
      expect(routing.replace).toHaveBeenCalledWith("/templates"),
    );
    const calls = fetchMock.mock.calls.filter(([url]) =>
      url.endsWith("/auth/login"),
    );
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1][1].body).otp_attempt).toBe("123456");
  },
);
it.each([
  [{ error: "Credentials rejected" }, "Credentials rejected"],
  [
    { error: "Two-factor authentication unavailable" },
    "Two-factor authentication unavailable",
  ],
  ["plain server failure", "Request failed"],
])(
  "preserves structured login failures without falsely challenging OTP",
  async (failure, message) => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/registration-status")
        ? jsonResponse({ can_register: true })
        : jsonResponse(failure, 401),
    );
    render(<LoginPage />);
    fillLogin();
    submitForm();
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith(
        "Sign in failed",
        expect.objectContaining({ description: message }),
      ),
    );
    expect(routing.replace).not.toHaveBeenCalled();
    expect(
      screen.queryByLabelText("Two-factor code from authenticator app"),
    ).toBeNull();
    expect(loader.done).toHaveBeenCalledOnce();
  },
);
it("handles non-HTTP login failures with a useful retry message", async () => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/registration-status"))
      return jsonResponse({ can_register: true });
    throw new Error("Network unavailable");
  });
  render(<LoginPage />);
  fillLogin();
  submitForm();
  await waitFor(() =>
    expect(notifications.error).toHaveBeenCalledWith(
      "Sign in failed",
      expect.objectContaining({
        description: "Unable to sign in. Please try again.",
      }),
    ),
  );
});
it("registers a named account using the selected locale and separates multi-part names", async () => {
  render(<RegisterPage />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "  Casey  Van Example  " },
  });
  fillLogin();
  submitForm("CREATE ACCOUNT");
  await waitFor(() =>
    expect(routing.replace).toHaveBeenCalledWith("/templates"),
  );
  const call = fetchMock.mock.calls.find(([url]) =>
    url.endsWith("/auth/register"),
  )!;
  expect(JSON.parse(call[1].body)).toMatchObject({
    first_name: "Casey",
    last_name: "Van Example",
    account_name: "Casey's Account",
    email: "casey@example.test",
    locale: "en-US",
    password: "test-password",
  });
  expect(notifications.success).toHaveBeenCalledWith(
    "Account created",
    expect.objectContaining({ description: "Your workspace is ready." }),
  );
});
it("shows registration availability and removes Google/register actions when registration is closed", async () => {
  fetchMock.mockImplementation(async () =>
    jsonResponse({
      can_register: false,
      mode: "disabled",
      reason: "Invitation required",
    }),
  );
  render(<RegisterPage />);
  await screen.findByText("Registration is closed");
  expect(screen.getByText("Invitation required")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "CREATE ACCOUNT" })
      .closest("form")
      ?.classList.contains("hidden"),
  ).toBe(true);
  expect(
    screen.queryByRole("button", { name: "SIGN IN WITH GOOGLE" }),
  ).toBeNull();
  expect(
    screen.getByRole("link", { name: "Go to sign in" }).getAttribute("href"),
  ).toBe("/auth/login");
});
it("shows documentation links when self-registration is unavailable", async () => {
  fetchMock.mockImplementation(async () =>
    jsonResponse({ can_register: false, mode: "initial_only", reason: null }),
  );
  render(<LoginPage />);
  const docs = await screen.findByRole("navigation", { name: "Documentation" });
  expect(docs.textContent).toContain("Docs");
  expect(
    screen.queryByRole("link", { name: "Create Free Account" }),
  ).toBeNull();
});
it("tolerates availability lookup failures and ignores a response after unmount", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Offline"));
  const view = render(<LoginPage />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(
    screen.getByRole("button", { name: "SIGN IN WITH GOOGLE" }),
  ).toBeTruthy();
  view.unmount();
  let resolve: ((response: Response) => void) | undefined;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const second = render(<LoginPage />);
  second.unmount();
  await act(async () => {
    resolve?.(jsonResponse({ can_register: false }));
  });
});
it("changes the language through the real select and persists the document locale", async () => {
  render(<LoginPage />);
  fireEvent.click(screen.getByRole("combobox", { name: "Language" }));
  fireEvent.click(await screen.findByRole("option", { name: "Français" }));
  expect(window.localStorage.getItem("signa.locale")).toBe("fr");
  expect(document.documentElement.lang).toBe("fr-FR");
  expect(screen.getByLabelText("Mot de passe")).toBeTruthy();
});
it("starts Google sign-in, saves state and follows the provider redirect", async () => {
  render(<LoginPage />);
  fetchMock.mockImplementation(async (url: string) =>
    jsonResponse(
      url.endsWith("/registration-status")
        ? { can_register: true }
        : { state: "test-state", url: "#google-provider" },
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "SIGN IN WITH GOOGLE" }));
  await waitFor(() =>
    expect(window.sessionStorage.getItem(getSocialAuthStateKey("google"))).toBe(
      "test-state",
    ),
  );
  expect(window.location.hash).toBe("#google-provider");
});
it.each([true, false])(
  "handles Google startup errors with structured error %s",
  async (structured) => {
    render(<LoginPage />);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/registration-status"))
        return jsonResponse({ can_register: true });
      if (structured) return jsonResponse({ error: "Google unavailable" }, 503);
      throw null;
    });
    const button = screen.getByRole("button", { name: "SIGN IN WITH GOOGLE" });
    fireEvent.click(button);
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith(
        "Google sign-in could not start",
        {
          description: structured
            ? "Google unavailable"
            : "Add the OAuth client id, client secret, and redirect URI environment variables.",
        },
      ),
    );
    expect(button.hasAttribute("disabled")).toBe(false);
  },
);
it.each([
  [ForgotPasswordPage, "Forgot your password?"],
  [ResetPasswordPage, "Change your password"],
] as const)(
  "renders recovery/challenge pages with their distinct fields",
  (Page, title) => {
    render(<Page />);
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    if (Page === ForgotPasswordPage)
      expect(screen.getByLabelText("Email")).toBeTruthy();
    if (Page === ResetPasswordPage) {
      expect(screen.getByLabelText("New Password")).toBeTruthy();
      expect(screen.getByLabelText("Confirm New Password")).toBeTruthy();
      expect(screen.getByText("Minimum 8 characters.")).toBeTruthy();
    }
  },
);
it("renders auth notices as readable text", () => {
  render(<AuthNotice message="Invitation accepted" />);
  expect(screen.getByText("Invitation accepted")).toBeTruthy();
});
