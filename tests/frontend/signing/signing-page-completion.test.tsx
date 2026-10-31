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
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routing }));
vi.mock("sonner", () => ({ toast: notifications }));
import { SigningPage } from "../../../apps/frontend/app/s/[slug]/signing-page";
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
it.each([
  "date",
  "file",
  "image",
  "initials",
  "multiple",
  "number",
  "payment",
  "phone",
  "radio",
  "select",
  "signature",
  "stamp",
  "text",
  "cells",
  undefined,
])("renders unnamed %s fields with meaningful default labels", async (type) => {
  const field = {
    uuid: "unnamed",
    type,
    areas: [{ attachment_uuid: "document", page: 0 }],
  };
  const form = signingForm({ fields: [field] });
  form.submitter.declined_at = "2026-10-31";
  await loadForm(form);
  const labels: Record<string, string> = {
    date: "Date",
    file: "File",
    image: "Image",
    initials: "Initials",
    multiple: "Multiple choice",
    number: "Number",
    payment: "Payment",
    phone: "Phone",
    radio: "Radio",
    select: "Select",
    signature: "Signature",
    stamp: "Stamp",
    text: "Text",
  };
  expect(screen.getByLabelText(labels[type ?? ""] ?? "Field")).toBeTruthy();
});
it.each([
  [1, false, "Document has been signed!"],
  [2, false, "Documents have been signed!"],
  [1, true, "Thank you"],
])(
  "shows a completion summary for %i documents with custom message %s",
  async (count, custom, heading) => {
    const form = signingForm({
      fields: [
        { uuid: "signature", type: "signature", readonly: true },
        textField,
      ],
    });
    if (count === 2)
      form.documents.push({
        ...form.documents[0],
        id: "other",
        uuid: "other",
        name: "Annex",
        preview_images: [],
      });
    if (custom) {
      form.configs.completed_message = {
        title: "Thank you",
        body: "Your agreement is ready.",
      };
      form.configs.completed_button = {
        title: "Return to portal",
        url: "https://portal.example.test",
      };
    }
    await loadForm(form);
    fireEvent.change(await screen.findByPlaceholderText("Full name"), {
      target: { value: "Casey" },
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...form,
        values: { "field-1": "Casey" },
        submitter: { ...form.submitter, completed_at: "2026-10-31" },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
    await screen.findByText(heading);
    if (custom) {
      expect(screen.getByText("Your agreement is ready.")).toBeTruthy();
      expect(
        screen
          .getByRole("link", { name: "Return to portal" })
          .getAttribute("href"),
      ).toBe("https://portal.example.test");
    }
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "queued" }));
    fireEvent.click(
      screen.getByRole("button", { name: "SEND COPY VIA EMAIL" }),
    );
    await waitFor(() =>
      expect(notifications.success).toHaveBeenCalledWith(
        "Document copy email queued",
      ),
    );
    fetchMock.mockRejectedValueOnce(new Error("Mail offline"));
    fireEvent.click(
      screen.getByRole("button", { name: "SEND COPY VIA EMAIL" }),
    );
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith("Copy email failed", {
        description: "Mail offline",
      }),
    );
    fetchMock.mockRejectedValueOnce(null);
    fireEvent.click(
      screen.getByRole("button", { name: "SEND COPY VIA EMAIL" }),
    );
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith("Copy email failed", {
        description: "Document copy email could not be sent.",
      }),
    );
  },
);
it("tolerates saved signature asset API failures when the signing form is otherwise available", async () => {
  saveAuthSession({
    access_token: "test-token",
    user: {
      id: "user",
      email: "casey@example.test",
      first_name: "Casey",
      last_name: null,
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
      : jsonResponse({ error: "Asset missing" }, 404),
  );
  render(<SigningPage slug="slug" />);
  await screen.findByPlaceholderText("Full name");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(screen.queryByText("Signing form unavailable")).toBeNull();
});
