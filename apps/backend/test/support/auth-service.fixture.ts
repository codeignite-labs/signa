import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AccountMembershipsService } from '../../src/account-memberships/account-memberships.service';
import { Account } from '../../src/accounts/entities/account.entity';
import { AccountLinkedAccount } from '../../src/accounts/entities/account-linked-account.entity';
import { EmailVerificationCodeService } from '../../src/mail/email-verification-code.service';
import { MailService } from '../../src/mail/mail.service';
import { Team } from '../../src/teams/entities/team.entity';
import { TeamMember } from '../../src/teams/entities/team-member.entity';
import { User } from '../../src/users/entities/user.entity';
import { AuthService } from '../../src/auth/auth.service';
import { AccessToken } from '../../src/auth/entities/access-token.entity';
import { hashPassword } from '../../src/auth/passwords';
export const password = 'correct horse battery staple';
const encryptedPassword = hashPassword(password);
export function authRepository<T extends { id?: string }>(Entity: new () => T) {
  return {
    create: jest.fn((input: Partial<T>) => Object.assign(new Entity(), input)),
    save: jest.fn((input: T) =>
      Promise.resolve(
        Object.assign(input, {
          id: input.id ?? 'generated',
          createdAt: new Date('2026-10-31'),
          updatedAt: new Date('2026-10-31'),
        }),
      ),
    ),
    findOne: jest.fn<Promise<T | null>, [unknown]>().mockResolvedValue(null),
    findOneBy: jest.fn<Promise<T | null>, [unknown]>().mockResolvedValue(null),
    find: jest.fn<Promise<T[]>, [unknown]>().mockResolvedValue([]),
    existsBy: jest.fn<Promise<boolean>, [unknown]>().mockResolvedValue(false),
    count: jest.fn<Promise<number>, unknown[]>().mockResolvedValue(0),
    update: jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValue({ affected: 1 }),
  };
}
export async function authFixture(
  configOverrides: Record<string, unknown> = {},
) {
  const account: Account = Object.assign(new Account(), {
    id: 'account',
    name: 'Example',
    timezone: 'UTC',
    locale: 'en-US',
    archivedAt: null,
  });
  const user: User = Object.assign(new User(), {
    id: 'user',
    accountId: account.id,
    account,
    role: 'admin',
    email: 'casey@example.test',
    firstName: 'Casey',
    lastName: 'Example',
    archivedAt: null,
    otpRequiredForLogin: false,
    encryptedPassword: await encryptedPassword,
  });
  const users = authRepository(User);
  users.findOne.mockResolvedValue(user);
  users.findOneBy.mockResolvedValue(user);
  const accounts = authRepository(Account);
  const teams = authRepository(Team);
  const teamMembers = authRepository(TeamMember);
  const accessTokens = authRepository(AccessToken);
  const links = authRepository(AccountLinkedAccount);
  const repositories = new Map<unknown, unknown>([
    [User, users],
    [Account, accounts],
    [Team, teams],
    [TeamMember, teamMembers],
  ]);
  const manager = {
    getRepository: jest.fn((target: unknown) => {
      const repository = repositories.get(target);
      if (!repository) throw new Error('Unconfigured repository');
      return repository;
    }),
  };
  const dataSource = {
    getRepository: manager.getRepository,
    transaction: jest.fn((work: (manager: EntityManager) => Promise<unknown>) =>
      work(manager as unknown as EntityManager),
    ),
  };
  const memberships = {
    resolveUser: jest
      .fn<Promise<User | null>, [string, string]>()
      .mockResolvedValue(user),
    listAccounts: jest
      .fn<Promise<Array<{ id: string; status: string }>>, [string]>()
      .mockResolvedValue([]),
  };
  const codes = { verifyAuthenticatorCode: jest.fn().mockReturnValue(true) };
  const mail = {
    sendPasswordReset: jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({ status: 'sent' }),
  };
  const config = new ConfigService({
    JWT_SECRET: 'test-only-signing-secret',
    REGISTRATION_MODE: 'open',
    ...configOverrides,
  });
  const jwt = new JwtService({ secret: 'test-only-signing-secret' });
  const service = new AuthService(
    memberships as unknown as AccountMembershipsService,
    accessTokens as unknown as Repository<AccessToken>,
    links as unknown as Repository<AccountLinkedAccount>,
    config,
    dataSource as unknown as DataSource,
    codes as unknown as EmailVerificationCodeService,
    jwt,
    mail as unknown as MailService,
  );
  return {
    service,
    account,
    user,
    users,
    accounts,
    teams,
    teamMembers,
    accessTokens,
    links,
    dataSource,
    manager,
    memberships,
    codes,
    mail,
    config,
    jwt,
  };
}
