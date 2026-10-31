import { attachRepositoryTransaction } from './repository-transaction.fixture';
import { Repository } from 'typeorm';
import { AccountMembershipsService } from '../../src/account-memberships/account-memberships.service';
import { Account } from '../../src/accounts/entities/account.entity';
import { EmailVerificationCodeService } from '../../src/mail/email-verification-code.service';
import { MailService } from '../../src/mail/mail.service';
import { StorageAttachment } from '../../src/storage/entities/storage-attachment.entity';
import { StorageBlob } from '../../src/storage/entities/storage-blob.entity';
import { StorageService } from '../../src/storage/storage.service';
import { TeamMember } from '../../src/teams/entities/team-member.entity';
import { Team } from '../../src/teams/entities/team.entity';
import { UserConfig } from '../../src/users/entities/user-config.entity';
import { User } from '../../src/users/entities/user.entity';
import { UsersService } from '../../src/users/users.service';
export function createUsersServiceFixture() {
  const user: User = Object.assign(new User(), {
    id: 'user',
    accountId: 'tenant',
    email: 'user@example.test',
    firstName: 'First',
    lastName: 'Last',
    role: 'member',
    encryptedPassword: 'test-password-hash',
    archivedAt: null,
    otpSecret: null,
    otpRequiredForLogin: false,
  });
  const users = {
    findOne: jest.fn<Promise<User | null>, [unknown]>().mockResolvedValue(null),
    findOneBy: jest
      .fn<Promise<User | null>, [unknown]>()
      .mockResolvedValue(null),
    findOneByOrFail: jest
      .fn<Promise<User>, [unknown]>()
      .mockResolvedValue(user),
    find: jest.fn<Promise<User[]>, [unknown]>().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(2),
    create: jest.fn((input: Partial<User>) =>
      Object.assign(new User(), { id: 'created' }, input),
    ),
    merge: jest.fn((current: User, patch: Partial<User>) =>
      Object.assign(current, patch),
    ),
    save: jest.fn((current: User) => Promise.resolve(current)),
  };
  const teams = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        Object.assign(new Team(), { id: 'team', accountId: 'tenant' }),
      ),
    findOneBy: jest
      .fn<Promise<Team | null>, [unknown]>()
      .mockResolvedValue(null),
    existsBy: jest.fn().mockResolvedValue(false),
    create: jest.fn((input: Partial<Team>) =>
      Object.assign(new Team(), { id: 'team' }, input),
    ),
    save: jest.fn((current: Team) => Promise.resolve(current)),
  };
  const teamMembers = {
    findOne: jest
      .fn<Promise<TeamMember | null>, [unknown]>()
      .mockResolvedValue(null),
    create: jest.fn((input: Partial<TeamMember>) =>
      Object.assign(new TeamMember(), input),
    ),
    save: jest.fn((current: TeamMember) => Promise.resolve(current)),
  };
  const userConfigs = {
    findOneBy: jest
      .fn<Promise<UserConfig | null>, [unknown]>()
      .mockResolvedValue(null),
    create: jest.fn((input: Partial<UserConfig>) =>
      Object.assign(new UserConfig(), input),
    ),
    save: jest.fn((current: UserConfig) => Promise.resolve(current)),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const codes = {
    generateAuthenticatorSecret: jest.fn().mockReturnValue('test-secret'),
    generateAuthenticatorUri: jest
      .fn()
      .mockReturnValue('otpauth://totp/example'),
    verifyAuthenticatorCode: jest.fn().mockReturnValue(true),
  };
  const mail = {
    sendUserInvitation: jest
      .fn<
        ReturnType<MailService['sendUserInvitation']>,
        Parameters<MailService['sendUserInvitation']>
      >()
      .mockResolvedValue({ status: 'sent', accepted: [], rejected: [] }),
  };
  const attachment = Object.assign(new StorageAttachment(), {
    uuid: 'asset',
    blob: Object.assign(new StorageBlob(), {
      filename: 'signature.png',
      contentType: 'image/png',
    }),
  });
  const storage = {
    findRecordAttachments: jest
      .fn<Promise<StorageAttachment[]>, [unknown]>()
      .mockResolvedValue([]),
    createAttachment: jest.fn().mockResolvedValue(attachment),
    deleteRecordAttachments: jest.fn().mockResolvedValue(undefined),
    createBlobProxyUrl: jest
      .fn()
      .mockReturnValue('https://files.example.test/signature.png'),
  };
  const memberships = {
    resolveUser: jest.fn().mockResolvedValue(user),
    hasMembershipRecord: jest.fn().mockResolvedValue(false),
    listMembers: jest
      .fn<Promise<Array<{ user: User; status: string }>>, [string, boolean]>()
      .mockResolvedValue([]),
    membershipUserIds: jest.fn().mockResolvedValue(new Set<string>()),
    invite: jest
      .fn<Promise<User>, [string, User, string]>()
      .mockResolvedValue(user),
    changeMember: jest
      .fn<Promise<User | null>, [string, string, unknown]>()
      .mockResolvedValue(null),
  };
  const accounts = {
    findOneByOrFail: jest
      .fn()
      .mockResolvedValue({ id: 'tenant', name: 'Example' }),
  };
  attachRepositoryTransaction(
    new Map<unknown, object>([
      [Team, teams],
      [TeamMember, teamMembers],
    ]),
  );
  const service = new UsersService(
    accounts as unknown as Repository<Account>,
    teams as unknown as Repository<Team>,
    teamMembers as unknown as Repository<TeamMember>,
    users as unknown as Repository<User>,
    userConfigs as unknown as Repository<UserConfig>,
    codes as unknown as EmailVerificationCodeService,
    mail as unknown as MailService,
    storage as unknown as StorageService,
    memberships as unknown as AccountMembershipsService,
  );
  return {
    service,
    user,
    users,
    teams,
    teamMembers,
    userConfigs,
    codes,
    mail,
    storage,
    memberships,
    attachment,
  };
}
