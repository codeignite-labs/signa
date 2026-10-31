import "./browser-settings-fixture";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import * as auth from "../../../apps/frontend/lib/api/auth";
import * as teams from "../../../apps/frontend/lib/api/teams";
import { ApiError } from "../../../apps/frontend/lib/api/http";
import { TeamsSettingsBody } from "../../../apps/frontend/app/settings/_components/teams-settings-body";
import { user, team, member } from "./settings-fixtures";
const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  params: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => navigation.params,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(
  "../../../apps/frontend/app/settings/_components/settings-sidebar",
  () => ({ SettingsSidebar: () => null }),
);
vi.mock("../../../apps/frontend/lib/api/auth", () => ({ updateUser: vi.fn() }));
vi.mock("../../../apps/frontend/lib/api/teams", () => ({
  listTeams: vi.fn(),
  listTeamMembers: vi.fn(),
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  archiveTeam: vi.fn(),
  addTeamMember: vi.fn(),
  updateTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  navigation.params = new URLSearchParams();
  vi.mocked(teams.listTeams).mockResolvedValue([team]);
  vi.mocked(teams.listTeamMembers).mockResolvedValue([member]);
  vi.mocked(teams.createTeam).mockResolvedValue({
    ...team,
    id: "new-team",
    name: "Legal",
  });
  vi.mocked(teams.updateTeam).mockResolvedValue({ ...team, name: "Updated" });
  vi.mocked(teams.archiveTeam).mockResolvedValue(team);
  vi.mocked(auth.updateUser).mockResolvedValue(user);
});
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function submit() {
  fireEvent.submit(
    screen.getByRole("button", { name: "SUBMIT" }).closest("form")!,
  );
}
async function renderTeams() {
  render(<TeamsSettingsBody />);
  await screen.findByText("Engineering");
}
async function renderMembers() {
  navigation.params = new URLSearchParams("team=" + team.id);
  render(<TeamsSettingsBody />);
  await screen.findByText(user.email);
}
it("shows loading then active teams with links to the members and archive views", async () => {
  render(<TeamsSettingsBody />);
  expect(screen.getByText("Loading…")).toBeTruthy();
  await screen.findByText("Engineering");
  expect(teams.listTeams).toHaveBeenCalledWith("active");
  expect(screen.getByRole("link", { name: "View" }).getAttribute("href")).toBe(
    "/settings/teams?team=team-1",
  );
  expect(
    screen.getByRole("link", { name: "View Archived" }).getAttribute("href"),
  ).toContain("archived");
  expect(screen.queryByRole("button", { name: "Impersonate" })).toBeNull();
});
it("shows larger team actions and empty archived state without removal actions", async () => {
  vi.mocked(teams.listTeams).mockResolvedValue([{ ...team, members_count: 2 }]);
  const view = render(<TeamsSettingsBody />);
  await screen.findByRole("button", { name: "Impersonate" });
  expect(screen.getByRole("button", { name: "API Key" })).toBeTruthy();
  view.unmount();
  navigation.params = new URLSearchParams("status=archived");
  vi.mocked(teams.listTeams).mockResolvedValue([]);
  render(<TeamsSettingsBody />);
  await screen.findByText("No archived teams.");
  expect(teams.listTeams).toHaveBeenLastCalledWith("archived");
  expect(screen.getByRole("link", { name: "View Active" })).toBeTruthy();
});
it.each([new Error("offline"), null, new ApiError("Unauthenticated", 401)])(
  "handles initial team load error %s",
  async (failure) => {
    vi.mocked(teams.listTeams).mockRejectedValue(failure);
    render(<TeamsSettingsBody />);
    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
    if (failure instanceof ApiError)
      expect(navigation.push).toHaveBeenCalledWith("/auth/login");
    else
      expect(toast.error).toHaveBeenCalledWith("Teams could not be loaded", {
        description:
          failure instanceof Error ? failure.message : "Please try again.",
      });
  },
);
it("creates and inserts a new team, passing an omitted blank description", async () => {
  await renderTeams();
  fireEvent.click(screen.getByRole("button", { name: "New Team" }));
  fill("Name", "Legal");
  submit();
  await screen.findByText("Legal");
  expect(teams.createTeam).toHaveBeenCalledWith({
    name: "Legal",
    description: undefined,
  });
  expect(toast.success).toHaveBeenCalledWith("Team created");
});
it("retains form data when team creation fails", async () => {
  vi.mocked(teams.createTeam).mockRejectedValue("failure");
  await renderTeams();
  fireEvent.click(screen.getByRole("button", { name: "New Team" }));
  fill("Name", "Legal");
  fill("Description", "Legal department");
  submit();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Team could not be saved", {
      description: "Please try again.",
    }),
  );
  expect(teams.createTeam).toHaveBeenCalledWith({
    name: "Legal",
    description: "Legal department",
  });
  expect(screen.getByRole("dialog")).toBeTruthy();
});
it("disables an unchanged team update and sends only the changed fields", async () => {
  await renderTeams();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(
    screen.getByRole("button", { name: "SUBMIT" }).hasAttribute("disabled"),
  ).toBe(true);
  submit();
  expect(teams.updateTeam).not.toHaveBeenCalled();
  fill("Name", "Updated");
  submit();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Team updated"),
  );
  expect(teams.updateTeam).toHaveBeenCalledWith(team.id, { name: "Updated" });
  expect(screen.getByText("Updated")).toBeTruthy();
});
it("supports editing a team with a null description", async () => {
  vi.mocked(teams.listTeams).mockResolvedValue([
    { ...team, description: null },
  ]);
  await renderTeams();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect((screen.getByLabelText("Description") as HTMLInputElement).value).toBe(
    "",
  );
  fill("Description", "New description");
  submit();
  await waitFor(() =>
    expect(teams.updateTeam).toHaveBeenCalledWith(team.id, {
      description: "New description",
    }),
  );
});
it("removes a team from the list only after successful archive", async () => {
  await renderTeams();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await screen.findByText("No active teams.");
  expect(teams.archiveTeam).toHaveBeenCalledWith(team.id);
  expect(toast.success).toHaveBeenCalledWith("Team removed");
});
it("retains the team when archive fails", async () => {
  vi.mocked(teams.archiveTeam).mockRejectedValue(new Error("forbidden"));
  await renderTeams();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Team could not be removed", {
      description: "forbidden",
    }),
  );
  expect(screen.getByText(team.name)).toBeTruthy();
});
it("opens team members, supports going back, and removes the viewed team with navigation", async () => {
  await renderMembers();
  expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Back to Team Accounts" }),
  );
  expect(navigation.push).toHaveBeenCalledWith("/settings/teams");
  fireEvent.click(screen.getByRole("button", { name: "Remove Team" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Team removed"),
  );
  expect(navigation.push).toHaveBeenLastCalledWith("/settings/teams");
});
it("shows an empty member list and displays member lookup failures", async () => {
  navigation.params = new URLSearchParams("team=" + team.id);
  vi.mocked(teams.listTeamMembers).mockRejectedValue(
    new Error("member lookup failed"),
  );
  render(<TeamsSettingsBody />);
  await screen.findByText("No users in this team.");
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Team users could not be loaded", {
      description: "member lookup failed",
    }),
  );
});
it("falls back to member email when the identity has no name", async () => {
  vi.mocked(teams.listTeamMembers).mockResolvedValue([
    { ...member, user: { ...member.user, first_name: null, last_name: null } },
  ]);
  navigation.params = new URLSearchParams("team=" + team.id);
  render(<TeamsSettingsBody />);
  await waitFor(() => expect(screen.getAllByText(user.email)).toHaveLength(2));
});
it("updates a member profile with a minimal patch and refreshes both team and member data", async () => {
  await renderMembers();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(
    screen.getByRole("button", { name: "SUBMIT" }).hasAttribute("disabled"),
  ).toBe(true);
  submit();
  expect(auth.updateUser).not.toHaveBeenCalled();
  fill("First name", " Grace ");
  fill("Last name", "  ");
  fill("Email", "grace@example.test");
  submit();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("User updated"),
  );
  expect(auth.updateUser).toHaveBeenCalledWith(user.id, {
    first_name: "Grace",
    last_name: undefined,
    email: "grace@example.test",
  });
  expect(teams.listTeams).toHaveBeenCalledTimes(2);
  expect(teams.listTeamMembers).toHaveBeenCalledTimes(2);
});
it("retains the member edit dialog after update failures", async () => {
  vi.mocked(auth.updateUser).mockRejectedValue(new Error("identity locked"));
  await renderMembers();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fill("First name", "Grace");
  submit();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("User could not be updated", {
      description: "identity locked",
    }),
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
});
it("cancels an open member dialog without changing their membership", async () => {
  await renderMembers();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(auth.updateUser).not.toHaveBeenCalled();
});
async function choose(label: string, option: string) {
  fireEvent.keyDown(screen.getByLabelText(label), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}
it("changes a member team role without changing their shared identity", async () => {
  await renderMembers();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await choose("Team role", "manager");
  submit();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("User updated"),
  );
  expect(auth.updateUser).not.toHaveBeenCalled();
  expect(teams.updateTeamMember).toHaveBeenCalledWith(team.id, member.id, {
    role: "manager",
  });
});
it("moves a user to another team and applies a changed account role", async () => {
  const other = { ...team, id: "team-2", name: "Legal" };
  vi.mocked(teams.listTeams).mockResolvedValue([team, other]);
  await renderMembers();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await choose("Team account", "Legal");
  await choose("Role", "Editor");
  submit();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("User updated"),
  );
  expect(auth.updateUser).toHaveBeenCalledWith(user.id, { role: "editor" });
  expect(teams.removeTeamMember).toHaveBeenCalledWith(team.id, member.id);
  expect(teams.addTeamMember).toHaveBeenCalledWith(other.id, {
    role: "member",
    user_id: user.id,
  });
});
it("refresh errors remain visible after a successful member update", async () => {
  await renderMembers();
  vi.mocked(teams.listTeams).mockRejectedValueOnce(
    new ApiError("Unauthorized", 401),
  );
  vi.mocked(teams.listTeamMembers).mockRejectedValueOnce("failure");
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fill("First name", "Grace");
  submit();
  await waitFor(() =>
    expect(navigation.push).toHaveBeenCalledWith("/auth/login"),
  );
  expect(toast.error).toHaveBeenCalledWith("Team users could not be loaded", {
    description: "Please try again.",
  });
});
it("shows archived teams without actions that would remove them again", async () => {
  navigation.params = new URLSearchParams("status=archived");
  vi.mocked(teams.listTeams).mockResolvedValue([
    { ...team, archived_at: "2026-01-01" },
  ]);
  await renderTeams();
  expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
});
it("preserves unrelated teams while updating one team row", async () => {
  vi.mocked(teams.listTeams).mockResolvedValue([
    team,
    { ...team, id: "another", name: "Operations" },
  ]);
  await renderTeams();
  fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
  fill("Name", "Updated");
  submit();
  await screen.findByText("Updated");
  expect(screen.getByText("Operations")).toBeTruthy();
});
it("edits a member whose shared identity has no optional names and clears a first name", async () => {
  vi.mocked(teams.listTeamMembers).mockResolvedValue([
    { ...member, user: { ...member.user, first_name: null, last_name: null } },
  ]);
  navigation.params = new URLSearchParams("team=" + team.id);
  render(<TeamsSettingsBody />);
  await screen.findAllByText(user.email);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe(
    "",
  );
  expect((screen.getByLabelText("Last name") as HTMLInputElement).value).toBe(
    "",
  );
  fill("First name", "Grace");
  submit();
  await waitFor(() =>
    expect(auth.updateUser).toHaveBeenCalledWith(user.id, {
      first_name: "Grace",
    }),
  );
});
it("omits a cleared first name in the shared identity patch", async () => {
  await renderMembers();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fill("First name", "  ");
  submit();
  await waitFor(() =>
    expect(auth.updateUser).toHaveBeenCalledWith(user.id, {
      first_name: undefined,
    }),
  );
});
it("redirects an expired session when member updates refresh the teams list", async () => {
  await renderMembers();
  vi.mocked(teams.listTeams).mockRejectedValue(new ApiError("Expired", 401));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fill("First name", "Grace");
  submit();
  await waitFor(() =>
    expect(navigation.push).toHaveBeenCalledWith("/auth/login"),
  );
});
it("ignores team list and member requests resolving after unmount", async () => {
  let resolveTeams!: (value: teams.Team[]) => void;
  let resolveMembers!: (value: teams.TeamMember[]) => void;
  vi.mocked(teams.listTeams).mockReturnValue(
    new Promise((resolve) => {
      resolveTeams = resolve;
    }),
  );
  const view = render(<TeamsSettingsBody />);
  view.unmount();
  resolveTeams([team]);
  await Promise.resolve();
  vi.mocked(teams.listTeams).mockResolvedValue([team]);
  vi.mocked(teams.listTeamMembers).mockReturnValue(
    new Promise((resolve) => {
      resolveMembers = resolve;
    }),
  );
  navigation.params = new URLSearchParams("team=" + team.id);
  const detail = render(<TeamsSettingsBody />);
  await screen.findAllByText(team.name);
  detail.unmount();
  resolveMembers([member]);
  await Promise.resolve();
  expect(toast.error).not.toHaveBeenCalled();
});
it("reports a failed team refresh without hiding the completed member update", async () => {
  await renderMembers();
  vi.mocked(teams.listTeams).mockRejectedValue(new Error("Teams unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fill("First name", "Grace");
  submit();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Teams could not be loaded", {
      description: "Teams unavailable",
    }),
  );
  expect(toast.success).toHaveBeenCalledWith("User updated");
});
