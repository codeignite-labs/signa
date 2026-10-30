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
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routing }));
vi.mock("nextjs-toploader", () => ({ useTopLoader: () => loader }));
vi.mock("sonner", () => ({ toast: notifications }));
import RegisterPage from "../../../apps/frontend/app/auth/register/page";
import LoginPage from "../../../apps/frontend/app/auth/login/page";
import {
  getAuthSession,
  getSocialAuthStateKey,
} from "../../../apps/frontend/lib/api/auth";
import { jsonResponse } from "../signing/signing-fixtures";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  routing.replace.mockClear();
  loader.start.mockClear();
  loader.done.mockClear();
  notifications.error.mockClear();
  window.history.replaceState({}, "", "/auth/register");
  window.sessionStorage.clear();
  fetchMock = vi.fn().mockResolvedValue(jsonResponse({ can_register: true }));
  vi.stubGlobal("fetch", fetchMock);
});
function fillRegistration() {
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Casey Example" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "casey@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "test-password" },
  });
}
it.each([true, false])(
  "preserves registration inputs and allows retry after structured error %s",
  async (structured) => {
    render(<RegisterPage />);
    await act(async () => {
      await Promise.resolve();
    });
    fillRegistration();
    fetchMock.mockImplementationOnce(async () => {
      if (structured)
        return jsonResponse(
          { error: "Registration is temporarily unavailable" },
          503,
        );
      throw new Error("Connection interrupted");
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "CREATE ACCOUNT" }).closest("form")!,
    );
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith(
        "Registration failed",
        expect.objectContaining({
          description: structured
            ? "Registration is temporarily unavailable"
            : "Unable to create your account. Please try again.",
        }),
      ),
    );
    expect(screen.getByLabelText("Name")).toHaveProperty(
      "value",
      "Casey Example",
    );
    expect(
      screen
        .getByRole("button", { name: "CREATE ACCOUNT" })
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(getAuthSession()).toBeNull();
    expect(routing.replace).not.toHaveBeenCalled();
    expect(loader.done).toHaveBeenCalledOnce();
  },
);
it.each(["Invitation required", null])(
  "blocks a pending registration submission when policy closes (%s)",
  async (reason) => {
    let resolve: ((response: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    render(<RegisterPage />);
    fillRegistration();
    const form = screen
      .getByRole("button", { name: "CREATE ACCOUNT" })
      .closest("form")!;
    await act(async () => {
      resolve?.(
        jsonResponse({ can_register: false, mode: "disabled", reason }),
      );
    });
    expect(
      screen.getByText(
        reason ??
          "Ask an administrator to invite you to this Signa installation.",
      ),
    ).toBeTruthy();
    // A form submission already queued by the browser must respect the newly loaded policy.
    fireEvent.submit(form);
    await waitFor(() => expect(loader.done).toHaveBeenCalledOnce());
    expect(form.textContent).toContain(
      reason ?? "Registration is disabled for this installation.",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(routing.replace).not.toHaveBeenCalled();
  },
);
it("ignores a failed availability request after leaving the auth route", async () => {
  let reject: ((reason: Error) => void) | undefined;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((_, fail) => {
        reject = fail;
      }),
  );
  const view = render(<LoginPage />);
  view.unmount();
  await act(async () => {
    reject?.(new Error("Offline"));
  });
  expect(routing.replace).not.toHaveBeenCalled();
  expect(notifications.error).not.toHaveBeenCalled();
});
it("passes registration mode to Google and keeps its control busy until the provider responds", async () => {
  render(<RegisterPage />);
  await act(async () => {
    await Promise.resolve();
  });
  let resolve: ((response: Response) => void) | undefined;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const google = screen.getByRole("button", { name: "SIGN IN WITH GOOGLE" });
  fireEvent.click(google);
  expect(google.hasAttribute("disabled")).toBe(true);
  expect(google.getAttribute("aria-busy")).toBe("true");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    mode: "register",
  });
  await act(async () => {
    resolve?.(
      jsonResponse({
        state: "registration-state",
        url: "#google-registration",
      }),
    );
  });
  expect(window.sessionStorage.getItem(getSocialAuthStateKey("google"))).toBe(
    "registration-state",
  );
  expect(window.location.hash).toBe("#google-registration");
  expect(google.hasAttribute("disabled")).toBe(false);
});
