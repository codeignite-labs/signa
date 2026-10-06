import { AccountMembershipsService } from '../account-memberships/account-memberships.service';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../auth/auth.service';
import { AbilityFactory } from '../authorization/ability.factory';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'JBSWY3DPEHPK3PXP'),
  generateSync: jest.fn(() => '123456'),
  generateURI: jest.fn(() => 'otpauth://totp/Signa:ada@example.com'),
  verifySync: jest.fn(() => ({ valid: true })),
}));

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: jest.Mocked<Pick<UsersService, 'findActiveUser'>>;

  beforeEach(async () => {
    usersService = {
      findActiveUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: AccountMembershipsService, useValue: {
          resolveUser: jest.fn().mockResolvedValue({ id: 'user-1', accountId: 'account-1', role: 'admin' }),
          listMembers: jest.fn().mockResolvedValue([]),
          changeMember: jest.fn().mockResolvedValue(null),
          invite: jest.fn(),
        } },
        {
          provide: UsersService,
          useValue: usersService,
        },
        {
          provide: AuthService,
          useValue: {
            resolveApiToken: jest.fn(),
          },
        },
        AbilityFactory,
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('returns the DocuSeal current user response shape', () => {
    usersService.findActiveUser.mockResolvedValue({
      id: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    } as Awaited<ReturnType<UsersService['findActiveUser']>>);

    const user = {
      id: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    } as User;

    expect(controller.show(user)).toEqual({
      id: 'user-1',
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@example.com',
    });
  });
});
