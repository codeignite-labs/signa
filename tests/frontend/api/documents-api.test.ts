import { beforeEach, expect, it, vi } from "vitest";
import * as templates from "../../../apps/frontend/lib/api/templates";
import * as submissions from "../../../apps/frontend/lib/api/submissions";
import {
  clearAuthSession,
  saveAuthSession,
} from "../../../apps/frontend/lib/api/auth";
import {
  getAccountBranding,
  updateAccountBranding,
} from "../../../apps/frontend/lib/api/branding";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  saveAuthSession({
    access_token: "test-token",
    user: {
      id: "user",
      email: "user@example.test",
      role: "admin",
      first_name: null,
      last_name: null,
    },
    account: {
      id: "account",
      name: "Example",
      locale: "en-US",
      timezone: "UTC",
    },
  });
  fetchMock = vi.fn().mockImplementation(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
});
const requests: Array<
  [string, () => Promise<unknown>, string, string, unknown?]
> = [
  [
    "create template",
    () => templates.createTemplate({ name: "Agreement" }),
    "/templates",
    "POST",
    { name: "Agreement" },
  ],
  ["list templates", () => templates.listTemplates(), "/templates", "GET"],
  [
    "filter templates",
    () =>
      templates.listTemplates({
        q: "A & B",
        archived: false,
        limit: 0,
        folder: "",
        after: undefined,
      }),
    "/templates?q=A+%26+B&archived=false&limit=0",
    "GET",
  ],
  [
    "list folders",
    () => templates.listTemplateFolders(),
    "/templates/folders",
    "GET",
  ],
  [
    "search folders",
    () => templates.listTemplateFolders({ q: "A & B", parent: "" }),
    "/templates/folders?q=A+%26+B",
    "GET",
  ],
  [
    "template history",
    () => templates.getTemplateEvents("1"),
    "/templates/1/events",
    "GET",
  ],
  [
    "template versions",
    () => templates.getTemplateVersions("1"),
    "/templates/1/versions",
    "GET",
  ],
  [
    "create folder",
    () => templates.createTemplateFolder({ name: "Contracts" }),
    "/templates/folders",
    "POST",
    { name: "Contracts" },
  ],
  [
    "update folder",
    () => templates.updateTemplateFolder("1", { parent: "2" }),
    "/templates/folders/1",
    "PUT",
    { parent: "2" },
  ],
  [
    "delete folder only",
    () => templates.deleteTemplateFolder("1", "folder_only"),
    "/templates/folders/1?mode=folder_only",
    "DELETE",
  ],
  [
    "delete folder and contents",
    () => templates.deleteTemplateFolder("1", "with_contents"),
    "/templates/folders/1?mode=with_contents",
    "DELETE",
  ],
  ["get template", () => templates.getTemplate("1"), "/templates/1", "GET"],
  [
    "custom fields",
    () => templates.getAccountCustomFields(),
    "/account_custom_fields",
    "GET",
  ],
  [
    "save custom fields",
    () => templates.saveAccountCustomFields([{ name: "Address" }]),
    "/account_custom_fields",
    "POST",
    { value: [{ name: "Address" }] },
  ],
  [
    "rename template",
    () => templates.updateTemplate("1", { name: "Updated" }),
    "/templates/1",
    "PUT",
    { name: "Updated" },
  ],
  [
    "template preferences",
    () => templates.updateTemplatePreferences("1", { color: "red" }),
    "/templates/1",
    "PUT",
    { preferences: { color: "red" } },
  ],
  [
    "share testing template",
    () => templates.updateTemplateTestingSharing("1", false),
    "/templates/1/testing-sharing",
    "POST",
    { value: false },
  ],
  [
    "document URLs",
    () => templates.getTemplateDocumentDownloads("1"),
    "/templates/1/documents",
    "GET",
  ],
  [
    "clone template defaults",
    () => templates.cloneTemplate("1"),
    "/templates/1/clone",
    "POST",
    {},
  ],
  [
    "clone template named",
    () => templates.cloneTemplate("1", { name: "Copy" }),
    "/templates/1/clone",
    "POST",
    { name: "Copy" },
  ],
  [
    "drive files",
    () =>
      templates.addTemplateGoogleDriveDocuments("1", {
        access_token: "drive-token",
        files: [{ id: "drive" }],
      }),
    "/templates/1/google-drive-documents",
    "PUT",
    { access_token: "drive-token", files: [{ id: "drive" }] },
  ],
  [
    "default blank page",
    () => templates.addBlankTemplatePage("1"),
    "/templates/1/documents",
    "PUT",
    {
      documents: [{ name: "Blank Page", size: "letter", type: "blank" }],
      merge: true,
    },
  ],
  [
    "custom blank page",
    () =>
      templates.addBlankTemplatePage("1", {
        name: "Annex",
        position: 0,
        size: "a4",
      }),
    "/templates/1/documents",
    "PUT",
    {
      documents: [{ name: "Annex", position: 0, size: "a4", type: "blank" }],
      merge: true,
    },
  ],
  [
    "archive template",
    () => templates.archiveTemplate("1"),
    "/templates/1",
    "DELETE",
  ],
  [
    "delete template",
    () => templates.deleteTemplatePermanently("1"),
    "/templates/1?permanently=true",
    "DELETE",
  ],
  [
    "create submission",
    () => submissions.createSubmission({ template_id: "1", submitters: [] }),
    "/submissions",
    "POST",
    { template_id: "1", submitters: [] },
  ],
  [
    "template submission",
    () => submissions.createTemplateSubmission("1", { submitters: [] }),
    "/templates/1/submissions",
    "POST",
    { submitters: [] },
  ],
  [
    "mail events",
    () => submissions.getSubmissionMailEvents("1"),
    "/submissions/1/mail-events",
    "GET",
  ],
  [
    "list submissions",
    () => submissions.listSubmissions(),
    "/submissions",
    "GET",
  ],
  [
    "filter submissions",
    () =>
      submissions.listSubmissions({
        q: "A & B",
        archived: false,
        limit: 0,
        include: "",
        status: undefined,
      }),
    "/submissions?q=A+%26+B&archived=false&limit=0",
    "GET",
  ],
  [
    "get submission fields",
    () => submissions.getSubmission("1"),
    "/submissions/1?include=fields",
    "GET",
  ],
  [
    "get without fields",
    () => submissions.getSubmission("1", ""),
    "/submissions/1",
    "GET",
  ],
  [
    "submission audit",
    () => submissions.getSubmissionEvents("1"),
    "/submissions/1/events",
    "GET",
  ],
  [
    "documents separate",
    () => submissions.getSubmissionDocuments("1"),
    "/submissions/1/documents",
    "GET",
  ],
  [
    "documents merged",
    () => submissions.getSubmissionDocuments("1", true),
    "/submissions/1/documents?merge=true",
    "GET",
  ],
  [
    "archive submission",
    () => submissions.archiveSubmission("1"),
    "/submissions/1",
    "DELETE",
  ],
  ["branding", () => getAccountBranding(), "/account/branding", "GET"],
  [
    "update branding",
    () =>
      updateAccountBranding({
        primary_color: "#123456",
        white_label: true,
        show_business_name: false,
      }),
    "/account/branding",
    "PATCH",
    { primary_color: "#123456", white_label: true, show_business_name: false },
  ],
];
it.each(requests)(
  "%s sends the expected tenant-authenticated request",
  async (_name, send, path, method, body) => {
    await send();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api" + path);
    expect(init.method ?? "GET").toBe(method);
    expect(init.headers.get("Authorization")).toBe("Bearer test-token");
    if (body !== undefined) expect(JSON.parse(init.body)).toEqual(body);
  },
);
it.each([
  ["agreement.PDF", "", undefined, "/templates/pdf"],
  ["agreement", "application/pdf", "Contracts", "/templates/pdf"],
  ["agreement.DOCX", "", undefined, "/templates/docx"],
  [
    "agreement",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Contracts",
    "/templates/docx",
  ],
])(
  "routes %s uploads by type or extension with multipart boundaries",
  async (name, type, folder, path) => {
    const file = new File(["content"], name, { type });
    await templates.createTemplateFromDocument(file, folder);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api" + path);
    expect(init.body.get("name")).toBe("agreement");
    expect(init.body.get("folder_name")).toBe(folder ?? null);
    expect(init.body.get("documents").name).toBe(name);
    expect(init.headers.has("Content-Type")).toBe(false);
  },
);
it("rejects unsupported template uploads without sending a request", async () => {
  await expect(
    templates.createTemplateFromDocument(new File(["text"], "file.txt")),
  ).rejects.toThrow("Only PDF and DOCX");
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["pdf", "docx"])(
  "adds a %s attachment with merge enabled",
  async (extension) => {
    await templates.addTemplateDocument(
      "1",
      new File(["document"], "file." + extension),
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/templates/1/documents");
    expect(init.method).toBe("PUT");
    expect(init.body.get("merge")).toBe("true");
    expect(init.body.get("documents").name).toBe("file." + extension);
  },
);
it("does not serve cached template details", async () => {
  await templates.getTemplate("1");
  expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
});
it("builds export queries without duplicate template ids or empty filter parameters", () => {
  expect(
    submissions.buildTemplateSubmissionsExportUrl({
      template_id: "1",
      format: "csv",
      q: "",
      archived: false,
      status: undefined,
    }),
  ).toBe("/templates/1/submissions/export?format=csv&archived=false");
});
it.each([
  ['attachment; filename="custom.csv"', "custom.csv"],
  [null, "submissions.csv"],
  ["attachment", "submissions.csv"],
])(
  "downloads exports with safe authentication and filename fallback for %s",
  async (disposition, filename) => {
    const response = new Response("a,b\n1,2", {
      headers: disposition ? { "Content-Disposition": disposition } : {},
    });
    fetchMock.mockResolvedValue(response);
    const result = await submissions.downloadTemplateSubmissionsExport({
      template_id: "1",
      format: "csv",
    });
    expect(result.filename).toBe(filename);
    expect(await result.blob.text()).toContain("a,b");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/templates/1/submissions/export?format=csv",
      { headers: { Authorization: "Bearer test-token" } },
    );
  },
);
it("rejects unauthorized and failed exports without returning a document", async () => {
  clearAuthSession();
  await expect(
    submissions.downloadTemplateSubmissionsExport({
      template_id: "1",
      format: "xlsx",
    }),
  ).rejects.toMatchObject({ status: 401 });
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["Unavailable", ""])(
  "preserves failed export status and a useful error message",
  async (statusText) => {
    fetchMock.mockResolvedValue(new Response("", { status: 503, statusText }));
    await expect(
      submissions.downloadTemplateSubmissionsExport({
        template_id: "1",
        format: "csv",
      }),
    ).rejects.toMatchObject({
      status: 503,
      message: statusText || "Export failed",
    });
  },
);
