import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../../apps/frontend/components/ui/tooltip";
import { FieldAreaOverlay } from "../../../apps/frontend/app/templates/[id]/edit/_components/canvas/field-area-overlay";
import { editorField, pageArea, signer, secondSigner } from "./fixtures";
type Props = React.ComponentProps<typeof FieldAreaOverlay>;
function setup(overrides: Partial<Props> = {}) {
  const props: Props = {
    area: pageArea,
    areaIndex: 0,
    field: editorField(),
    fields: [],
    isMultiSelected: false,
    isSaving: false,
    isSelected: true,
    onCopySelectedFields: vi.fn(),
    onDeleteField: vi.fn(),
    onDeleteSelectedFields: vi.fn(),
    onAddSubmitter: vi.fn(),
    onNudgeSelectedFields: vi.fn(),
    onPasteCopiedFields: vi.fn(),
    onSelectField: vi.fn(),
    onUpdateField: vi.fn(),
    onUpdateFieldArea: vi.fn(),
    submitters: [signer, secondSigner],
    ...overrides,
  };
  const view = render(
    <TooltipProvider delayDuration={0}>
      <div data-page-layer>
        <FieldAreaOverlay {...props} />
      </div>
    </TooltipProvider>,
  );
  const layer = view.container.querySelector("[data-page-layer]")!;
  vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({
    width: 1000,
    height: 1000,
    x: 0,
    y: 0,
    left: 0,
    right: 1000,
    top: 0,
    bottom: 1000,
    toJSON: () => ({}),
  });
  for (const button of view.container.querySelectorAll("button"))
    button.setPointerCapture = vi.fn();
  return { props, layer, ...view };
}
beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
it("selects a field and supports copy/paste/delete and bounded keyboard nudges", () => {
  const { props } = setup();
  const overlay = screen.getByRole("button", { name: "field field" });
  fireEvent.click(overlay, { ctrlKey: true });
  expect(props.onSelectField).toHaveBeenCalledWith("field", true);
  fireEvent.keyDown(overlay, { key: "c", ctrlKey: true });
  expect(props.onCopySelectedFields).toHaveBeenCalledWith("field");
  fireEvent.keyDown(overlay, { key: "V", metaKey: true });
  expect(props.onPasteCopiedFields).toHaveBeenCalledOnce();
  for (const key of ["Delete", "Backspace"])
    fireEvent.keyDown(overlay, { key });
  expect(props.onDeleteSelectedFields).toHaveBeenCalledTimes(2);
  for (const [key, dx, dy] of [
    ["ArrowLeft", -0.005, 0],
    ["ArrowRight", 0.005, 0],
    ["ArrowUp", 0, -0.005],
    ["ArrowDown", 0, 0.005],
  ] as const) {
    fireEvent.keyDown(overlay, { key });
    expect(props.onNudgeSelectedFields).toHaveBeenLastCalledWith(
      "field",
      dx,
      dy,
    );
  }
  fireEvent.keyDown(overlay, { key: "ArrowRight", shiftKey: true });
  expect(props.onNudgeSelectedFields).toHaveBeenLastCalledWith(
    "field",
    0.02,
    0,
  );
  fireEvent.keyDown(overlay, { key: "q" });
  expect(props.onNudgeSelectedFields).toHaveBeenCalledTimes(5);
});
it("saves selected text values on blur, keeps editing keys local, and supports required/delete controls", () => {
  const { props } = setup();
  const input = screen.getByRole("textbox", { name: "field value" });
  expect(document.activeElement).toBe(input);
  fireEvent.click(input);
  fireEvent.pointerDown(input);
  fireEvent.change(input, { target: { value: "Saved value" } });
  fireEvent.keyDown(input, { key: "c", ctrlKey: true });
  expect(props.onCopySelectedFields).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(props.onUpdateField).toHaveBeenCalledWith("field", {
    default_value: "Saved value",
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Mark field optional" }),
  );
  expect(props.onUpdateField).toHaveBeenLastCalledWith("field", {
    required: false,
  });
  fireEvent.pointerDown(screen.getByRole("button", { name: "Delete field" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete field" }));
  expect(props.onDeleteField).toHaveBeenCalledWith("field");
});
it.each([true, false])(
  "toggles selected checkbox values from %s without selecting the enclosing field",
  (checked) => {
    const { props } = setup({
      field: editorField("check", {
        type: "checkbox",
        default_value: checked,
        required: false,
      }),
    });
    const toggle = screen
      .getAllByRole("button")
      .find(
        (button) =>
          button.getAttribute("aria-pressed") === String(checked) &&
          !button.getAttribute("aria-label"),
      )!;
    fireEvent.pointerDown(toggle);
    fireEvent.click(toggle);
    expect(props.onUpdateField).toHaveBeenCalledWith("check", {
      default_value: !checked,
    });
    expect(props.onSelectField).not.toHaveBeenCalled();
  },
);
it("renames field labels by enter/blur while escape cancels and blank values preserve the name", () => {
  const { props } = setup();
  fireEvent.click(screen.getByRole("button", { name: /^field$/ }));
  let input = screen.getByRole("textbox", { name: "field name" });
  fireEvent.pointerDown(input);
  fireEvent.click(input);
  fireEvent.change(input, { target: { value: "  Updated  " } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(props.onUpdateField).toHaveBeenCalledWith("field", {
    name: "Updated",
  });
  fireEvent.click(screen.getByRole("button", { name: /^field$/ }));
  input = screen.getByRole("textbox", { name: "field name" });
  fireEvent.change(input, { target: { value: "Discarded" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("textbox", { name: "field name" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^field$/ }));
  input = screen.getByRole("textbox", { name: "field name" });
  fireEvent.blur(input, { target: { value: " " } });
  expect(
    vi
      .mocked(props.onUpdateField)
      .mock.calls.filter(([, patch]) => patch.name !== undefined),
  ).toHaveLength(1);
});
it("moves and resizes areas in normalized document coordinates", () => {
  const { props } = setup();
  const move = screen.getByRole("button", { name: "Move field" });
  fireEvent.pointerDown(move, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(move, { clientX: 200, clientY: 300 });
  fireEvent.pointerUp(move);
  expect(props.onUpdateFieldArea).toHaveBeenCalledWith(
    "field",
    0,
    expect.objectContaining({ x: 0.2, y: 0.30000000000000004 }),
  );
  const resize = screen.getByRole("button", { name: "Resize field" });
  fireEvent.pointerDown(resize, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(resize, { clientX: 200, clientY: 200 });
  fireEvent.pointerUp(resize);
  expect(props.onUpdateFieldArea).toHaveBeenCalledWith(
    "field",
    0,
    expect.objectContaining({ w: 0.30000000000000004, h: 0.14 }),
  );
});
it("cancels pointer edits and ignores secondary/saving interactions", () => {
  const { props } = setup({ isSaving: true });
  const move = screen.getByRole("button", { name: "Move field" });
  fireEvent.pointerDown(move, { button: 0 });
  fireEvent.pointerMove(move);
  fireEvent.pointerUp(move);
  expect(props.onUpdateFieldArea).not.toHaveBeenCalled();
});
it("shows values when unselected and icons for unchecked/other fields", () => {
  const first = setup({
    isSelected: false,
    field: editorField("text", { default_value: "Visible" }),
  });
  expect(screen.getByText("Visible")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Move text" })).toBeNull();
  first.unmount();
  const checkbox = setup({
    isSelected: false,
    field: editorField("check", { type: "checkbox", default_value: true }),
  });
  expect(screen.queryByRole("button", { name: "Move check" })).toBeNull();
  checkbox.unmount();
  setup({
    isSelected: false,
    isMultiSelected: true,
    field: editorField("date", { type: "date", name: "" }),
  });
  expect(
    screen
      .getByRole("button", { name: "Date Field 1 field" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});
it("changes signer roles and field types through real menus, avoiding no-op patches", async () => {
  const { props } = setup();
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Change field role" }),
    { button: 0 },
  );
  fireEvent.click(
    await screen.findByRole("menuitem", { name: /Second Party/ }),
  );
  expect(props.onUpdateField).toHaveBeenCalledWith("field", {
    submitter_uuid: "second",
  });
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Change field role" }),
    { button: 0 },
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: /First Party/ }));
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Change field role" }),
    { button: 0 },
  );
  fireEvent.click(
    await screen.findByRole("menuitem", { name: /Add Third Party/ }),
  );
  expect(props.onAddSubmitter).toHaveBeenCalledWith("field");
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Change field field type" }),
    { button: 0 },
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: /^Date$/ }));
  expect(props.onUpdateField).toHaveBeenCalledWith(
    "field",
    expect.objectContaining({ type: "date" }),
  );
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Change field field type" }),
    { button: 0 },
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: /Text/ }));
  expect(
    vi
      .mocked(props.onUpdateField)
      .mock.calls.filter(([, patch]) => patch.type || patch.submitter_uuid),
  ).toHaveLength(2);
});
it("formats conditional field hints using field/option names and handles unknown fields", async () => {
  const field = editorField("conditional", {
    conditions: [
      { field_uuid: "source", action: "equal", value: "yes" },
      { field_uuid: "unknown", value: "raw", operation: "or" },
      { field_uuid: "source", action: "empty", operation: "and" },
    ],
  });
  const { container } = setup({
    field,
    fields: [
      editorField("source", {
        name: "Consent",
        type: "select",
        options: [{ uuid: "yes", value: "Accepted" }],
      }),
    ],
  });
  const trigger = screen.getByLabelText("3 conditions");
  fireEvent.pointerMove(trigger, { pointerType: "mouse" });
  fireEvent.focus(trigger);
  await waitFor(() =>
    expect(container.ownerDocument.body.textContent).toContain("Consent"),
  );
});

it.each(["Move", "Resize"])("persists one %s gesture only once", (action) => {
  const { props } = setup();
  const move = screen.getByRole("button", { name: `${action} field` });
  fireEvent.pointerDown(move, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(move, { clientX: 200, clientY: 200 });
  fireEvent.pointerUp(move);
  expect(props.onUpdateFieldArea).toHaveBeenCalledTimes(1);
});
