import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DocumentPageImage } from "../../../apps/frontend/app/templates/[id]/edit/_components/canvas/document-page-image";
import { TemplateCanvas } from "../../../apps/frontend/app/templates/[id]/edit/_components/canvas/template-canvas";
import { PendingImportedFieldsBanner } from "../../../apps/frontend/app/templates/[id]/edit/_components/pending-imported-fields-banner";
import { FIELD_DRAG_MIME_TYPE } from "../../../apps/frontend/app/templates/[id]/edit/_lib/template-editor-model";
import {
  document as doc,
  editorField,
  pageArea,
  signer,
  templateFixture,
} from "./fixtures";
type PageProps = React.ComponentProps<typeof DocumentPageImage>;
function pageProps(overrides: Partial<PageProps> = {}): PageProps {
  return {
    activeFieldType: "text",
    documentUuid: "doc",
    fields: [],
    filename: "agreement.pdf",
    isSavingFields: false,
    onAddSubmitter: vi.fn(),
    onCopySelectedFields: vi.fn(),
    onCreateField: vi.fn(),
    onDeleteField: vi.fn(),
    onDeleteSelectedFields: vi.fn(),
    onDropField: vi.fn(),
    onNudgeSelectedFields: vi.fn(),
    onPasteCopiedFields: vi.fn(),
    onSelectField: vi.fn(),
    onUpdateField: vi.fn(),
    onUpdateFieldArea: vi.fn(),
    pageIndex: 0,
    previewImage: doc.preview_images[0],
    selectedFieldUuid: null,
    selectedFieldUuids: [],
    submitters: [signer],
    ...overrides,
  };
}
function renderPage(overrides: Partial<PageProps> = {}) {
  const props = pageProps(overrides);
  const view = render(<DocumentPageImage {...props} />);
  const page = view.container.firstElementChild as HTMLDivElement;
  page.setPointerCapture = vi.fn();
  vi.spyOn(page, "getBoundingClientRect").mockReturnValue({
    width: 1000,
    height: 1000,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 1000,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return { props, page, ...view };
}
beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
});
it("keeps page controls hidden until preview loads and exposes recoverable preview errors", () => {
  const { rerender, props } = renderPage({ pageIndex: 1 });
  const image = screen.getByRole("img", { name: "agreement.pdf page 2" });
  expect(image.getAttribute("loading")).toBe("lazy");
  expect(screen.getByText("Loading preview...")).toBeTruthy();
  fireEvent.error(image);
  expect(screen.getByText(/preview could not be loaded/)).toBeTruthy();
  fireEvent.load(image);
  expect(screen.queryByText(/preview could not be loaded/)).toBeNull();
  rerender(
    <DocumentPageImage
      {...props}
      previewImage={{ ...props.previewImage, url: "/new-url" }}
    />,
  );
  expect(screen.getByText("Loading preview...")).toBeTruthy();
});
it("draws normalized rectangles and uses default dimensions for a simple click", () => {
  const { page, props } = renderPage();
  fireEvent.pointerDown(page, { button: 0, clientX: 100, clientY: 200 });
  fireEvent.pointerMove(page, { clientX: 400, clientY: 300 });
  fireEvent.pointerUp(page, { clientX: 400, clientY: 300 });
  expect(props.onCreateField).toHaveBeenCalledWith(
    expect.objectContaining({
      attachment_uuid: "doc",
      page: 0,
      x: 0.1,
      y: 0.2,
    }),
  );
  expect(vi.mocked(props.onCreateField).mock.calls[0][0].w).toBeCloseTo(0.3);
  expect(vi.mocked(props.onCreateField).mock.calls[0][0].h).toBeCloseTo(0.1);
  fireEvent.pointerDown(page, { button: 0, clientX: 600, clientY: 600 });
  fireEvent.pointerUp(page, { clientX: 600, clientY: 600 });
  expect(props.onCreateField).toHaveBeenCalledTimes(2);
  expect(props.onSelectField).toHaveBeenCalledWith(null);
});
it("ignores drawing while saving, without a selected field type or with a secondary pointer", () => {
  const { page, props, rerender } = renderPage({ isSavingFields: true });
  for (const event of ["pointerDown", "pointerMove", "pointerUp"] as const)
    fireEvent[event](page, { button: 0 });
  rerender(
    <DocumentPageImage
      {...props}
      isSavingFields={false}
      activeFieldType={null}
    />,
  );
  fireEvent.pointerDown(page, { button: 0 });
  fireEvent.pointerUp(page);
  rerender(<DocumentPageImage {...props} isSavingFields={false} />);
  fireEvent.pointerDown(page, { button: 2 });
  fireEvent.pointerUp(page);
  expect(props.onCreateField).not.toHaveBeenCalled();
  fireEvent.pointerDown(page, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerCancel(page);
  fireEvent.pointerUp(page);
  expect(props.onCreateField).not.toHaveBeenCalled();
});
it.each([
  { kind: "new", type: "date" },
  { kind: "custom", type: "text", customFieldUuid: "custom" },
  { kind: "existing", fieldUuid: "known" },
  { kind: "existing", fieldUuid: "missing" },
])(
  "drops a typed field on the page at normalized coordinates %j",
  (payload) => {
    const { page, props } = renderPage({ fields: [editorField("known")] });
    const transfer = {
      types: [FIELD_DRAG_MIME_TYPE],
      getData: () => JSON.stringify(payload),
      dropEffect: "",
    };
    fireEvent.dragOver(page, { dataTransfer: transfer });
    expect(transfer.dropEffect).toBe("copy");
    fireEvent.drop(page, {
      dataTransfer: transfer,
      clientX: 100,
      clientY: 200,
    });
    expect(props.onDropField).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({ attachment_uuid: "doc", page: 0 }),
    );
  },
);
it("ignores unrelated drags and handles paste keyboard shortcuts on the page", () => {
  const { page, props } = renderPage();
  fireEvent.dragOver(page, { dataTransfer: { types: ["Files"] } });
  fireEvent.drop(page, { dataTransfer: { getData: () => "invalid" } });
  expect(props.onDropField).not.toHaveBeenCalled();
  fireEvent.keyDown(page, { key: "v", ctrlKey: true });
  fireEvent.keyDown(page, { key: "V", metaKey: true });
  fireEvent.keyDown(page, { key: "x" });
  expect(props.onPasteCopiedFields).toHaveBeenCalledTimes(2);
});
it("includes only areas belonging to this page and attachment", () => {
  renderPage({
    fields: [
      editorField("visible"),
      editorField("other-page", { areas: [{ ...pageArea, page: 1 }] }),
      editorField("other-document", {
        areas: [{ ...pageArea, attachment_uuid: "other" }],
      }),
    ],
  });
  fireEvent.load(screen.getByRole("img"));
  expect(screen.getByRole("button", { name: "visible field" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "other-page field" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "other-document field" }),
  ).toBeNull();
});
function canvasProps(
  overrides: Partial<React.ComponentProps<typeof TemplateCanvas>> = {},
): React.ComponentProps<typeof TemplateCanvas> {
  const {
    documentUuid: _documentUuid,
    filename: _filename,
    pageIndex: _pageIndex,
    previewImage: _previewImage,
    ...common
  } = pageProps();
  return {
    ...common,
    documents: [],
    isUploadingDocument: false,
    onAddDocument: vi.fn(),
    onAddGoogleDriveDocuments: vi.fn(),
    selectedDocumentUuid: null,
    template: templateFixture(),
    ...overrides,
  };
}
it("uploads only the first document and supports Google Drive from an empty canvas", () => {
  const props = canvasProps();
  const view = render(<TemplateCanvas {...props} />);
  const first = new File(["pdf"], "first.pdf");
  const second = new File(["pdf"], "second.pdf");
  const input = view.container.querySelector("input")!;
  fireEvent.change(input, { target: { files: [first, second] } });
  expect(props.onAddDocument).toHaveBeenCalledWith(first);
  fireEvent.click(screen.getByRole("button", { name: /Google Drive/ }));
  expect(props.onAddGoogleDriveDocuments).toHaveBeenCalledOnce();
  const zone = view.container.querySelector("section > div > div")!;
  fireEvent.dragEnter(zone);
  fireEvent.dragLeave(zone);
  fireEvent.dragOver(zone);
  fireEvent.drop(zone, { dataTransfer: { files: [first] } });
  expect(props.onAddDocument).toHaveBeenCalledTimes(2);
  fireEvent.change(input, { target: { files: [] } });
  expect(props.onAddDocument).toHaveBeenCalledTimes(2);
  view.rerender(<TemplateCanvas {...props} isUploadingDocument />);
  fireEvent.drop(zone, { dataTransfer: { files: [first] } });
  expect(props.onAddDocument).toHaveBeenCalledTimes(2);
});
it("renders document previews or a waiting placeholder and scrolls to the active document", () => {
  const scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  const props = canvasProps({ documents: [doc], selectedDocumentUuid: "doc" });
  const view = render(<TemplateCanvas {...props} />);
  expect(screen.getAllByRole("img")).toHaveLength(3);
  expect(scrollIntoView).toHaveBeenCalled();
  view.rerender(
    <TemplateCanvas {...props} documents={[{ ...doc, preview_images: [] }]} />,
  );
  expect(screen.getByText(/preview is not available yet/)).toBeTruthy();
});
it("offers keep/remove imported fields while disabling both actions during save", () => {
  const onKeep = vi.fn();
  const onRemove = vi.fn();
  const view = render(
    <PendingImportedFieldsBanner
      isSaving={false}
      onKeep={onKeep}
      onRemove={onRemove}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "KEEP" }));
  fireEvent.click(screen.getByRole("button", { name: "REMOVE" }));
  expect(onKeep).toHaveBeenCalledOnce();
  expect(onRemove).toHaveBeenCalledOnce();
  view.rerender(
    <PendingImportedFieldsBanner
      isSaving
      onKeep={onKeep}
      onRemove={onRemove}
    />,
  );
  expect(
    (screen.getByRole("button", { name: "KEEP" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
