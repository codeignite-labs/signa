import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import * as api from "../../../apps/frontend/lib/api/templates";
import { createTemplateEditorTemplateActions } from "../../../apps/frontend/app/templates/[id]/edit/_hooks/template-editor-template-actions";
import { editorField, pageArea, templateFixture } from "./fixtures";
vi.mock("../../../apps/frontend/lib/api/templates", () => ({
  updateTemplate: vi.fn(),
  updateTemplatePreferences: vi.fn(),
  updateTemplateTestingSharing: vi.fn(),
  getTemplateDocumentDownloads: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
type Context = Parameters<typeof createTemplateEditorTemplateActions>[0];
function setup(overrides: Partial<Context> = {}) {
  let template: api.TemplateResponse | null =
    overrides.currentTemplate ??
    templateFixture({ preferences: { existing: true } });
  let selected: string | null = "field";
  const context: Context = {
    currentFields: [
      editorField(),
      editorField("retained", {
        areas: [{ ...pageArea, attachment_uuid: "other" }],
      }),
    ],
    currentTemplate: template,
    pendingFieldAttachmentUuids: ["doc"],
    setIsDownloadingTemplateDocuments: vi.fn(),
    setIsPreferencesOpen: vi.fn(),
    setIsSavingFields: vi.fn(),
    setIsSavingPreferences: vi.fn(),
    setIsUpdatingSharedLink: vi.fn(),
    setSelectedFieldUuid: vi.fn((value) => {
      selected = typeof value === "function" ? value(selected) : value;
    }),
    setTemplate: vi.fn((value) => {
      template = typeof value === "function" ? value(template) : value;
    }),
    ...overrides,
  };
  return {
    actions: createTemplateEditorTemplateActions(context),
    context,
    getTemplate: () => template,
    getSelection: () => selected,
    navigateAway: () => {
      template = templateFixture({ id: "other" });
    },
  };
}
beforeEach(() => {
  vi.mocked(api.updateTemplate).mockResolvedValue({
    id: "template",
    updated_at: "",
  });
  vi.mocked(api.updateTemplatePreferences).mockResolvedValue({
    id: "template",
    updated_at: "",
  });
  vi.mocked(api.updateTemplateTestingSharing).mockResolvedValue(
    templateFixture(),
  );
  vi.mocked(api.getTemplateDocumentDownloads).mockResolvedValue([]);
});
it("saves drafts and always resets the pending flag", async () => {
  const { actions, context } = setup();
  await actions.saveTemplateDraft();
  expect(api.updateTemplate).toHaveBeenCalledWith("template", {
    fields: [],
    schema: [{ attachment_uuid: "doc" }],
    submitters: context.currentTemplate.submitters,
  });
  expect(toast.success).toHaveBeenCalledWith("Template saved");
  expect(context.setIsSavingFields).toHaveBeenLastCalledWith(false);
});
it.each([new Error("offline"), "unknown"])(
  "reports draft failures: %s",
  async (failure) => {
    vi.mocked(api.updateTemplate).mockRejectedValue(failure);
    const { actions, context } = setup();
    await actions.saveTemplateDraft();
    expect(toast.error).toHaveBeenCalledWith("Save failed", {
      description:
        failure instanceof Error
          ? failure.message
          : "Template could not be saved.",
    });
    expect(context.setIsSavingFields).toHaveBeenLastCalledWith(false);
  },
);
it("merges preferences optimistically and closes the dialog on success", async () => {
  const test = setup();
  await test.actions.saveTemplatePreferences({ new: false });
  expect(test.getTemplate()?.preferences).toEqual({
    existing: true,
    new: false,
  });
  expect(api.updateTemplatePreferences).toHaveBeenCalledWith("template", {
    new: false,
  });
  expect(test.context.setIsPreferencesOpen).toHaveBeenCalledWith(false);
  expect(test.context.setIsSavingPreferences).toHaveBeenLastCalledWith(false);
});
it.each([new Error("offline"), null])(
  "rolls preferences back when save fails",
  async (failure) => {
    vi.mocked(api.updateTemplatePreferences).mockRejectedValue(failure);
    const test = setup();
    await test.actions.saveTemplatePreferences({ changed: true });
    expect(test.getTemplate()?.preferences).toEqual({ existing: true });
    expect(toast.error).toHaveBeenCalledWith(
      "Preferences update failed",
      expect.any(Object),
    );
  },
);
it.each([true, false])(
  "saves public and test sharing state: %s",
  async (enabled) => {
    const test = setup();
    await test.actions.updateTemplateSharedLink(enabled);
    expect(api.updateTemplate).toHaveBeenCalledWith("template", {
      shared_link: enabled,
    });
    expect(test.getTemplate()?.shared_link).toBe(enabled);
    vi.mocked(api.updateTemplateTestingSharing).mockResolvedValue(
      templateFixture({ shared_with_test_mode: enabled }),
    );
    await test.actions.updateTemplateTestingShare(enabled);
    expect(test.getTemplate()?.shared_with_test_mode).toBe(enabled);
    expect(test.context.setIsUpdatingSharedLink).toHaveBeenLastCalledWith(
      false,
    );
  },
);
it.each([new Error("offline"), null])(
  "rolls both sharing settings back on failure",
  async (failure) => {
    vi.mocked(api.updateTemplate).mockRejectedValue(failure);
    vi.mocked(api.updateTemplateTestingSharing).mockRejectedValue(failure);
    const test = setup();
    await test.actions.updateTemplateSharedLink(true);
    await test.actions.updateTemplateTestingShare(true);
    expect(test.getTemplate()).toMatchObject({
      shared_link: false,
      shared_with_test_mode: false,
    });
    expect(toast.error).toHaveBeenCalledWith(
      "Shared link update failed",
      expect.any(Object),
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Test mode sharing update failed",
      expect.any(Object),
    );
  },
);
it("does not overwrite another template while preference/share requests resolve", async () => {
  const test = setup();
  test.navigateAway();
  await test.actions.saveTemplatePreferences({ changed: true });
  await test.actions.updateTemplateSharedLink(true);
  vi.mocked(api.updateTemplatePreferences).mockRejectedValue(null);
  vi.mocked(api.updateTemplate).mockRejectedValue(null);
  vi.mocked(api.updateTemplateTestingSharing).mockRejectedValue(null);
  await test.actions.saveTemplatePreferences({ changed: true });
  await test.actions.updateTemplateSharedLink(true);
  await test.actions.updateTemplateTestingShare(true);
  expect(test.getTemplate()?.id).toBe("other");
});
it("requests document downloads and releases pending state for failures", async () => {
  const test = setup();
  await test.actions.downloadTemplateDocuments();
  expect(api.getTemplateDocumentDownloads).toHaveBeenCalledWith("template");
  expect(toast.success).toHaveBeenCalledWith("Download started");
  for (const failure of [new Error("offline"), null]) {
    vi.mocked(api.getTemplateDocumentDownloads).mockRejectedValue(failure);
    await test.actions.downloadTemplateDocuments();
    expect(toast.error).toHaveBeenCalledWith(
      "Download failed",
      expect.any(Object),
    );
    expect(
      test.context.setIsDownloadingTemplateDocuments,
    ).toHaveBeenLastCalledWith(false);
  }
});
it("trims changed names and ignores blank or unchanged names", async () => {
  const test = setup();
  await test.actions.renameTemplate("  ");
  await test.actions.renameTemplate("Agreement");
  expect(api.updateTemplate).not.toHaveBeenCalled();
  await test.actions.renameTemplate("  Updated  ");
  expect(test.getTemplate()?.name).toBe("Updated");
  expect(api.updateTemplate).toHaveBeenCalledWith("template", {
    name: "Updated",
  });
});
it.each([new Error("offline"), null])(
  "restores the template name and rethrows rename failures",
  async (failure) => {
    vi.mocked(api.updateTemplate).mockRejectedValue(failure);
    const test = setup();
    await expect(test.actions.renameTemplate("Updated")).rejects.toBe(failure);
    expect(test.getTemplate()?.name).toBe("Agreement");
    expect(toast.error).toHaveBeenCalledWith(
      "Template rename failed",
      expect.any(Object),
    );
  },
);
it.each(["keep", "remove"] as const)(
  "resolves imported fields with action %s",
  async (action) => {
    const test = setup({
      currentTemplate: templateFixture({
        schema: [
          { attachment_uuid: "doc", pending_fields: true },
          { attachment_uuid: "other", pending_fields: true },
          {},
        ],
      }),
    });
    await test.actions.resolvePendingImportedFields(action);
    expect(test.getTemplate()?.schema).toEqual([
      { attachment_uuid: "doc" },
      { attachment_uuid: "other", pending_fields: true },
      {},
    ]);
    expect(test.getTemplate()?.fields).toHaveLength(
      action === "remove" ? 1 : 2,
    );
    expect(test.getSelection()).toBe(action === "remove" ? null : "field");
    expect(test.context.setIsSavingFields).toHaveBeenLastCalledWith(false);
  },
);
it("retains valid selection after removing imports and ignores an empty pending set", async () => {
  const test = setup({ pendingFieldAttachmentUuids: ["other"] });
  await test.actions.resolvePendingImportedFields("remove");
  expect(test.getSelection()).toBe("field");
  const empty = setup({ pendingFieldAttachmentUuids: [] });
  vi.mocked(api.updateTemplate).mockClear();
  await empty.actions.resolvePendingImportedFields("remove");
  expect(api.updateTemplate).not.toHaveBeenCalled();
});
it.each([new Error("offline"), null])(
  "rolls back imported-field changes on failure",
  async (failure) => {
    vi.mocked(api.updateTemplate).mockRejectedValue(failure);
    const test = setup();
    await test.actions.resolvePendingImportedFields("remove");
    expect(test.getTemplate()).toBe(test.context.currentTemplate);
    expect(toast.error).toHaveBeenCalledWith(
      "Imported fields update failed",
      expect.any(Object),
    );
  },
);
