import { expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createTemplateEditorSubmitterActions } from "../../../apps/frontend/app/templates/[id]/edit/_hooks/template-editor-submitter-actions";
import { createTemplateEditorFieldClipboardActions } from "../../../apps/frontend/app/templates/[id]/edit/_hooks/template-editor-field-clipboard-actions";
import { FIELD_CLIPBOARD_STORAGE_KEY } from "../../../apps/frontend/app/templates/[id]/edit/_lib/template-editor-model";
import {
  document,
  editorField,
  pageArea,
  signer,
  secondSigner,
  templateFixture,
} from "./fixtures";
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
function setupRoles(
  overrides: Partial<
    Parameters<typeof createTemplateEditorSubmitterActions>[0]
  > = {},
) {
  const context = {
    currentFields: [
      editorField(),
      editorField("other", { submitter_uuid: secondSigner.uuid }),
    ],
    currentSubmitters: [signer, secondSigner],
    persistTemplateStructure: vi.fn().mockResolvedValue(undefined),
    selectedField: editorField(),
    selectedSubmitterUuid: signer.uuid as string | null,
    setSelectedFieldUuid: vi.fn(),
    setSelectedSubmitterUuid: vi.fn(),
    ...overrides,
  };
  return { context, actions: createTemplateEditorSubmitterActions(context) };
}
it("adds signer roles and optionally assigns the selected field", async () => {
  const { context, actions } = setupRoles();
  await actions.addSubmitter();
  expect(context.persistTemplateStructure).toHaveBeenLastCalledWith({
    fields: undefined,
    submitters: [
      signer,
      secondSigner,
      expect.objectContaining({ name: "Third Party" }),
    ],
    successMessage: "Role added",
  });
  await actions.addSubmitter("field");
  expect(context.persistTemplateStructure).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fields: [
        expect.objectContaining({ submitter_uuid: expect.any(String) }),
        context.currentFields[1],
      ],
      successMessage: "Role added and assigned",
    }),
  );
  expect(context.setSelectedFieldUuid).toHaveBeenCalledWith("field");
});
it("renames, reassigns and removes signer roles while retaining at least one role", async () => {
  const { context, actions } = setupRoles();
  await actions.renameSubmitter(signer.uuid, "  Updated  ");
  expect(context.persistTemplateStructure).toHaveBeenLastCalledWith({
    submitters: [{ ...signer, name: "Updated" }, secondSigner],
  });
  await actions.renameSubmitter(signer.uuid, "  ");
  expect(context.persistTemplateStructure).toHaveBeenLastCalledWith({
    submitters: [{ ...signer, name: "Signer" }, secondSigner],
  });
  await actions.removeSubmitter(signer.uuid);
  expect(context.persistTemplateStructure).toHaveBeenLastCalledWith({
    fields: [
      expect.objectContaining({ submitter_uuid: secondSigner.uuid }),
      context.currentFields[1],
    ],
    submitters: [secondSigner],
    successMessage: "Role removed and fields reassigned",
  });
  expect(context.setSelectedSubmitterUuid).toHaveBeenCalledWith(
    secondSigner.uuid,
  );
  await actions.removeSubmitter(signer.uuid, "remove_fields");
  expect(context.persistTemplateStructure).toHaveBeenLastCalledWith({
    fields: [context.currentFields[1]],
    submitters: [secondSigner],
    successMessage: "Role and assigned fields removed",
  });
  expect(context.setSelectedFieldUuid).toHaveBeenCalledWith(null);
  const keepSelection = setupRoles({
    selectedField: null,
    selectedSubmitterUuid: secondSigner.uuid,
  });
  await keepSelection.actions.removeSubmitter(signer.uuid, "remove_fields");
  expect(keepSelection.context.setSelectedSubmitterUuid).not.toHaveBeenCalled();
  const only = setupRoles({ currentSubmitters: [signer] });
  await only.actions.removeSubmitter(signer.uuid);
  expect(only.context.persistTemplateStructure).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("At least one role is required");
});
type ClipboardContext = Parameters<
  typeof createTemplateEditorFieldClipboardActions
>[0];
function setupClipboard(overrides: Partial<ClipboardContext> = {}) {
  const context: ClipboardContext = {
    currentFields: [
      editorField(),
      editorField("second", { areas: [{ ...pageArea, x: 0.3, y: 0.2 }] }),
    ],
    currentTemplate: templateFixture(),
    getEffectiveSelectedFieldUuids: () => ["field"],
    persistFields: vi.fn().mockResolvedValue(undefined),
    selectedDocument: document,
    selectedField: null,
    selectedSubmitter: signer,
    setSelectedFieldUuid: vi.fn(),
    setSelectedFieldUuids: vi.fn(),
    ...overrides,
  };
  return {
    context,
    actions: createTemplateEditorFieldClipboardActions(context),
  };
}
function clipboard(value: unknown) {
  localStorage.setItem(FIELD_CLIPBOARD_STORAGE_KEY, JSON.stringify(value));
}
it("copies relative positions and pastes independent identifiers onto the active page", async () => {
  const { context, actions } = setupClipboard({
    getEffectiveSelectedFieldUuids: () => ["field", "second"],
    selectedField: editorField(),
  });
  actions.copySelectedFields();
  const value = JSON.parse(
    localStorage.getItem(FIELD_CLIPBOARD_STORAGE_KEY)!,
  ) as {
    templateId: string;
    fields: Array<{ areas: Array<{ relativeX: number; relativeY: number }> }>;
  };
  expect(value.templateId).toBe("template");
  expect(value.fields[0].areas[0]).toMatchObject({
    relativeX: 0,
    relativeY: 0,
  });
  expect(value.fields[1].areas[0].relativeX).toBeCloseTo(0.2);
  await actions.pasteCopiedFields();
  const fields = vi.mocked(context.persistFields).mock.calls[0][0];
  expect(fields).toHaveLength(4);
  expect(fields[2].uuid).not.toBe("field");
  expect(fields[3].uuid).not.toBe("second");
  expect(fields[3].areas[0].x - fields[2].areas[0].x).toBeCloseTo(0.2);
  expect(fields[3].areas[0].y - fields[2].areas[0].y).toBeCloseTo(0.1);
  expect(context.setSelectedFieldUuids).toHaveBeenCalledWith([
    fields[2].uuid,
    fields[3].uuid,
  ]);
});
it("regenerates option ids and remaps choice areas while normalizing imported clipboard content", async () => {
  const { actions, context } = setupClipboard({
    currentFields: [],
    selectedField: null,
  });
  clipboard({
    fields: [
      null,
      {
        type: "radio",
        name: "",
        options: [null, { uuid: "old", value: "Yes" }, { value: "No" }],
        areas: [
          null,
          { ...pageArea, option_uuid: "old" },
          { ...pageArea, option_uuid: "unmapped", relativeX: 0.2 },
        ],
      },
      {
        type: "text",
        name: "Preserved",
        submitter_uuid: "original",
        options: "invalid",
      },
    ],
  });
  await actions.pasteCopiedFields();
  const fields = vi.mocked(context.persistFields).mock.calls[0][0];
  expect(fields).toHaveLength(2);
  expect(fields[0].name).toContain("Radio Field");
  expect(fields[0].submitter_uuid).toBe(signer.uuid);
  const options = fields[0].options as Array<{ uuid: string }>;
  expect(options).toHaveLength(2);
  expect(options[0].uuid).not.toBe("old");
  expect(fields[0].areas[0].option_uuid).toBe(options[0].uuid);
  expect(fields[0].areas[1].option_uuid).toBe("unmapped");
  expect(fields[1]).toMatchObject({
    name: "Preserved",
    submitter_uuid: "original",
    areas: [],
    options: "invalid",
  });
});
it("guards empty, malformed, stale and unplaceable clipboard data", async () => {
  const { actions, context } = setupClipboard({
    getEffectiveSelectedFieldUuids: () => [],
  });
  actions.copySelectedFields();
  expect(localStorage.getItem(FIELD_CLIPBOARD_STORAGE_KEY)).toBeNull();
  await actions.pasteCopiedFields();
  expect(toast.info).toHaveBeenCalledWith("No copied fields");
  for (const value of [null, {}, { fields: "bad" }]) {
    clipboard(value);
    await actions.pasteCopiedFields();
    expect(localStorage.getItem(FIELD_CLIPBOARD_STORAGE_KEY)).toBeNull();
  }
  clipboard({ fields: [], timestamp: Date.now() - 3_600_001 });
  await actions.pasteCopiedFields();
  expect(toast.info).toHaveBeenCalledWith("Copied fields expired");
  clipboard({ fields: [null] });
  await actions.pasteCopiedFields();
  expect(context.persistFields).not.toHaveBeenCalled();
  const noPage = setupClipboard({
    currentFields: [],
    selectedDocument: undefined,
    selectedSubmitter: null,
  });
  clipboard({ fields: [editorField()] });
  await noPage.actions.pasteCopiedFields();
  expect(toast.error).toHaveBeenCalledWith(
    "No document page available for paste",
  );
});
it("copies a single field and pastes against the last existing area", async () => {
  const { actions, context } = setupClipboard();
  actions.copySelectedFields("field");
  expect(toast.success).toHaveBeenCalledWith("Field copied");
  await actions.pasteCopiedFields();
  expect(context.persistFields).toHaveBeenCalledWith(expect.any(Array), {
    successMessage: "Field pasted",
  });
});
