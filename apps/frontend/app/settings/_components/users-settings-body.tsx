"use client"

import type React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useId, useMemo, useState } from "react"
import { signaRoleLabels, signaRoles, type SignaRole } from "@repo/shared"
import {
  ArchiveIcon,
  EditIcon,
  RotateCcwIcon,
  UserPlusIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  type AuthUser,
  type CreateUserInput,
  archiveUser,
  createUser,
  getAuthSession,
  listUsers,
  updateUser,
  type UserStatus,
} from "@/lib/api/auth"
import { ApiError } from "@/lib/api/http"
import {
  addTeamMember,
  createTeamInvitation,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  type Team,
  type TeamMember,
  type TeamRole,
  updateTeamMember,
} from "@/lib/api/teams"
import { getChangedFields } from "@/lib/object-diff"
import { SettingsSidebar } from "./settings-sidebar"
import { UsersImportDialog } from "./users-import-dialog"

type UserFormState = {
  email: string
  firstName: string
  lastName: string
  password: string
  role: SignaRole
  teamId: string
  teamRole: TeamRole
}

const emptyUserForm: UserFormState = {
  email: "",
  firstName: "",
  lastName: "",
  password: "",
  role: "member",
  teamId: "",
  teamRole: "member",
}

export function UsersSettingsBody() {
  return (
    <div className="flex w-full flex-wrap gap-6 md:flex-nowrap md:gap-8">
      <SettingsSidebar active="Users" />
      <UsersPanel />
    </div>
  )
}

function UsersPanel() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const status = getStatus(searchParams.get("status"))
  const [users, setUsers] = useState<AuthUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<AuthUser | null>(null)
  const [form, setForm] = useState<UserFormState>(emptyUserForm)
  const [initialForm, setInitialForm] = useState<UserFormState>(emptyUserForm)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [teamMembersByTeamId, setTeamMembersByTeamId] = useState<
    Record<string, TeamMember[]>
  >({})
  const [teams, setTeams] = useState<Team[]>([])
  const currentUserId = useMemo(() => getAuthSession()?.user.id ?? null, [])

  const loadUsers = useCallback(async () => {
    setIsLoading(true)

    await Promise.all([listUsers(status), loadTeamsWithMembers()])
      .then(([loadedUsers, teamState]) => {
        setUsers(loadedUsers)
        setTeams(teamState.teams)
        setTeamMembersByTeamId(teamState.membersByTeamId)
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          router.push("/auth/login")
          return
        }

        toast.error("Users could not be loaded", {
          description: getErrorMessage(error),
          classNames: { icon: "text-destructive" },
        })
      })
      .finally(() => setIsLoading(false))
  }, [router, status])

  useEffect(() => {
    void Promise.resolve().then(loadUsers)
  }, [loadUsers])

  function openCreateDialog() {
    setEditingUser(null)
    const nextForm = {
      ...emptyUserForm,
      teamId: teams[0]?.id ?? "",
    }

    setForm(nextForm)
    setInitialForm(nextForm)
    setIsDialogOpen(true)
  }

  function openEditDialog(user: AuthUser) {
    const primaryMember = getPrimaryTeamMember(teamMembersByTeamId, teams, user.id)

    setEditingUser(user)
    const nextForm = {
      email: user.email,
      firstName: user.first_name ?? "",
      lastName: user.last_name ?? "",
      password: "",
      role: user.role,
      teamId: primaryMember?.team_id ?? teams[0]?.id ?? "",
      teamRole: primaryMember?.role ?? "member",
    }

    setForm(nextForm)
    setInitialForm(nextForm)
    setIsDialogOpen(true)
  }

  async function submitUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const userPatch = getUserPatch(form, initialForm, Boolean(editingUser))
    const hasTeamChanges =
      form.teamId !== initialForm.teamId || form.teamRole !== initialForm.teamRole

    if (editingUser && Object.keys(userPatch).length === 0 && !hasTeamChanges) {
      return
    }

    setIsSubmitting(true)

    try {
      const savedUser = editingUser
        ? Object.keys(userPatch).length
          ? await updateUser(editingUser.id, userPatch)
          : editingUser
        : await createUser(getCreateUserInput(form))

      if (!editingUser || hasTeamChanges) {
        if (savedUser.membership_status === "invited" && form.teamId) {
          await createTeamInvitation(form.teamId, {
            email: savedUser.email,
            role: form.teamRole,
          })
        } else if (savedUser.membership_status !== "invited") {
          await syncUserTeam(savedUser)
        }
      }
      setUsers((current) => upsertUser(current, savedUser))
      setIsDialogOpen(false)
      await loadUsers()
      toast.success(savedUser.membership_status === "invited" ? "Invitation sent" : editingUser ? "User updated" : "User added")
    } catch (error) {
      toast.error(editingUser ? "User update failed" : "User invite failed", {
        description: getErrorMessage(error),
        classNames: { icon: "text-destructive" },
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const userPatch = getUserPatch(form, initialForm, Boolean(editingUser))
  const hasUserChanges =
    Object.keys(userPatch).length > 0 ||
    form.teamId !== initialForm.teamId ||
    form.teamRole !== initialForm.teamRole

  async function syncUserTeam(user: AuthUser) {
    if (!form.teamId) {
      return
    }

    try {
      await Promise.all(
        teams.map(async (team) => {
          const member = teamMembersByTeamId[team.id]?.find(
            (item) => item.user_id === user.id
          )

          if (team.id === form.teamId) {
            if (member) {
              await updateTeamMember(team.id, member.id, {
                role: form.teamRole,
              })
            } else {
              await addTeamMember(team.id, {
                role: form.teamRole,
                user_id: user.id,
              })
            }

            return
          }

          if (member) {
            await removeTeamMember(team.id, member.id)
          }
        })
      )
    } catch (error) {
      toast.error("Team account could not be updated", {
        description: getErrorMessage(error),
        classNames: { icon: "text-destructive" },
      })
      throw error
    }
  }

  async function removeUser(user: AuthUser) {
    try {
      const archivedUser = await archiveUser(user.id)

      setUsers((current) =>
        current.filter((currentUser) => currentUser.id !== archivedUser.id)
      )
      toast.success("User archived")
    } catch (error) {
      toast.error("User could not be archived", {
        description: getErrorMessage(error),
        classNames: { icon: "text-destructive" },
      })
    }
  }

  async function restoreUser(user: AuthUser) {
    try {
      const restoredUser = await createUser({
        email: user.email,
        first_name: user.first_name ?? "",
        last_name: user.last_name ?? "",
        role: user.role,
      })

      setUsers((current) =>
        current.filter((currentUser) => currentUser.id !== restoredUser.id)
      )
      toast.success("User restored")
    } catch (error) {
      toast.error("User could not be restored", {
        description: getErrorMessage(error),
        classNames: { icon: "text-destructive" },
      })
    }
  }

  return (
    <section className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl font-bold tracking-normal">
          {status === "archived" ? "Archived Users" : "Users"}
        </h1>
        <div className="flex flex-wrap justify-end gap-2">
          <UsersImportDialog onImported={loadUsers} />
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button
                className="h-12 rounded-full bg-[var(--auth-muted)] px-6 text-sm font-bold text-[var(--auth-primary)] hover:bg-[color-mix(in_srgb,var(--auth-muted),var(--auth-primary)_8%)]"
                onClick={openCreateDialog}
                type="button"
                variant="ghost"
              >
                <UserPlusIcon data-icon="inline-start" />
                New User
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl rounded-3xl border-[var(--auth-input-border)] bg-[var(--auth-background)] text-[var(--auth-foreground)]">
              <DialogHeader>
                <DialogTitle className="text-3xl font-semibold tracking-normal">
                  {editingUser ? "Edit User" : "New User"}
                </DialogTitle>
              </DialogHeader>
              <form className="flex flex-col gap-6" onSubmit={submitUser}>
                <UserForm
                  form={form}
                  isEditing={Boolean(editingUser)}
                  sharedIdentity={Boolean(editingUser?.shared_identity)}
                  teams={teams}
                  onChange={setForm}
                />
                <Button
                  className="h-14 rounded-full bg-[var(--auth-primary)] text-base font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
                  disabled={isSubmitting || (Boolean(editingUser) && !hasUserChanges)}
                  type="submit"
                >
                  {isSubmitting ? "SUBMITTING…" : "SUBMIT"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <StatusLink href="/settings/users" isActive={status === "active"}>
          Active
        </StatusLink>
        <StatusLink
          href="/settings/users?status=archived"
          isActive={status === "archived"}
        >
          Archived
        </StatusLink>
      </div>

      <div className="mt-5 overflow-x-auto rounded-2xl">
        <div className="grid min-w-[920px] grid-cols-[1.1fr_1.35fr_1fr_0.7fr_0.85fr_1fr] rounded-t-2xl bg-[var(--auth-muted)] px-6 py-4 text-xs font-bold uppercase tracking-normal text-[var(--auth-primary)]">
          <span>Name</span>
          <span>Email</span>
          <span>Teams</span>
          <span>Role</span>
          <span>Last Session</span>
          <span className="text-right">Actions</span>
        </div>
        {isLoading ? (
          <p className="border-b border-border px-6 py-6 text-sm text-muted-foreground">
            Loading…
          </p>
        ) : users.length === 0 ? (
          <p className="border-b border-border px-6 py-6 text-sm text-muted-foreground">
            No {status} users.
          </p>
        ) : (
          users.map((user) => (
            <div
              className="grid min-h-14 min-w-[920px] grid-cols-[1.1fr_1.35fr_1fr_0.7fr_0.85fr_1fr] items-center gap-3 border-b border-border px-6 py-3"
              key={user.id}
            >
              <span>{getUserName(user)}</span>
              <span className="truncate text-sm text-muted-foreground">
                {user.email}
              </span>
              <TeamChips
                teamMembersByTeamId={teamMembersByTeamId}
                teams={teams}
                userId={user.id}
              />
              <span>
                <span className="rounded-full border border-sky-400 px-2.5 py-0.5 text-sm capitalize text-sky-500">
                  {user.role}
                </span>
              </span>
              <span className="text-sm capitalize text-muted-foreground">{user.membership_status ?? "Active"}</span>
              <div className="flex justify-end gap-2">
                {status === "archived" ? (
                  <Button
                    className="h-8 rounded-full border-[var(--auth-primary)] px-4 text-xs font-bold"
                    onClick={() => restoreUser(user)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <RotateCcwIcon data-icon="inline-start" />
                    Restore
                  </Button>
                ) : (
                  <>
                    <Button
                      className="h-8 rounded-full border-[var(--auth-primary)] px-4 text-xs font-bold"
                      onClick={() => openEditDialog(user)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <EditIcon data-icon="inline-start" />
                      Edit
                    </Button>
                    <Button
                      className="h-8 rounded-full border-[var(--auth-primary)] px-4 text-xs font-bold"
                      disabled={user.id === currentUserId}
                      onClick={() => removeUser(user)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <ArchiveIcon data-icon="inline-start" />
                      Archive
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

function getUserPatch(
  form: UserFormState,
  initialForm: UserFormState,
  isEditing: boolean,
): Partial<CreateUserInput> {
  const changes = getChangedFields(form, initialForm)
  const patch: Partial<CreateUserInput> = {}

  if (!isEditing || changes.email !== undefined) {
    patch.email = form.email
  }

  if (!isEditing || changes.firstName !== undefined) {
    patch.first_name = form.firstName.trim() || undefined
  }

  if (!isEditing || changes.lastName !== undefined) {
    patch.last_name = form.lastName.trim() || undefined
  }

  if (!isEditing || changes.password !== undefined) {
    patch.password = form.password.trim() || undefined
  }

  if (!isEditing || changes.role !== undefined) {
    patch.role = form.role
  }

  return patch
}

function getCreateUserInput(form: UserFormState): CreateUserInput {
  return {
    email: form.email,
    first_name: form.firstName.trim() || undefined,
    last_name: form.lastName.trim() || undefined,
    password: form.password.trim() || undefined,
    role: form.role,
  }
}

function UserForm({
  form,
  isEditing,
  sharedIdentity,
  teams,
  onChange,
}: {
  form: UserFormState
  isEditing: boolean
  sharedIdentity: boolean
  teams: Team[]
  onChange: (form: UserFormState) => void
}) {
  return (
    <>
      <div className="grid gap-5 md:grid-cols-2">
        <FieldInput
          disabled={sharedIdentity}
          label="First name"
          onChange={(firstName) => onChange({ ...form, firstName })}
          value={form.firstName}
        />
        <FieldInput
          disabled={sharedIdentity}
          label="Last name"
          onChange={(lastName) => onChange({ ...form, lastName })}
          value={form.lastName}
        />
      </div>
      <FieldInput
        disabled={sharedIdentity}
        label="Email"
        onChange={(email) => onChange({ ...form, email })}
        required
        type="email"
        value={form.email}
      />
      {!isEditing ? (
        <FieldInput
          label="Password (optional; leave blank to email an invitation)"
          onChange={(password) => onChange({ ...form, password })}
          type="password"
          value={form.password}
        />
      ) : null}
      <SelectField
        label="Role"
        onValueChange={(role) => onChange({ ...form, role: role as SignaRole })}
        value={form.role}
      >
        {signaRoles.map((role) => (
          <SelectItem key={role} value={role}>
            {signaRoleLabels[role]}
          </SelectItem>
        ))}
      </SelectField>
      <RoleHelp />
      {teams.length ? (
        <>
          <SelectField
            label="Team account"
            onValueChange={(teamId) => onChange({ ...form, teamId })}
            value={form.teamId}
          >
            {teams.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
              </SelectItem>
            ))}
          </SelectField>
          <SelectField
            label="Team role"
            onValueChange={(teamRole) =>
              onChange({ ...form, teamRole: teamRole as TeamRole })
            }
            value={form.teamRole}
          >
            <SelectItem value="manager">Manager</SelectItem>
            <SelectItem value="member">Member</SelectItem>
            <SelectItem value="viewer">Viewer</SelectItem>
          </SelectField>
        </>
      ) : null}
    </>
  )
}

function RoleHelp() {
  return (
    <div className="-mt-2 rounded-2xl bg-[var(--auth-muted)] px-5 py-4 text-sm text-[var(--auth-foreground)]">
      Roles are enabled in Signa. Admins manage all account settings, editors
      manage documents, members work with assigned documents, agents can send
      requests from templates, and viewers have read-only access.
    </div>
  )
}

function SelectField({
  children,
  label,
  onValueChange,
  value,
}: {
  children: React.ReactNode
  label: string
  onValueChange: (value: string) => void
  value: string
}) {
  const id = useId()

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select onValueChange={onValueChange} value={value}>
        <SelectTrigger
          className="!h-14 min-h-14 w-full rounded-full px-6 py-0 text-lg"
          id={id}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  )
}

function TeamChips({
  teamMembersByTeamId,
  teams,
  userId,
}: {
  teamMembersByTeamId: Record<string, TeamMember[]>
  teams: Team[]
  userId: string
}) {
  const userTeams = teams.filter((team) =>
    hasTeamMember(teamMembersByTeamId[team.id], userId)
  )

  if (userTeams.length === 0) {
    return <span className="text-sm text-muted-foreground">None</span>
  }

  return (
    <div className="flex flex-wrap gap-1">
      {userTeams.slice(0, 2).map((team) => (
        <span
          className="rounded-full bg-[var(--auth-muted)] px-2 py-1 text-xs font-bold"
          key={team.id}
        >
          {team.name}
        </span>
      ))}
      {userTeams.length > 2 ? (
        <span className="rounded-full bg-[var(--auth-muted)] px-2 py-1 text-xs font-bold">
          +{userTeams.length - 2}
        </span>
      ) : null}
    </div>
  )
}

function FieldInput({
  label,
  onChange,
  type = "text",
  value,
  required = false,
  disabled = false,
}: {
  label: string
  onChange: (value: string) => void
  required?: boolean
  disabled?: boolean
  type?: string
  value: string
}) {
  const id = useId()

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        autoComplete={type === "email" ? "email" : "off"}
        className="h-14 rounded-full px-6 text-lg"
        id={id}
        name={id}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled}
        type={type}
        value={value}
      />
    </div>
  )
}

function StatusLink({
  children,
  href,
  isActive,
}: {
  children: React.ReactNode
  href: string
  isActive: boolean
}) {
  return (
    <Link
      className={
        isActive
          ? "rounded-full bg-[var(--auth-primary)] px-4 py-2 text-sm font-bold text-[var(--auth-primary-foreground)]"
          : "rounded-full border border-border px-4 py-2 text-sm font-bold hover:bg-[var(--auth-muted)]"
      }
      href={href}
    >
      {children}
    </Link>
  )
}

function getStatus(status: string | null): UserStatus {
  return status === "archived" ? "archived" : "active"
}

function getUserName(user: AuthUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ")
  return name || user.email
}

function upsertUser(users: AuthUser[], user: AuthUser): AuthUser[] {
  const existingIndex = users.findIndex((currentUser) => currentUser.id === user.id)

  if (existingIndex === -1) {
    return [user, ...users]
  }

  return users.map((currentUser) =>
    currentUser.id === user.id ? user : currentUser
  )
}

async function loadTeamsWithMembers(): Promise<{
  membersByTeamId: Record<string, TeamMember[]>
  teams: Team[]
}> {
  const teams = await listTeams("active")
  const membersEntries = await Promise.all(
    teams.map(async (team) => [team.id, await listTeamMembers(team.id)] as const)
  )

  return {
    membersByTeamId: Object.fromEntries(membersEntries),
    teams,
  }
}

function hasTeamMember(
  members: TeamMember[] | undefined,
  userId: string
): boolean {
  return members?.some((member) => member.user_id === userId) ?? false
}

function getPrimaryTeamMember(
  membersByTeamId: Record<string, TeamMember[]>,
  teams: Team[],
  userId: string
): TeamMember | null {
  for (const team of teams) {
    const member = membersByTeamId[team.id]?.find(
      (item) => item.user_id === userId
    )

    if (member) {
      return member
    }
  }

  return null
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Please try again."
}
