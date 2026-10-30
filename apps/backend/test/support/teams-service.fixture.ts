import { attachRepositoryTransaction } from './repository-transaction.fixture';
import { Repository } from 'typeorm';
import { AccountMembershipsService } from '../../src/account-memberships/account-memberships.service';
import { MailService } from '../../src/mail/mail.service';
import { User } from '../../src/users/entities/user.entity';
import { Team } from '../../src/teams/entities/team.entity';
import { TeamMember } from '../../src/teams/entities/team-member.entity';
import { TeamInvitation } from '../../src/teams/entities/team-invitation.entity';
import { TeamsService } from '../../src/teams/teams.service';
import { authRepository } from './auth-service.fixture';
export function teamsFixture() {
  const user: User = Object.assign(new User(), {
    id: 'user',
    accountId: 'account',
    role: 'admin',
    email: 'casey@example.test',
    firstName: 'Casey',
    lastName: 'Example',
    account: { id: 'account', name: 'Example organization' },
  });
  const team: Team = Object.assign(new Team(), {
    id: 'team',
    accountId: 'account',
    name: 'Legal',
    slug: 'legal',
    description: null,
    archivedAt: null,
    members: [],
  });
  const member: TeamMember = Object.assign(new TeamMember(), {
    id: 'member',
    accountId: 'account',
    teamId: team.id,
    userId: user.id,
    role: 'manager',
    archivedAt: null,
    user,
  });
  const invitation: TeamInvitation = Object.assign(new TeamInvitation(), {
    id: 'invitation',
    accountId: 'account',
    teamId: team.id,
    email: 'invitee@example.test',
    role: 'viewer',
    status: 'pending',
    acceptedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  const teams = authRepository(Team);
  teams.findOne.mockResolvedValue(team);
  const members = authRepository(TeamMember);
  members.findOneBy.mockResolvedValue(member);
  const invitations = authRepository(TeamInvitation);
  invitations.findOneBy.mockResolvedValue(invitation);
  const users = authRepository(User);
  const mail = {
    sendTeamInvitation: jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({ status: 'sent' }),
  };
  const memberships = {
    resolveUser: jest
      .fn<Promise<User | null>, [string, string]>()
      .mockResolvedValue(user),
    acceptTeamInvitation: jest
      .fn<Promise<TeamMember>, [string, User]>()
      .mockResolvedValue(member),
  };
  attachRepositoryTransaction(
    new Map<unknown, object>([
      [Team, teams],
      [TeamMember, members],
    ]),
  );
  const service = new TeamsService(
    teams as unknown as Repository<Team>,
    members as unknown as Repository<TeamMember>,
    invitations as unknown as Repository<TeamInvitation>,
    users as unknown as Repository<User>,
    mail as unknown as MailService,
    memberships as unknown as AccountMembershipsService,
  );
  return {
    service,
    user,
    team,
    member,
    invitation,
    teams,
    members,
    invitations,
    users,
    mail,
    memberships,
  };
}
