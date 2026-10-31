import { expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createTemplateEditorFieldActions } from "../../../apps/frontend/app/templates/[id]/edit/_hooks/template-editor-field-actions";
import {
  document,
  editorField,
  pageArea,
  signer,
  templateFixture,
} from "./fixtures";
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
type Context = Parameters<typeof createTemplateEditorFieldActions>[0];
function setup(overrides: Partial<Context> = {}) {
  const context: Context = {
    activeFieldType: "text",
    currentFields: [
      editorField(),
      editorField("other", { submitter_uuid: "other" }),
      editorField("last"),
    ],
    customFields: [{ name: "Address", type: "text", uuid: "custom" }],
    currentTemplate: templateFixture(),
    getEffectiveSelectedFieldUuids: () => ["field"],
    persistFields: vi.fn().mockResolvedValue(undefined),
    persistTemplateStructure: vi.fn().mockResolvedValue(undefined),
    selectField: vi.fn(),
    selectedDocument: document,
    selectedField: null,
    selectedSubmitter: signer,
    setActiveFieldType: vi.fn(),
    setSelectedDocumentUuid: vi.fn(),
    setSelectedFieldUuid: vi.fn(),
    setSelectedFieldUuids: vi.fn(),
    ...overrides,
  };
  return { context, actions: createTemplateEditorFieldActions(context) };
}
it("creates typed and custom fields and selects them after persistence", async () => {
  const { context, actions } = setup();
  await actions.createField(pageArea);
  expect(context.persistFields).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ type: "text", submitter_uuid: signer.uuid }),
    ]),
  );
  expect(context.setActiveFieldType).toHaveBeenCalledWith(null);
  await actions.addFieldWithoutDrawing();
  await actions.addCustomFieldWithoutDrawing(context.customFields[0]);
  await actions.addDroppedField({ kind: "new", type: "date" }, pageArea);
  await actions.addDroppedField(
    { kind: "custom", type: "text", customFieldUuid: "custom" },
    pageArea,
  );
  expect(context.persistFields).toHaveBeenCalledTimes(5);
  expect(context.setSelectedFieldUuid).toHaveBeenCalledTimes(5);
});
it("uses default proportions when a document has no preview metadata", async () => {
  const { actions, context } = setup({
    selectedDocument: { ...document, preview_images: [] },
  });
  await actions.addFieldWithoutDrawing();
  await actions.addCustomFieldWithoutDrawing(context.customFields[0]);
  expect(context.persistFields).toHaveBeenCalledTimes(2);
});
it("refuses field creation when signer, active type or selected document is absent", async () => {
  const noSigner = setup({ selectedSubmitter: null });
  await noSigner.actions.createField(pageArea);
  await noSigner.actions.addCustomFieldWithoutDrawing(
    noSigner.context.customFields[0],
  );
  await noSigner.actions.addDroppedField(
    { kind: "custom", type: "text", customFieldUuid: "custom" },
    pageArea,
  );
  expect(noSigner.context.persistFields).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith(
    "Field could not be added",
    expect.any(Object),
  );
  const inactive = setup({ activeFieldType: null });
  await inactive.actions.createField(pageArea);
  await inactive.actions.addFieldWithoutDrawing();
  expect(inactive.context.persistFields).not.toHaveBeenCalled();
  const noDocument = setup({ selectedDocument: undefined });
  await noDocument.actions.addFieldWithoutDrawing();
  await noDocument.actions.addCustomFieldWithoutDrawing(
    noDocument.context.customFields[0],
  );
  expect(noDocument.context.persistFields).not.toHaveBeenCalled();
});
it("updates one field or area without mutating adjacent fields", async () => {
  const { actions, context } = setup({
    currentFields: [
      editorField("field", { areas: [pageArea, { ...pageArea, page: 1 }] }),
      editorField("other"),
    ],
  });
  await actions.updateFieldArea("field", 0, { ...pageArea, x: 0.6 });
  expect(context.persistFields).toHaveBeenLastCalledWith([
    expect.objectContaining({
      areas: [
        { ...pageArea, x: 0.6 },
        { ...pageArea, page: 1 },
      ],
    }),
    context.currentFields[1],
  ]);
  await actions.updateField("field", { required: false });
  expect(context.persistFields).toHaveBeenLastCalledWith([
    expect.objectContaining({ required: false }),
    context.currentFields[1],
  ]);
  await actions.updateFieldAndTemplate("field", { name: "Updated" });
  expect(context.persistTemplateStructure).toHaveBeenCalledWith({
    fields: [
      expect.objectContaining({ name: "Updated" }),
      context.currentFields[1],
    ],
  });
  expect(context.currentFields[0].name).toBe("field");
});
it("copies areas only onto missing pages of the same document", async () => {
  const { actions, context } = setup();
  await actions.copyFieldToAllPages(editorField());
  expect(context.persistTemplateStructure).toHaveBeenCalledWith({
    fields: [
      expect.objectContaining({
        areas: [pageArea, { ...pageArea, page: 1 }, { ...pageArea, page: 2 }],
      }),
      context.currentFields[1],
      context.currentFields[2],
    ],
  });
  await actions.copyFieldToAllPages(editorField("empty", { areas: [] }));
  expect(toast.error).toHaveBeenCalledWith("Field has no area to copy");
  await actions.copyFieldToAllPages(
    editorField("other", {
      areas: [{ ...pageArea, attachment_uuid: "missing" }],
    }),
  );
  expect(toast.info).toHaveBeenCalledWith("This document only has one page");
  await actions.copyFieldToAllPages(
    editorField("field", {
      areas: [0, 1, 2].map((page) => ({ ...pageArea, page })),
    }),
  );
  expect(toast.info).toHaveBeenCalledWith("Field already exists on every page");
});
it("adds repeated dropped areas and guards stale fields/custom fields", async () => {
  const { actions, context } = setup();
  await actions.addDroppedField(
    { kind: "existing", fieldUuid: "field", optionUuid: "choice" },
    { ...pageArea, page: 1 },
  );
  expect(context.persistFields).toHaveBeenCalledWith([
    expect.objectContaining({
      areas: [pageArea, { ...pageArea, page: 1, option_uuid: "choice" }],
    }),
    context.currentFields[1],
    context.currentFields[2],
  ]);
  await actions.addDroppedField(
    { kind: "existing", fieldUuid: "field" },
    pageArea,
  );
  await actions.addDroppedField(
    { kind: "existing", fieldUuid: "missing" },
    pageArea,
  );
  await actions.addDroppedField(
    { kind: "custom", type: "text", customFieldUuid: "missing" },
    pageArea,
  );
  expect(context.persistFields).toHaveBeenCalledTimes(2);
  expect(toast.error).toHaveBeenCalledWith(
    "Field could not be dropped",
    expect.any(Object),
  );
  expect(toast.error).toHaveBeenCalledWith(
    "Custom field could not be dropped",
    expect.any(Object),
  );
});
it("deletes selected fields and bounds nudged areas without changing other fields", async () => {
  const { actions, context } = setup();
  await actions.deleteField("field");
  expect(context.selectField).toHaveBeenCalledWith(null);
  expect(context.persistFields).toHaveBeenLastCalledWith(
    context.currentFields.slice(1),
    { successMessage: "Field removed" },
  );
  await actions.deleteSelectedFields();
  expect(context.persistFields).toHaveBeenLastCalledWith(
    context.currentFields.slice(1),
    { successMessage: "Field removed" },
  );
  await actions.nudgeSelectedFields("field", -10, 10);
  expect(context.persistFields).toHaveBeenLastCalledWith([
    expect.objectContaining({
      areas: [expect.objectContaining({ x: 0, y: 0.96 })],
    }),
    context.currentFields[1],
    context.currentFields[2],
  ]);
  const many = setup({
    getEffectiveSelectedFieldUuids: () => ["field", "last"],
  });
  await many.actions.deleteSelectedFields();
  expect(many.context.persistFields).toHaveBeenCalledWith(
    [many.context.currentFields[1]],
    { successMessage: "Fields removed" },
  );
  const empty = setup({ getEffectiveSelectedFieldUuids: () => [] });
  await empty.actions.deleteSelectedFields();
  await empty.actions.nudgeSelectedFields("field", 1, 1);
  expect(empty.context.persistFields).not.toHaveBeenCalled();
});
it("reorders within signer roles and moves to an explicit insert index", async () => {
  const { actions, context } = setup();
  await actions.moveFieldInOrder("field", 1);
  expect(context.persistTemplateStructure).toHaveBeenLastCalledWith({
    fields: [
      context.currentFields[1],
      context.currentFields[2],
      context.currentFields[0],
    ],
    successMessage: "Field order updated",
  });
  await actions.moveFieldInOrder("last", -1);
  expect(context.persistTemplateStructure).toHaveBeenLastCalledWith({
    fields: [
      context.currentFields[2],
      context.currentFields[0],
      context.currentFields[1],
    ],
    successMessage: "Field order updated",
  });
  await actions.moveFieldToIndex("last", 0);
  expect(context.persistTemplateStructure).toHaveBeenLastCalledWith({
    fields: [
      context.currentFields[2],
      context.currentFields[0],
      context.currentFields[1],
    ],
    successMessage: "Field order updated",
  });
  await actions.moveFieldToIndex("field", 3);
  expect(context.persistTemplateStructure).toHaveBeenCalledTimes(4);
  for (const [id, index] of [
    ["missing", 0],
    ["field", -1],
    ["field", 4],
    ["field", 0],
    ["field", 1],
  ] as const)
    await actions.moveFieldToIndex(id, index);
  await actions.moveFieldInOrder("missing", 1);
  await actions.moveFieldInOrder("field", -1);
  await actions.moveFieldInOrder("last", 1);
  expect(context.persistTemplateStructure).toHaveBeenCalledTimes(4);
});
it("navigates to a field page/area and starts adding an area", () => {
  const { actions, context } = setup();
  const field = editorField();
  actions.goToFieldPage(field);
  actions.goToFieldArea(field, { ...pageArea, page: 2 });
  actions.startDrawNewArea(field);
  expect(context.setSelectedDocumentUuid).toHaveBeenCalledWith("doc");
  expect(context.setSelectedFieldUuid).toHaveBeenCalledWith("field");
  expect(context.setSelectedFieldUuids).toHaveBeenCalledWith(["field"]);
  expect(toast.info).toHaveBeenCalledWith("Opened page 3");
  actions.goToFieldPage(editorField("empty", { areas: [] }));
  expect(toast.error).toHaveBeenCalledWith("Field has no page area yet");
});
