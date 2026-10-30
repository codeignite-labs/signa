import type { AuthUser } from "../../../apps/frontend/lib/api/auth";
import type { Team, TeamMember } from "../../../apps/frontend/lib/api/teams";
export const user: AuthUser = {
  id: "user-1",
  email: "ada@example.test",
  first_name: "Ada",
  last_name: "Lovelace",
  role: "member",
};
export const team: Team = {
  id: "team-1",
  uuid: "uuid-1",
  name: "Engineering",
  slug: "engineering",
  description: "Product engineering",
  members_count: 1,
  archived_at: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-02",
};
export const member: TeamMember = {
  id: "member-1",
  team_id: team.id,
  user_id: user.id,
  role: "member",
  archived_at: null,
  created_at: "2026-01-01",
  user: {
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    account_role: user.role,
  },
};
