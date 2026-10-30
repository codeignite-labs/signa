import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxGroup,
  ComboboxLabel,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "../../../apps/frontend/components/ui/combobox";
function FolderPicker({
  changed,
  showTrigger = true,
}: {
  changed?: (value: string) => void;
  showTrigger?: boolean;
}) {
  const [input, setInput] = useState("");
  const [value, setValue] = useState("Contracts");
  return (
    <Combobox
      inputValue={input}
      onInputValueChange={setInput}
      value={value}
      onValueChange={
        changed
          ? (next) => {
              setValue(next);
              changed(next);
            }
          : undefined
      }
    >
      <ComboboxInput placeholder="Folder" showTrigger={showTrigger} />
      <ComboboxContent>
        <ComboboxList>
          <ComboboxGroup>
            <ComboboxLabel>Folders</ComboboxLabel>
            {["Contracts", "Invoices"]
              .filter((name) => !input || name.includes(input))
              .map((name) => (
                <ComboboxItem key={name} value={name}>
                  {name}
                </ComboboxItem>
              ))}
          </ComboboxGroup>
          {input === "missing" && (
            <ComboboxEmpty>No matching folders</ComboboxEmpty>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
it("opens on focus, filters user input, chooses a folder and closes after selection", () => {
  const changed = vi.fn();
  render(<FolderPicker changed={changed} />);
  const input = screen.getByPlaceholderText("Folder");
  expect(screen.queryByText("Folders")).toBeNull();
  fireEvent.focus(input);
  expect(screen.getByText("Folders")).toBeTruthy();
  fireEvent.change(input, { target: { value: "Inv" } });
  expect(screen.queryByRole("button", { name: "Contracts" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Invoices" }));
  expect(changed).toHaveBeenCalledWith("Invoices");
  expect(input).toHaveProperty("value", "Invoices");
  expect(screen.queryByText("Folders")).toBeNull();
});
it("toggles the trigger, keeps inside clicks open, dismisses outside clicks and cleans up document listeners", () => {
  const remove = vi.spyOn(document, "removeEventListener");
  const view = render(<FolderPicker />);
  const trigger = screen.getByRole("button", { name: "Show folders" });
  fireEvent.click(trigger);
  expect(screen.getByText("Folders")).toBeTruthy();
  fireEvent.mouseDown(screen.getByText("Folders"));
  expect(screen.getByText("Folders")).toBeTruthy();
  fireEvent.click(trigger);
  expect(screen.queryByText("Folders")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.mouseDown(document.body);
  expect(screen.queryByText("Folders")).toBeNull();
  view.unmount();
  expect(remove).toHaveBeenCalledWith("mousedown", expect.any(Function));
});
it("supports input-only pickers, empty results, keyboard handlers and an omitted value callback", () => {
  const view = render(<FolderPicker showTrigger={false} />);
  expect(screen.queryByRole("button", { name: "Show folders" })).toBeNull();
  const input = screen.getByPlaceholderText("Folder");
  fireEvent.change(input, { target: { value: "missing" } });
  expect(screen.getByText("No matching folders")).toBeTruthy();
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Contracts" }));
  expect(input).toHaveProperty("value", "Contracts");
  view.unmount();
  const keyDown = vi.fn();
  render(
    <Combobox inputValue="" value="" onInputValueChange={vi.fn()}>
      <ComboboxInput placeholder="Custom" onKeyDown={keyDown} />
    </Combobox>,
  );
  fireEvent.keyDown(screen.getByPlaceholderText("Custom"), { key: "Escape" });
  expect(keyDown.mock.calls[0][0].key).toBe("Escape");
});
it.each([ComboboxInput, ComboboxContent, ComboboxItem])(
  "rejects a context-dependent child without its owning combobox",
  (Component) => {
    expect(() => render(<Component value="folder">Folder</Component>)).toThrow(
      "Combobox components must be used within Combobox",
    );
  },
);
