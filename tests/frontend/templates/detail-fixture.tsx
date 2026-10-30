import { template, submission } from "./dashboard-fixture";
import { beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TemplateDetailPage } from "../../../apps/frontend/app/templates/[id]/template-detail-page";
import * as api from "../../../apps/frontend/lib/api/templates";
import * as submissions from "../../../apps/frontend/lib/api/submissions";
import { getAuthSession } from "../../../apps/frontend/lib/api/auth";
import { user } from "../settings/settings-fixtures";
vi.mock("../../../apps/frontend/lib/api/auth", () => ({
  getAuthSession: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(api.getTemplate).mockResolvedValue({
    ...template,
    submitters: [{ uuid: "first", name: "First Party" }],
  });
  vi.mocked(api.getTemplateEvents).mockResolvedValue({ data: [] });
  vi.mocked(api.updateTemplatePreferences).mockResolvedValue({
    id: template.id,
    updated_at: "2026-01-02",
  });
  vi.mocked(api.updateTemplateTestingSharing).mockImplementation(
    async (_id, value) => ({ ...template, shared_with_test_mode: value }),
  );
  vi.mocked(submissions.createSubmission).mockResolvedValue(
    submission.submitters,
  );
  vi.mocked(submissions.createTemplateSubmission).mockResolvedValue(
    submission.submitters,
  );
  vi.mocked(submissions.downloadTemplateSubmissionsExport).mockResolvedValue({
    blob: new Blob(["export"]),
    filename: "submissions.csv",
  });
  vi.mocked(getAuthSession).mockReturnValue({
    access_token: "token",
    user,
    account: { id: "account", name: "Org", locale: "en-US", timezone: "UTC" },
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
export function renderDetail() {
  return render(<TemplateDetailPage templateId={template.id} />);
}
export async function loadDetail() {
  renderDetail();
  await screen.findByRole("heading", { name: template.name });
}
