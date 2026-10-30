import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import * as api from "../../../apps/frontend/lib/api/templates";
import { createTemplateEditorDocumentActions } from "../../../apps/frontend/app/templates/[id]/edit/_hooks/template-editor-document-actions";
import { document, editorField, pageArea, templateFixture } from "./fixtures";
vi.mock("../../../apps/frontend/lib/api/templates", () => ({
  updateTemplate: vi.fn(),
  getTemplate: vi.fn(),
  addTemplateDocument: vi.fn(),
  addBlankTemplatePage: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), loading: vi.fn() },
}));
const otherDocument = {
  ...document,
  id: "other",
  uuid: "other",
  filename: "annex.pdf",
};
const file = new File(["pdf"], "replacement.pdf");
function setup(overrides: Partial<api.TemplateResponse> = {}) {
  const currentTemplate = templateFixture({
    documents: [document, otherDocument],
    schema: [
      { attachment_uuid: "doc", name: "Agreement" },
      { attachment_uuid: "other" },
    ],
    fields: [editorField()],
    ...overrides,
  });
  let template: api.TemplateResponse | null = currentTemplate;
  const context = {
    currentTemplate,
    setIsUploadingDocument: vi.fn(),
    setSelectedDocumentUuid: vi.fn(),
    setTemplate: vi.fn(
      (
        value:
          | api.TemplateResponse
          | ((
              previous: api.TemplateResponse | null,
            ) => api.TemplateResponse | null),
      ) => {
        template = typeof value === "function" ? value(template) : value;
      },
    ),
  };
  return {
    actions: createTemplateEditorDocumentActions(context),
    context,
    getTemplate: () => template,
    navigateAway: () => {
      template = templateFixture({ id: "another" });
    },
  };
}
beforeEach(() => {
  vi.mocked(api.updateTemplate).mockResolvedValue({
    id: "template",
    updated_at: "",
  });
  vi.mocked(api.getTemplate).mockResolvedValue(
    templateFixture({ documents: [document, otherDocument] }),
  );
  const upload = {
    schema: [{ attachment_uuid: "other" }],
    documents: [otherDocument],
    fields: [],
    submitters: [],
  };
  vi.mocked(api.addTemplateDocument).mockResolvedValue(upload);
  vi.mocked(api.addBlankTemplatePage).mockResolvedValue(upload);
});
it("renames an existing schema entry or appends an unlisted document", async () => {
  const test = setup();
  await test.actions.renameDocument(document, "Updated");
  expect(test.getTemplate()?.schema).toEqual([
    { attachment_uuid: "doc", name: "Updated" },
    { attachment_uuid: "other" },
  ]);
  const unlisted = { ...document, uuid: "unlisted" };
  await test.actions.renameDocument(unlisted, "Unlisted");
  expect(api.updateTemplate).toHaveBeenLastCalledWith("template", {
    schema: [
      ...test.context.currentTemplate.schema,
      { attachment_uuid: "unlisted", name: "Unlisted" },
    ],
  });
  test.navigateAway();
  await test.actions.renameDocument(document, "Late update");
  expect(test.getTemplate()?.id).toBe("another");
});
it.each(["file", "blank"])(
  "uploads a %s document and selects the new attachment",
  async (kind) => {
    const test = setup({ documents: [document] });
    await (kind === "file"
      ? test.actions.addDocument(file)
      : test.actions.addBlankPage());
    expect(
      test.context.setIsUploadingDocument.mock.calls.map(([value]) => value),
    ).toEqual([true, false]);
    expect(test.context.setSelectedDocumentUuid).toHaveBeenCalledWith("other");
    expect(test.getTemplate()?.documents).toHaveLength(2);
    if (kind === "blank")
      expect(api.addBlankTemplatePage).toHaveBeenCalledWith("template", {
        name: "Blank Page 2",
        size: "letter",
      });
  },
);
it.each(["file", "blank"])(
  "preserves ready mutation previews when a %s refresh has fewer preview pages",
  async (kind) => {
    const test = setup({ documents: [document] });
    vi.mocked(api.getTemplate).mockResolvedValue(
      templateFixture({
        documents: [{ ...otherDocument, preview_images: [] }],
      }),
    );
    await (kind === "file"
      ? test.actions.addDocument(file)
      : test.actions.addBlankPage());
    expect(test.getTemplate()?.documents[0].preview_images).toHaveLength(3);
  },
);
it.each(["file", "blank"])(
  "includes newly uploaded %s documents omitted by a delayed refresh",
  async (kind) => {
    const test = setup({ documents: [document] });
    vi.mocked(api.getTemplate).mockResolvedValue(templateFixture());
    await (kind === "file"
      ? test.actions.addDocument(file)
      : test.actions.addBlankPage());
    expect(test.getTemplate()?.documents.map((doc) => doc.uuid)).toEqual([
      "doc",
      "other",
    ]);
  },
);
it.each(["file", "blank"])(
  "selects the last %s document or clears selection when no new document is returned",
  async (kind) => {
    for (const documents of [[document], []]) {
      const test = setup({ documents: [document] });
      vi.mocked(api.getTemplate).mockResolvedValue(
        templateFixture({ documents }),
      );
      vi.mocked(api.addTemplateDocument).mockResolvedValue({
        schema: [],
        documents: [],
        fields: [],
        submitters: [],
      });
      vi.mocked(api.addBlankTemplatePage).mockResolvedValue({
        schema: [],
        documents: [],
        fields: [],
        submitters: [],
      });
      await (kind === "file"
        ? test.actions.addDocument(file)
        : test.actions.addBlankPage());
      expect(test.context.setSelectedDocumentUuid).toHaveBeenCalledWith(
        documents[0]?.uuid ?? null,
      );
    }
  },
);
it.each([new Error("offline"), null])(
  "reports file and blank upload failures and resets pending state",
  async (failure) => {
    vi.mocked(api.addTemplateDocument).mockRejectedValue(failure);
    vi.mocked(api.addBlankTemplatePage).mockRejectedValue(failure);
    const test = setup();
    await test.actions.addDocument(file);
    await test.actions.addBlankPage();
    expect(toast.error).toHaveBeenCalledWith(
      "Document upload failed",
      expect.any(Object),
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Blank page could not be added",
      expect.any(Object),
    );
    expect(test.context.setIsUploadingDocument).toHaveBeenLastCalledWith(false);
  },
);
it("replaces a document, rewrites its fields and keeps the original schema title", async () => {
  const test = setup();
  await test.actions.replaceDocument(document, file);
  expect(api.updateTemplate).toHaveBeenCalledWith("template", {
    schema: [
      { attachment_uuid: "other", name: "Agreement" },
      { attachment_uuid: "other" },
    ],
    fields: [
      expect.objectContaining({
        areas: [{ ...pageArea, attachment_uuid: "other" }],
      }),
    ],
  });
  expect(test.context.setSelectedDocumentUuid).toHaveBeenCalledWith("other");
  expect(toast.success).toHaveBeenCalledWith(
    "Document replaced",
    expect.any(Object),
  );
});
it("guards a missing schema entry or missing replacement document", async () => {
  const noSchema = setup({ schema: [] });
  await noSchema.actions.replaceDocument(document, file);
  expect(api.addTemplateDocument).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith(
    "Document could not be replaced",
    expect.any(Object),
  );
  const test = setup();
  for (const schema of [[], [{ attachment_uuid: "missing" }]]) {
    vi.mocked(api.addTemplateDocument).mockResolvedValue({
      schema,
      documents: [],
      fields: [],
      submitters: [],
    });
    await test.actions.replaceDocument(document, file);
    expect(toast.error).toHaveBeenCalledWith(
      "Document replace failed",
      expect.objectContaining({
        description: "Replacement document was not returned by the API.",
      }),
    );
  }
  vi.mocked(api.addTemplateDocument).mockRejectedValue(null);
  await test.actions.replaceDocument(document, file);
  expect(test.context.setIsUploadingDocument).toHaveBeenLastCalledWith(false);
});
it("removes document fields and schema entries while requiring at least one document", async () => {
  const test = setup();
  await test.actions.removeDocument(document);
  expect(api.updateTemplate).toHaveBeenCalledWith("template", {
    fields: [],
    schema: [{ attachment_uuid: "other" }],
  });
  expect(test.context.setSelectedDocumentUuid).toHaveBeenCalledWith("doc");
  vi.mocked(api.getTemplate).mockResolvedValue(
    templateFixture({ documents: [] }),
  );
  await test.actions.removeDocument(document);
  expect(test.context.setSelectedDocumentUuid).toHaveBeenLastCalledWith(null);
  vi.mocked(api.updateTemplate).mockClear();
  await setup({ documents: [document] }).actions.removeDocument(document);
  expect(api.updateTemplate).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("At least one document is required");
});
it("reorders neighboring documents and ignores missing/out-of-bounds movements", async () => {
  const test = setup();
  await test.actions.moveDocument(document, 1);
  expect(api.updateTemplate).toHaveBeenCalledWith("template", {
    schema: [
      { attachment_uuid: "other" },
      { attachment_uuid: "doc", name: "Agreement" },
    ],
  });
  await test.actions.moveDocument(otherDocument, -1);
  await test.actions.moveDocument(document, -1);
  await test.actions.moveDocument(otherDocument, 1);
  await test.actions.moveDocument({ ...document, uuid: "missing" }, 1);
  expect(api.updateTemplate).toHaveBeenCalledTimes(2);
});
it.each([new Error("offline"), null])(
  "reports document removal/reorder/condition failures without local mutation",
  async (failure) => {
    vi.mocked(api.updateTemplate).mockRejectedValue(failure);
    const test = setup();
    await test.actions.removeDocument(document);
    await test.actions.moveDocument(document, 1);
    await test.actions.updateDocumentConditions(document, []);
    expect(test.getTemplate()).toBe(test.context.currentTemplate);
    for (const title of [
      "Document remove failed",
      "Document reorder failed",
      "Document condition update failed",
    ])
      expect(toast.error).toHaveBeenCalledWith(title, expect.any(Object));
  },
);
it("sets or removes document conditions and avoids updating another open template", async () => {
  const test = setup();
  const conditions = [{ field_uuid: "field", value: "Yes" }];
  await test.actions.updateDocumentConditions(document, conditions);
  expect(test.getTemplate()?.schema[0].conditions).toEqual(conditions);
  await test.actions.updateDocumentConditions(document, []);
  expect(test.getTemplate()?.schema[0]).not.toHaveProperty("conditions");
  test.navigateAway();
  await test.actions.updateDocumentConditions(document, conditions);
  expect(test.getTemplate()?.id).toBe("another");
});
it("sorts fields by template document order, page and visual reading position", async () => {
  const fields = [
    editorField("bottom", { areas: [{ ...pageArea, y: 0.8 }] }),
    editorField("next-document", {
      areas: [{ ...pageArea, attachment_uuid: "other" }],
    }),
    editorField("right", { areas: [{ ...pageArea, x: 0.6 }] }),
    editorField("left"),
    editorField("page2", { areas: [{ ...pageArea, page: 1 }] }),
  ];
  const test = setup({ fields });
  await test.actions.reorderDocumentFields(document);
  const saved = vi.mocked(api.updateTemplate).mock.calls[0][1].fields as Array<{
    uuid: string;
  }>;
  expect(saved.map((field) => field.uuid)).toEqual([
    "left",
    "right",
    "bottom",
    "page2",
    "next-document",
  ]);
  expect(test.getTemplate()?.fields).toEqual(saved);
});
it("retains fields outside the target document and supports a last document preceding unplaced fields", async () => {
  const inside = editorField("inside", {
    areas: [{ ...pageArea, attachment_uuid: "other" }],
  });
  const empty = editorField("unplaced", { areas: [] });
  for (const fields of [
    [inside, empty],
    [empty, inside],
    [editorField(), inside],
  ]) {
    const test = setup({ fields });
    await test.actions.reorderDocumentFields(otherDocument);
    expect(
      (test.getTemplate()?.fields as Array<{ uuid: string }>).map(
        (field) => field.uuid,
      ),
    ).toEqual(fields.map((field) => field.uuid));
  }
});
it("refuses to drop malformed fields when normalizing a field reorder", async () => {
  const test = setup({ fields: [null] });
  await test.actions.reorderDocumentFields(document);
  expect(api.updateTemplate).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("Fields could not be reordered");
});
it.each([new Error("offline"), null])(
  "reports field reorder errors and preserves original state",
  async (failure) => {
    vi.mocked(api.updateTemplate).mockRejectedValue(failure);
    const test = setup();
    await test.actions.reorderDocumentFields(document);
    expect(test.getTemplate()).toBe(test.context.currentTemplate);
    expect(toast.error).toHaveBeenCalledWith(
      "Field reorder failed",
      expect.any(Object),
    );
  },
);
it("preserves a newly opened template when an earlier field reorder finishes", async () => {
  const test = setup();
  test.navigateAway();
  await test.actions.reorderDocumentFields(document);
  expect(test.getTemplate()?.id).toBe("another");
});
it("uses the earliest template document for a field placed on several documents", async () => {
  const shared = editorField("shared", {
    areas: [{ ...pageArea, attachment_uuid: "other" }, pageArea],
  });
  const test = setup({
    fields: [shared, editorField("top", { areas: [{ ...pageArea, y: 0.01 }] })],
  });
  await test.actions.reorderDocumentFields(document);
  expect(
    (test.getTemplate()?.fields as Array<{ uuid: string }>).map(
      (field) => field.uuid,
    ),
  ).toEqual(["top", "shared"]);
});
it.each([false, true])(
  "orders vertically nested fields by horizontal reading position (reverse input: %s)",
  async (reverse) => {
    const narrow = editorField("narrow", {
      areas: [{ ...pageArea, x: 0.7, y: 0.2, h: 0.1 }],
    });
    const tall = editorField("tall", {
      areas: [{ ...pageArea, x: 0.1, y: 0.1, h: 0.5 }],
    });
    const test = setup({ fields: reverse ? [tall, narrow] : [narrow, tall] });
    await test.actions.reorderDocumentFields(document);
    expect(
      (test.getTemplate()?.fields as Array<{ uuid: string }>).map(
        (field) => field.uuid,
      ),
    ).toEqual(["tall", "narrow"]);
  },
);
