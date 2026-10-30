import { DataSource, EntityManager, Repository } from 'typeorm';
import { AccountMembershipsService } from '../../src/account-memberships/account-memberships.service';
import { AccountMembership } from '../../src/account-memberships/entities/account-membership.entity';
import { Account } from '../../src/accounts/entities/account.entity';
import { MailService } from '../../src/mail/mail.service';
import { Team } from '../../src/teams/entities/team.entity';
import { TeamInvitation } from '../../src/teams/entities/team-invitation.entity';
import { TeamMember } from '../../src/teams/entities/team-member.entity';
import { User } from '../../src/users/entities/user.entity';
import { authRepository } from './auth-service.fixture';
export function membershipsFixture() {
  const original: Account = Object.assign(new Account(), {
    id: 'original',
    name: 'Original account',
    archivedAt: null,
  });
  const account: Account = Object.assign(new Account(), {
    id: 'secondary',
    name: 'Secondary account',
    archivedAt: null,
  });
  const user: User = Object.assign(new User(), {
    id: 'user',
    accountId: original.id,
    account: original,
    email: 'casey@example.test',
    firstName: 'Casey',
    role: 'admin',
    archivedAt: null,
  });
  const membership: AccountMembership = Object.assign(new AccountMembership(), {
    id: 'membership',
    accountId: account.id,
    account,
    userId: user.id,
    user,
    role: 'viewer',
    acceptedAt: new Date(),
    archivedAt: null,
    expiresAt: null,
  });
  const team: Team = Object.assign(new Team(), {
    id: 'team',
    accountId: account.id,
    archivedAt: null,
  });
  const invitation: TeamInvitation = Object.assign(new TeamInvitation(), {
    id: 'invitation',
    accountId: account.id,
    teamId: team.id,
    email: user.email,
    role: 'manager',
    status: 'pending',
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  const rows = new Map<unknown, object | null>([
    [User, user],
    [Account, account],
    [AccountMembership, membership],
    [Team, team],
    [TeamInvitation, invitation],
    [TeamMember, null],
  ]);
  const collections = new Map<unknown, object[]>([
    [User, []],
    [AccountMembership, [membership]],
  ]);
  const members = authRepository(AccountMembership);
  members.findOneBy.mockResolvedValue(null);
  const manager = {
    connection: { options: { type: 'postgres' } },
    getRepository: (target: unknown) => ({
      findOne: () => Promise.resolve(rows.get(target) ?? null),
    }),
    findOne: jest.fn<Promise<unknown>, [unknown, unknown]>((target) =>
      Promise.resolve(rows.get(target) ?? null),
    ),
    findOneOrFail: jest.fn<Promise<unknown>, [unknown, unknown]>((target) =>
      Promise.resolve(rows.get(target)),
    ),
    findOneBy: jest.fn<Promise<unknown>, [unknown, unknown]>((target) =>
      Promise.resolve(rows.get(target) ?? null),
    ),
    findOneByOrFail: jest.fn<Promise<unknown>, [unknown, unknown]>((target) =>
      Promise.resolve(rows.get(target)),
    ),
    find: jest.fn<Promise<unknown[]>, [unknown, unknown]>((target) =>
      Promise.resolve(collections.get(target) ?? []),
    ),
    existsBy: jest
      .fn<Promise<boolean>, [unknown, unknown]>()
      .mockResolvedValue(false),
    create: jest.fn((Entity: new () => object, input: object) =>
      Object.assign(new Entity(), input),
    ),
    save: jest.fn<Promise<unknown>, unknown[]>((...input) =>
      Promise.resolve(input.at(-1)),
    ),
  };
  const dataSource = {
    manager,
    getRepository: jest.fn(
      () => members as unknown as Repository<AccountMembership>,
    ),
    transaction: jest.fn((work: (manager: EntityManager) => Promise<unknown>) =>
      work(manager as unknown as EntityManager),
    ),
  };
  const mail = {
    sendAccountInvitation: jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({ status: 'sent' }),
  };
  const service = new AccountMembershipsService(
    dataSource as unknown as DataSource,
    mail as unknown as MailService,
  );
  return {
    service,
    original,
    account,
    user,
    membership,
    team,
    invitation,
    rows,
    collections,
    manager,
    members,
    dataSource,
    mail,
  };
}
