import { loadDetail, renderDetail } from "./detail-fixture";
import { state, template, submission } from "./dashboard-fixture";
import { expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import * as api from "../../../apps/frontend/lib/api/templates";
import * as submissions from "../../../apps/frontend/lib/api/submissions";
import { getAuthSession } from "../../../apps/frontend/lib/api/auth";
import { ApiError } from "../../../apps/frontend/lib/api/http";

it.each([false, true])(
  "ignores a template request finishing after unmount (rejected=%s)",
  async (rejected) => {
    let resolve!: (value: api.TemplateResponse) => void;
    let reject!: (reason: unknown) => void;
    vi.mocked(api.getTemplate).mockReturnValue(
      new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      }),
    );
    const view = renderDetail();
    view.unmount();
    await act(async () => {
      if (rejected) reject(new ApiError("Expired", 401));
      else resolve(template);
    });
    expect(toast.error).not.toHaveBeenCalled();
    expect(state.push).not.toHaveBeenCalled();
  },
);

it("uses safe self-sign defaults when the cached session and template roles are absent", async () => {
  vi.mocked(getAuthSession).mockReturnValue(null);
  vi.mocked(api.getTemplate).mockResolvedValue({ ...template, submitters: [] });
  vi.mocked(submissions.listSubmissions).mockResolvedValue({
    data: [],
    pagination: { count: 0, next: null, prev: null },
  });
  vi.spyOn(window, "open").mockReturnValue(null);
  await loadDetail();
  fireEvent.click(screen.getByRole("button", { name: "SIGN IT YOURSELF" }));
  await waitFor(() =>
    expect(submissions.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        submitters: [
          { email: undefined, name: "Self signer", role: "First Party" },
        ],
      }),
    ),
  );
  await waitFor(() => expect(state.push).toHaveBeenCalledWith("/s/signer"));
});

it("reports an Error from the clone endpoint", async () => {
  vi.mocked(api.cloneTemplate).mockRejectedValue(new Error("Clone refused"));
  await loadDetail();
  fireEvent.click(screen.getByRole("button", { name: "CLONE" }));
  fireEvent.click(screen.getByRole("button", { name: "SUBMIT" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Template clone failed", {
      description: "Clone refused",
    }),
  );
  expect(api.cloneTemplate).toHaveBeenCalledWith(template.id, {
    name: template.name + " (Clone)",
    team_id: undefined,
  });
});

it("reports a non-Error submission archive failure without discarding the row", async () => {
  vi.mocked(submissions.archiveSubmission).mockRejectedValue(null);
  await loadDetail();
  fireEvent.click(screen.getByRole("button", { name: "Archive submission" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Submission archive failed", {
      description: "Try again.",
    }),
  );
  expect(
    screen.getByRole("link", { name: submission.submitters[0].name! }),
  ).toBeTruthy();
});

it("redirects an expired session when a successful mutation triggers a protected reload", async () => {
  vi.mocked(submissions.archiveSubmission).mockResolvedValue({
    id: submission.id,
    archived_at: "2026-01-01",
  });
  await loadDetail();
  vi.mocked(api.getTemplate).mockRejectedValue(new ApiError("Expired", 401));
  fireEvent.click(screen.getByRole("button", { name: "Archive submission" }));
  await waitFor(() => expect(state.push).toHaveBeenCalledWith("/auth/login"));
  expect(toast.error).not.toHaveBeenCalled();
});

it.each(["link", "testing"] as const)(
  "reports both provider error types for %s sharing",
  async (kind) => {
    vi.mocked(api.updateTemplate).mockRejectedValue(false);
    vi.mocked(api.updateTemplateTestingSharing).mockRejectedValue(
      new Error("Testing refused"),
    );
    await loadDetail();
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.mouseDown(
      screen.getByRole("tab", { name: "API and Embedding" }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(screen.getAllByRole("switch")[kind === "link" ? 0 : 1]);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        kind === "link"
          ? "Shared link update failed"
          : "Test mode sharing update failed",
        { description: kind === "link" ? "Try again." : "Testing refused" },
      ),
    );
  },
);
