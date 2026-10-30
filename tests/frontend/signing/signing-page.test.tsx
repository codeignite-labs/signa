import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const routing = vi.hoisted(() => ({ replace: vi.fn() }));
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routing }));
vi.mock("sonner", () => ({ toast: notifications }));
import { SigningPage } from "../../../apps/frontend/app/s/[slug]/signing-page";
import type {
  SigningForm,
  SigningField,
} from "../../../apps/frontend/lib/api/signing";
import { saveAuthSession } from "../../../apps/frontend/lib/api/auth";
import { signingForm, textField, jsonResponse } from "./signing-fixtures";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  routing.replace.mockClear();
  notifications.error.mockClear();
  notifications.success.mockClear();
  fetchMock = vi
    .fn()
    .mockImplementation(async () => jsonResponse(signingForm()));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/s/slug");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
async function loadForm(form = signingForm()) {
  fetchMock.mockResolvedValueOnce(jsonResponse(form));
  render(<SigningPage slug="slug" />);
  await screen.findByRole("heading", { name: "Customer agreement" });
  await act(async () => {
    await Promise.resolve();
  });
}
it("loads tracked links and routes completed submitters to the completed page", async () => {
  const form = signingForm();
  form.submitter.completed_at = "2026-10-30";
  fetchMock.mockResolvedValueOnce(jsonResponse(form));
  render(<SigningPage slug="slug" trackingParam="tracking&extra" />);
  expect(screen.getByText("Loading signing form")).toBeTruthy();
  await waitFor(() =>
    expect(routing.replace).toHaveBeenCalledWith("/s/slug/completed"),
  );
  expect(fetchMock.mock.calls[0][0]).toBe(
    "/api/signing/slug?t=tracking%26extra",
  );
});
it.each([new Error("Connection lost"), "failure"])(
  "renders load failures and notifies React Native hosts",
  async (failure) => {
    const postMessage = vi.fn();
    Object.assign(window, { ReactNativeWebView: { postMessage } });
    fetchMock.mockRejectedValueOnce(failure);
    render(<SigningPage slug="slug" />);
    await screen.findByText("Signing form unavailable");
    expect(
      screen.getByText(
        failure instanceof Error
          ? failure.message
          : "Signing form could not be loaded.",
      ),
    ).toBeTruthy();
    expect(
      postMessage.mock.calls.map(([message]) => JSON.parse(message)),
    ).toContainEqual({
      type: "signa:error",
      payload: {
        code: "signing_form_load_failed",
        message:
          failure instanceof Error
            ? failure.message
            : "Signing form could not be loaded.",
      },
    });
    delete window.ReactNativeWebView;
  },
);
it("signs text through the real panel, posts completion, and displays completion actions", async () => {
  const form = signingForm();
  const postMessage = vi.fn();
  Object.assign(window, { ReactNativeWebView: { postMessage } });
  await loadForm(form);
  const input = await screen.findByPlaceholderText("Full name");
  fireEvent.change(input, { target: { value: "Casey Example" } });
  const completed = signingForm({ values: { "field-1": "Casey Example" } });
  completed.submitter.completed_at = "2026-10-30";
  fetchMock.mockResolvedValueOnce(jsonResponse(completed));
  fireEvent.click(
    await screen.findByRole("button", { name: "SIGN AND COMPLETE" }),
  );
  await screen.findByText("Form has been completed!");
  expect(fetchMock.mock.calls[1][0]).toBe("/api/signing/slug/complete");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    values: { "field-1": "Casey Example" },
  });
  const events = postMessage.mock.calls.map(([message]) => JSON.parse(message));
  expect(events.map((event) => event.type)).toEqual(
    expect.arrayContaining(["signa:init", "signa:loaded", "signa:completed"]),
  );
  expect(notifications.success).toHaveBeenCalledWith("Document completed");
  expect(screen.queryByPlaceholderText("Full name")).toBeNull();
  delete window.ReactNativeWebView;
});
it("saves intermediate fields, skips read-only fields, and preserves existing values", async () => {
  const second = { uuid: "second", type: "text", name: "Address" };
  const form = signingForm({
    fields: [
      textField,
      { uuid: "readonly", type: "text", readonly: true },
      second,
    ],
    values: { existing: "retained" },
  });
  await loadForm(form);
  fireEvent.change(await screen.findByPlaceholderText("Full name"), {
    target: { value: "Casey" },
  });
  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      ...form,
      values: { existing: "retained", "field-1": "Casey" },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
  await screen.findByPlaceholderText("Address");
  expect(fetchMock.mock.calls[1][0]).toBe("/api/signing/slug/values");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    values: { existing: "retained", "field-1": "Casey" },
  });
});
it("focuses a field prefix instead of the first empty field", async () => {
  const form = signingForm({
    fields: [textField, { uuid: "second-uuid", type: "text", name: "Address" }],
  });
  fetchMock.mockResolvedValueOnce(jsonResponse(form));
  render(<SigningPage slug="slug" focusFieldPrefix="second" />);
  await screen.findByPlaceholderText("Address");
  expect(screen.queryByPlaceholderText("Full name")).toBeNull();
});
it("opens, cancels, and confirms a decline dialog then disables signing", async () => {
  await loadForm();
  fireEvent.click(screen.getByRole("button", { name: "DECLINE" }));
  expect(await screen.findByText("Decline this document?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByText("Decline this document?")).toBeNull(),
  );
  fireEvent.click(screen.getByRole("button", { name: "DECLINE" }));
  const form = signingForm();
  form.submitter.declined_at = "2026-10-30";
  fetchMock.mockResolvedValueOnce(jsonResponse(form));
  fireEvent.click(screen.getByRole("button", { name: "Decline document" }));
  await screen.findByText("This document has been declined.");
  expect(fetchMock.mock.calls[1][0]).toBe("/api/signing/slug/decline");
  expect(
    screen.getByRole("button", { name: "DECLINE" }).hasAttribute("disabled"),
  ).toBe(true);
});
it("renders declined submissions read-only and makes the first preview eager while later pages are lazy", async () => {
  const form = signingForm({
    fields: [
      { ...textField, default_value: "Default value" },
      {
        type: "text",
        uuid: "other",
        areas: [{ attachment_uuid: "other", page: 0 }],
      },
    ],
  });
  form.submitter.declined_at = "2026-10-30";
  form.documents[0].preview_images.push({
    id: "second",
    url: "/second.png",
    filename: "second.png",
    metadata: {},
  });
  await loadForm(form);
  expect(screen.getByText("Default value")).toBeTruthy();
  expect(
    screen.getByAltText("Customer agreement page 1").getAttribute("loading"),
  ).toBe("eager");
  expect(
    screen.getByAltText("Customer agreement page 2").getAttribute("loading"),
  ).toBe("lazy");
  expect(
    screen.getByAltText("Customer agreement page 2").getAttribute("width"),
  ).toBe("1000");
  expect(screen.queryByPlaceholderText("Full name")).toBeNull();
});
it.each([
  [
    403,
    "Denied",
    "Authentication is required to download completed documents for this account.",
  ],
  [500, "Offline", "Offline"],
])("handles document download HTTP %i", async (status, error, message) => {
  await loadForm();
  fetchMock.mockResolvedValueOnce(jsonResponse({ error }, status));
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  await waitFor(() =>
    expect(notifications.error).toHaveBeenCalledWith("Download failed", {
      description: message,
    }),
  );
});
it("downloads document URLs and handles untyped download failures", async () => {
  const clicks = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  await loadForm();
  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      documents: [{ url: "/signed.pdf", filename: "signed.pdf" }],
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  await waitFor(() => expect(clicks).toHaveBeenCalledOnce());
  const link = clicks.mock.instances[0] as HTMLAnchorElement;
  expect(link.download).toBe("signed.pdf");
  expect(link.rel).toBe("noreferrer");
  fetchMock.mockRejectedValueOnce(null);
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  await waitFor(() =>
    expect(notifications.error).toHaveBeenCalledWith("Download failed", {
      description: "Document could not be downloaded.",
    }),
  );
});
it("selects fields with mouse/keyboard, renders saved attachment previews and selected choices", async () => {
  const fields: SigningField[] = [
    {
      uuid: "sign",
      type: "signature",
      name: "Signature",
      areas: [{ attachment_uuid: "document", page: 0 }],
    },
    {
      uuid: "initials",
      type: "initials",
      name: "Initials",
      default_value: "initial-value",
      areas: [{ attachment_uuid: "document", page: 0 }],
    },
    {
      uuid: "check",
      type: "checkbox",
      name: "Consent",
      areas: [{ attachment_uuid: "document", page: 0 }],
    },
    {
      uuid: "radio",
      type: "radio",
      name: "Plan",
      options: [{ uuid: "one", value: "Premium" }],
      areas: [{ attachment_uuid: "document", page: 0, option_uuid: "one" }],
    },
    {
      uuid: "select",
      type: "select",
      name: "Choice",
      options: [
        "Alpha",
        { label: "Beta" },
        { name: "Gamma" },
        { title: "Delta" },
        { text: "Epsilon" },
        42,
      ],
      areas: [{ attachment_uuid: "document", page: 0 }],
    },
    {
      uuid: "image",
      type: "image",
      name: "Photo",
      areas: [{ attachment_uuid: "document", page: 0 }],
    },
    {
      uuid: "file",
      type: "file",
      name: "Attachment",
      areas: [{ attachment_uuid: "document", page: 0 }],
    },
  ];
  const form = signingForm({
    fields,
    attachments: [
      {
        uuid: "sign-value",
        filename: "signature.png",
        content_type: "image/png",
        url: "/signature.png",
      },
      {
        uuid: "photo-value",
        filename: "photo.png",
        content_type: "image/png",
        url: "/photo.png",
      },
    ],
    values: {
      initials: "initial-value",
      sign: "sign-value",
      check: true,
      radio: "one",
      select: ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"],
      image: "photo-value",
      file: ["file-value"],
    },
  });
  await loadForm(form);
  expect(screen.getByAltText("Signature").getAttribute("src")).toBe(
    "/signature.png",
  );
  expect(screen.getByAltText("photo.png").getAttribute("src")).toBe(
    "/photo.png",
  );
  expect(screen.getByText("Alpha, Beta, Gamma, Delta, Epsilon")).toBeTruthy();
  expect(screen.getByText("Uploaded")).toBeTruthy();
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Consent, completed" }),
    { key: "Enter" },
  );
  await screen.findByRole("checkbox");
  fireEvent.keyDown(screen.getByRole("button", { name: "Plan, completed" }), {
    key: " ",
  });
  await screen.findByRole("radio", { name: "Premium" });
  fireEvent.click(screen.getByRole("button", { name: /ChoiceAlpha, Beta/ }));
  await screen.findByRole("combobox");
});
it("loads saved signer assets only for the same signed-in email when prefilling is enabled", async () => {
  saveAuthSession({
    access_token: "test-token",
    user: {
      id: "user",
      email: "CASEY@example.test",
      first_name: "Casey",
      last_name: "Example",
      role: "admin",
    },
    account: {
      id: "account",
      name: "Example",
      locale: "en-US",
      timezone: "UTC",
    },
  });
  const form = signingForm();
  form.configs.prefill_signature = true;
  fetchMock.mockImplementation(async (url: string) =>
    url === "/api/signing/slug"
      ? jsonResponse(form)
      : jsonResponse({
          uuid: "asset",
          filename: "signature.png",
          content_type: "image/png",
          url: "/signature.png",
        }),
  );
  render(<SigningPage slug="slug" />);
  await screen.findByPlaceholderText("Full name");
  await waitFor(() =>
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(
      expect.arrayContaining([
        "/api/profile/signature",
        "/api/profile/initials",
      ]),
    ),
  );
});
it.each([new Error("Decline rejected"), null])(
  "reports decline failures, retains draft values and permits retry",
  async (failure) => {
    await loadForm();
    const input = await screen.findByPlaceholderText("Full name");
    fireEvent.change(input, { target: { value: "Casey draft" } });
    fireEvent.click(screen.getByRole("button", { name: "DECLINE" }));
    fetchMock.mockRejectedValueOnce(failure);
    fireEvent.click(screen.getByRole("button", { name: "Decline document" }));
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith(
        "Document could not be declined",
        {
          description:
            failure instanceof Error ? failure.message : "Please try again.",
        },
      ),
    );
    expect(input).toHaveProperty("value", "Casey draft");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.queryByText("This document has been declined.")).toBeNull();
    const declined = signingForm({ values: { "field-1": "Casey draft" } });
    declined.submitter.declined_at = "2026-10-31";
    fetchMock.mockResolvedValueOnce(jsonResponse(declined));
    fireEvent.click(screen.getByRole("button", { name: "Decline document" }));
    await screen.findByText("This document has been declined.");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  },
);
it("blocks duplicate decline requests and cancellation while the API response is pending", async () => {
  await loadForm();
  await screen.findByPlaceholderText("Full name");
  fireEvent.click(screen.getByRole("button", { name: "DECLINE" }));
  let resolve: ((response: Response) => void) | undefined;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const confirm = screen.getByRole("button", { name: "Decline document" });
  fireEvent.click(confirm);
  expect(confirm.hasAttribute("disabled")).toBe(true);
  expect(
    screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(confirm);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const declined = signingForm();
  declined.submitter.declined_at = "2026-10-31";
  await act(async () => {
    resolve?.(jsonResponse(declined));
  });
  await screen.findByText("This document has been declined.");
});
