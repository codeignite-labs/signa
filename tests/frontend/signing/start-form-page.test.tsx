import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const routing = vi.hoisted(() => ({ push: vi.fn() }));
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routing }));
vi.mock("sonner", () => ({ toast: notifications }));
import { StartFormPage } from "../../../apps/frontend/app/d/[slug]/start-form-page";
import PublicStartFormRoute from "../../../apps/frontend/app/d/[slug]/page";
import type { StartForm } from "../../../apps/frontend/lib/api/start-form";
import { jsonResponse } from "./signing-fixtures";
const form: StartForm = {
  account_name: "Example Organization",
  template_name: "Customer agreement",
  shared_link: true,
  require_email_2fa: false,
  link_form_fields: ["email"],
};
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  routing.push.mockClear();
  notifications.error.mockClear();
  notifications.success.mockClear();
  fetchMock = vi.fn().mockImplementation(async () => jsonResponse(form));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/d/template");
});
async function loadForm(overrides: Partial<StartForm> = {}) {
  fetchMock.mockResolvedValueOnce(jsonResponse({ ...form, ...overrides }));
  render(<StartFormPage slug="template" />);
  await screen.findByRole("heading", { name: form.template_name });
}
function submitIdentity() {
  fireEvent.submit(
    screen.getByRole("button", { name: "Continue" }).closest("form")!,
  );
}
async function verifyStep() {
  await loadForm({ require_email_2fa: true });
  fireEvent.change(screen.getByPlaceholderText("Email"), {
    target: { value: "casey@example.test" },
  });
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ email: "casey@example.test", status: "sent" }),
  );
  submitIdentity();
  await screen.findByPlaceholderText("XXX-XXX");
}
it("renders loading and resolves async route params into the shared form request", async () => {
  render(
    await PublicStartFormRoute({
      params: Promise.resolve({ slug: "template-slug" }),
    }),
  );
  expect(screen.getByText("Loading form")).toBeTruthy();
  await screen.findByText("Invited by Example Organization");
  expect(fetchMock.mock.calls[0][0]).toBe("/api/start-form/template-slug");
});
it.each([new Error("Link expired"), null])(
  "renders shared-form load failures",
  async (failure) => {
    fetchMock.mockRejectedValueOnce(failure);
    render(<StartFormPage slug="template" />);
    await screen.findByText("Form unavailable");
    expect(
      screen.getByText(
        failure instanceof Error
          ? failure.message
          : "This shared form could not be opened.",
      ),
    ).toBeTruthy();
  },
);
it("collects only configured identity fields and preserves embedded appearance during navigation", async () => {
  window.history.replaceState(
    {},
    "",
    "/d/template?embed=true&primary-color=%23123456",
  );
  await loadForm({ link_form_fields: ["name", "email", "phone"] });
  fireEvent.change(screen.getByPlaceholderText("Name"), {
    target: { value: "Casey Example" },
  });
  fireEvent.change(screen.getByPlaceholderText("Email"), {
    target: { value: "casey@example.test" },
  });
  fireEvent.change(screen.getByPlaceholderText("Phone"), {
    target: { value: "+14155552671" },
  });
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ signing_slug: "signer", signing_url: "/s/signer" }),
  );
  submitIdentity();
  await waitFor(() =>
    expect(routing.push).toHaveBeenCalledWith(
      "/s/signer?embed=true&primary-color=%23123456",
    ),
  );
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    name: "Casey Example",
    email: "casey@example.test",
    phone: "+14155552671",
  });
});
it("uses email as the default configured identity field when legacy forms omit the field list", async () => {
  await loadForm({ link_form_fields: undefined });
  expect(screen.getByPlaceholderText("Email")).toBeTruthy();
  expect(screen.queryByPlaceholderText("Phone")).toBeNull();
  expect(screen.queryByPlaceholderText("Name")).toBeNull();
});
it.each([new Error("Email rejected"), null])(
  "shows identity submission failures and releases the submit button",
  async (failure) => {
    await loadForm();
    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "casey@example.test" },
    });
    fetchMock.mockRejectedValueOnce(failure);
    submitIdentity();
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith("Unable to continue", {
        description:
          failure instanceof Error
            ? failure.message
            : "Please check the details and try again.",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled"),
    ).toBe(false);
    expect(routing.push).not.toHaveBeenCalled();
  },
);
it("sends, resends and checks an email verification code before opening the signing link", async () => {
  await verifyStep();
  expect(notifications.success).toHaveBeenCalledWith("Verification code sent");
  expect(fetchMock.mock.calls[1][0]).toBe(
    "/api/start-form/template/email-verification/send",
  );
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ email: "casey@example.test", status: "sent" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Re-send code" }));
  await waitFor(() =>
    expect(notifications.success).toHaveBeenCalledWith(
      "Verification code resent",
    ),
  );
  fireEvent.change(screen.getByPlaceholderText("XXX-XXX"), {
    target: { value: "123456" },
  });
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ signing_slug: "signer", signing_url: "/s/signer" }),
  );
  fireEvent.submit(
    screen.getByRole("button", { name: "Submit" }).closest("form")!,
  );
  await waitFor(() => expect(routing.push).toHaveBeenCalledWith("/s/signer"));
  expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({
    email: "casey@example.test",
    one_time_code: "123456",
  });
});
it.each([new Error("Invalid code"), null])(
  "preserves the verification step after a failed code check",
  async (failure) => {
    await verifyStep();
    fireEvent.change(screen.getByPlaceholderText("XXX-XXX"), {
      target: { value: "wrong" },
    });
    fetchMock.mockRejectedValueOnce(failure);
    fireEvent.submit(
      screen.getByRole("button", { name: "Submit" }).closest("form")!,
    );
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith("Verification failed", {
        description:
          failure instanceof Error
            ? failure.message
            : "Please check the code and try again.",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Submit" }).hasAttribute("disabled"),
    ).toBe(false);
    expect(routing.push).not.toHaveBeenCalled();
  },
);
it("skips resend when the verification step has no email address", async () => {
  await loadForm({ require_email_2fa: true, link_form_fields: [] });
  fetchMock.mockResolvedValueOnce(jsonResponse({ email: "", status: "sent" }));
  submitIdentity();
  await screen.findByPlaceholderText("XXX-XXX");
  fireEvent.click(screen.getByRole("button", { name: "Re-send code" }));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("handles a resend failure without an unhandled rejection or false success notice", async () => {
  await verifyStep();
  notifications.success.mockClear();
  fetchMock.mockRejectedValueOnce(new Error("Email service unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Re-send code" }));
  await waitFor(() =>
    expect(notifications.error).toHaveBeenCalledWith("Verification failed", {
      description: "Email service unavailable",
    }),
  );
  expect(notifications.success).not.toHaveBeenCalled();
  expect(screen.getByPlaceholderText("XXX-XXX")).toBeTruthy();
});
