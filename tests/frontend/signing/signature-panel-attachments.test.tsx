import React, { useState } from "react";
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
import { signingForm } from "./signing-fixtures";
const complete = vi.fn().mockResolvedValue(undefined);
const save = vi.fn().mockResolvedValue(undefined);
const upload = vi.fn().mockResolvedValue("uploaded");
function Panel({
  field,
  initial,
}: {
  field: SigningField;
  initial?: SigningForm;
}) {
  const [form, setForm] = useState(initial ?? signingForm({ fields: [field] }));
  return (
    <SignaturePanel
      activeField={field}
      fields={form.fields}
      form={form}
      onFormChange={setForm}
      onComplete={complete}
      onSaveField={save}
      onSelectField={() => undefined}
      onUploadAttachment={upload}
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
  save.mockClear();
  upload.mockClear().mockResolvedValue("uploaded");
  notifications.error.mockClear();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
it("uploads multiple files and removes pending files independently from saved attachments", async () => {
  const field = {
    type: "file",
    uuid: "files",
    description: "Attach supporting documents",
  };
  const form = signingForm({
    fields: [field],
    values: { files: ["saved", "missing", 42] },
    attachments: [
      {
        uuid: "saved",
        filename: "saved.pdf",
        content_type: "application/pdf",
        url: "/saved.pdf",
      },
    ],
  });
  const view = render(<Panel field={field} initial={form} />);
  await settle();
  expect(
    screen.getByRole("link", { name: "saved.pdf" }).getAttribute("href"),
  ).toBe("/saved.pdf");
  const input = view.container.querySelector("input[type=file]")!;
  expect(input.hasAttribute("multiple")).toBe(true);
  const file = new File(["one"], "one.pdf");
  const removed = new File(["two"], "two.pdf");
  fireEvent.change(input, { target: { files: [file, removed] } });
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Remove two.pdf" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove saved.pdf" }));
  await settle();
  expect(screen.queryByText("saved.pdf")).toBeNull();
  expect(screen.queryByText("two.pdf")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() => expect(upload).toHaveBeenCalledWith(file, "file"));
  expect(complete).toHaveBeenCalledWith(field, ["missing", "uploaded"], {});
});
it.each(["image", "stamp"])(
  "uploads, previews, replaces and saves a %s",
  async (type) => {
    const field = { type, uuid: "image", name: "Photo" };
    const view = render(<Panel field={field} />);
    await settle();
    const input = view.container.querySelector("input[type=file]")!;
    expect(input.getAttribute("accept")).toBe(
      "image/png,image/jpeg,image/webp",
    );
    const file = new File(["image"], "photo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await settle();
    expect(screen.getByAltText("photo.png").getAttribute("src")).toBe(
      "blob:preview",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reupload" }));
    await settle();
    expect(screen.queryByAltText("photo.png")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    fireEvent.change(input, { target: { files: [file] } });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
    await waitFor(() =>
      expect(complete).toHaveBeenCalledWith(field, "uploaded", {}),
    );
    expect(upload).toHaveBeenCalledWith(file, type);
  },
);
it("reuses saved image UUIDs without uploading them again", async () => {
  const field = { type: "image", uuid: "image", name: "Photo" };
  const form = signingForm({
    fields: [field],
    values: { image: "saved" },
    attachments: [
      {
        uuid: "saved",
        filename: "saved.png",
        content_type: "image/png",
        url: "/saved.png",
      },
    ],
  });
  render(<Panel field={field} initial={form} />);
  await settle();
  expect(screen.getByAltText("saved.png").getAttribute("src")).toBe(
    "/saved.png",
  );
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(complete).toHaveBeenCalledWith(field, "saved", {}),
  );
  expect(upload).not.toHaveBeenCalled();
});
it("rejects empty required uploads and permits an optional empty file field", async () => {
  const field = { type: "file", uuid: "file", name: "Supporting file" };
  const view = render(<Panel field={field} />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
  expect(complete).not.toHaveBeenCalled();
  expect(notifications.error).toHaveBeenCalledWith(
    "Complete the required field",
    expect.anything(),
  );
  view.unmount();
  render(<Panel field={{ ...field, required: false }} />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(complete).toHaveBeenCalledWith(
      { ...field, required: false },
      [],
      {},
    ),
  );
});
it("reports failed uploads and preserves selected files so the signer can retry", async () => {
  const field = { type: "image", uuid: "image", name: "Photo" };
  upload.mockRejectedValueOnce(new Error("Upload failed"));
  const view = render(<Panel field={field} />);
  await settle();
  fireEvent.change(view.container.querySelector("input[type=file]")!, {
    target: { files: [new File(["image"], "photo.png")] },
  });
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
  await waitFor(() =>
    expect(notifications.error).toHaveBeenCalledWith("Signing failed", {
      description: "Upload failed",
    }),
  );
  expect(screen.getByAltText("photo.png")).toBeTruthy();
  expect(complete).not.toHaveBeenCalled();
});
