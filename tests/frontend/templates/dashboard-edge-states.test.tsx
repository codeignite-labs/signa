import {
  template,
  submission,
  templatesResponse,
  text,
  renderDashboard,
  loadDashboard,
} from "./dashboard-fixture";
import { expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import * as api from "../../../apps/frontend/lib/api/templates";
import * as submissions from "../../../apps/frontend/lib/api/submissions";
import { pickGoogleDriveDocuments } from "../../../apps/frontend/lib/google-drive/picker";

it("uses a default document name when a Drive file has no usable name", async () => {
  vi.mocked(pickGoogleDriveDocuments).mockResolvedValue({
    accessToken: "drive-token",
    files: [{ id: "drive", name: " " }],
  });
  await loadDashboard();
  fireEvent.click(screen.getByRole("button", { name: text.actions.create }));
  fireEvent.click(screen.getByRole("button", { name: /Google Drive/ }));
  fireEvent.click(
    screen.getByRole("button", { name: text.actions.addFromGoogleDrive }),
  );
  await waitFor(() =>
    expect(api.createTemplate).toHaveBeenCalledWith({
      name: text.create.title,
      folder_name: undefined,
      shared_link: true,
    }),
  );
});

it("moves to the default folder when the destination is blank", async () => {
  vi.mocked(api.listTemplates).mockResolvedValue(
    templatesResponse([{ ...template, folder_name: "Legal" }]),
  );
  renderDashboard("folder=Legal");
  await screen.findByRole("heading", { name: template.name });
  fireEvent.click(screen.getByRole("button", { name: text.actions.move }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(
    screen.getByPlaceholderText(text.folder.newNamePlaceholder),
    { target: { value: "" } },
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: text.actions.moveSubmit }),
  );
  await waitFor(() =>
    expect(api.updateTemplate).toHaveBeenCalledWith(template.id, {
      folder_name: text.folder.default,
    }),
  );
});

it.each([null, new Error("Folder refused")])(
  "reports folder creation errors without resetting the entered name %#",
  async (failure) => {
    vi.mocked(api.createTemplateFolder).mockRejectedValue(failure);
    await loadDashboard();
    fireEvent.click(
      screen.getByRole("button", { name: text.actions.newFolder }),
    );
    const input = screen.getByPlaceholderText(text.folder.namePlaceholder);
    fireEvent.change(input, { target: { value: "Contracts" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(text.toasts.folderCreateFailed, {
        description:
          failure instanceof Error
            ? failure.message
            : text.toasts.folderCreateFailed + ".",
      }),
    );
    expect((input as HTMLInputElement).value).toBe("Contracts");
  },
);

it.each([null, new Error("Restore refused")])(
  "reports archived restore failures %#",
  async (failure) => {
    vi.mocked(api.updateTemplate).mockRejectedValue(failure);
    await loadDashboard("archived=true");
    fireEvent.click(screen.getByRole("button", { name: text.actions.restore }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(text.toasts.restoreFailed, {
        description:
          failure instanceof Error
            ? failure.message
            : text.toasts.restoreFailed + ".",
      }),
    );
  },
);

it.each([submission.template, null])(
  "uses a remaining submission identifier in archive notifications %#",
  async (templateReference) => {
    const row = { ...submission, name: null, template: templateReference };
    vi.mocked(submissions.listSubmissions).mockResolvedValue({
      data: [row],
      pagination: { count: 1, next: null, prev: null },
    });
    vi.mocked(submissions.archiveSubmission).mockResolvedValue({
      id: row.id,
      archived_at: "2026-01-01",
    });
    renderDashboard("view=submissions");
    await screen.findByRole("button", { name: text.actions.archive });
    fireEvent.click(screen.getByRole("button", { name: text.actions.archive }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        text.toasts.submissionArchived,
        { description: templateReference?.name ?? row.id },
      ),
    );
  },
);
