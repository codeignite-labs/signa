import { loadDashboard, text, state } from "./dashboard-fixture";
import { expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import * as api from "../../../apps/frontend/lib/api/templates";
import { pickGoogleDriveDocuments } from "../../../apps/frontend/lib/google-drive/picker";
async function openCreate() {
  await loadDashboard();
  fireEvent.click(screen.getByRole("button", { name: text.actions.create }));
  return screen.getByRole("dialog");
}
it("creates a named blank template and opens its editor", async () => {
  const dialog = await openCreate();
  fireEvent.change(screen.getByPlaceholderText(text.create.documentName), {
    target: { value: "  New agreement  " },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: text.actions.create }),
  );
  await waitFor(() =>
    expect(state.push).toHaveBeenCalledWith("/templates/new-template/edit"),
  );
  expect(api.createTemplate).toHaveBeenCalledWith({
    name: "New agreement",
    folder_name: undefined,
    shared_link: true,
  });
  expect(toast.success).toHaveBeenCalledWith(
    text.toasts.created,
    expect.objectContaining({ id: "template-create" }),
  );
});
it("uses a default blank document title and submits on Enter", async () => {
  await openCreate();
  fireEvent.keyDown(screen.getByPlaceholderText(text.create.documentName), {
    key: "Enter",
  });
  await waitFor(() =>
    expect(api.createTemplate).toHaveBeenCalledWith({
      name: text.create.title,
      folder_name: undefined,
      shared_link: true,
    }),
  );
});
it.each([new Error("Template denied"), undefined])(
  "reports blank template creation failure %s and keeps the draft",
  async (failure) => {
    vi.mocked(api.createTemplate).mockRejectedValue(failure);
    const dialog = await openCreate();
    fireEvent.change(screen.getByPlaceholderText(text.create.documentName), {
      target: { value: "Draft" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: text.actions.create }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        text.toasts.createFailed,
        expect.objectContaining({
          description:
            failure instanceof Error
              ? failure.message
              : `${text.toasts.createFailed}.`,
        }),
      ),
    );
    expect(screen.getByDisplayValue("Draft")).toBeTruthy();
  },
);
it("clears create drafts and resets the source tab when the dialog is dismissed", async () => {
  await openCreate();
  fireEvent.change(screen.getByPlaceholderText(text.create.documentName), {
    target: { value: "Draft" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: text.create.googleDrive }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: text.actions.create }));
  expect(
    (screen.getByPlaceholderText(text.create.documentName) as HTMLInputElement)
      .value,
  ).toBe("");
});
it("creates and imports a picked Drive file with authorization scoped to the import request", async () => {
  await openCreate();
  fireEvent.click(
    screen.getByRole("button", { name: text.create.googleDrive }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: text.actions.addFromGoogleDrive }),
  );
  await waitFor(() =>
    expect(state.push).toHaveBeenCalledWith("/templates/new-template/edit"),
  );
  expect(api.createTemplate).toHaveBeenCalledWith({
    name: "Drive agreement",
    folder_name: undefined,
    shared_link: true,
  });
  expect(api.addTemplateGoogleDriveDocuments).toHaveBeenCalledWith(
    "new-template",
    {
      access_token: "drive-token",
      files: [{ id: "drive-1", name: "Drive agreement" }],
      merge: true,
    },
  );
});
it("keeps a typed name for Drive imports and falls back when the picker supplies no filename", async () => {
  vi.mocked(pickGoogleDriveDocuments).mockResolvedValue({
    accessToken: "token",
    files: [{ id: "drive" }],
  });
  await openCreate();
  fireEvent.change(screen.getByPlaceholderText(text.create.documentName), {
    target: { value: "Typed name" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: text.create.googleDrive }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: text.actions.addFromGoogleDrive }),
  );
  await waitFor(() =>
    expect(api.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Typed name" }),
    ),
  );
});
it("does not create an empty template when the Drive picker is canceled", async () => {
  vi.mocked(pickGoogleDriveDocuments).mockResolvedValue({
    accessToken: "token",
    files: [],
  });
  await openCreate();
  fireEvent.click(
    screen.getByRole("button", { name: text.create.googleDrive }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: text.actions.addFromGoogleDrive }),
  );
  await waitFor(() =>
    expect(toast.info).toHaveBeenCalledWith(text.toasts.driveNoFiles, {
      id: "template-create",
    }),
  );
  expect(api.createTemplate).not.toHaveBeenCalled();
});
it.each([new Error("Drive denied"), false])(
  "reports Drive import failure %s and re-enables import controls",
  async (failure) => {
    vi.mocked(pickGoogleDriveDocuments).mockRejectedValue(failure);
    await openCreate();
    fireEvent.click(
      screen.getByRole("button", { name: text.create.googleDrive }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: text.actions.addFromGoogleDrive }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        text.toasts.driveImportFailed,
        expect.objectContaining({
          description:
            failure instanceof Error
              ? failure.message
              : `${text.toasts.driveImportFailed}.`,
        }),
      ),
    );
    expect(
      screen
        .getByRole("button", { name: text.actions.addFromGoogleDrive })
        .hasAttribute("disabled"),
    ).toBe(false);
  },
);
it("uploads PDF/DOCX files from the toolbar and clears the input after upload", async () => {
  await loadDashboard();
  const input = document.querySelector<HTMLInputElement>(
    'input[accept^="application/pdf,.pdf"]',
  )!;
  const click = vi.spyOn(input, "click").mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: text.actions.upload }));
  expect(click).toHaveBeenCalledTimes(1);
  const file = new File(["pdf"], "agreement.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() =>
    expect(state.push).toHaveBeenCalledWith(
      "/templates/uploaded-template/edit",
    ),
  );
  expect(api.createTemplateFromDocument).toHaveBeenCalledWith(file, undefined);
  expect(input.value).toBe("");
});
it.each([new Error("Unsupported document"), null])(
  "reports toolbar upload failure %s",
  async (failure) => {
    vi.mocked(api.createTemplateFromDocument).mockRejectedValue(failure);
    await loadDashboard();
    const input = document.querySelector<HTMLInputElement>(
      'input[accept^="application/pdf,.pdf"]',
    )!;
    fireEvent.change(input, { target: { files: [] } });
    expect(api.createTemplateFromDocument).not.toHaveBeenCalled();
    fireEvent.change(input, {
      target: { files: [new File(["bad"], "bad.pdf")] },
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        text.toasts.uploadFailed,
        expect.objectContaining({
          description:
            failure instanceof Error
              ? failure.message
              : `${text.toasts.uploadFailed}.`,
        }),
      ),
    );
  },
);
it("creates a folder from a trimmed name and refreshes the parent list", async () => {
  await loadDashboard();
  fireEvent.click(screen.getByRole("button", { name: text.actions.newFolder }));
  fireEvent.change(screen.getByPlaceholderText(text.folder.namePlaceholder), {
    target: { value: "  Legal  " },
  });
  fireEvent.keyDown(screen.getByPlaceholderText(text.folder.namePlaceholder), {
    key: "Enter",
  });
  await waitFor(() =>
    expect(api.createTemplateFolder).toHaveBeenCalledWith({
      name: "Legal",
      parent: undefined,
    }),
  );
  expect(toast.success).toHaveBeenCalledWith(text.toasts.folderCreated, {
    description: "Legal",
  });
});
it.each([new Error("Folder exists"), false])(
  "reports folder creation failure %s and preserves the input",
  async (failure) => {
    vi.mocked(api.createTemplateFolder).mockRejectedValue(failure);
    await loadDashboard();
    fireEvent.click(
      screen.getByRole("button", { name: text.actions.newFolder }),
    );
    fireEvent.change(screen.getByPlaceholderText(text.folder.namePlaceholder), {
      target: { value: "Legal" },
    });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: text.actions.create,
      }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(text.toasts.folderCreateFailed, {
        description:
          failure instanceof Error
            ? failure.message
            : `${text.toasts.folderCreateFailed}.`,
      }),
    );
    expect(screen.getByDisplayValue("Legal")).toBeTruthy();
  },
);
it("does not create blank folders and clears canceled folder drafts", async () => {
  await loadDashboard();
  fireEvent.click(screen.getByRole("button", { name: text.actions.newFolder }));
  fireEvent.keyDown(screen.getByPlaceholderText(text.folder.namePlaceholder), {
    key: "Enter",
  });
  expect(api.createTemplateFolder).not.toHaveBeenCalled();
  fireEvent.change(screen.getByPlaceholderText(text.folder.namePlaceholder), {
    target: { value: "Draft folder" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: text.actions.newFolder }));
  expect(
    (
      screen.getByPlaceholderText(
        text.folder.namePlaceholder,
      ) as HTMLInputElement
    ).value,
  ).toBe("");
});
it("opens folder creation from the create-template folder selector", async () => {
  await openCreate();
  fireEvent.click(
    screen.getByRole("button", { name: text.actions.changeFolder }),
  );
  expect(
    screen.getByRole("heading", { name: text.dialogs.createFolderTitle }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: text.actions.cancel }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
