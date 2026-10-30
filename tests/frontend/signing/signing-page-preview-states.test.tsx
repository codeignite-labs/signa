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
vi.mock("next/navigation", () => ({ useRouter: () => routing }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { SigningPage } from "../../../apps/frontend/app/s/[slug]/signing-page";
import type { SigningField } from "../../../apps/frontend/lib/api/signing";
import { saveAuthSession } from "../../../apps/frontend/lib/api/auth";
import { signingForm, textField, jsonResponse } from "./signing-fixtures";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi
    .fn()
    .mockImplementation(async () => jsonResponse(signingForm()));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/s/slug");
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:upload");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
async function load(form = signingForm()) {
  fetchMock.mockResolvedValueOnce(jsonResponse(form));
  const view = render(<SigningPage slug="slug" />);
  await screen.findByRole("heading", { name: "Customer agreement" });
  return view;
}
it("honors a disabled decline policy and never loads another user saved signature assets", async () => {
  const form = signingForm();
  form.configs.with_decline = false;
  form.configs.prefill_signature = true;
  await load(form);
  await screen.findByPlaceholderText("Full name");
  expect(screen.queryByRole("button", { name: "DECLINE" })).toBeNull();
  expect(fetchMock).toHaveBeenCalledOnce();
});
it("does not prefill a public signer from a different signed-in identity", async () => {
  saveAuthSession({
    access_token: "token",
    user: {
      id: "other",
      email: "other@example.test",
      role: "viewer",
      first_name: "Other",
      last_name: "User",
    },
    account: { id: "other", name: "Other", locale: "en-US", timezone: "UTC" },
  });
  const form = signingForm();
  form.configs.prefill_signature = true;
  await load(form);
  await screen.findByPlaceholderText("Full name");
  expect(fetchMock).toHaveBeenCalledOnce();
});
it("uploads an image through the actual page attachment handler before submitting its UUID", async () => {
  const field = { uuid: "photo", type: "image", name: "Photo" };
  const form = signingForm({ fields: [field] });
  const view = await load(form);
  await screen.findByText("Upload an image");
  const file = new File(["image"], "photo.png", { type: "image/png" });
  fireEvent.change(view.container.querySelector("input[type=file]")!, {
    target: { files: [file] },
  });
  fetchMock
    .mockResolvedValueOnce(
      jsonResponse({
        uuid: "uploaded",
        filename: file.name,
        content_type: file.type,
        url: "/photo.png",
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        ...form,
        values: { photo: "uploaded" },
        submitter: { ...form.submitter, completed_at: "2026-10-31" },
      }),
    );
  fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
  await screen.findByText("Form has been completed!");
  expect(fetchMock.mock.calls[1][0]).toBe("/api/signing/slug/attachments");
  expect(fetchMock.mock.calls[1][1].body.get("type")).toBe("image");
  expect(fetchMock.mock.calls[1][1].body.get("file").name).toBe("photo.png");
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
    values: { photo: "uploaded" },
  });
});
it("returns to an earlier incomplete field after saving the final field and supports step navigation", async () => {
  const last = { uuid: "notes", type: "text", name: "Notes", required: false };
  const form = signingForm({ fields: [textField, last] });
  fetchMock.mockResolvedValueOnce(jsonResponse(form));
  render(<SigningPage slug="slug" focusFieldPrefix="notes" />);
  await screen.findByPlaceholderText("Notes");
  fireEvent.change(screen.getByPlaceholderText("Notes"), {
    target: { value: "Ready" },
  });
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ ...form, values: { notes: "Ready" } }),
  );
  fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
  await waitFor(() =>
    expect(screen.queryByPlaceholderText("Notes")).toBeNull(),
  );
  await screen.findByPlaceholderText("Full name");
  fireEvent.change(screen.getByPlaceholderText("Full name"), {
    target: { value: "Casey" },
  });
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole("button", { name: "Go to Notes" }));
  expect(await screen.findByPlaceholderText("Notes")).toHaveProperty(
    "value",
    "Ready",
  );
  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      ...form,
      values: { "field-1": "Casey", notes: "Ready" },
      submitter: { ...form.submitter, completed_at: "2026-10-31" },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await screen.findByText("Form has been completed!");
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
    values: { "field-1": "Casey", notes: "Ready" },
  });
});
it("renders selected and unselected option marks and supports native choice area mouse/keyboard interactions", async () => {
  const area = { attachment_uuid: "document", page: 0 };
  const fields: SigningField[] = [
    {
      uuid: "consent",
      type: "checkbox",
      name: "Consent",
      required: false,
      areas: [area],
    },
    {
      uuid: "multi",
      type: "multiple",
      name: "Plans",
      options: [
        { uuid: "one", value: "One" },
        { uuid: "two", value: "Two" },
      ],
      areas: [
        { ...area, option_uuid: "one" },
        { ...area, option_uuid: "two" },
      ],
    },
    {
      uuid: "radio",
      type: "radio",
      name: "Choose a plan",
      options: [
        { uuid: "one", value: "One" },
        { uuid: "two", value: "Two" },
      ],
      areas: [
        { ...area, option_uuid: "one" },
        { ...area, option_uuid: "two" },
      ],
    },
    {
      uuid: "select",
      type: "select",
      name: "Legacy choice",
      preferences: { options: ["One", "Two"] },
      areas: [area],
    },
  ];
  await load(signingForm({ fields, values: { multi: ["One"] } }));
  await screen.findByRole("checkbox");
  const consent = screen.getByRole("button", { name: "Consent" });
  fireEvent.keyDown(consent, { key: "Escape" });
  fireEvent.click(consent);
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
    "false",
  );
  fireEvent.click(
    screen.getAllByRole("button", { name: "Plans, completed" })[0],
  );
  expect(await screen.findByRole("checkbox", { name: "One" })).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Choose a plan" })[0]);
  expect(
    (await screen.findByRole("radio", { name: "One" })).getAttribute(
      "aria-checked",
    ),
  ).toBe("false");
});
it("renders saved signature images using title/type fallback labels on a read-only form", async () => {
  const area = { attachment_uuid: "document", page: 0 };
  const fields: SigningField[] = [
    { uuid: "signature", type: "signature", title: "Approval", areas: [area] },
    { uuid: "initials", type: "initials", areas: [area] },
  ];
  const form = signingForm({
    fields,
    values: { signature: "asset", initials: "asset" },
    attachments: [
      {
        uuid: "asset",
        filename: "saved.png",
        content_type: "image/png",
        url: "/saved.png",
      },
    ],
  });
  form.submitter.declined_at = "2026-10-31";
  await load(form);
  expect(screen.getByAltText("Approval").getAttribute("src")).toBe(
    "/saved.png",
  );
  expect(screen.getByAltText("initials").getAttribute("src")).toBe(
    "/saved.png",
  );
});
it("supports legacy name-based value keys while preserving the signing API wire shape", async () => {
  const field = {
    type: "text",
    name: "Legacy name",
    required: false,
    areas: [{ attachment_uuid: "document", page: 0 }],
  };
  const form = signingForm({ fields: [field] });
  await load(form);
  fireEvent.change(await screen.findByPlaceholderText("Legacy name"), {
    target: { value: "Casey" },
  });
  await act(async () => {
    await Promise.resolve();
  });
  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      ...form,
      values: { "Legacy name": "Casey" },
      submitter: { ...form.submitter, completed_at: "2026-10-31" },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await screen.findByText("Form has been completed!");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    values: { "Legacy name": "Casey" },
  });
});
it("keeps completed-panel download controls busy until the download endpoint responds", async () => {
  const form = signingForm();
  await load(form);
  fireEvent.change(await screen.findByPlaceholderText("Full name"), {
    target: { value: "Casey" },
  });
  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      ...form,
      submitter: { ...form.submitter, completed_at: "2026-10-31" },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await screen.findByText("Form has been completed!");
  let resolve: ((response: Response) => void) | undefined;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const button = screen.getByRole("button", { name: "DOWNLOAD" });
  fireEvent.click(button);
  expect(button.hasAttribute("disabled")).toBe(true);
  await act(async () => {
    resolve?.(jsonResponse({ documents: [] }));
  });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
});
