import { Team } from '../teams/entities/team.entity';
import { TeamMember } from '../teams/entities/team-member.entity';
import { AccountMembershipsService } from '../account-memberships/account-memberships.service';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { EmailVerificationCodeService } from '../mail/email-verification-code.service';
import { MailService } from '../mail/mail.service';
import { StorageService } from '../storage/storage.service';
import { UserConfig } from './entities/user-config.entity';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'JBSWY3DPEHPK3PXP'),
  generateSync: jest.fn(() => '123456'),
  generateURI: jest.fn(() => 'otpauth://totp/Signa:ada@example.com'),
  verifySync: jest.fn(() => ({ valid: true })),
}));

type MockRepository<T extends object> = {
  count: jest.Mock;
  create: jest.Mock<T, [Partial<T>]>;
  delete: jest.Mock;
  findOneByOrFail: jest.Mock;
  findOne: jest.Mock;
  findOneBy: jest.Mock;
  merge: jest.Mock<T, [T, Partial<T>]>;
  save: jest.Mock<Promise<T>, [T]>;
};

function createRepository<T extends object>(): jest.Mocked<MockRepository<T>> {
  return {
    count: jest.fn(),
    create: jest.fn((input: Partial<T>) => input as T),
    delete: jest.fn(),
    findOneByOrFail: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    merge: jest.fn((target: T, input: Partial<T>) =>
      Object.assign(target, input),
    ),
    save: jest.fn((input: T) => Promise.resolve(input)),
  };
}

describe('UsersService', () => {
  let service: UsersService;
  let accounts: jest.Mocked<MockRepository<Account>>;
  let emailCodes: jest.Mocked<
    Pick<
      EmailVerificationCodeService,
      | 'generateAuthenticatorSecret'
      | 'generateAuthenticatorUri'
      | 'verifyAuthenticatorCode'
    >
  >;
  let mailService: jest.Mocked<Pick<MailService, 'sendUserInvitation'>>;
  let storageService: jest.Mocked<
    Pick<
      StorageService,
      | 'createAttachment'
      | 'createBlobProxyUrl'
      | 'deleteRecordAttachments'
      | 'findRecordAttachments'
    >
  >;
  let userConfigs: jest.Mocked<MockRepository<UserConfig>>;
  let users: jest.Mocked<MockRepository<User>>;

  beforeEach(async () => {
    accounts = createRepository<Account>();
    accounts.findOneByOrFail.mockResolvedValue({
      id: 'account-1',
      name: 'Ada Labs',
    });
    mailService = {
      sendUserInvitation: jest.fn().mockResolvedValue({ status: 'sent' }),
    };
    emailCodes = {
      generateAuthenticatorSecret: jest.fn().mockReturnValue('secret'),
      generateAuthenticatorUri: jest.fn().mockReturnValue('otpauth://totp'),
      verifyAuthenticatorCode: jest.fn().mockReturnValue(true),
    };
    storageService = {
      createAttachment: jest.fn(),
      createBlobProxyUrl: jest.fn().mockReturnValue('https://asset.test/file'),
      deleteRecordAttachments: jest.fn().mockResolvedValue(undefined),
      findRecordAttachments: jest.fn().mockResolvedValue([]),
    };
    userConfigs = createRepository<UserConfig>();
    users = createRepository<User>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: getRepositoryToken(Team), useValue: createRepository<Team>() },
        { provide: getRepositoryToken(TeamMember), useValue: createRepository<TeamMember>() },
        { provide: AccountMembershipsService, useValue: {
          resolveUser: jest.fn().mockResolvedValue({ id: 'user-1', accountId: 'account-1', role: 'admin' }),
          hasMembershipRecord: jest.fn().mockResolvedValue(false),
          membershipUserIds: jest.fn().mockResolvedValue(new Set()),
          listMembers: jest.fn().mockResolvedValue([]),
          changeMember: jest.fn().mockResolvedValue(null),
          invite: jest.fn(),
        } },
        UsersService,
        {
          provide: getRepositoryToken(Account),
          useValue: accounts,
        },
        {
          provide: getRepositoryToken(User),
          useValue: users,
        },
        {
          provide: getRepositoryToken(UserConfig),
          useValue: userConfigs,
        },
        {
          provide: EmailVerificationCodeService,
          useValue: emailCodes,
        },
        {
          provide: MailService,
          useValue: mailService,
        },
        {
          provide: StorageService,
          useValue: storageService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('loads an active user with account relation', async () => {
    users.findOne.mockResolvedValue(null);

    await service.findActiveUser('user-1');

    expect(users.findOne).toHaveBeenCalledWith({
      where: {
        id: 'user-1',
        archivedAt: IsNull(),
      },
      relations: {
        account: true,
      },
    });
  });

  it('normalizes email before account-scoped lookup', async () => {
    users.findOne.mockResolvedValue(null);

    await service.findByEmailInAccount({
      accountId: 'account-1',
      email: 'OWNER@EXAMPLE.COM',
    });

    expect(users.findOne).toHaveBeenCalledWith({
      where: {
        accountId: 'account-1',
        email: 'owner@example.com',
        archivedAt: IsNull(),
      },
    });
  });

  it('creates users with supported Signa roles', async () => {
    users.findOne.mockResolvedValue(null);

    const response = await service.createUser('account-1', {
      email: 'editor@example.com',
      first_name: 'Ed',
      last_name: 'Itor',
      role: 'editor',
    });

    expect(response.role).toBe('editor');
    expect(users.merge).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ role: 'editor' }),
    );
    expect(mailService.sendUserInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        accountName: 'Ada Labs',
        email: 'editor@example.com',
      }),
    );
  });

  it('imports users with only email and reports skipped duplicates', async () => {
    users.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: '2',
        accountId: 'account-1',
        email: 'taken@example.com',
        archivedAt: null,
      });

    const response = await service.importUsers('account-1', {
      users: [
        {
          email: 'new@example.com',
        },
        {
          email: 'taken@example.com',
        },
      ],
    });

    expect(response.created).toBe(1);
    expect(response.skipped).toBe(1);
    expect(response.results[0]).toMatchObject({
      email: 'new@example.com',
      status: 'created',
    });
    expect(response.results[1]).toMatchObject({
      email: 'taken@example.com',
      status: 'skipped',
    });
  });
});
