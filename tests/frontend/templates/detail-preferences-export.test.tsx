import { loadDetail } from "./detail-fixture";
import { template } from "./dashboard-fixture";
import { expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import * as api from "../../../apps/frontend/lib/api/templates";
import * as submissions from "../../../apps/frontend/lib/api/submissions";
async function openPreferences(apiTab = false) {
  await loadDetail();
  fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
  if (apiTab)
    fireEvent.mouseDown(
      screen.getByRole("tab", { name: "API and Embedding" }),
      { button: 0, ctrlKey: false },
    );
}
it("saves changed preferences and closes only after success", async () => {
  await openPreferences();
  fireEvent.change(
    screen.getByLabelText("Completed documents notification BCC address"),
    { target: { value: "legal@example.test" } },
  );
  fireEvent.click(screen.getAllByRole("button", { name: "SAVE" })[0]);
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Preferences saved"),
  );
  expect(api.updateTemplatePreferences).toHaveBeenCalledWith(
    template.id,
    expect.objectContaining({ bcc_completed: "legal@example.test" }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});
it.each([new Error("Preferences denied"), false])(
  "rolls failed preference updates back without closing the dialog %s",
  async (failure) => {
    vi.mocked(api.updateTemplatePreferences).mockRejectedValue(failure);
    await openPreferences();
    fireEvent.change(
      screen.getByLabelText("Completed documents notification BCC address"),
      { target: { value: "legal@example.test" } },
    );
    fireEvent.click(screen.getAllByRole("button", { name: "SAVE" })[0]);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Preferences update failed", {
        description: failure instanceof Error ? failure.message : "Try again.",
      }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  },
);
it("toggles the public shared link and testing sharing using their separate endpoints", async () => {
  await openPreferences(true);
  const switches = screen.getAllByRole("switch");
  fireEvent.click(switches[0]);
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Shared link disabled"),
  );
  expect(api.updateTemplate).toHaveBeenCalledWith(template.id, {
    shared_link: false,
  });
  fireEvent.click(screen.getAllByRole("switch")[0]);
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Shared link enabled"),
  );
  fireEvent.click(screen.getAllByRole("switch")[1]);
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Template shared with Test mode",
    ),
  );
  expect(api.updateTemplateTestingSharing).toHaveBeenCalledWith(
    template.id,
    true,
  );
  fireEvent.click(screen.getAllByRole("switch")[1]);
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Template unshared from Test mode",
    ),
  );
});
it("restores shared link values after each type of sharing update fails", async () => {
  vi.mocked(api.updateTemplate).mockRejectedValue(new Error("Link denied"));
  vi.mocked(api.updateTemplateTestingSharing).mockRejectedValue(null);
  await openPreferences(true);
  fireEvent.click(screen.getAllByRole("switch")[0]);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Shared link update failed", {
      description: "Link denied",
    }),
  );
  expect(screen.getAllByRole("switch")[0].getAttribute("aria-checked")).toBe(
    "true",
  );
  fireEvent.click(screen.getAllByRole("switch")[1]);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Test mode sharing update failed",
      { description: "Try again." },
    ),
  );
  expect(screen.getAllByRole("switch")[1].getAttribute("aria-checked")).toBe(
    "false",
  );
});
function mockDownloads() {
  const createObjectURL = vi.fn(() => "blob:test"),
    revokeObjectURL = vi.fn();
  const OriginalURL = URL;
  vi.stubGlobal(
    "URL",
    class extends OriginalURL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  return { createObjectURL, revokeObjectURL, click };
}
it.each(["CSV", "XLSX"])(
  "exports all template submissions as %s and releases the temporary object URL",
  async (format) => {
    const downloads = mockDownloads();
    await loadDetail();
    fireEvent.click(screen.getByRole("button", { name: "EXPORT" }));
    expect(screen.getByText("1 submission match this export.")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp("^" + format) }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(format + " export started"),
    );
    expect(submissions.downloadTemplateSubmissionsExport).toHaveBeenCalledWith({
      format: format.toLowerCase(),
      status: undefined,
      template_id: template.id,
    });
    expect(downloads.revokeObjectURL).toHaveBeenCalledWith("blob:test");
    expect(downloads.click).toHaveBeenCalled();
  },
);
it("filters exports and updates their preview count without narrowing the displayed submission list", async () => {
  mockDownloads();
  await loadDetail();
  fireEvent.click(screen.getByRole("button", { name: "EXPORT" }));
  fireEvent.keyDown(screen.getByLabelText("Status"), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "Completed" }));
  expect(screen.getByText("0 submissions match this export.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^CSV/ }));
  await waitFor(() =>
    expect(submissions.downloadTemplateSubmissionsExport).toHaveBeenCalledWith({
      format: "csv",
      status: "completed",
      template_id: template.id,
    }),
  );
});
it.each([new Error("Export denied"), false])(
  "reports an export failure %s without discarding the dialog",
  async (failure) => {
    vi.mocked(submissions.downloadTemplateSubmissionsExport).mockRejectedValue(
      failure,
    );
    await loadDetail();
    fireEvent.click(screen.getByRole("button", { name: "EXPORT" }));
    fireEvent.click(screen.getByRole("button", { name: /^CSV/ }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Export failed", {
        description: failure instanceof Error ? failure.message : "Try again.",
      }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  },
);
