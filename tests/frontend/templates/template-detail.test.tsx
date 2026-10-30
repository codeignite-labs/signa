import { renderDetail, loadDetail } from "./detail-fixture";
import { template, submission, state } from "./dashboard-fixture";
import { expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { toast } from "sonner";
import * as api from "../../../apps/frontend/lib/api/templates";
import * as submissions from "../../../apps/frontend/lib/api/submissions";
import { getAuthSession } from "../../../apps/frontend/lib/api/auth";
import { ApiError } from "../../../apps/frontend/lib/api/http";
import { listTeams } from "../../../apps/frontend/lib/api/teams";
import { team } from "../settings/settings-fixtures";
it("loads template detail, submissions and event history together and provides document actions", async () => {
  renderDetail();
  expect(screen.getByText("Loading template")).toBeTruthy();
  await screen.findByRole("heading", { name: template.name });
  expect(api.getTemplate).toHaveBeenCalledWith(template.id);
  expect(submissions.listSubmissions).toHaveBeenCalledWith({
    include: "fields",
    limit: 100,
    template_id: template.id,
  });
  expect(api.getTemplateEvents).toHaveBeenCalledWith(template.id);
  expect(screen.getByRole("link", { name: "EDIT" }).getAttribute("href")).toBe(
    "/templates/template-1/edit",
  );
});
it.each([
  new ApiError("Unauthorized", 401),
  new Error("Template offline"),
  null,
])("handles initial detail load failure %s", async (failure) => {
  vi.mocked(api.getTemplate).mockRejectedValue(failure);
  renderDetail();
  await screen.findByText("Template not found.");
  if (failure instanceof ApiError)
    expect(state.push).toHaveBeenCalledWith("/auth/login");
  else
    expect(toast.error).toHaveBeenCalledWith("Template could not be loaded", {
      description:
        failure instanceof Error ? failure.message : "Open the templates page.",
    });
});
it("copies a public template link and archives a template through the API", async () => {
  await loadDetail();
  fireEvent.click(screen.getByRole("button", { name: "LINK" }));
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      window.location.origin + "/d/example",
    ),
  );
  expect(toast.success).toHaveBeenCalledWith("Template link copied");
  fireEvent.click(screen.getByRole("button", { name: "ARCHIVE" }));
  await waitFor(() =>
    expect(state.push).toHaveBeenCalledWith("/templates?archived=true"),
  );
  expect(api.archiveTemplate).toHaveBeenCalledWith(template.id);
});
it.each([new Error("Archive denied"), false])(
  "reports template archive failure %s without navigating",
  async (failure) => {
    vi.mocked(api.archiveTemplate).mockRejectedValue(failure);
    await loadDetail();
    fireEvent.click(screen.getByRole("button", { name: "ARCHIVE" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Template archive failed", {
        description: failure instanceof Error ? failure.message : "Try again.",
      }),
    );
    expect(state.push).not.toHaveBeenCalled();
  },
);
it("clones a template with a chosen team and trimmed name and opens the result", async () => {
  vi.mocked(listTeams).mockResolvedValue([
    team,
    { ...team, id: "legal", name: "Legal" },
  ]);
  await loadDetail();
  fireEvent.click(screen.getByRole("button", { name: "CLONE" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), {
    target: { value: "  Cloned Agreement  " },
  });
  fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "Legal" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "SUBMIT" }));
  await waitFor(() =>
    expect(state.push).toHaveBeenCalledWith("/templates/cloned-template"),
  );
  expect(api.cloneTemplate).toHaveBeenCalledWith(template.id, {
    name: "Cloned Agreement",
    team_id: "legal",
  });
});
it("defaults clone identity when there are no teams and reports clone failure", async () => {
  vi.mocked(api.cloneTemplate).mockRejectedValue("failure");
  await loadDetail();
  fireEvent.click(screen.getByRole("button", { name: "CLONE" }));
  fireEvent.click(screen.getByRole("button", { name: "SUBMIT" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Template clone failed", {
      description: "Try again.",
    }),
  );
  expect(api.cloneTemplate).toHaveBeenCalledWith(template.id, {
    name: template.name + " (Clone)",
    team_id: undefined,
  });
});
it("archives a submission and refreshes template detail", async () => {
  await loadDetail();
  fireEvent.click(screen.getByRole("button", { name: "Archive submission" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Submission archived"),
  );
  expect(submissions.archiveSubmission).toHaveBeenCalledWith(submission.id);
  expect(api.getTemplate).toHaveBeenCalledTimes(2);
});
it("reports submission archive errors and current detail reload errors", async () => {
  vi.mocked(submissions.archiveSubmission).mockRejectedValue(
    new Error("Archive denied"),
  );
  await loadDetail();
  fireEvent.click(screen.getByRole("button", { name: "Archive submission" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Submission archive failed", {
      description: "Archive denied",
    }),
  );
  vi.mocked(submissions.archiveSubmission).mockResolvedValue({
    id: submission.id,
    archived_at: "2026-01-01",
  });
  vi.mocked(api.getTemplate).mockRejectedValue(new Error("Reload failed"));
  fireEvent.click(screen.getByRole("button", { name: "Archive submission" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Template could not be loaded", {
      description: "Reload failed",
    }),
  );
});
it("refreshes through realtime and redirects expired sessions without replacing visible detail on other errors", async () => {
  await loadDetail();
  const handler = state.realtime.mock.calls.at(-1)![0] as {
    onEvent: () => void;
  };
  vi.mocked(api.getTemplate).mockResolvedValueOnce({
    ...template,
    name: "Updated template",
  });
  act(() => handler.onEvent());
  await screen.findByRole("heading", { name: "Updated template" });
  vi.mocked(api.getTemplate).mockRejectedValueOnce(new Error("offline"));
  act(() => handler.onEvent());
  await waitFor(() => expect(api.getTemplate).toHaveBeenCalledTimes(3));
  expect(
    screen.getByRole("heading", { name: "Updated template" }),
  ).toBeTruthy();
  vi.mocked(api.getTemplate).mockRejectedValueOnce(
    new ApiError("Unauthorized", 401),
  );
  act(() => handler.onEvent());
  await waitFor(() => expect(state.push).toHaveBeenCalledWith("/auth/login"));
});
it("groups today, week, month and older activity with user and system actor details", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
  vi.mocked(api.getTemplateEvents).mockResolvedValue({
    data: [
      "2026-10-31T10:00:00Z",
      "2026-10-30T10:00:00Z",
      "2026-10-10T10:00:00Z",
      "2026-09-01T10:00:00Z",
    ].map((event_timestamp, index) => ({
      id: String(index),
      template_id: template.id,
      event_type: "template.fields.updated",
      summary: "Change " + index,
      event_timestamp,
      data:
        index === 0 ? { changed_paths: ["fields.name", 123, "schema"] } : {},
      user:
        index === 3
          ? null
          : {
              ...template.author,
              first_name: index === 2 ? null : template.author.first_name,
              last_name: index === 2 ? null : template.author.last_name,
            },
    })),
  });
  await loadDetail();
  fireEvent.click(screen.getByRole("button", { name: /Activity/ }));
  for (const label of [
    "Today",
    "This week",
    "This month",
    "Older",
    "System",
    template.author.email,
    "Changed fields.name, schema",
  ])
    expect(await screen.findByText(label)).toBeTruthy();
  vi.useRealTimers();
});
async function loadEmptyDetail() {
  vi.mocked(submissions.listSubmissions).mockResolvedValue({
    data: [],
    pagination: { count: 0, next: null, prev: null },
  });
  await loadDetail();
}
it("offers recipient invitations and self-signing when the template has no submissions", async () => {
  await loadEmptyDetail();
  fireEvent.click(screen.getByRole("button", { name: "SEND TO RECIPIENTS" }));
  expect(
    screen.getByRole("heading", { name: "Add New Recipients" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("creates a self-signing request and opens it in the previously created popup", async () => {
  const popup = { location: { href: "" }, focus: vi.fn(), close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  await loadEmptyDetail();
  fireEvent.click(screen.getByRole("button", { name: "SIGN IT YOURSELF" }));
  await waitFor(() => expect(popup.focus).toHaveBeenCalled());
  expect(popup.location.href).toBe("/s/signer");
  expect(submissions.createSubmission).toHaveBeenCalledWith(
    expect.objectContaining({
      submitters: [
        {
          email: "ada@example.test",
          name: "Ada Lovelace",
          role: "First Party",
        },
      ],
    }),
  );
});
it("uses in-page navigation when popups are blocked and falls back to the account email for the signer name", async () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  vi.mocked(getAuthSession).mockReturnValue({
    access_token: "token",
    user: {
      id: "user",
      email: "user@example.test",
      role: "member",
      first_name: null,
      last_name: null,
    },
    account: { id: "account", name: "Org", locale: "en-US", timezone: "UTC" },
  });
  await loadEmptyDetail();
  fireEvent.click(screen.getByRole("button", { name: "SIGN IT YOURSELF" }));
  await waitFor(() => expect(state.push).toHaveBeenCalledWith("/s/signer"));
  expect(submissions.createSubmission).toHaveBeenCalledWith(
    expect.objectContaining({
      submitters: [
        {
          email: "user@example.test",
          name: "user@example.test",
          role: "First Party",
        },
      ],
    }),
  );
});
it.each([[], null])(
  "closes an unused popup if self-sign creation fails or returns no signing link",
  async (response) => {
    const popup = { close: vi.fn(), location: { href: "" }, focus: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    if (response)
      vi.mocked(submissions.createSubmission).mockResolvedValue(response);
    else vi.mocked(submissions.createSubmission).mockRejectedValue("failure");
    await loadEmptyDetail();
    fireEvent.click(screen.getByRole("button", { name: "SIGN IT YOURSELF" }));
    await waitFor(() => expect(popup.close).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(
      "Self-signing form could not be opened",
      expect.objectContaining({
        description: response
          ? "The signing link was not returned by the API."
          : "The signing form could not be created.",
      }),
    );
  },
);
