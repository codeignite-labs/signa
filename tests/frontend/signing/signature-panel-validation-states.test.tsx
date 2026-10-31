import React, { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const notices = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: notices }));
import { SignaturePanel } from "../../../apps/frontend/app/s/[slug]/signature-panel";
import type {
  SigningField,
  SigningForm,
} from "../../../apps/frontend/lib/api/signing";
import { signingForm } from "./signing-fixtures";
const complete = vi.fn().mockResolvedValue(undefined);
const upload = vi.fn().mockResolvedValue("uploaded");
function Panel({
  field,
  initial,
  useSaved = false,
}: {
  field: SigningField;
  initial?: SigningForm;
  useSaved?: boolean;
}) {
  const [form, setForm] = useState(initial ?? signingForm({ fields: [field] }));
  return (
    <SignaturePanel
      activeField={field}
      fields={form.fields}
      form={form}
      onFormChange={setForm}
      onComplete={complete}
      onSaveField={vi.fn()}
      onSelectField={vi.fn()}
      onUploadAttachment={upload}
      savedAssets={
        useSaved
          ? {
              initials: null,
              signature: {
                uuid: "saved",
                filename: "saved.png",
                content_type: "image/png",
                url: "/saved.png",
              },
            }
          : undefined
      }
    />
  );
}
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}
beforeEach(() => {
  complete.mockClear();
  upload.mockClear();
  notices.error.mockClear();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "Content-Type": "image/png" },
        }),
      ),
  );
});
it.each(["checkbox", "date", "select", "radio", "multiple", "image", "stamp"])(
  "shows required-field errors for %s and does not complete an empty value",
  async (type) => {
    const field = {
      uuid: "field",
      type,
      name: "Required value",
      options: ["One", "Two", "Three", "Four", "Five"],
      preferences: { format: "MM/DD/YYYY" },
    };
    render(<Panel field={field} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
    expect(notices.error).toHaveBeenCalledWith("Complete the required field", {
      description: "Required value is required before you can continue.",
    });
    expect(complete).not.toHaveBeenCalled();
    if (type === "radio") expect(screen.getAllByRole("radio")).toHaveLength(5);
    if (type === "multiple")
      expect(screen.getAllByRole("checkbox")).toHaveLength(5);
  },
);
it("supports checking and unchecking a required checkbox before retrying a save", async () => {
  const field = { uuid: "checkbox", type: "checkbox", name: "Consent" };
  render(<Panel field={field} />);
  await settle();
  const checkbox = screen.getByRole("checkbox");
  fireEvent.click(checkbox);
  await settle();
  fireEvent.click(checkbox);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
  expect(complete).not.toHaveBeenCalled();
  fireEvent.click(checkbox);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() => expect(complete).toHaveBeenCalledWith(field, true, {}));
});
it("shows a description and invalid state for an unnamed multiline text field", async () => {
  render(
    <Panel
      field={{
        uuid: "text",
        type: "text",
        description: "Enter the full address.",
      }}
    />,
  );
  await settle();
  expect(screen.getByText("Enter the full address.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Use multiple lines" }));
  fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
  expect(notices.error).toHaveBeenCalledWith(
    "Complete the required field",
    expect.objectContaining({
      description: "Text is required before you can continue.",
    }),
  );
  expect(screen.getByPlaceholderText("Text").tagName).toBe("TEXTAREA");
});
it("allows clearing a datetime value and flags the required date instead of inventing a replacement", async () => {
  const field = {
    uuid: "date",
    type: "date",
    name: "Meeting time",
    preferences: { format: "YYYY-MM-DD HH:mm" },
    default_value: "2026-10-31T12:30:00Z",
  };
  const view = render(<Panel field={field} />);
  await settle();
  const input = view.container.querySelector("input")!;
  fireEvent.change(input, { target: { value: "" } });
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
  expect(complete).not.toHaveBeenCalled();
  expect(notices.error).toHaveBeenCalledWith(
    "Complete the required field",
    expect.anything(),
  );
});
it("previews an unnamed image upload and handles an empty file-picker result safely", async () => {
  const field = { uuid: "image", type: "image" };
  const view = render(<Panel field={field} />);
  await settle();
  const input = view.container.querySelector("input[type=file]")!;
  fireEvent.change(input, {
    target: {
      files: [new File(["image"], "photo.png", { type: "image/png" })],
    },
  });
  await settle();
  expect(screen.getByText("Image")).toBeTruthy();
  expect(screen.getByAltText("photo.png")).toBeTruthy();
  fireEvent.change(input, { target: { files: null } });
  await settle();
  expect(screen.queryByAltText("photo.png")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
  expect(complete).not.toHaveBeenCalled();
});

it("reuses a previously entered signing reason", async () => {
  const field = { uuid: "signature", type: "signature", name: "Signature" };
  const form = signingForm({
    fields: [field],
    values: { signature_reason: "I approve this agreement" },
  });
  form.configs.require_signing_reason = true;
  render(<Panel field={field} initial={form} useSaved />);
  await settle();
  expect(screen.getByPlaceholderText("Reason for signing")).toHaveProperty(
    "value",
    "I approve this agreement",
  );
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(complete).toHaveBeenCalledWith(field, "uploaded", {
      signature_reason: "I approve this agreement",
    }),
  );
});
