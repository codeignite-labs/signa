import { TeamInvitationResponseDto } from './dto/team-invitation-response.dto';
import { TeamMemberResponseDto } from './dto/team-member-response.dto';
import { TeamResponseDto } from './dto/team-response.dto';
import { TeamInvitation } from './entities/team-invitation.entity';
import { TeamMember } from './entities/team-member.entity';
import { Team } from './entities/team.entity';

export function toTeamResponse(team: Team): TeamResponseDto {
  return {
    id: String(team.id),
    uuid: team.uuid,
    name: team.name,
    slug: team.slug,
    description: team.description,
    members_count:
      team.members?.filter((member) => !member.archivedAt).length ?? 0,
    archived_at: team.archivedAt,
    created_at: team.createdAt,
    updated_at: team.updatedAt,
  };
}

export function toMemberResponse(member: TeamMember): TeamMemberResponseDto {
  return {
    account_id: String(member.accountId),
    id: String(member.id),
    team_id: String(member.teamId),
    user_id: String(member.userId),
    role: member.role,
    user: {
      id: String(member.user.id),
      account_role: member.user.role,
      email: member.user.email,
      first_name: member.user.firstName,
      last_name: member.user.lastName,
    },
    archived_at: member.archivedAt,
    created_at: member.createdAt,
  };
}

export function toInvitationResponse(
  invitation: TeamInvitation,
  options?: { acceptToken?: string },
): TeamInvitationResponseDto {
  return {
    accept_token: options?.acceptToken,
    id: String(invitation.id),
    team_id: String(invitation.teamId),
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expires_at: invitation.expiresAt,
    accepted_at: invitation.acceptedAt,
    created_at: invitation.createdAt,
  };
}
