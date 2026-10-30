import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import * as api from "../../../apps/frontend/lib/api/templates";
import { ApiError } from "../../../apps/frontend/lib/api/http";
import { pickGoogleDriveDocuments } from "../../../apps/frontend/lib/google-drive/picker";
import { useTemplateEditorController } from "../../../apps/frontend/app/templates/[id]/edit/_hooks/use-template-editor-controller";
import { editorField, signer, templateFixture } from "./fixtures";
const { push, router } = vi.hoisted(() => {
  const push = vi.fn();
  return { push, router: { push } };
});
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "template" }),
  useRouter: () => router,
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));
vi.mock("../../../apps/frontend/lib/api/templates", async (original) => ({
  ...(await original<typeof api>()),
  getTemplate: vi.fn(),
  getAccountCustomFields: vi.fn(),
  updateTemplate: vi.fn(),
  saveAccountCustomFields: vi.fn(),
  addTemplateGoogleDriveDocuments: vi.fn(),
}));
vi.mock("../../../apps/frontend/lib/google-drive/picker", () => ({
  pickGoogleDriveDocuments: vi.fn(),
}));
type Loaded = Extract<
  ReturnType<typeof useTemplateEditorController>,
  { isLoaded: true }
>;
function loaded(value: ReturnType<typeof useTemplateEditorController>): Loaded {
  if (!value.isLoaded) throw new Error("Editor not loaded");
  return value;
}
async function renderEditor() {
  const hook = renderHook(() => useTemplateEditorController());
  await waitFor(() => expect(hook.result.current.isLoaded).toBe(true));
  return hook;
}
beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(api.getTemplate).mockResolvedValue(
    templateFixture({ fields: [editorField("a"), editorField("b")] }),
  );
  vi.mocked(api.getAccountCustomFields).mockResolvedValue({ value: [] });
  vi.mocked(api.updateTemplate).mockResolvedValue({
    id: "template",
    updated_at: "",
  });
  vi.mocked(api.saveAccountCustomFields).mockImplementation(
    async (fields) => fields,
  );
  vi.mocked(api.addTemplateGoogleDriveDocuments).mockResolvedValue({
    schema: [],
    documents: [],
    fields: [],
    submitters: [],
  });
  vi.mocked(pickGoogleDriveDocuments).mockResolvedValue({
    accessToken: "drive-token",
    files: [],
  });
});
it("loads editor state, signer defaults and active document, then supports selection toggles", async () => {
  const hook = await renderEditor();
  expect(loaded(hook.result.current)).toMatchObject({
    currentSubmitters: [signer],
    selectedDocument: { uuid: "doc" },
    canUndo: false,
    canRedo: false,
  });
  act(() => loaded(hook.result.current).selectField("a"));
  expect(loaded(hook.result.current).selectedFieldUuids).toEqual(["a"]);
  act(() => loaded(hook.result.current).selectField("b", true));
  expect(loaded(hook.result.current).selectedFieldUuids).toEqual(["a", "b"]);
  act(() => loaded(hook.result.current).selectField("a", true));
  expect(loaded(hook.result.current).selectedFieldUuids).toEqual(["b"]);
  act(() => loaded(hook.result.current).selectField(null));
  expect(loaded(hook.result.current).selectedFieldUuids).toEqual([]);
  act(() => loaded(hook.result.current).goBackToTemplates());
  expect(push).toHaveBeenCalledWith("/templates");
});
it("uses a safe custom-field fallback and handles templates without documents", async () => {
  vi.mocked(api.getAccountCustomFields).mockRejectedValue(
    new Error("optional setting unavailable"),
  );
  vi.mocked(api.getTemplate).mockResolvedValue(
    templateFixture({ documents: [], submitters: [] }),
  );
  const hook = await renderEditor();
  expect(loaded(hook.result.current).customFields).toEqual([]);
  expect(loaded(hook.result.current).selectedDocument).toBeUndefined();
});
it.each([new Error("offline"), null])(
  "renders a recoverable editor load error",
  async (failure) => {
    vi.mocked(api.getTemplate).mockRejectedValue(failure);
    const hook = renderHook(() => useTemplateEditorController());
    await waitFor(() =>
      expect(hook.result.current.error).toBe(
        failure instanceof Error ? "offline" : "Template could not be loaded.",
      ),
    );
    expect(hook.result.current.isLoaded).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      "Template could not be loaded",
      expect.any(Object),
    );
  },
);
it("redirects expired authentication rather than showing an editor failure", async () => {
  vi.mocked(api.getTemplate).mockRejectedValue(new ApiError("expired", 401));
  renderHook(() => useTemplateEditorController());
  await waitFor(() => expect(push).toHaveBeenCalledWith("/auth/login"));
});
it("persists field edits with undo/redo and restores exact schema/signer history", async () => {
  const hook = await renderEditor();
  await act(() => loaded(hook.result.current).undoTemplateChange());
  await act(() => loaded(hook.result.current).redoTemplateChange());
  expect(api.updateTemplate).not.toHaveBeenCalled();
  act(() => loaded(hook.result.current).selectField("a"));
  await act(() =>
    loaded(hook.result.current).updateField("a", { name: "Updated" }),
  );
  expect(loaded(hook.result.current).currentFields[0].name).toBe("Updated");
  expect(loaded(hook.result.current).canUndo).toBe(true);
  await act(() => loaded(hook.result.current).undoTemplateChange());
  expect(loaded(hook.result.current).currentFields[0].name).toBe("a");
  expect(loaded(hook.result.current).canRedo).toBe(true);
  expect(loaded(hook.result.current).selectedFieldUuid).toBe("a");
  await act(() => loaded(hook.result.current).redoTemplateChange());
  expect(loaded(hook.result.current).currentFields[0].name).toBe("Updated");
  expect(toast.success).toHaveBeenCalledWith("Change undone");
  expect(toast.success).toHaveBeenCalledWith("Change redone");
  const history = JSON.parse(
    sessionStorage.getItem("signa_template_editor_history:template")!,
  ) as { undo: unknown[] };
  expect(history.undo).toHaveLength(1);
});
it.each([new Error("offline"), null])(
  "rolls failed field and role changes back and resets pending state",
  async (failure) => {
    vi.mocked(api.updateTemplate).mockRejectedValue(failure);
    const hook = await renderEditor();
    await act(() =>
      loaded(hook.result.current).updateField("a", { name: "Changed" }),
    );
    expect(loaded(hook.result.current).currentFields[0].name).toBe("a");
    await act(() =>
      loaded(hook.result.current).renameSubmitter(signer.uuid, "Changed"),
    );
    expect(loaded(hook.result.current).currentSubmitters[0].name).toBe(
      signer.name,
    );
    expect(loaded(hook.result.current).isSavingFields).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      "Field update failed",
      expect.any(Object),
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Template update failed",
      expect.any(Object),
    );
  },
);
it.each([new Error("offline"), null])(
  "restores the current value when undo or redo cannot persist",
  async (failure) => {
    const hook = await renderEditor();
    await act(() =>
      loaded(hook.result.current).updateField("a", { name: "Updated" }),
    );
    vi.mocked(api.updateTemplate).mockRejectedValue(failure);
    await act(() => loaded(hook.result.current).undoTemplateChange());
    expect(loaded(hook.result.current).currentFields[0].name).toBe("Updated");
    await act(() => loaded(hook.result.current).redoTemplateChange());
    expect(loaded(hook.result.current).isSavingFields).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Undo failed", expect.any(Object));
    expect(toast.error).toHaveBeenCalledWith("Redo failed", expect.any(Object));
  },
);
it("persists role structure, selection-driven deletion and a fresh custom field", async () => {
  const hook = await renderEditor();
  await act(() =>
    loaded(hook.result.current).renameSubmitter(signer.uuid, "Updated role"),
  );
  expect(loaded(hook.result.current).currentSubmitters[0].name).toBe(
    "Updated role",
  );
  await act(() =>
    loaded(hook.result.current).saveFieldAsCustomField(editorField("custom")),
  );
  expect(loaded(hook.result.current).customFields).toHaveLength(1);
  expect(toast.success).toHaveBeenCalledWith("Custom field saved");
  await act(() => loaded(hook.result.current).deleteSelectedFields("a"));
  expect(
    loaded(hook.result.current).currentFields.map((field) => field.uuid),
  ).toEqual(["b"]);
  expect(toast.success).toHaveBeenCalledWith("Field removed");
});
it.each([new Error("offline"), null])(
  "preserves custom fields after a failed custom-field save",
  async (failure) => {
    vi.mocked(api.saveAccountCustomFields).mockRejectedValue(failure);
    const hook = await renderEditor();
    await act(() =>
      loaded(hook.result.current).saveFieldAsCustomField(editorField()),
    );
    expect(loaded(hook.result.current).customFields).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(
      "Custom field save failed",
      expect.any(Object),
    );
  },
);
it("handles cancelled Drive selection and imports newly selected files", async () => {
  const hook = await renderEditor();
  await act(() => loaded(hook.result.current).addGoogleDriveDocuments());
  expect(api.addTemplateGoogleDriveDocuments).not.toHaveBeenCalled();
  vi.mocked(pickGoogleDriveDocuments).mockResolvedValue({
    accessToken: "drive-token",
    files: [{ id: "drive-file" }],
  });
  vi.mocked(api.getTemplate).mockResolvedValue(
    templateFixture({ documents: [] }),
  );
  await act(() => loaded(hook.result.current).addGoogleDriveDocuments());
  expect(api.addTemplateGoogleDriveDocuments).toHaveBeenCalledWith("template", {
    access_token: "drive-token",
    files: [{ id: "drive-file" }],
    merge: true,
  });
  expect(loaded(hook.result.current).isUploadingDocument).toBe(false);
});
it.each([new Error("offline"), null])(
  "reports Drive picker/import errors and clears pending state",
  async (failure) => {
    vi.mocked(pickGoogleDriveDocuments).mockRejectedValue(failure);
    const hook = await renderEditor();
    await act(() => loaded(hook.result.current).addGoogleDriveDocuments());
    expect(toast.error).toHaveBeenCalledWith(
      "Google Drive import failed",
      expect.any(Object),
    );
    expect(loaded(hook.result.current).isUploadingDocument).toBe(false);
  },
);
it.each(["invalid-json", '{"undo":null,"redo":{}}'])(
  "ignores invalid cached editor history %s",
  async (value) => {
    sessionStorage.setItem("signa_template_editor_history:template", value);
    const hook = await renderEditor();
    expect(loaded(hook.result.current).canUndo).toBe(false);
    expect(loaded(hook.result.current).canRedo).toBe(false);
  },
);
it("bounds persisted history and tolerates unavailable browser storage", async () => {
  const hook = await renderEditor();
  for (let index = 0; index < 52; index++)
    await act(() =>
      loaded(hook.result.current).updateField("a", { name: String(index) }),
    );
  const history = JSON.parse(
    sessionStorage.getItem("signa_template_editor_history:template")!,
  ) as { undo: unknown[] };
  expect(history.undo).toHaveLength(50);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });
  await act(() =>
    loaded(hook.result.current).updateField("a", { name: "Works" }),
  );
  expect(loaded(hook.result.current).currentFields[0].name).toBe("Works");
});
