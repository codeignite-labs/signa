import "./browser-settings-fixture";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Dialog } from "../../../apps/frontend/components/ui/dialog";
import {
  TeamsHeader,
  TeamForm,
  TeamList,
  TeamDetails,
} from "../../../apps/frontend/app/settings/_components/team-settings-sections";
import { team, user, member } from "./settings-fixtures";
it("opens team creation and submits name and description fields", () => {
  const change = vi.fn(),
    submit = vi.fn((event) => event.preventDefault()),
    open = vi.fn();
  render(
    <TeamsHeader
      isDialogOpen
      onDialogOpenChange={open}
      onOpenCreateDialog={open}
    >
      <TeamForm
        form={{ name: "", description: "" }}
        mode="create"
        isSaving={false}
        onChange={change}
        onSubmit={submit}
      />
    </TeamsHeader>,
  );
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Legal" },
  });
  expect(change).toHaveBeenCalledWith({ name: "Legal", description: "" });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Legal work" },
  });
  expect(change).toHaveBeenCalledWith({ name: "", description: "Legal work" });
  fireEvent.submit(
    screen.getByRole("button", { name: "SAVE" }).closest("form")!,
  );
  expect(submit).toHaveBeenCalledTimes(1);
});
it("marks editing team forms busy and opens a closed creation dialog", () => {
  const open = vi.fn();
  const view = render(
    <TeamsHeader
      isDialogOpen={false}
      onDialogOpenChange={open}
      onOpenCreateDialog={open}
    >
      Content
    </TeamsHeader>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create Team" }));
  expect(open).toHaveBeenCalled();
  view.rerender(
    <Dialog open>
      <TeamForm
        form={{ name: "Legal", description: "" }}
        mode="edit"
        isSaving
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    </Dialog>,
  );
  expect(screen.getByRole("heading", { name: "Edit Team" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "SAVING…" }).hasAttribute("disabled"),
  ).toBe(true);
});
it("lists singular and plural teams and members, including archived teams, and selects a row", () => {
  const select = vi.fn();
  const view = render(
    <TeamList
      teams={[team]}
      selectedTeamId={team.id}
      status="active"
      onSelectTeam={select}
    />,
  );
  expect(screen.getByText("1 team")).toBeTruthy();
  expect(screen.getByText("1 member")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Engineering/ }));
  expect(select).toHaveBeenCalledWith(team.id);
  view.rerender(
    <TeamList
      teams={[
        team,
        {
          ...team,
          id: "archived",
          name: "Archived team",
          members_count: 3,
          archived_at: "2026-01-01",
        },
      ]}
      selectedTeamId={null}
      status="archived"
      onSelectTeam={select}
    />,
  );
  expect(screen.getByText("2 teams")).toBeTruthy();
  expect(screen.getByText("3 members")).toBeTruthy();
  view.rerender(
    <TeamList
      teams={[]}
      selectedTeamId={null}
      status="archived"
      onSelectTeam={select}
    />,
  );
  expect(screen.getByText("No archived teams.")).toBeTruthy();
});
it("shows team details and delegates edit, archive, membership role and removal actions", async () => {
  const edit = vi.fn(),
    archive = vi.fn(),
    role = vi.fn(),
    remove = vi.fn(),
    add = vi.fn();
  render(
    <TeamDetails
      activeUsers={[
        user,
        {
          ...user,
          id: "available",
          first_name: null,
          last_name: null,
          email: "available@example.test",
        },
      ]}
      members={[member]}
      team={team}
      onAddMember={add}
      onArchiveTeam={archive}
      onChangeMemberRole={role}
      onOpenEditDialog={edit}
      onRemoveMember={remove}
    />,
  );
  expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(edit).toHaveBeenCalledWith(team);
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  expect(archive).toHaveBeenCalledWith(team);
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(remove).toHaveBeenCalledWith(member);
  fireEvent.keyDown(screen.getAllByRole("combobox")[1], { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "viewer" }));
  expect(role).toHaveBeenCalledWith(member, "viewer");
  fireEvent.keyDown(screen.getAllByRole("combobox")[0], { key: "ArrowDown" });
  expect(screen.queryByRole("option", { name: "Ada Lovelace" })).toBeNull();
  fireEvent.click(
    await screen.findByRole("option", { name: "available@example.test" }),
  );
  expect(add).toHaveBeenCalledWith("available");
});
it("supports archived details, missing descriptions, empty members and fallback member names", () => {
  const callbacks = {
    onAddMember: vi.fn(),
    onArchiveTeam: vi.fn(),
    onChangeMemberRole: vi.fn(),
    onOpenEditDialog: vi.fn(),
    onRemoveMember: vi.fn(),
  };
  const view = render(
    <TeamDetails
      activeUsers={[]}
      members={[]}
      team={{ ...team, archived_at: "2026-01-01", description: null }}
      {...callbacks}
    />,
  );
  expect(screen.getByText("No description yet.")).toBeTruthy();
  expect(screen.getByText("No members assigned yet.")).toBeTruthy();
  view.rerender(
    <TeamDetails
      activeUsers={[]}
      members={[
        {
          ...member,
          user: { ...member.user, first_name: null, last_name: null },
        },
        { ...member, id: "second" },
      ]}
      team={team}
      {...callbacks}
    />,
  );
  expect(screen.getByText("2 members")).toBeTruthy();
  expect(screen.getAllByText(user.email)).toHaveLength(3);
});
