import { loadDashboard, template, folder, text } from "./dashboard-fixture";
import { expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import * as api from "../../../apps/frontend/lib/api/templates";
import { listTeams } from "../../../apps/frontend/lib/api/teams";
import { team } from "../settings/settings-fixtures";
async function openTemplateAction(action: string, query = "") {
  await loadDashboard(query);
  fireEvent.click(screen.getByRole("button", { name: action }));
}
async function folderAction(action: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: "Folder actions" }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: action }));
}
it.each([
  ["archive", ""],
  ["delete", "archived=true"],
] as const)(
  "confirms %s before changing a template and refreshes the list",
  async (action, query) => {
    await openTemplateAction(text.actions[action], query);
    expect(api.archiveTemplate).not.toHaveBeenCalled();
    expect(api.deleteTemplatePermanently).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: text.actions[action],
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        action === "archive"
          ? text.toasts.templateArchived
          : text.toasts.templateDeleted,
        { description: template.name },
      ),
    );
    expect(
      action === "archive"
        ? api.archiveTemplate
        : api.deleteTemplatePermanently,
    ).toHaveBeenCalledWith(template.id);
  },
);
it.each([
  ["archive", ""],
  ["delete", "archived=true"],
] as const)(
  "reports %s failure and retains its confirmation dialog",
  async (action, query) => {
    vi.mocked(api.archiveTemplate).mockRejectedValue(
      new Error("Action denied"),
    );
    vi.mocked(api.deleteTemplatePermanently).mockRejectedValue(null);
    await openTemplateAction(text.actions[action], query);
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: text.actions[action],
      }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        action === "archive"
          ? text.toasts.archiveFailed
          : text.toasts.deleteFailed,
        {
          description:
            action === "archive" ? "Action denied" : "Template action failed.",
        },
      ),
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  },
);
it("cancels template removal without invoking its API", async () => {
  await openTemplateAction(text.actions.archive);
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: text.actions.cancel,
    }),
  );
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(api.archiveTemplate).not.toHaveBeenCalled();
});
it("restores archived templates and reports restore failure without navigating away", async () => {
  await loadDashboard("archived=true");
  fireEvent.click(screen.getByRole("button", { name: text.actions.restore }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(text.toasts.restored, {
      description: template.name,
    }),
  );
  expect(api.updateTemplate).toHaveBeenCalledWith(template.id, {
    archived: false,
  });
  vi.mocked(api.updateTemplate).mockRejectedValue(new Error("Restore denied"));
  fireEvent.click(screen.getByRole("button", { name: text.actions.restore }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(text.toasts.restoreFailed, {
      description: "Restore denied",
    }),
  );
});
it("clones a template with an editable title and default folder", async () => {
  await openTemplateAction(text.actions.clone);
  const dialog = screen.getByRole("dialog");
  fireEvent.change(
    within(dialog).getByDisplayValue(template.name + " (Clone)"),
    { target: { value: "  Cloned Agreement  " } },
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: text.actions.submit }),
  );
  await waitFor(() =>
    expect(api.cloneTemplate).toHaveBeenCalledWith(template.id, {
      name: "Cloned Agreement",
      folder_name: "Default",
      team_id: undefined,
    }),
  );
  expect(toast.success).toHaveBeenCalledWith(
    text.toasts.cloned,
    expect.objectContaining({ description: "Cloned Agreement" }),
  );
});
it("clones to a selected team and target folder", async () => {
  vi.mocked(listTeams).mockResolvedValue([
    team,
    { ...team, id: "legal", name: "Legal" },
  ]);
  await openTemplateAction(text.actions.clone);
  const dialog = screen.getByRole("dialog");
  fireEvent.keyDown(within(dialog).getAllByRole("combobox")[0], {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("option", { name: "Legal" }));
  fireEvent.change(screen.getByPlaceholderText(text.actions.changeFolder), {
    target: { value: "Contracts" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: text.actions.submit }),
  );
  await waitFor(() =>
    expect(api.cloneTemplate).toHaveBeenCalledWith(template.id, {
      name: template.name + " (Clone)",
      folder_name: "Contracts",
      team_id: "legal",
    }),
  );
});
it("reports clone failure without losing the clone draft", async () => {
  vi.mocked(api.cloneTemplate).mockRejectedValue(new Error("Clone denied"));
  await openTemplateAction(text.actions.clone);
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: text.actions.submit,
    }),
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      text.toasts.cloneFailed,
      expect.objectContaining({ description: "Clone denied" }),
    ),
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
});
it("moves a template only when the folder changes and supports keyboard submission", async () => {
  await openTemplateAction(text.actions.move);
  fireEvent.click(
    screen.getByRole("button", { name: text.actions.moveSubmit }),
  );
  expect(api.updateTemplate).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: text.actions.move }));
  fireEvent.change(
    screen.getByPlaceholderText(text.folder.newNamePlaceholder),
    { target: { value: "  Legal  " } },
  );
  fireEvent.keyDown(
    screen.getByPlaceholderText(text.folder.newNamePlaceholder),
    { key: "Enter" },
  );
  await waitFor(() =>
    expect(api.updateTemplate).toHaveBeenCalledWith(template.id, {
      folder_name: "Legal",
    }),
  );
  expect(toast.success).toHaveBeenCalledWith(text.toasts.moved, {
    description: "Legal",
  });
});
it("reports move failures and preserves the selected destination", async () => {
  vi.mocked(api.updateTemplate).mockRejectedValue("failure");
  await openTemplateAction(text.actions.move);
  fireEvent.change(
    screen.getByPlaceholderText(text.folder.newNamePlaceholder),
    { target: { value: "Legal" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: text.actions.moveSubmit }),
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(text.toasts.moveFailed, {
      description: `${text.toasts.moveFailed}.`,
    }),
  );
  expect(screen.getByDisplayValue("Legal")).toBeTruthy();
});
it("opens a folder and supports breadcrumb navigation back to its ancestors", async () => {
  vi.mocked(api.listTemplateFolders).mockResolvedValue([folder]);
  await loadDashboard();
  fireEvent.click(screen.getByRole("button", { name: /LegalLegal/ }));
  await waitFor(() =>
    expect(api.listTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ folder: "Legal" }),
    ),
  );
  fireEvent.click(
    within(screen.getByRole("navigation")).getByRole("button", {
      name: text.folder.templates,
    }),
  );
  await waitFor(() =>
    expect(api.listTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ folder: undefined }),
    ),
  );
});
it("renames folders from their context menu using a trimmed title", async () => {
  vi.mocked(api.listTemplateFolders).mockResolvedValue([folder]);
  await loadDashboard();
  await folderAction(text.actions.rename);
  fireEvent.change(screen.getByPlaceholderText(text.folder.namePlaceholder), {
    target: { value: "  Renamed  " },
  });
  fireEvent.keyDown(screen.getByPlaceholderText(text.folder.namePlaceholder), {
    key: "Enter",
  });
  await waitFor(() =>
    expect(api.updateTemplateFolder).toHaveBeenCalledWith(folder.id, {
      name: "Renamed",
    }),
  );
  expect(toast.success).toHaveBeenCalledWith(text.toasts.folderRenamed, {
    description: "Renamed",
  });
});
it("does not rename unchanged folders and cancels the rename dialog cleanly", async () => {
  vi.mocked(api.listTemplateFolders).mockResolvedValue([folder]);
  await loadDashboard();
  await folderAction(text.actions.rename);
  fireEvent.click(screen.getByRole("button", { name: text.actions.rename }));
  expect(api.updateTemplateFolder).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  await folderAction(text.actions.rename);
  fireEvent.click(screen.getByRole("button", { name: text.actions.cancel }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("reports rename failures while preserving the folder name draft", async () => {
  vi.mocked(api.listTemplateFolders).mockResolvedValue([folder]);
  vi.mocked(api.updateTemplateFolder).mockRejectedValue("failure");
  await loadDashboard();
  await folderAction(text.actions.rename);
  fireEvent.change(screen.getByPlaceholderText(text.folder.namePlaceholder), {
    target: { value: "New name" },
  });
  fireEvent.click(screen.getByRole("button", { name: text.actions.rename }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(text.toasts.folderRenameFailed, {
      description: `${text.toasts.folderRenameFailed}.`,
    }),
  );
});
it.each([
  ["folder_only", "deleteFolderOnly"],
  ["with_contents", "deleteFolderAndDocuments"],
] as const)(
  "deletes a folder with the explicit %s scope",
  async (mode, action) => {
    vi.mocked(api.listTemplateFolders).mockResolvedValue([folder]);
    await loadDashboard();
    await folderAction(text.actions.delete);
    fireEvent.click(screen.getByRole("button", { name: text.actions[action] }));
    await waitFor(() =>
      expect(api.deleteTemplateFolder).toHaveBeenCalledWith(folder.id, mode),
    );
    expect(toast.success).toHaveBeenCalledWith(text.toasts.folderDeleted, {
      description:
        mode === "with_contents"
          ? text.toasts.folderDeletedWithContents
          : text.toasts.folderOnlyDeleted,
    });
  },
);
it("reports folder delete failure and allows canceling its confirmation", async () => {
  vi.mocked(api.listTemplateFolders).mockResolvedValue([folder]);
  vi.mocked(api.deleteTemplateFolder).mockRejectedValue(
    new Error("Folder in use"),
  );
  await loadDashboard();
  await folderAction(text.actions.delete);
  fireEvent.click(
    screen.getByRole("button", { name: text.actions.deleteFolderOnly }),
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(text.toasts.folderDeleteFailed, {
      description: "Folder in use",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: text.actions.cancel }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
it("dismisses rename, move and clone dialogs through their close controls", async () => {
  vi.mocked(api.listTemplateFolders).mockResolvedValue([folder]);
  await loadDashboard();
  await folderAction(text.actions.rename);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  for (const action of [text.actions.move, text.actions.clone]) {
    fireEvent.click(screen.getByRole("button", { name: action }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  }
});
it("selects a suggested move folder and a suggested clone destination", async () => {
  vi.mocked(api.listTemplateFolders).mockResolvedValue([folder]);
  await loadDashboard();
  fireEvent.click(screen.getByRole("button", { name: text.actions.move }));
  const move = screen.getByPlaceholderText(text.folder.newNamePlaceholder);
  fireEvent.focus(move);
  fireEvent.change(move, { target: { value: "Leg" } });
  fireEvent.keyDown(move, { key: "ArrowDown" });
  fireEvent.click(
    await within(screen.getByRole("dialog")).findByRole("button", {
      name: "Legal",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: text.actions.moveSubmit }),
  );
  await waitFor(() =>
    expect(api.updateTemplate).toHaveBeenCalledWith(template.id, {
      folder_name: "Legal",
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: text.actions.clone }));
  const destination = screen.getByPlaceholderText(text.actions.changeFolder);
  fireEvent.focus(destination);
  fireEvent.change(destination, { target: { value: "Leg" } });
  fireEvent.click(
    await within(screen.getByRole("dialog")).findByRole("button", {
      name: "Legal",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: text.actions.submit }));
  await waitFor(() =>
    expect(api.cloneTemplate).toHaveBeenCalledWith(
      template.id,
      expect.objectContaining({ folder_name: "Legal" }),
    ),
  );
});
it("refuses an empty keyboard folder creation request", async () => {
  await loadDashboard();
  fireEvent.click(screen.getByRole("button", { name: text.actions.newFolder }));
  fireEvent.keyDown(screen.getByPlaceholderText(text.folder.namePlaceholder), {
    key: "Enter",
  });
  expect(api.createTemplateFolder).not.toHaveBeenCalled();
});
it("reports the fallback error when cloning fails without an Error object", async () => {
  vi.mocked(api.cloneTemplate).mockRejectedValue(null);
  await openTemplateAction(text.actions.clone);
  fireEvent.click(screen.getByRole("button", { name: text.actions.submit }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      text.toasts.cloneFailed,
      expect.objectContaining({ description: text.toasts.cloneFailed + "." }),
    ),
  );
});
it("reports Error objects from move and rename APIs without losing their messages", async () => {
  vi.mocked(api.listTemplateFolders).mockResolvedValue([folder]);
  vi.mocked(api.updateTemplate).mockRejectedValue(new Error("Move denied"));
  await openTemplateAction(text.actions.move);
  fireEvent.change(
    screen.getByPlaceholderText(text.folder.newNamePlaceholder),
    { target: { value: "Contracts" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: text.actions.moveSubmit }),
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(text.toasts.moveFailed, {
      description: "Move denied",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  vi.mocked(api.updateTemplateFolder).mockRejectedValue(
    new Error("Rename denied"),
  );
  await folderAction(text.actions.rename);
  fireEvent.change(screen.getByPlaceholderText(text.folder.namePlaceholder), {
    target: { value: "Contracts" },
  });
  fireEvent.click(screen.getByRole("button", { name: text.actions.rename }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(text.toasts.folderRenameFailed, {
      description: "Rename denied",
    }),
  );
});
it("uses a fallback description when folder deletion fails without an Error", async () => {
  vi.mocked(api.listTemplateFolders).mockResolvedValue([folder]);
  vi.mocked(api.deleteTemplateFolder).mockRejectedValue(false);
  await loadDashboard();
  await folderAction(text.actions.delete);
  fireEvent.click(
    screen.getByRole("button", { name: text.actions.deleteFolderOnly }),
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(text.toasts.folderDeleteFailed, {
      description: text.toasts.folderDeleteFailed + ".",
    }),
  );
});
it("defaults a cleared clone folder without changing the document name", async () => {
  await openTemplateAction(text.actions.clone);
  fireEvent.change(screen.getByPlaceholderText(text.actions.changeFolder), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: text.actions.submit }));
  await waitFor(() =>
    expect(api.cloneTemplate).toHaveBeenCalledWith(
      template.id,
      expect.objectContaining({ folder_name: text.folder.default }),
    ),
  );
});
it("does not submit creation and rename forms for ordinary typing keys", async () => {
  vi.mocked(api.listTemplateFolders).mockResolvedValue([folder]);
  await loadDashboard();
  fireEvent.click(screen.getByRole("button", { name: text.actions.create }));
  fireEvent.keyDown(screen.getByPlaceholderText(text.create.documentName), {
    key: "A",
  });
  expect(api.createTemplate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: text.actions.newFolder }));
  fireEvent.keyDown(screen.getByPlaceholderText(text.folder.namePlaceholder), {
    key: "C",
  });
  expect(api.createTemplateFolder).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: text.actions.cancel }));
  await folderAction(text.actions.rename);
  fireEvent.keyDown(screen.getByPlaceholderText(text.folder.namePlaceholder), {
    key: "R",
  });
  expect(api.updateTemplateFolder).not.toHaveBeenCalled();
});
it("keeps the active filter when its selected toggle is clicked and supports returning from archive", async () => {
  await loadDashboard();
  fireEvent.click(screen.getByRole("radio", { name: text.actions.active }));
  expect(api.listTemplates).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("radio", { name: text.actions.archived }));
  await waitFor(() =>
    expect(api.listTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ archived: true }),
    ),
  );
  fireEvent.click(screen.getByRole("radio", { name: text.actions.active }));
  await waitFor(() =>
    expect(api.listTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ archived: false }),
    ),
  );
});
