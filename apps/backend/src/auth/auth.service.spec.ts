import { AccountLinkedAccount } from '../accounts/entities/account-linked-account.entity';
import { AccountMembershipsService } from '../account-memberships/account-memberships.service';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EmailVerificationCodeService } from '../mail/email-verification-code.service';
import { MailService } from '../mail/mail.service';
import { AuthService } from './auth.service';
import { AccessToken } from './entities/access-token.entity';

jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'JBSWY3DPEHPK3PXP'),
  generateSync: jest.fn(() => '123456'),
  generateURI: jest.fn(() => 'otpauth://totp/Signa:ada@example.com'),
  verifySync: jest.fn(() => ({ valid: true })),
}));

type MockRepository<T extends object> = {
  create: jest.Mock<T, [Partial<T>]>;
  findOne: jest.Mock<Promise<T | null>>;
  save: jest.Mock<Promise<T>, [T]>;
  update: jest.Mock;
};

function createRepository<T extends object>(): jest.Mocked<MockRepository<T>> {
  return {
    create: jest.fn((value: Partial<T>) => value as T),
    findOne: jest.fn(),
    save: jest.fn((value: T) => Promise.resolve(value)),
    update: jest.fn(),
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let memberships: AccountMembershipsService;
  let accessTokens: jest.Mocked<MockRepository<AccessToken>>;
  let dataSource: jest.Mocked<
    Pick<DataSource, 'getRepository' | 'transaction'>
  >;
  let jwtService: jest.Mocked<Pick<JwtService, 'sign'>>;

  beforeEach(async () => {
    accessTokens = createRepository<AccessToken>();
    dataSource = {
      getRepository: jest.fn(),
      transaction: jest.fn(),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('jwt-token'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: getRepositoryToken(AccountLinkedAccount), useValue: { findOne: jest.fn().mockResolvedValue(null) } },
        { provide: AccountMembershipsService, useValue: {
          resolveUser: jest.fn().mockResolvedValue({ id: 'user-1', accountId: 'account-1', role: 'admin' }),
          listMembers: jest.fn().mockResolvedValue([]),
          changeMember: jest.fn().mockResolvedValue(null),
          invite: jest.fn(),
        } },
        AuthService,
        {
          provide: getRepositoryToken(AccessToken),
          useValue: accessTokens,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-secret'),
          },
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
        {
          provide: EmailVerificationCodeService,
          useValue: {
            verifyAuthenticatorCode: jest.fn().mockReturnValue(true),
          },
        },
        {
          provide: JwtService,
          useValue: jwtService,
        },
        {
          provide: MailService,
          useValue: {
            sendPasswordReset: jest.fn().mockResolvedValue({ status: 'sent' }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    memberships = module.get(AccountMembershipsService);
  });

  it('hashes API tokens with SHA-256', () => {
    expect(service.hashApiToken('api-token')).toHaveLength(64);
    expect(service.hashApiToken('api-token')).toBe(
      service.hashApiToken('api-token'),
    );
  });

  it('returns tenant context for a valid token', async () => {
    accessTokens.findOne.mockResolvedValue({
      id: 'token-1',
      permissions: ['templates:read'],
      userId: 'user-1',
      user: {
        accountId: 'account-1',
        archivedAt: null,
        role: 'admin',
        account: {
          archivedAt: null,
        },
      },
    } as AccessToken);

    await expect(service.resolveApiToken('api-token')).resolves.toEqual({
      accountId: 'account-1',
      userId: 'user-1',
      accessTokenId: 'token-1',
      role: 'admin',
      isTestMode: false,
      productionAccountId: 'account-1',
      testingAccountId: null,
      apiTokenPermissions: ['templates:read'],
    });
  });

  it('returns null when the token has no active user', async () => {
    accessTokens.findOne.mockResolvedValue({
      user: {
        archivedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    } as AccessToken);

    await expect(service.resolveApiToken('api-token')).resolves.toBeNull();
  });

  it('returns null when the token account membership is inactive', async () => {
    jest.mocked(memberships.resolveUser).mockResolvedValue(null);
    accessTokens.findOne.mockResolvedValue({
      user: {
        archivedAt: null,
        account: {
          archivedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      },
    } as AccessToken);

    await expect(service.resolveApiToken('api-token')).resolves.toBeNull();
  });
});
