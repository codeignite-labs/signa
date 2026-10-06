import { AccountMembershipsService } from '../account-memberships/account-memberships.service';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';
import { TeamInvitation } from './entities/team-invitation.entity';
import { TeamMember } from './entities/team-member.entity';
import { Team } from './entities/team.entity';
import { TeamsService } from './teams.service';

type MockRepository<T extends object> = {
  create: jest.Mock<T, [Partial<T>]>;
  existsBy: jest.Mock<Promise<boolean>, [Record<string, unknown>]>;
  find: jest.Mock<Promise<T[]>, [Record<string, unknown>]>;
  findOne: jest.Mock<Promise<T | null>, [Record<string, unknown>]>;
  findOneBy: jest.Mock<Promise<T | null>, [Record<string, unknown>]>;
  save: jest.Mock<Promise<T>, [Partial<T>]>;
};

function createRepository<T extends object>(): jest.Mocked<MockRepository<T>> {
  return {
    create: jest.fn((input) => input as T),
    existsBy: jest.fn((where: Record<string, unknown>) => {
      void where;
      return Promise.resolve(false);
    }),
    find: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn((input) => Promise.resolve(input as T)),
  };
}

describe('TeamsService', () => {
  let service: TeamsService;
  let invitations: jest.Mocked<MockRepository<TeamInvitation>>;
  let mail: { sendTeamInvitation: jest.Mock<Promise<unknown>, [unknown]> };
  let teamMembers: jest.Mocked<MockRepository<TeamMember>>;
  let teams: jest.Mocked<MockRepository<Team>>;

  beforeEach(async () => {
    teams = createRepository<Team>();
    teamMembers = createRepository<TeamMember>();
    invitations = createRepository<TeamInvitation>();
    mail = {
      sendTeamInvitation: jest.fn((input: unknown) => {
        void input;

        return Promise.resolve({});
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: AccountMembershipsService, useValue: {
          resolveUser: jest.fn().mockResolvedValue({ id: 'user-1', accountId: 'account-1', role: 'admin' }),
          listMembers: jest.fn().mockResolvedValue([]),
          changeMember: jest.fn().mockResolvedValue(null),
          invite: jest.fn(),
        } },
        TeamsService,
        { provide: getRepositoryToken(Team), useValue: teams },
        { provide: getRepositoryToken(TeamMember), useValue: teamMembers },
        { provide: getRepositoryToken(TeamInvitation), useValue: invitations },
        { provide: getRepositoryToken(User), useValue: {} },
        { provide: MailService, useValue: mail },
      ],
    }).compile();

    service = module.get<TeamsService>(TeamsService);
  });

  it('creates a default team with the registering user as manager', async () => {
    teams.save.mockResolvedValue({
      id: 'team-1',
      name: 'Acme',
      slug: 'acme',
    } as Team);

    await service.createDefaultTeam({
      accountId: 'account-1',
      name: 'Acme',
      userId: 'user-1',
    });

    expect(teams.create).toHaveBeenCalledWith({
      accountId: 'account-1',
      createdByUserId: 'user-1',
      name: 'Acme',
      slug: 'acme',
    });
    expect(teamMembers.create).toHaveBeenCalledWith({
      accountId: 'account-1',
      role: 'manager',
      teamId: 'team-1',
      userId: 'user-1',
    });
  });

  it('lists active account teams by default', async () => {
    teams.find.mockResolvedValue([]);

    await service.listTeams({ accountId: 'account-1' });

    expect(teams.find).toHaveBeenCalledWith({
      where: { accountId: 'account-1', archivedAt: IsNull() },
      relations: { members: true },
      order: { id: 'DESC' },
    });
  });

  it('emails the raw accept token when creating a team invitation', async () => {
    teams.findOne.mockImplementation(() =>
      Promise.resolve({
        id: 'team-1',
        name: 'Legal',
      } as Team),
    );
    teamMembers.findOneBy.mockImplementation(() =>
      Promise.resolve({
        id: 'member-1',
        role: 'manager',
      } as TeamMember),
    );
    invitations.save.mockImplementation((input) =>
      Promise.resolve({
        ...input,
        id: 'invitation-1',
      } as TeamInvitation),
    );

    const response = await service.createInvitation({
      accountId: 'account-1',
      actor: {
        account: { name: 'Acme' },
        accountId: 'account-1',
        email: 'admin@example.com',
        firstName: 'Ada',
        id: 'user-1',
        lastName: 'Lovelace',
        role: 'admin',
      } as User,
      input: { email: 'teammate@example.com', role: 'viewer' },
      teamId: 'team-1',
    });

    expect(response.accept_token).toEqual(expect.any(String));
    expect(response.accept_token).not.toHaveLength(0);
    expect(mail.sendTeamInvitation).toHaveBeenCalledTimes(1);
    const [mailInput] = mail.sendTeamInvitation.mock.calls[0] ?? [];
    expect(mailInput).toMatchObject({
      accountId: 'account-1',
      accountName: 'Acme',
      email: 'teammate@example.com',
      inviterName: 'Ada Lovelace',
      role: 'viewer',
      teamName: 'Legal',
      token: response.accept_token,
    });
    expect(mailInput).toHaveProperty('expiresAt');
    expect((mailInput as { expiresAt?: unknown }).expiresAt).toBeInstanceOf(
      Date,
    );
  });
});
