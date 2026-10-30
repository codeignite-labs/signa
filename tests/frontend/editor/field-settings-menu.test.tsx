import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FieldSettingsMenu } from "../../../apps/frontend/app/templates/[id]/edit/_components/fields/field-settings-menu";
import { editorField } from "./fixtures";
import type { TemplateEditorField } from "../../../apps/frontend/app/templates/[id]/edit/_lib/template-editor-model";
beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
function setup(
  field = editorField(),
  index = 1,
  fields = [editorField("first"), field, editorField("last")],
) {
  const props = {
    field,
    fields,
    index,
    onCopyToAllPages: vi.fn().mockResolvedValue(undefined),
    onGoToPage: vi.fn(),
    onMoveDown: vi.fn().mockResolvedValue(undefined),
    onMoveUp: vi.fn().mockResolvedValue(undefined),
    onOpenConditions: vi.fn(),
    onOpenDescription: vi.fn(),
    onOpenSettings: vi.fn(),
    onSaveCustomField: vi.fn().mockResolvedValue(undefined),
    onStartDrawNewArea: vi.fn(),
    onUpdateField: vi.fn().mockResolvedValue(undefined),
    title: "Field",
  };
  const view = render(<FieldSettingsMenu {...props} />);
  const open = () =>
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Open settings for Field" }),
      { button: 0 },
    );
  open();
  return { props, open, ...view };
}
it("invokes navigation, movement, formatting and custom-field menu actions", async () => {
  const { props, open } = setup();
  const cases = [
    ["Move up", props.onMoveUp],
    ["Move down", props.onMoveDown],
    ["More format options", props.onOpenSettings],
    ["Description", props.onOpenDescription],
    ["Condition", props.onOpenConditions],
    ["Page", props.onGoToPage],
    ["Draw new area", props.onStartDrawNewArea],
    ["Copy to all pages", props.onCopyToAllPages],
    ["Save as custom field", props.onSaveCustomField],
  ] as const;
  for (let index = 0; index < cases.length; index++) {
    if (index) open();
    const [label, callback] = cases[index];
    fireEvent.click(await screen.findByRole("menuitem", { name: label }));
    expect(callback).toHaveBeenCalledOnce();
  }
});
it("saves default text on blur and toggles required/read-only states while keeping the menu open", () => {
  const { props } = setup();
  const input = screen.getByPlaceholderText("Default value");
  fireEvent.change(input, { target: { value: "Default" } });
  fireEvent.blur(input);
  expect(props.onUpdateField).toHaveBeenCalledWith("field", {
    default_value: "Default",
  });
  fireEvent.click(
    screen.getByRole("switch", { name: "Toggle required for Field" }),
  );
  expect(props.onUpdateField).toHaveBeenCalledWith("field", {
    required: false,
  });
  fireEvent.click(
    screen.getByRole("switch", { name: "Toggle read-only for Field" }),
  );
  expect(props.onUpdateField).toHaveBeenCalledWith("field", { readonly: true });
});
it("sets preset/length validation and clears rules with None", () => {
  const { props } = setup();
  const select = screen.getByRole("combobox");
  fireEvent.change(select, { target: { value: "email" } });
  expect(props.onUpdateField).toHaveBeenCalledWith("field", {
    validation: expect.objectContaining({
      pattern: expect.stringContaining("@"),
    }),
  });
  fireEvent.change(select, { target: { value: "length" } });
  fireEvent.change(screen.getByPlaceholderText("Min"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByPlaceholderText("Max"), {
    target: { value: "8" },
  });
  fireEvent.blur(screen.getByPlaceholderText("Max"));
  expect(props.onUpdateField).toHaveBeenLastCalledWith("field", {
    validation: { pattern: ".{2,8}" },
  });
  fireEvent.change(select, { target: { value: "" } });
  expect(props.onUpdateField).toHaveBeenLastCalledWith("field", {
    validation: undefined,
  });
});
it.each([true, false])(
  "stores checkbox defaults as booleans for initial value %s",
  (checked) => {
    const { props } = setup(
      editorField("check", { type: "checkbox", default_value: checked }),
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: checked ? "false" : "true" },
    });
    expect(props.onUpdateField).toHaveBeenCalledWith("check", {
      default_value: !checked,
    });
  },
);
it("saves number format/min/max and removes empty limits", () => {
  const { props } = setup(
    editorField("number", {
      type: "number",
      preferences: { retained: true },
      validation: { min: 1, max: 10 },
    }),
  );
  const format = screen.getByRole("combobox") as HTMLSelectElement;
  fireEvent.change(format, { target: { value: format.options[1].value } });
  expect(props.onUpdateField).toHaveBeenCalledWith("number", {
    preferences: { retained: true, format: format.options[1].value },
  });
  fireEvent.change(screen.getByPlaceholderText("Min"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByPlaceholderText("Max"), {
    target: { value: "8" },
  });
  fireEvent.blur(screen.getByPlaceholderText("Min"));
  expect(props.onUpdateField).toHaveBeenLastCalledWith("number", {
    validation: { min: 2, max: 8 },
  });
  fireEvent.change(screen.getByPlaceholderText("Min"), {
    target: { value: "" },
  });
  fireEvent.change(screen.getByPlaceholderText("Max"), {
    target: { value: "" },
  });
  fireEvent.blur(screen.getByPlaceholderText("Max"));
  expect(props.onUpdateField).toHaveBeenLastCalledWith("number", {
    validation: undefined,
  });
});
it("sets and clears a required phone country while preserving extra validation keys", () => {
  const { props } = setup(
    editorField("phone", { type: "phone", validation: { retained: true } }),
  );
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "KE" } });
  expect(props.onUpdateField).toHaveBeenCalledWith("phone", {
    validation: { retained: true, phone_country: "KE" },
  });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
  expect(props.onUpdateField).toHaveBeenLastCalledWith("phone", {
    validation: { retained: true },
  });
});
it("disables movement outside field list bounds and displays non-editable field controls safely", () => {
  const field: TemplateEditorField = editorField("signature", {
    type: "signature",
    preferences: null,
    validation: null,
    required: false,
    readonly: true,
  });
  setup(field, 0, [field]);
  expect(
    screen
      .getByRole("menuitem", { name: "Move up" })
      .getAttribute("aria-disabled"),
  ).toBe("true");
  expect(
    screen
      .getByRole("menuitem", { name: "Move down" })
      .getAttribute("aria-disabled"),
  ).toBe("true");
  expect(screen.queryByPlaceholderText("Default value")).toBeNull();
});
it("loads saved date format without replacing it on menu open", () => {
  const { props } = setup(
    editorField("date", {
      type: "date",
      preferences: { format: "MM/DD/YYYY" },
    }),
  );
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
    "MM/DD/YYYY",
  );
  expect(props.onUpdateField).not.toHaveBeenCalled();
});
it("saves an open-ended length rule with a zero minimum", () => {
  const { props } = setup(
    editorField("text", { validation: { pattern: ".{2,8}" } }),
  );
  fireEvent.change(screen.getByPlaceholderText("Min"), {
    target: { value: "" },
  });
  fireEvent.blur(screen.getByPlaceholderText("Min"));
  expect(props.onUpdateField).toHaveBeenLastCalledWith("text", {
    validation: { pattern: ".{0,8}" },
  });
});
it("removes a phone validation object when its last country rule is cleared", () => {
  const { props } = setup(
    editorField("phone", {
      type: "phone",
      validation: { phone_country: "KE" },
    }),
  );
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
  expect(props.onUpdateField).toHaveBeenLastCalledWith("phone", {
    validation: undefined,
  });
});
