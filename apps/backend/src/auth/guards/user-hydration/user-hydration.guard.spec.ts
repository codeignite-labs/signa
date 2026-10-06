import { UnauthorizedException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../authenticated-request';
import { User } from '../../../users/entities/user.entity';
import { UsersService } from '../../../users/users.service';
import { UserHydrationGuard } from './user-hydration.guard';

describe('UserHydrationGuard', () => {
  let usersService: jest.Mocked<Pick<UsersService, 'findActiveUser'>>;
  let guard: UserHydrationGuard;

  beforeEach(() => {
    usersService = {
      findActiveUser: jest.fn(),
    };
    guard = new UserHydrationGuard(usersService as unknown as UsersService);
  });

  it('hydrates the active user from the web session', async () => {
    const user = { id: 'user-1' } as User;
    const request = {
      session: {
        accountId: 'account-1',
        userId: 'user-1',
        role: 'admin',
      },
    } as AuthenticatedRequest;
    usersService.findActiveUser.mockResolvedValue(user);

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);

    expect(usersService.findActiveUser).toHaveBeenCalledWith('user-1', 'account-1');
    expect(request.user).toBe(user);
  });

  it('hydrates the active user from API token tenancy context', async () => {
    const user = { id: 'user-1' } as User;
    const request = {
      tenant: {
        accountId: 'account-1',
        userId: 'user-1',
        accessTokenId: 'token-1',
      },
    } as AuthenticatedRequest;
    usersService.findActiveUser.mockResolvedValue(user);

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);

    expect(request.user).toBe(user);
  });

  it('rejects missing auth context', async () => {
    await expect(
      guard.canActivate(createContext({} as AuthenticatedRequest)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects inactive users', async () => {
    usersService.findActiveUser.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        createContext({
          session: {
            accountId: 'account-1',
            userId: 'user-1',
            role: 'admin',
          },
        } as AuthenticatedRequest),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

function createContext(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}
