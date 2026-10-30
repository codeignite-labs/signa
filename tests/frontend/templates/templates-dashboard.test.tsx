import {
  template,
  folder,
  submission,
  templatesResponse,
  text,
  state,
  renderDashboard,
  loadDashboard,
} from "./dashboard-fixture";
import * as api from "../../../apps/frontend/lib/api/templates";
import * as submissions from "../../../apps/frontend/lib/api/submissions";
import { expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { ApiError } from "../../../apps/frontend/lib/api/http";
it("loads templates with tenant list filters and renders author and editor links", async () => {
  await loadDashboard();
  expect(api.listTemplates).toHaveBeenCalledWith({
    archived: false,
    folder: undefined,
    limit: 100,
    q: undefined,
  });
  expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: text.actions.edit }).getAttribute("href"),
  ).toBe("/templates/template-1/edit");
  expect(
    screen
      .getByRole("link", { name: /Example Agreement/ })
      .getAttribute("href"),
  ).toBe("/templates/template-1");
});
it.each([new ApiError("Unauthorized", 401), new Error("offline"), false])(
  "handles dashboard loading error %s",
  async (failure) => {
    vi.mocked(api.listTemplates).mockRejectedValue(failure);
    renderDashboard();
    await waitFor(() => {
      if (failure instanceof ApiError && failure.status === 401)
        expect(state.push).toHaveBeenCalledWith("/auth/login");
      else
        expect(toast.error).toHaveBeenCalledWith(text.toasts.loadingFailed, {
          description:
            failure instanceof Error
              ? failure.message
              : `${text.toasts.loadingFailed}.`,
        });
    });
  },
);
it("filters folders and templates to the selected parent while searching includes descendant templates", async () => {
  vi.mocked(api.listTemplateFolders).mockResolvedValue([
    folder,
    {
      ...folder,
      id: "child",
      name: "Contracts",
      full_name: "Legal / Contracts",
    },
    {
      ...folder,
      id: "foreign",
      name: "Payroll",
      full_name: "Finance / Payroll",
    },
  ]);
  vi.mocked(api.listTemplates).mockResolvedValue(
    templatesResponse([
      { ...template, folder_name: "Legal" },
      {
        ...template,
        id: "nested",
        name: "Nested agreement",
        folder_name: "Legal / Contracts",
      },
      {
        ...template,
        id: "foreign",
        name: "Foreign agreement",
        folder_name: "Finance",
      },
    ]),
  );
  renderDashboard("folder=Legal&q=Agreement");
  await screen.findByRole("heading", { name: template.name });
  expect(
    screen.getByRole("heading", { name: "Nested agreement" }),
  ).toBeTruthy();
  expect(screen.queryByText("Foreign agreement")).toBeNull();
  expect(screen.queryByText("Payroll")).toBeNull();
  expect(screen.getByRole("button", { name: /Contracts/ })).toBeTruthy();
});
it("updates the search URL and reloads templates for the submitted search term", async () => {
  await loadDashboard();
  fireEvent.change(
    screen.getByRole("textbox", { name: text.search.templates }),
    { target: { value: "  Agreement  " } },
  );
  fireEvent.submit(
    screen
      .getByRole("textbox", { name: text.search.templates })
      .closest("form")!,
  );
  await waitFor(() =>
    expect(api.listTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "Agreement" }),
    ),
  );
  expect(state.urlUpdated).toHaveBeenCalledWith(
    expect.objectContaining({ searchParams: expect.any(URLSearchParams) }),
  );
});
it("changes dashboard views and archived state without mixing template and submission data", async () => {
  await loadDashboard();
  fireEvent.click(screen.getByRole("button", { name: "Submissions" }));
  await screen.findByText(submission.name!);
  expect(submissions.listSubmissions).toHaveBeenCalledWith({
    archived: false,
    limit: 100,
    q: undefined,
  });
  expect(screen.queryByRole("heading", { name: template.name })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: text.actions.archived }));
  await waitFor(() =>
    expect(submissions.listSubmissions).toHaveBeenLastCalledWith({
      archived: true,
      limit: 100,
      q: undefined,
    }),
  );
  expect(
    screen.getByRole("heading", { name: text.titles.archivedSubmissions }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Templates" }));
  await screen.findByRole("heading", { name: template.name });
  expect(api.listTemplates).toHaveBeenLastCalledWith(
    expect.objectContaining({ archived: false }),
  );
});
it.each([
  ["", text.empty.noTemplates],
  ["q=missing", text.empty.templatesNotFound],
  ["folder=Legal", text.empty.folderEmpty],
  ["archived=true", text.empty.archivedTemplates],
  ["view=submissions", text.empty.noSubmissions],
  ["view=submissions&q=missing", text.empty.submissionsNotFound],
  ["view=submissions&archived=true", text.empty.archivedSubmissions],
])("renders an actionable empty state for %s", async (query, message) => {
  vi.mocked(api.listTemplates).mockResolvedValue(templatesResponse([]));
  vi.mocked(submissions.listSubmissions).mockResolvedValue({
    data: [],
    pagination: { count: 0, next: null, prev: null },
  });
  renderDashboard(query);
  await screen.findAllByText(message);
});
it("uses the author email fallback when template author names are absent", async () => {
  vi.mocked(api.listTemplates).mockResolvedValue(
    templatesResponse([
      {
        ...template,
        author: { ...template.author, first_name: null, last_name: null },
      },
    ]),
  );
  await loadDashboard();
  expect(screen.getByText(template.author.email)).toBeTruthy();
});
it("silently refreshes templates after realtime events and ignores outdated success responses", async () => {
  let finish!: (value: ReturnType<typeof templatesResponse>) => void;
  vi.mocked(api.listTemplates).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  renderDashboard();
  const handler = state.realtime.mock.calls.at(-1)![0] as {
    onEvent: () => void;
  };
  act(() => handler.onEvent());
  await screen.findByRole("heading", { name: template.name });
  await act(async () =>
    finish(templatesResponse([{ ...template, name: "Stale result" }])),
  );
  expect(screen.queryByRole("heading", { name: "Stale result" })).toBeNull();
});
it("ignores errors from a superseded template list request", async () => {
  let fail!: (reason: unknown) => void;
  vi.mocked(api.listTemplates).mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  renderDashboard();
  const handler = state.realtime.mock.calls.at(-1)![0] as {
    onEvent: () => void;
  };
  act(() => handler.onEvent());
  await screen.findByRole("heading", { name: template.name });
  await act(async () => fail(new Error("Old error")));
  expect(toast.error).not.toHaveBeenCalled();
});
it("archives submissions and reloads the current view", async () => {
  renderDashboard("view=submissions");
  await screen.findByText(submission.name!);
  fireEvent.click(screen.getByRole("button", { name: text.actions.archive }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(text.toasts.submissionArchived, {
      description: submission.name,
    }),
  );
  expect(submissions.archiveSubmission).toHaveBeenCalledWith(submission.id);
});
it("reports failed submission archive operations", async () => {
  vi.mocked(submissions.archiveSubmission).mockRejectedValue(
    new Error("Archive denied"),
  );
  renderDashboard("view=submissions");
  await screen.findByText(submission.name!);
  fireEvent.click(screen.getByRole("button", { name: text.actions.archive }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      text.toasts.submissionArchiveFailed,
      { description: "Archive denied" },
    ),
  );
});
it("preserves a loaded list during a pending silent refresh and replaces it after success", async () => {
  await loadDashboard();
  let finish!: (value: ReturnType<typeof templatesResponse>) => void;
  vi.mocked(api.listTemplates).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const handler = state.realtime.mock.calls.at(-1)![0] as {
    onEvent: () => void;
  };
  act(() => handler.onEvent());
  expect(screen.getByRole("heading", { name: template.name })).toBeTruthy();
  await act(async () =>
    finish(templatesResponse([{ ...template, name: "Updated agreement" }])),
  );
  await screen.findByRole("heading", { name: "Updated agreement" });
});
it.each([
  ["completed", null, undefined, text.status.completed],
  ["declined", null, undefined, text.status.declined],
  ["expired", null, undefined, text.status.expired],
  ["pending", "2026-01-02", undefined, text.status.archived],
  ["pending", null, "2026-01-02", text.status.opened],
] as const)(
  "renders submission %s status and appropriate signing or download actions",
  async (status, archived_at, opened_at, label) => {
    vi.mocked(submissions.listSubmissions).mockResolvedValue({
      data: [
        {
          ...submission,
          status,
          archived_at,
          submitters: [{ ...submission.submitters[0], opened_at }],
        },
      ],
      pagination: { count: 1, next: null, prev: null },
    });
    renderDashboard("view=submissions");
    await screen.findByText(submission.name!);
    expect(screen.getByText(label)).toBeTruthy();
    if (status === "completed") {
      expect(
        screen.getByRole("link", { name: text.actions.download }),
      ).toBeTruthy();
      expect(
        screen.queryByRole("link", { name: text.actions.signNow }),
      ).toBeNull();
    }
    if (archived_at)
      expect(
        screen.queryByRole("button", { name: text.actions.archive }),
      ).toBeNull();
  },
);
it("uses missing submission identity fallbacks without exposing an unrelated template link", async () => {
  vi.mocked(submissions.listSubmissions).mockResolvedValue({
    data: [{ ...submission, name: null, template: null, submitters: [] }],
    pagination: { count: 1, next: null, prev: null },
  });
  renderDashboard("view=submissions");
  await screen.findByText("Submission " + submission.id);
  expect(screen.getByText("Unknown")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Recipient" }).getAttribute("href"),
  ).toBe("/submissions/" + submission.id);
});
it.each([
  [
    { ...submission.submitters[0], name: null },
    submission.submitters[0].email!,
  ],
  [
    {
      ...submission.submitters[0],
      name: null,
      email: null,
      phone: "+15551234567",
    },
    "+15551234567",
  ],
] as const)(
  "falls back to available signer contact details",
  async (submitter, label) => {
    vi.mocked(submissions.listSubmissions).mockResolvedValue({
      data: [
        {
          ...submission,
          name: null,
          submitters: [submitter],
          created_by_user: {
            ...template.author,
            first_name: null,
            last_name: null,
          },
        },
      ],
      pagination: { count: 1, next: null, prev: null },
    });
    renderDashboard("view=submissions");
    await screen.findByText(label);
    expect(screen.getByText(template.author.email)).toBeTruthy();
  },
);
it("shows archived template metadata and does not depend on teams loading successfully", async () => {
  vi.mocked(api.listTemplates).mockResolvedValue(
    templatesResponse([{ ...template, archived_at: "2026-01-02" }]),
  );
  const { listTeams } = await import("../../../apps/frontend/lib/api/teams");
  vi.mocked(listTeams).mockRejectedValueOnce(new Error("Teams unavailable"));
  await loadDashboard("archived=true");
  expect(screen.getByText("Archived", { selector: "span" })).toBeTruthy();
});
it("ignores a superseded submission-list response after a newer realtime request has completed", async () => {
  let finish!: (
    value: Awaited<ReturnType<typeof submissions.listSubmissions>>,
  ) => void;
  vi.mocked(submissions.listSubmissions).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  renderDashboard("view=submissions");
  const handler = state.realtime.mock.calls.at(-1)![0] as {
    onEvent: () => void;
  };
  act(() => handler.onEvent());
  await screen.findByText(submission.name!);
  await act(async () =>
    finish({
      data: [{ ...submission, name: "Stale request" }],
      pagination: { count: 1, next: null, prev: null },
    }),
  );
  expect(screen.queryByText("Stale request")).toBeNull();
});
