import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountMembershipsService } from '../../../account-memberships/account-memberships.service';
import { AccountsService } from '../../../accounts/accounts.service';
import { Account } from '../../../accounts/entities/account.entity';
import { User } from '../../../users/entities/user.entity';
import { UsersService } from '../../../users/users.service';
import { AuthenticatedRequest } from '../../authenticated-request';
import { AdminGuard } from '../admin/admin.guard';
import { AccountHydrationGuard } from '../account-hydration/account-hydration.guard';
import { UserHydrationGuard } from '../user-hydration/user-hydration.guard';
import { JwtGuard } from '../jwt/jwt.guard';
function context(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}
it.each(['editor', 'agent', 'member', 'viewer', undefined])(
  'requires an actual administrator session, refusing %s',
  (role) => {
    const guard = new AdminGuard();
    expect(() =>
      guard.canActivate(
        context(
          role ? { session: { role } as AuthenticatedRequest['session'] } : {},
        ),
      ),
    ).toThrow('Forbidden');
    expect(
      guard.canActivate(
        context({
          session: { role: 'admin' } as AuthenticatedRequest['session'],
        }),
      ),
    ).toBe(true);
  },
);
it('hydrates the active session account or API tenant and refuses missing accounts', async () => {
  const account = Object.assign(new Account(), { id: 'account' });
  const findActiveAccount = jest.fn().mockResolvedValue(account);
  const guard = new AccountHydrationGuard({
    findActiveAccount,
  } as unknown as AccountsService);
  const session = { accountId: 'account' } as NonNullable<
    AuthenticatedRequest['session']
  >;
  const request: Partial<AuthenticatedRequest> = { session };
  expect(await guard.canActivate(context(request))).toBe(true);
  expect(request.account).toBe(account);
  expect(findActiveAccount).toHaveBeenCalledWith('account');
  const tenant = { accountId: 'api' } as NonNullable<
    AuthenticatedRequest['tenant']
  >;
  expect(await guard.canActivate(context({ tenant }))).toBe(true);
  expect(findActiveAccount).toHaveBeenLastCalledWith('api');
  await expect(guard.canActivate(context({}))).rejects.toMatchObject({
    status: 401,
  });
  findActiveAccount.mockResolvedValue(null);
  await expect(guard.canActivate(context({ session }))).rejects.toMatchObject({
    status: 401,
  });
});
it('reuses an authenticated user and tenant-scopes later user hydration', async () => {
  const user = Object.assign(new User(), { id: 'user', accountId: 'account' });
  const findActiveUser = jest.fn().mockResolvedValue(user);
  const guard = new UserHydrationGuard({
    findActiveUser,
  } as unknown as UsersService);
  expect(await guard.canActivate(context({ user }))).toBe(true);
  expect(findActiveUser).not.toHaveBeenCalled();
  const session = { userId: 'user', accountId: 'account' } as NonNullable<
    AuthenticatedRequest['session']
  >;
  const request: Partial<AuthenticatedRequest> = { session };
  await guard.canActivate(context(request));
  expect(findActiveUser).toHaveBeenCalledWith('user', 'account');
  expect(request.user).toBe(user);
  const tenant = {
    userId: 'api-user',
    accountId: 'api-account',
  } as NonNullable<AuthenticatedRequest['tenant']>;
  await guard.canActivate(context({ tenant }));
  expect(findActiveUser).toHaveBeenLastCalledWith('api-user', 'api-account');
  await expect(guard.canActivate(context({}))).rejects.toMatchObject({
    status: 401,
  });
  findActiveUser.mockResolvedValue(null);
  await expect(guard.canActivate(context({ session }))).rejects.toMatchObject({
    status: 401,
  });
});
it('verifies JWT membership on every request and uses the current membership role', async () => {
  const payload = {
    userId: 'user',
    accountId: 'account',
    role: 'admin',
    teamId: 'team',
    isTestMode: true,
    trueAccountId: 'original-account',
    trueUserId: 'original-user',
  };
  const verifyAsync = jest.fn().mockResolvedValue(payload);
  const user = Object.assign(new User(), { id: 'user', role: 'viewer' });
  const resolveUser = jest.fn().mockResolvedValue(user);
  const guard = new JwtGuard(
    { verifyAsync } as unknown as JwtService,
    { resolveUser } as unknown as AccountMembershipsService,
  );
  const request = {
    headers: { authorization: 'Bearer signed-token' },
  } as AuthenticatedRequest;
  expect(await guard.canActivate(context(request))).toBe(true);
  expect(verifyAsync).toHaveBeenCalledWith('signed-token');
  expect(resolveUser).toHaveBeenCalledWith('user', 'account');
  expect(request.session).toEqual({ ...payload, role: 'viewer' });
  expect(request.user).toBe(user);
  resolveUser.mockResolvedValue(null);
  await expect(guard.canActivate(context(request))).rejects.toMatchObject({
    status: 401,
  });
  verifyAsync.mockRejectedValue(new Error('expired'));
  await expect(guard.canActivate(context(request))).rejects.toMatchObject({
    status: 401,
  });
  for (const authorization of [undefined, '', 'Basic signed-token', 'Bearer '])
    await expect(
      guard.canActivate(
        context({ headers: { authorization } } as AuthenticatedRequest),
      ),
    ).rejects.toMatchObject({ status: 401 });
});
