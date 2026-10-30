import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: notifications }));
import { SignaturePanel } from "../../../apps/frontend/app/s/[slug]/signature-panel";
import type {
  SigningField,
  SigningForm,
} from "../../../apps/frontend/lib/api/signing";
import { signingForm, jsonResponse } from "./signing-fixtures";
const changed = vi.fn();
const complete = vi.fn().mockResolvedValue(undefined);
let fetchMock: ReturnType<typeof vi.fn>;
const field: SigningField = {
  uuid: "phone",
  type: "phone",
  name: "Contact phone",
  validation: { phone_country: "US" },
  description: "Your contact number",
};
function Panel({
  initial,
  activeField = field,
}: {
  initial?: SigningForm;
  activeField?: SigningField;
}) {
  const form = initial ?? signingForm({ fields: [activeField] });
  return (
    <SignaturePanel
      activeField={activeField}
      fields={form.fields}
      form={form}
      onFormChange={changed}
      onComplete={complete}
      onSaveField={vi.fn()}
      onSelectField={vi.fn()}
      onUploadAttachment={vi.fn()}
    />
  );
}
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}
function phoneInput() {
  return screen.getByRole("textbox", { name: "" }) as HTMLInputElement;
}
beforeEach(() => {
  changed.mockClear();
  complete.mockClear();
  notifications.error.mockClear();
  notifications.success.mockClear();
  fetchMock = vi
    .fn()
    .mockImplementation(async () =>
      jsonResponse({ phone: "+14155552671", valid: true }),
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
});
async function enterValidPhone() {
  const input = screen
    .getAllByRole("textbox")
    .find((element) => element.getAttribute("type") === "tel")!;
  fireEvent.change(input, { target: { value: "4155552671" } });
  await settle();
  return input;
}
it("constrains fixed-country inputs, rejects invalid drafts and validates a number through the server", async () => {
  render(<Panel />);
  await settle();
  expect(
    screen
      .getByRole("button", { name: "Select phone country" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: "Use valid number" })
      .hasAttribute("disabled"),
  ).toBe(true);
  const input = screen
    .getAllByRole("textbox")
    .find((element) => element.getAttribute("type") === "tel")!;
  fireEvent.change(input, { target: { value: "12" } });
  await settle();
  expect(screen.getByText(/Enter a valid United States number/)).toBeTruthy();
  await enterValidPhone();
  fireEvent.click(screen.getByRole("button", { name: "Use valid number" }));
  await waitFor(() =>
    expect(notifications.success).toHaveBeenCalledWith("Phone number accepted"),
  );
  expect(fetchMock.mock.calls[0][0]).toBe(
    "/api/signing/slug/phone-verification/validate",
  );
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    field_uuid: "phone",
    phone: "+14155552671",
  });
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({ values: { phone: "+14155552671" } }),
  );
});
it("sends SMS verification and checks the entered code through the public API", async () => {
  render(<Panel />);
  await settle();
  await enterValidPhone();
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ phone: "+14155552671", status: "sent" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Send SMS code" }));
  await screen.findByText("Verification code sent to +14155552671.");
  expect(fetchMock.mock.calls[0][0]).toBe(
    "/api/signing/slug/phone-verification/send",
  );
  fireEvent.change(screen.getByPlaceholderText("Code"), {
    target: { value: "123456" },
  });
  const verified = signingForm({
    fields: [field],
    values: { phone: "+14155552671" },
  });
  fetchMock.mockResolvedValueOnce(jsonResponse(verified));
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  await waitFor(() =>
    expect(notifications.success).toHaveBeenCalledWith("Phone verified"),
  );
  expect(fetchMock.mock.calls[1][0]).toBe(
    "/api/signing/slug/phone-verification/check",
  );
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    field_uuid: "phone",
    phone: "+14155552671",
    code: "123456",
  });
  expect(changed).toHaveBeenLastCalledWith(verified);
});
it.each([new Error("Provider unavailable"), null])(
  "handles phone validation provider failures",
  async (failure) => {
    render(<Panel />);
    await settle();
    await enterValidPhone();
    fetchMock.mockRejectedValueOnce(failure);
    const button = screen.getByRole("button", { name: "Use valid number" });
    fireEvent.click(button);
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith(
        "Phone number is invalid",
        {
          description:
            failure instanceof Error
              ? failure.message
              : "Enter a valid United States phone number.",
        },
      ),
    );
    expect(button.hasAttribute("disabled")).toBe(false);
  },
);
it.each([new Error("SMS unavailable"), null])(
  "handles SMS send failures and re-enables sending",
  async (failure) => {
    render(<Panel />);
    await settle();
    await enterValidPhone();
    fetchMock.mockRejectedValueOnce(failure);
    const button = screen.getByRole("button", { name: "Send SMS code" });
    fireEvent.click(button);
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith(
        "Phone verification failed",
        {
          description:
            failure instanceof Error
              ? failure.message
              : "Unable to send SMS code.",
        },
      ),
    );
    expect(button.hasAttribute("disabled")).toBe(false);
  },
);
it.each([new Error("Invalid code"), null])(
  "handles verification failures without changing the form",
  async (failure) => {
    render(<Panel />);
    await settle();
    await enterValidPhone();
    changed.mockClear();
    fetchMock.mockRejectedValueOnce(failure);
    fireEvent.change(screen.getByPlaceholderText("Code"), {
      target: { value: "wrong" },
    });
    const button = screen.getByRole("button", { name: "Verify" });
    fireEvent.click(button);
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith(
        "Phone verification failed",
        {
          description:
            failure instanceof Error
              ? failure.message
              : "Check the code and try again.",
        },
      ),
    );
    expect(changed).not.toHaveBeenCalled();
    expect(button.hasAttribute("disabled")).toBe(false);
  },
);
it("formats an existing accepted international number and permits completion", async () => {
  render(
    <Panel
      initial={signingForm({
        fields: [field],
        values: { phone: "+1 (415) 555-2671" },
      })}
    />,
  );
  await settle();
  expect(screen.getByText(/Phone number is valid/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(complete).toHaveBeenCalledWith(field, "+1 (415) 555-2671", {}),
  );
});
it("allows searching and selecting another country when the field has no fixed country", async () => {
  render(<Panel activeField={{ ...field, validation: {} }} />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Select phone country" }));
  const search = await screen.findByPlaceholderText("Search country or code");
  fireEvent.change(search, { target: { value: "Nonsense country" } });
  expect(screen.getByText("No country found.")).toBeTruthy();
  fireEvent.change(search, { target: { value: "Kenya" } });
  fireEvent.click(screen.getByRole("button", { name: /Kenya/ }));
  await settle();
  expect(
    screen.getByRole("button", { name: "Select phone country" }).textContent,
  ).toContain("+254");
  const input = screen
    .getAllByRole("textbox")
    .find((element) => element.getAttribute("type") === "tel")!;
  fireEvent.change(input, { target: { value: "712345678" } });
  await settle();
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({ values: { phone: "+254712345678" } }),
  );
  fireEvent.change(input, { target: { value: "" } });
  await settle();
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({ values: { phone: "" } }),
  );
});
it("rejects a server response that explicitly marks the phone invalid", async () => {
  render(<Panel />);
  await settle();
  await enterValidPhone();
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ phone: "+14155552671", valid: false }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Use valid number" }));
  await waitFor(() =>
    expect(notifications.error).toHaveBeenCalledWith(
      "Phone number is invalid",
      { description: "Phone number is invalid." },
    ),
  );
  expect(notifications.success).not.toHaveBeenCalled();
});
it("preserves a partial phone number while the signer types its first digit", async () => {
  render(<Panel />);
  await settle();
  const input = screen
    .getAllByRole("textbox")
    .find((element) => element.getAttribute("type") === "tel")!;
  fireEvent.change(input, { target: { value: "4" } });
  await settle();
  expect(input).toHaveProperty("value", "4");
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({ values: { phone: "+14" } }),
  );
});
it("accepts a local-format prefilled phone through the server after displaying it unchanged", async () => {
  render(<Panel activeField={{ ...field, default_value: "4155552671" }} />);
  await settle();
  const input = screen
    .getAllByRole("textbox")
    .find((element) => element.getAttribute("type") === "tel")!;
  expect(input).toHaveProperty("value", "4155552671");
  fireEvent.click(screen.getByRole("button", { name: "Use valid number" }));
  await waitFor(() =>
    expect(notifications.success).toHaveBeenCalledWith("Phone number accepted"),
  );
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).phone).toBe(
    "+14155552671",
  );
});
it("uses a generic national-number placeholder when a supported country has no mobile example", async () => {
  render(
    <Panel activeField={{ ...field, validation: { phone_country: "PN" } }} />,
  );
  await settle();
  expect(screen.getByPlaceholderText("234 567 8900")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Select phone country" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
