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
import { signingForm, textField, jsonResponse } from "./signing-fixtures";
const complete = vi.fn().mockResolvedValue(undefined);
const save = vi.fn().mockResolvedValue(undefined);
const select = vi.fn();
const upload = vi.fn().mockResolvedValue("uploaded");
let fetchMock: ReturnType<typeof vi.fn>;
function Panel({
  field = textField,
  form: initialForm,
  next,
  assets,
}: {
  field?: SigningField | null;
  form?: SigningForm;
  next?: SigningField;
  assets?: { signature: null; initials: null };
}) {
  const [form, setForm] = useState(
    initialForm ??
      signingForm({ fields: field ? [field, ...(next ? [next] : [])] : [] }),
  );
  return (
    <SignaturePanel
      activeField={field}
      fields={form.fields}
      form={form}
      onFormChange={setForm}
      onComplete={complete}
      onSaveField={save}
      onSelectField={select}
      onUploadAttachment={upload}
      savedAssets={assets}
    />
  );
}
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}
beforeEach(() => {
  complete.mockClear().mockResolvedValue(undefined);
  save.mockClear().mockResolvedValue(undefined);
  select.mockClear();
  upload.mockClear().mockResolvedValue("uploaded");
  notifications.error.mockClear();
  notifications.success.mockClear();
  fetchMock = vi.fn().mockImplementation(async () => jsonResponse({}));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
it("renders no controls without an active field", () => {
  const view = render(<Panel field={null} />);
  expect(view.container.innerHTML).toBe("");
});
it("blocks required-field save/navigation until a value is entered, then completes", async () => {
  render(<Panel />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
  expect(notifications.error).toHaveBeenCalledWith(
    "Complete the required field",
    expect.objectContaining({
      description: "Full name is required before you can continue.",
    }),
  );
  expect(complete).not.toHaveBeenCalled();
  fireEvent.change(screen.getByPlaceholderText("Full name"), {
    target: { value: "Casey Example" },
  });
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(complete).toHaveBeenCalledWith(textField, "Casey Example", {}),
  );
});
it("supports multiline input and minimizes/restores the panel", async () => {
  render(<Panel />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Use multiple lines" }));
  expect(screen.getByPlaceholderText("Full name").tagName).toBe("TEXTAREA");
  fireEvent.change(screen.getByPlaceholderText("Full name"), {
    target: { value: "Casey\nExample" },
  });
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Use single line" }));
  expect(screen.getByPlaceholderText("Full name").tagName).toBe("INPUT");
  fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
  expect(screen.queryByPlaceholderText("Full name")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "CONTINUE" }));
  expect(screen.getByPlaceholderText("Full name")).toHaveProperty(
    "value",
    "Casey\nExample".replace("\n", ""),
  );
});
it("saves intermediate fields and guards step-dot navigation", async () => {
  const next = { uuid: "next", name: "Address", type: "text" };
  render(<Panel next={next} />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Go to Full name" }));
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Go to Address" }));
  expect(select).not.toHaveBeenCalled();
  fireEvent.change(screen.getByPlaceholderText("Full name"), {
    target: { value: "Casey" },
  });
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Go to Address" }));
  expect(select).toHaveBeenCalledWith(next);
  fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(textField, "Casey", {}),
  );
  expect(notifications.success).toHaveBeenCalledWith("Field saved");
});
it.each([new Error("Server validation"), "unexpected"])(
  "reports save failures and releases the busy state",
  async (failure) => {
    complete.mockRejectedValue(failure);
    render(<Panel field={{ ...textField, required: false }} />);
    await settle();
    const button = screen.getByRole("button", { name: "SIGN AND COMPLETE" });
    fireEvent.click(button);
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith("Signing failed", {
        description:
          failure instanceof Error
            ? failure.message
            : "Field could not be saved.",
      }),
    );
    expect(button.hasAttribute("disabled")).toBe(false);
  },
);
it("keeps an incomplete required earlier field from completing an optional last field", async () => {
  const field = { uuid: "last", name: "Notes", type: "text", required: false };
  render(
    <Panel field={field} form={signingForm({ fields: [textField, field] })} />,
  );
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(field, "", {}));
  expect(complete).not.toHaveBeenCalled();
});
it("round-trips a required checkbox as a boolean", async () => {
  const field = {
    uuid: "check",
    type: "checkbox",
    name: "Consent",
    description: "I agree",
  };
  render(<Panel field={field} />);
  await settle();
  fireEvent.click(screen.getByRole("checkbox"));
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() => expect(complete).toHaveBeenCalledWith(field, true, {}));
});
it("supports multiple-choice selection and deselection before saving an array", async () => {
  const field = {
    uuid: "choices",
    name: "Interests",
    type: "multiple",
    options: [
      "Alpha",
      { uuid: "b", label: "Beta" },
      123,
      { name: "Delta" },
      { title: "Epsilon" },
      { text: "Zeta" },
    ],
  };
  render(<Panel field={field} />);
  await settle();
  const choices = screen.getAllByRole("checkbox");
  expect(choices).toHaveLength(6);
  fireEvent.click(choices[0]);
  await settle();
  fireEvent.click(choices[1]);
  await settle();
  fireEvent.click(choices[0]);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(complete).toHaveBeenCalledWith(field, ["Beta"], {}),
  );
});
it("saves single-choice radio values and derives options from legacy preferences", async () => {
  const field = {
    uuid: "choice",
    type: "radio",
    preferences: { options: [{ value: "Alpha" }, { label: "Beta" }] },
  };
  render(<Panel field={field} />);
  await settle();
  fireEvent.click(screen.getByRole("radio", { name: "Beta" }));
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() => expect(complete).toHaveBeenCalledWith(field, "Beta", {}));
});
it("derives missing choices from option areas", async () => {
  const field = {
    uuid: "choice",
    type: "radio",
    areas: [{ option_uuid: "one" }, { option_uuid: "two" }, {}],
  };
  render(<Panel field={field} />);
  await settle();
  expect(screen.getAllByRole("radio")).toHaveLength(2);
  fireEvent.click(screen.getByRole("radio", { name: "Option 1" }));
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(complete).toHaveBeenCalledWith(field, "Option 1", {}),
  );
});
it.each([
  ["number", { min: 0, max: "99", step: 0.5 }, undefined, "number", undefined],
  ["cells", {}, [{ w: 0.5, cell_w: 0.1 }], "text", "5"],
  ["cells", {}, [{ w: 0.55, cell_w: 0.1 }], "text", "6"],
  ["cells", {}, [{}], "text", null],
  ["text", { pattern: "[A-Z]+" }, undefined, "text", null],
])(
  "renders %s validation attributes without changing their semantics",
  async (type, validation, areas, inputType, maxLength) => {
    const field = {
      uuid: "value",
      name: "Value",
      type,
      validation,
      areas,
    } as SigningField;
    render(<Panel field={field} />);
    await settle();
    const input = screen.getByPlaceholderText("Value");
    expect(input.getAttribute("type")).toBe(inputType);
    if (maxLength !== undefined)
      expect(input.getAttribute("maxlength")).toBe(maxLength);
    if (type === "number") {
      expect(input.getAttribute("min")).toBe("0");
      expect(input.getAttribute("max")).toBe("99");
      expect(input.getAttribute("step")).toBe("0.5");
      expect(input.getAttribute("inputmode")).toBe("decimal");
    }
    if (type === "text") {
      expect(input.getAttribute("pattern")).toBe("[A-Z]+");
      expect(
        screen.queryByRole("button", { name: "Use multiple lines" }),
      ).toBeNull();
    }
  },
);
it.each([
  [undefined, "date", "2026-10-31"],
  ["MM/YYYY", "month", "2026-10"],
  ["MM/DD/YYYY HH:mm", "datetime-local", "2026-10-31T10:30"],
])(
  "renders date format %s and serializes edits",
  async (format, type, value) => {
    const field = {
      uuid: "date",
      name: "Signed date",
      type: "date",
      preferences: { format },
      validation: { min: "{date}", max: "{{date}}" },
    };
    const view = render(<Panel field={field} />);
    await settle();
    const input = view.container.querySelector("input")!;
    expect(input.type).toBe(type);
    expect(input.getAttribute("min")).toBeTruthy();
    expect(input.getAttribute("max")).toBeTruthy();
    if (type !== "datetime-local")
      fireEvent.click(screen.getByRole("button", { name: "Set today" }));
    else expect(screen.queryByRole("button", { name: "Set today" })).toBeNull();
    fireEvent.change(input, { target: { value } });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
    await waitFor(() =>
      expect(complete).toHaveBeenCalledWith(
        field,
        type === "datetime-local" ? new Date(value).toISOString() : value,
        {},
      ),
    );
  },
);
it("prevents a today shortcut when the configured date bounds exclude today", async () => {
  const view = render(
    <Panel
      field={{
        type: "date",
        name: "Historical",
        validation: { max: "2000-01-01" },
      }}
    />,
  );
  await settle();
  expect(screen.queryByRole("button", { name: "Set today" })).toBeNull();
  expect(view.container.querySelector("input")?.max).toBe("2000-01-01");
});
it("keeps payment unconfigured and does not pretend it collected a payment", async () => {
  const field = { type: "payment", uuid: "payment", name: "Payment" };
  render(
    <Panel
      field={field}
      form={signingForm({ fields: [field], values: { payment: "pending" } })}
    />,
  );
  await settle();
  expect(screen.getByText(/Payment collection needs/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(notifications.error).toHaveBeenCalledWith("Signing failed", {
      description: "Payment collection is not configured yet.",
    }),
  );
  expect(complete).not.toHaveBeenCalled();
});
it("selects dropdown options and retains a legacy title when no name exists", async () => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  const field = {
    uuid: "select",
    type: "select",
    title: "Plan",
    options: ["Basic", "Premium"],
  };
  render(<Panel field={field} />);
  await settle();
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(await screen.findByRole("option", { name: "Premium" }));
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(complete).toHaveBeenCalledWith(field, "Premium", {}),
  );
});
it("normalizes numeric and boolean defaults into editable strings", async () => {
  const view = render(
    <Panel
      field={{
        uuid: "numeric",
        type: "number",
        title: "Quantity",
        default_value: 0,
      }}
    />,
  );
  await settle();
  expect(screen.getByPlaceholderText("Number")).toHaveProperty("value", "0");
  view.unmount();
  render(
    <Panel
      field={{ uuid: "checkbox", type: "checkbox", default_value: true }}
    />,
  );
  await settle();
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
    "true",
  );
});
it("handles a field outside the current field list and supports a name-based legacy value key", async () => {
  const outside = { name: "Legacy field", type: "text", required: false };
  render(
    <Panel
      field={outside}
      form={signingForm({ fields: [textField], values: { Name: "Existing" } })}
    />,
  );
  await settle();
  expect(screen.getByRole("status").getAttribute("aria-label")).toBe(
    "Step 1 of 2",
  );
  fireEvent.change(screen.getByPlaceholderText("Legacy field"), {
    target: { value: "Legacy value" },
  });
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(outside, "Legacy value", {}),
  );
});
it("uses explicit date formats, ISO bounds and malformed legacy datetime defaults without inventing dates", async () => {
  const field = {
    uuid: "date",
    type: "date",
    preferences: { format: "YYYY-MM-DD HH:mm" },
    validation: { min: "2026-01-01T12:30:00Z", max: 42 },
    default_value: "invalid-date",
  };
  const view = render(<Panel field={field} />);
  await settle();
  const input = view.container.querySelector("input")!;
  expect(input.type).toBe("datetime-local");
  expect(input.getAttribute("min")).toContain("2026-01-01T");
  expect(input.getAttribute("max")).toBeNull();
  expect(input.value).toBe("");
});
