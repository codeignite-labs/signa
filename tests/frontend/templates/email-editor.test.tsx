import "../settings/browser-settings-fixture";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { EmailMarkdownEditor } from "../../../apps/frontend/app/templates/[id]/edit/email-markdown-editor";
const rectangle = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
};
const previousRects = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getClientRects",
);
const previousRect = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getBoundingClientRect",
);
beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => rectangle,
  });
});
afterAll(() => {
  if (previousRects)
    Object.defineProperty(Range.prototype, "getClientRects", previousRects);
  else Reflect.deleteProperty(Range.prototype, "getClientRects");
  if (previousRect)
    Object.defineProperty(
      Range.prototype,
      "getBoundingClientRect",
      previousRect,
    );
  else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
});
function Harness({
  initial = "Hello recipient",
  variables = true,
}: {
  initial?: string;
  variables?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <EmailMarkdownEditor
        label="Email body"
        value={value}
        onChange={setValue}
        variables={
          variables
            ? [
                { label: "Template name", value: "template.name" },
                { label: "Submitter link", value: "submitter.link" },
              ]
            : []
        }
      />
      <output data-testid="markdown">{value}</output>
    </>
  );
}
async function editor() {
  return await screen.findByLabelText("Email body");
}
async function selectText() {
  const surface = await editor();
  surface.focus();
  const range = document.createRange();
  range.selectNodeContents(surface.querySelector("p")!);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent(document, new Event("selectionchange"));
  await act(async () => {});
  return surface;
}
function topButton(name: string) {
  return screen.getAllByRole("button", { name })[0];
}
it("renders the real markdown editor, emits edits and accepts external content changes while unfocused", async () => {
  const changed = vi.fn();
  const view = render(
    <EmailMarkdownEditor
      label="Email body"
      value="Hello\n{account.name}"
      onChange={changed}
      variables={[]}
    />,
  );
  const surface = await editor();
  expect(surface.textContent).toContain("{account.name}");
  expect(surface.querySelector(".bg-amber-100")).toBeTruthy();
  fireEvent.input(surface, { target: { textContent: "Edited text" } });
  await waitFor(() => expect(changed).toHaveBeenCalledWith("Edited text"));
  surface.blur();
  view.rerender(
    <EmailMarkdownEditor
      label="Email body"
      value="External update"
      onChange={changed}
      variables={[]}
    />,
  );
  await waitFor(() => expect(surface.textContent).toBe("External update"));
  expect(screen.queryByRole("button", { name: "Add variable" })).toBeNull();
});
it.each([
  ["Bold", "strong"],
  ["Italic", "em"],
  ["Underline", "u"],
])(
  "formats selected email text with %s and supports undo/redo",
  async (button, tag) => {
    render(<Harness />);
    const surface = await selectText();
    fireEvent.click(topButton(button));
    await waitFor(() => expect(surface.querySelector(tag)).toBeTruthy());
    fireEvent.click(topButton("Undo"));
    await waitFor(() => expect(surface.querySelector(tag)).toBeNull());
    fireEvent.click(topButton("Redo"));
    await waitFor(() => expect(surface.querySelector(tag)).toBeTruthy());
  },
);
it("inserts a message variable at the current selection and preserves the saved selection when opening its menu", async () => {
  render(<Harness />);
  const surface = await editor();
  surface.focus();
  const button = screen.getByRole("button", { name: "Add variable" });
  fireEvent.pointerDown(button, { button: 0, ctrlKey: false });
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Template name" }),
  );
  await waitFor(() =>
    expect(screen.getByTestId("markdown").textContent).toContain(
      "{template.name}",
    ),
  );
});
it("adds a link variable to selected text instead of replacing its label", async () => {
  render(<Harness />);
  const surface = await selectText();
  const button = screen.getByRole("button", { name: "Add variable" });
  fireEvent.pointerDown(button, { button: 0, ctrlKey: false });
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Submitter link" }),
  );
  await waitFor(() =>
    expect(surface.querySelector("a")?.getAttribute("href")).toBe(
      "{submitter.link}",
    ),
  );
  expect(surface.textContent).toContain("Hello recipient");
});
it.each([
  ["example.test/path", "https://example.test/path"],
  ["mailto:signer@example.test", "mailto:signer@example.test"],
  ["{submitter.link}", "{submitter.link}"],
  [" https://example.test/path ", "https://example.test/path"],
])("normalizes and saves the link URL %s", async (url, href) => {
  render(<Harness />);
  const surface = await selectText();
  fireEvent.click(topButton("Link"));
  fireEvent.change(
    screen.getByPlaceholderText("Enter a URL or variable name"),
    { target: { value: url } },
  );
  fireEvent.keyDown(
    screen.getByPlaceholderText("Enter a URL or variable name"),
    { key: "Enter" },
  );
  await waitFor(() =>
    expect(surface.querySelector("a")?.getAttribute("href")).toBe(href),
  );
});
it("cancels link changes with Escape and supports removing an existing link", async () => {
  render(<Harness initial="[Hello recipient](https://example.test)" />);
  const surface = await selectText();
  fireEvent.click(topButton("Link"));
  const input = screen.getByPlaceholderText("Enter a URL or variable name");
  expect((input as HTMLInputElement).value).toBe("https://example.test");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(
    screen.queryByPlaceholderText("Enter a URL or variable name"),
  ).toBeNull();
  fireEvent.click(topButton("Link"));
  fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
  await waitFor(() => expect(surface.querySelector("a")).toBeNull());
});
it("uses an empty link URL to remove the mark and supports the Save link button", async () => {
  render(<Harness initial="[Hello recipient](https://example.test)" />);
  const surface = await selectText();
  fireEvent.click(topButton("Link"));
  fireEvent.change(
    screen.getByPlaceholderText("Enter a URL or variable name"),
    { target: { value: "" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Save link" }));
  await waitFor(() => expect(surface.querySelector("a")).toBeNull());
});
it("inserts a hard break on Enter and handles an initially empty message", async () => {
  render(<Harness initial="" />);
  const surface = await editor();
  surface.focus();
  fireEvent.keyDown(surface, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(surface.querySelector("br")).toBeTruthy());
});
it("formats text through the selection bubble controls and its link editor", async () => {
  render(<Harness />);
  const surface = await selectText();
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "Bold" })).toHaveLength(2),
  );
  for (const [name, tag] of [
    ["Bold", "strong"],
    ["Italic", "em"],
    ["Underline", "u"],
  ]) {
    fireEvent.click(screen.getAllByRole("button", { name }).at(-1)!);
    await waitFor(() => expect(surface.querySelector(tag)).toBeTruthy());
  }
  fireEvent.click(screen.getAllByRole("button", { name: "Link" }).at(-1)!);
  fireEvent.change(
    screen.getByPlaceholderText("Enter a URL or variable name"),
    { target: { value: "bubble.example.test" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Save link" }));
  await waitFor(() =>
    expect(surface.querySelector("a")?.getAttribute("href")).toBe(
      "https://bubble.example.test",
    ),
  );
});
it("opens the variable menu with the keyboard and inserts a variable without losing the cursor", async () => {
  render(<Harness />);
  await editor();
  fireEvent.keyDown(screen.getByRole("button", { name: "Add variable" }), {
    key: "Enter",
  });
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Template name" }),
  );
  await waitFor(() =>
    expect(screen.getByTestId("markdown").textContent).toContain(
      "{template.name}",
    ),
  );
});
it("does not open the variable menu when an unrelated key is pressed", async () => {
  render(<Harness />);
  await editor();
  fireEvent.keyDown(screen.getByRole("button", { name: "Add variable" }), {
    key: "Escape",
  });
  expect(screen.queryByRole("menu")).toBeNull();
});
