import "../settings/browser-settings-fixture";
import { beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NuqsTestingAdapter } from "../../../apps/frontend/node_modules/nuqs/dist/adapters/testing.js";
import TemplatesPage from "../../../apps/frontend/app/templates/page";
import * as api from "../../../apps/frontend/lib/api/templates";
import * as submissions from "../../../apps/frontend/lib/api/submissions";
import { listTeams } from "../../../apps/frontend/lib/api/teams";
import { pickGoogleDriveDocuments } from "../../../apps/frontend/lib/google-drive/picker";
import { appDictionaries } from "../../../apps/frontend/lib/i18n/app-dictionaries";
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  urlUpdated: vi.fn(),
  realtime: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks }));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    info: vi.fn(),
    custom: vi.fn(),
  },
}));
vi.mock(
  "../../../apps/frontend/app/templates/_components/console-header",
  () => ({ ConsoleHeader: () => null }),
);
vi.mock("../../../apps/frontend/lib/i18n/use-app-i18n", async () => {
  const { appDictionaries } =
    await import("../../../apps/frontend/lib/i18n/app-dictionaries");
  return { useAppI18n: () => ({ dictionary: appDictionaries.en }) };
});
vi.mock("../../../apps/frontend/lib/realtime/use-realtime-events", () => ({
  useRealtimeEvents: mocks.realtime,
}));
vi.mock("../../../apps/frontend/lib/api/templates", () => ({
  getTemplate: vi.fn(),
  getTemplateEvents: vi.fn(),
  updateTemplatePreferences: vi.fn(),
  updateTemplateTestingSharing: vi.fn(),
  listTemplates: vi.fn(),
  listTemplateFolders: vi.fn(),
  archiveTemplate: vi.fn(),
  addTemplateGoogleDriveDocuments: vi.fn(),
  cloneTemplate: vi.fn(),
  createTemplate: vi.fn(),
  createTemplateFolder: vi.fn(),
  createTemplateFromDocument: vi.fn(),
  deleteTemplateFolder: vi.fn(),
  deleteTemplatePermanently: vi.fn(),
  updateTemplateFolder: vi.fn(),
  updateTemplate: vi.fn(),
}));
vi.mock("../../../apps/frontend/lib/api/submissions", () => ({
  createSubmission: vi.fn(),
  createTemplateSubmission: vi.fn(),
  downloadTemplateSubmissionsExport: vi.fn(),
  archiveSubmission: vi.fn(),
  listSubmissions: vi.fn(),
}));
vi.mock("../../../apps/frontend/lib/api/teams", () => ({ listTeams: vi.fn() }));
vi.mock("../../../apps/frontend/lib/google-drive/picker", () => ({
  pickGoogleDriveDocuments: vi.fn(),
}));
export const state = mocks;
export const text = appDictionaries.en.templates;
export const template: api.TemplateResponse = {
  id: "template-1",
  name: "Example Agreement",
  slug: "example",
  archived_at: null,
  fields: [],
  preferences: {},
  schema: [],
  source: "pdf",
  submitters: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  author_id: "author-1",
  external_id: null,
  folder_id: "folder-1",
  shared_link: true,
  shared_with_test_mode: false,
  application_key: null,
  folder_name: "Default",
  variables_schema: null,
  author: {
    id: "author-1",
    email: "author@example.test",
    first_name: "Ada",
    last_name: "Lovelace",
  },
  documents: [],
};
export const folder: api.TemplateFolderResponse = {
  id: "folder-2",
  name: "Legal",
  full_name: "Legal",
  parent_folder_id: null,
  templates_count: 2,
  subfolders_count: 1,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};
export const submission: submissions.SubmissionResponse = {
  id: "submission-1",
  name: "Example Request",
  slug: "submission-slug",
  source: "api",
  submitters_order: "preserved",
  expire_at: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  archived_at: null,
  status: "pending",
  completed_at: null,
  audit_log_url: null,
  combined_document_url: null,
  variables: {},
  submitters: [
    {
      id: "signer-1",
      submission_id: "submission-1",
      uuid: "uuid",
      email: "signer@example.test",
      slug: "signer",
      name: "Grace",
      role: "First Party",
      status: "sent",
    },
  ],
  template: {
    id: template.id,
    name: template.name,
    external_id: null,
    folder_name: "Default",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
  created_by_user: null,
};
export function templatesResponse(data: api.TemplateResponse[]) {
  return { data, pagination: { count: data.length, next: null, prev: null } };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listTemplates).mockResolvedValue(templatesResponse([template]));
  vi.mocked(api.listTemplateFolders).mockResolvedValue([]);
  vi.mocked(listTeams).mockResolvedValue([]);
  vi.mocked(submissions.listSubmissions).mockResolvedValue({
    data: [submission],
    pagination: { count: 1, next: null, prev: null },
  });
  vi.mocked(api.createTemplate).mockResolvedValue({
    ...template,
    id: "new-template",
  });
  vi.mocked(api.createTemplateFromDocument).mockResolvedValue({
    ...template,
    id: "uploaded-template",
  });
  vi.mocked(api.createTemplateFolder).mockResolvedValue(folder);
  vi.mocked(api.updateTemplateFolder).mockResolvedValue({
    ...folder,
    name: "Renamed",
    full_name: "Renamed",
  });
  vi.mocked(api.cloneTemplate).mockResolvedValue({
    ...template,
    id: "cloned-template",
    name: "Cloned Agreement",
  });
  vi.mocked(api.updateTemplate).mockResolvedValue({
    id: template.id,
    updated_at: "2026-01-02",
  });
  vi.mocked(api.archiveTemplate).mockResolvedValue({
    id: template.id,
    archived_at: "2026-01-02",
  });
  vi.mocked(api.deleteTemplatePermanently).mockResolvedValue({
    id: template.id,
    archived_at: null,
  });
  vi.mocked(api.deleteTemplateFolder).mockResolvedValue(null);
  vi.mocked(pickGoogleDriveDocuments).mockResolvedValue({
    accessToken: "drive-token",
    files: [{ id: "drive-1", name: "Drive agreement" }],
  });
});
export function renderDashboard(searchParams = "") {
  return render(
    <NuqsTestingAdapter
      resetUrlUpdateQueueOnMount={false}
      searchParams={searchParams}
      hasMemory
      onUrlUpdate={state.urlUpdated}
    >
      <TemplatesPage />
    </NuqsTestingAdapter>,
  );
}
export async function loadDashboard(searchParams = "") {
  renderDashboard(searchParams);
  await screen.findByRole("heading", { name: template.name });
}
