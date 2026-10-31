import { text, state } from "./dashboard-fixture";
import { expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { TemplateUploadDropzone } from "../../../apps/frontend/app/templates/_components/template-upload-dropzone";
import * as api from "../../../apps/frontend/lib/api/templates";
import { pickGoogleDriveDocuments } from "../../../apps/frontend/lib/google-drive/picker";
function uploadInput() {
  return document.querySelector<HTMLInputElement>("input[type=file]")!;
}
it("uploads a supported document to the requested folder and renders meaningful progress and completion toasts", async () => {
  vi.mocked(toast.custom).mockReturnValue("upload-toast");
  render(<TemplateUploadDropzone folderName="Legal" />);
  const file = new File(["pdf"], "agreement.pdf", { type: "application/pdf" });
  fireEvent.change(uploadInput(), { target: { files: [file] } });
  await waitFor(() =>
    expect(state.push).toHaveBeenCalledWith(
      "/templates/uploaded-template/edit",
    ),
  );
  expect(api.createTemplateFromDocument).toHaveBeenCalledWith(file, "Legal");
  const progress = vi.mocked(toast.custom).mock.calls[0][0];
  const notification = render(progress("upload-toast"));
  expect(
    screen.getByText(
      text.toasts.preparingUpload.replaceAll("{file}", file.name),
    ),
  ).toBeTruthy();
  notification.unmount();
  const during = render(
    vi.mocked(toast.custom).mock.calls[1][0]("upload-toast"),
  );
  expect(screen.getByText(text.toasts.uploadingDocument + "...")).toBeTruthy();
  during.unmount();
  render(vi.mocked(toast.custom).mock.calls[2][0]("upload-toast"));
  expect(
    screen.getByText(file.name + " - " + text.toasts.documentUploaded),
  ).toBeTruthy();
});
it.each([new Error("Unsupported document"), null])(
  "reports upload failure %s and clears the selected file so the same document can be retried",
  async (failure) => {
    vi.mocked(api.createTemplateFromDocument).mockRejectedValue(failure);
    render(<TemplateUploadDropzone />);
    fireEvent.change(uploadInput(), {
      target: {
        files: [
          new File(["pdf"], "agreement.pdf", { type: "application/pdf" }),
        ],
      },
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
    expect(screen.getByText(text.uploadDropzone.title)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: text.uploadDropzone.drive })
        .hasAttribute("disabled"),
    ).toBe(false);
  },
);
it("ignores empty and unsupported selections before making an upload request", async () => {
  render(<TemplateUploadDropzone />);
  fireEvent.change(uploadInput(), { target: { files: [] } });
  await act(async () => {});
  expect(api.createTemplateFromDocument).not.toHaveBeenCalled();
  fireEvent.change(uploadInput(), {
    target: {
      files: [new File(["text"], "notes.txt", { type: "text/plain" })],
    },
  });
  await act(async () => {});
  expect(api.createTemplateFromDocument).not.toHaveBeenCalled();
});
it("imports selected Drive documents into a new folder-scoped template", async () => {
  render(<TemplateUploadDropzone folderName="Legal" />);
  fireEvent.click(
    screen.getByRole("button", { name: text.uploadDropzone.drive }),
  );
  await waitFor(() =>
    expect(state.push).toHaveBeenCalledWith("/templates/new-template/edit"),
  );
  expect(api.createTemplate).toHaveBeenCalledWith({
    folder_name: "Legal",
    name: "Drive agreement",
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
  for (const [callback] of vi.mocked(toast.custom).mock.calls) {
    const view = render(callback("toast"));
    view.unmount();
  }
});
it("uses a default template name when Drive supplies an unnamed file", async () => {
  vi.mocked(pickGoogleDriveDocuments).mockResolvedValue({
    accessToken: "token",
    files: [{ id: "drive" }],
  });
  render(<TemplateUploadDropzone />);
  fireEvent.click(
    screen.getByRole("button", { name: text.uploadDropzone.drive }),
  );
  await waitFor(() =>
    expect(api.createTemplate).toHaveBeenCalledWith({
      name: text.create.title,
      shared_link: true,
      folder_name: undefined,
    }),
  );
});
it("does not create a template if Drive selection is canceled and re-enables the import control", async () => {
  vi.mocked(pickGoogleDriveDocuments).mockResolvedValue({
    accessToken: "token",
    files: [],
  });
  render(<TemplateUploadDropzone />);
  fireEvent.click(
    screen.getByRole("button", { name: text.uploadDropzone.drive }),
  );
  await waitFor(() =>
    expect(toast.info).toHaveBeenCalledWith(
      text.toasts.driveNoFiles,
      expect.any(Object),
    ),
  );
  expect(api.createTemplate).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole("button", { name: text.uploadDropzone.drive })
      .hasAttribute("disabled"),
  ).toBe(false);
});
it.each([new Error("Drive unavailable"), "failure"])(
  "reports Drive import failure %s",
  async (failure) => {
    vi.mocked(pickGoogleDriveDocuments).mockRejectedValue(failure);
    render(<TemplateUploadDropzone />);
    fireEvent.click(
      screen.getByRole("button", { name: text.uploadDropzone.drive }),
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
  },
);
