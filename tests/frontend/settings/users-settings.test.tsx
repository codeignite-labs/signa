import "./browser-settings-fixture";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import * as auth from "../../../apps/frontend/lib/api/auth";
import * as teams from "../../../apps/frontend/lib/api/teams";
import { ApiError } from "../../../apps/frontend/lib/api/http";
import { UsersSettingsBody } from "../../../apps/frontend/app/settings/_components/users-settings-body";
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
vi.mock("../../../apps/frontend/lib/api/auth", () => ({
  getAuthSession: vi.fn(),
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  archiveUser: vi.fn(),
  importUsers: vi.fn(),
}));
vi.mock("../../../apps/frontend/lib/api/teams", () => ({
  listTeams: vi.fn(),
  listTeamMembers: vi.fn(),
  addTeamMember: vi.fn(),
  updateTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  createTeamInvitation: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  navigation.params = new URLSearchParams();
  vi.mocked(auth.getAuthSession).mockReturnValue(null);
  vi.mocked(auth.listUsers).mockResolvedValue([user]);
  vi.mocked(teams.listTeams).mockResolvedValue([]);
  vi.mocked(teams.listTeamMembers).mockResolvedValue([]);
  vi.mocked(auth.createUser).mockResolvedValue({ ...user, id: "new-user" });
  vi.mocked(auth.updateUser).mockResolvedValue({
    ...user,
    first_name: "Augusta",
  });
  vi.mocked(auth.archiveUser).mockResolvedValue(user);
});
async function renderUsers() {
  render(<UsersSettingsBody />);
  await screen.findAllByText(user.email);
}
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
async function openCreate() {
  await renderUsers();
  fireEvent.click(screen.getByRole("button", { name: "New User" }));
}
function submit() {
  fireEvent.submit(
    screen.getByRole("button", { name: "SUBMIT" }).closest("form")!,
  );
}
it("loads active users and displays loading, identity, role, and empty team states", async () => {
  render(<UsersSettingsBody />);
  expect(screen.getByText("Loading…")).toBeTruthy();
  await screen.findByText("Ada Lovelace");
  expect(auth.listUsers).toHaveBeenCalledWith("active");
  expect(screen.getByText("None")).toBeTruthy();
  expect(screen.getByText("Active", { selector: "span" })).toBeTruthy();
});
it("displays empty archived users and normalizes unknown status values", async () => {
  navigation.params = new URLSearchParams("status=archived");
  vi.mocked(auth.listUsers).mockResolvedValue([]);
  const view = render(<UsersSettingsBody />);
  await screen.findByText("No archived users.");
  expect(screen.getByRole("heading", { name: "Archived Users" })).toBeTruthy();
  expect(auth.listUsers).toHaveBeenCalledWith("archived");
  view.unmount();
  navigation.params = new URLSearchParams("status=unknown");
  render(<UsersSettingsBody />);
  await screen.findByText("No active users.");
  expect(auth.listUsers).toHaveBeenLastCalledWith("active");
});
it.each([new Error("offline"), "failure", new ApiError("Unauthorized", 401)])(
  "handles user loading failure %s",
  async (failure) => {
    vi.mocked(auth.listUsers).mockRejectedValue(failure);
    render(<UsersSettingsBody />);
    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
    if (failure instanceof ApiError)
      expect(navigation.push).toHaveBeenCalledWith("/auth/login");
    else
      expect(toast.error).toHaveBeenCalledWith(
        "Users could not be loaded",
        expect.objectContaining({
          description:
            failure instanceof Error ? failure.message : "Please try again.",
        }),
      );
  },
);
it("creates a user with trimmed optional fields and no team when none exists", async () => {
  await openCreate();
  fill("First name", "  Grace  ");
  fill("Last name", "  Hopper  ");
  fill("Email", "grace@example.test");
  fill(
    "Password (optional; leave blank to email an invitation)",
    "  password  ",
  );
  submit();
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("User added"));
  expect(auth.createUser).toHaveBeenCalledWith({
    email: "grace@example.test",
    first_name: "Grace",
    last_name: "Hopper",
    password: "password",
    role: "member",
  });
  expect(teams.addTeamMember).not.toHaveBeenCalled();
});
it("adds a newly created active user to the default team", async () => {
  vi.mocked(teams.listTeams).mockResolvedValue([team]);
  await openCreate();
  fill("Email", "new@example.test");
  submit();
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("User added"));
  expect(teams.addTeamMember).toHaveBeenCalledWith(team.id, {
    role: "member",
    user_id: "new-user",
  });
});
it("invites an existing identity to the selected team without altering active memberships", async () => {
  vi.mocked(teams.listTeams).mockResolvedValue([team]);
  vi.mocked(auth.createUser).mockResolvedValue({
    ...user,
    membership_status: "invited",
  });
  await openCreate();
  fill("Email", user.email);
  submit();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Invitation sent"),
  );
  expect(teams.createTeamInvitation).toHaveBeenCalledWith(team.id, {
    email: user.email,
    role: "member",
  });
  expect(teams.addTeamMember).not.toHaveBeenCalled();
});
it.each([new Error("duplicate email"), null])(
  "keeps the invite dialog open on failure %s",
  async (failure) => {
    vi.mocked(auth.createUser).mockRejectedValue(failure);
    await openCreate();
    fill("Email", user.email);
    submit();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "User invite failed",
        expect.objectContaining({
          description:
            failure instanceof Error ? failure.message : "Please try again.",
        }),
      ),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "SUBMIT" }).hasAttribute("disabled"),
    ).toBe(false);
  },
);
it("disables editing submit until changed and sends only changed profile fields", async () => {
  await renderUsers();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(
    screen.getByRole("button", { name: "SUBMIT" }).hasAttribute("disabled"),
  ).toBe(true);
  submit();
  expect(auth.updateUser).not.toHaveBeenCalled();
  fill("First name", " Augusta ");
  fill("Last name", "  ");
  fill("Email", "augusta@example.test");
  submit();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("User updated"),
  );
  expect(auth.updateUser).toHaveBeenCalledWith(user.id, {
    first_name: "Augusta",
    last_name: undefined,
    email: "augusta@example.test",
  });
});
it("renders a shared identity as read-only and prevents archiving the current login", async () => {
  vi.mocked(auth.getAuthSession).mockReturnValue({
    access_token: "token",
    user,
    account: { id: "1", name: "Org", timezone: "UTC", locale: "en-US" },
  });
  vi.mocked(auth.listUsers).mockResolvedValue([
    { ...user, shared_identity: true, first_name: null, last_name: null },
  ]);
  await renderUsers();
  expect(
    screen.getByRole("button", { name: "Archive" }).hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  for (const label of ["First name", "Last name", "Email"])
    expect(screen.getByLabelText(label).hasAttribute("disabled")).toBe(true);
});
it("reports an update failure and retains entered values", async () => {
  vi.mocked(auth.updateUser).mockRejectedValue(new Error("forbidden"));
  await renderUsers();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fill("First name", "Changed");
  submit();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "User update failed",
      expect.objectContaining({ description: "forbidden" }),
    ),
  );
  expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe(
    "Changed",
  );
});
it("shows at most two team chips and counts the remaining memberships", async () => {
  vi.mocked(teams.listTeams).mockResolvedValue([
    team,
    { ...team, id: "2", name: "Legal" },
    { ...team, id: "3", name: "Support" },
  ]);
  vi.mocked(teams.listTeamMembers).mockImplementation(async (id) => [
    { ...member, team_id: id },
  ]);
  await renderUsers();
  expect(screen.getByText("Engineering")).toBeTruthy();
  expect(screen.getByText("Legal")).toBeTruthy();
  expect(screen.getByText("+1")).toBeTruthy();
  expect(screen.queryByText("Support")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText("Team account").textContent).toContain(
    "Engineering",
  );
});
it("archives another user and removes the row without a full refresh", async () => {
  await renderUsers();
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  await screen.findByText("No active users.");
  expect(auth.archiveUser).toHaveBeenCalledWith(user.id);
  expect(toast.success).toHaveBeenCalledWith("User archived");
});
it("reports archive failures without removing the user", async () => {
  vi.mocked(auth.archiveUser).mockRejectedValue("failure");
  await renderUsers();
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "User could not be archived",
      expect.objectContaining({ description: "Please try again." }),
    ),
  );
  expect(screen.getByText(user.email)).toBeTruthy();
});
it("restores an archived user using their saved account role", async () => {
  navigation.params = new URLSearchParams("status=archived");
  vi.mocked(auth.createUser).mockResolvedValue(user);
  await renderUsers();
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  await screen.findByText("No archived users.");
  expect(auth.createUser).toHaveBeenCalledWith({
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
  });
  expect(toast.success).toHaveBeenCalledWith("User restored");
});
it("preserves archived entries when restoration fails", async () => {
  navigation.params = new URLSearchParams("status=archived");
  vi.mocked(auth.createUser).mockRejectedValue(new Error("blocked"));
  await renderUsers();
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "User could not be restored",
      expect.objectContaining({ description: "blocked" }),
    ),
  );
  expect(screen.getByText(user.email)).toBeTruthy();
});
async function choose(label: string, option: string) {
  fireEvent.keyDown(screen.getByLabelText(label), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}
it("changes an existing member team role without patching their identity", async () => {
  vi.mocked(teams.listTeams).mockResolvedValue([team]);
  vi.mocked(teams.listTeamMembers).mockResolvedValue([member]);
  await renderUsers();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await choose("Team role", "Manager");
  submit();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("User updated"),
  );
  expect(auth.updateUser).not.toHaveBeenCalled();
  expect(teams.updateTeamMember).toHaveBeenCalledWith(team.id, member.id, {
    role: "manager",
  });
});
it("moves a member to a different team, removing their prior team membership", async () => {
  const other = { ...team, id: "team-2", name: "Legal" };
  vi.mocked(teams.listTeams).mockResolvedValue([team, other]);
  vi.mocked(teams.listTeamMembers).mockImplementation(async (id) =>
    id === team.id ? [member] : [],
  );
  await renderUsers();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await choose("Team account", "Legal");
  await choose("Role", "Viewer");
  submit();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("User updated"),
  );
  expect(auth.updateUser).toHaveBeenCalledWith(user.id, { role: "viewer" });
  expect(teams.removeTeamMember).toHaveBeenCalledWith(team.id, member.id);
  expect(teams.addTeamMember).toHaveBeenCalledWith(other.id, {
    user_id: user.id,
    role: "member",
  });
});
it("surfaces team update failure and keeps the user dialog available for retry", async () => {
  vi.mocked(teams.listTeams).mockResolvedValue([team]);
  vi.mocked(teams.listTeamMembers).mockResolvedValue([member]);
  vi.mocked(teams.updateTeamMember).mockRejectedValue(new Error("Team denied"));
  await renderUsers();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await choose("Team role", "Viewer");
  submit();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Team account could not be updated",
      expect.objectContaining({ description: "Team denied" }),
    ),
  );
  expect(toast.error).toHaveBeenCalledWith(
    "User update failed",
    expect.objectContaining({ description: "Team denied" }),
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
});
it("invites an identity without a team when the organization has no teams", async () => {
  vi.mocked(auth.createUser).mockResolvedValue({
    ...user,
    membership_status: "invited",
  });
  await openCreate();
  fill("Email", user.email);
  submit();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Invitation sent"),
  );
  expect(teams.createTeamInvitation).not.toHaveBeenCalled();
  expect(teams.addTeamMember).not.toHaveBeenCalled();
});
it("restores an archived shared identity with missing optional names", async () => {
  navigation.params = new URLSearchParams("status=archived");
  vi.mocked(auth.listUsers).mockResolvedValue([
    { ...user, first_name: null, last_name: null },
  ]);
  await renderUsers();
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  await waitFor(() =>
    expect(auth.createUser).toHaveBeenCalledWith({
      email: user.email,
      first_name: "",
      last_name: "",
      role: user.role,
    }),
  );
});
it("updates one user without replacing other account members", async () => {
  vi.mocked(auth.listUsers).mockResolvedValue([
    user,
    {
      ...user,
      id: "another",
      email: "another@example.test",
      first_name: "Other",
    },
  ]);
  await renderUsers();
  fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
  fill("First name", "Augusta");
  submit();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("User updated"),
  );
  expect(auth.updateUser).toHaveBeenCalledWith(user.id, {
    first_name: "Augusta",
  });
  expect(screen.getByText("another@example.test")).toBeTruthy();
});
