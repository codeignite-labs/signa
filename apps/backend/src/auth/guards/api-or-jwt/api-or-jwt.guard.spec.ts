import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../../auth.service';
import { AuthenticatedRequest } from '../../authenticated-request';
import { User } from '../../../users/entities/user.entity';
import { ApiOrJwtGuard } from './api-or-jwt.guard';
function context(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}
function setup(
  headers: Record<string, string | string[] | undefined> = {},
  path = '/api/templates',
) {
  const auth = { resolveApiToken: jest.fn(), resolveSessionUser: jest.fn() };
  const jwt = { verifyAsync: jest.fn() };
  const request = { headers, path, method: 'GET' } as AuthenticatedRequest;
  const guard = new ApiOrJwtGuard(
    auth as unknown as AuthService,
    jwt as unknown as JwtService,
  );
  return { auth, jwt, request, guard };
}
it.each([
  {},
  { 'x-auth-token': [] },
  { 'x-auth-token': '' },
  { authorization: 'Basic credentials' },
])('rejects missing usable authentication %p', async (headers) => {
  const { guard, request } = setup(headers);
  await expect(guard.canActivate(context(request))).rejects.toBeInstanceOf(
    UnauthorizedException,
  );
});
it('accepts scoped API tokens, supports header arrays and does not verify an unrelated JWT', async () => {
  const { guard, request, auth, jwt } = setup({
    'x-auth-token': ['token', 'ignored'],
    authorization: 'Bearer other',
  });
  const tenant = {
    accountId: 'account',
    userId: 'user',
    accessTokenId: 'token-id',
    role: 'viewer',
    apiTokenPermissions: ['templates:read'],
  };
  auth.resolveApiToken.mockResolvedValue(tenant);
  await expect(guard.canActivate(context(request))).resolves.toBe(true);
  expect(auth.resolveApiToken).toHaveBeenCalledWith('token');
  expect(request.tenant).toEqual(tenant);
  expect(jwt.verifyAsync).not.toHaveBeenCalled();
});
it('denies wrong API scope rather than falling back to a second identity', async () => {
  const { guard, request, auth, jwt } = setup(
    { 'x-auth-token': 'token', authorization: 'Bearer jwt' },
    '/api/webhooks/1/events',
  );
  auth.resolveApiToken.mockResolvedValue({
    accountId: 'account',
    userId: 'user',
    accessTokenId: 'token-id',
    role: 'admin',
    apiTokenPermissions: ['submissions:read'],
  });
  await expect(guard.canActivate(context(request))).rejects.toBeInstanceOf(
    ForbiddenException,
  );
  expect(jwt.verifyAsync).not.toHaveBeenCalled();
});
it('accepts webhook scope for nested event listing and rejects missing permissions', async () => {
  const { guard, request, auth } = setup(
    { 'x-auth-token': 'token' },
    '/api/webhooks/1/events',
  );
  auth.resolveApiToken.mockResolvedValue({
    accountId: 'account',
    userId: 'user',
    accessTokenId: 'token-id',
    role: 'admin',
    apiTokenPermissions: ['webhooks:read'],
  });
  await expect(guard.canActivate(context(request))).resolves.toBe(true);
  auth.resolveApiToken.mockResolvedValue({
    accountId: 'account',
    userId: 'user',
    accessTokenId: 'token-id',
    role: 'admin',
  });
  await expect(guard.canActivate(context(request))).rejects.toBeInstanceOf(
    ForbiddenException,
  );
});
it('hydrates JWT sessions from current membership roles, preserving impersonation and test context', async () => {
  const { guard, request, auth, jwt } = setup({
    'x-auth-token': 'invalid',
    authorization: 'Bearer jwt',
  });
  auth.resolveApiToken.mockResolvedValue(null);
  const payload = {
    userId: 'user',
    accountId: 'account',
    role: 'admin',
    isTestMode: true,
    teamId: 'team',
    trueUserId: 'original',
    trueAccountId: 'production',
  };
  jwt.verifyAsync.mockResolvedValue(payload);
  const user = { id: 'user', role: 'viewer' } as User;
  auth.resolveSessionUser.mockResolvedValue(user);
  await expect(guard.canActivate(context(request))).resolves.toBe(true);
  expect(jwt.verifyAsync).toHaveBeenCalledWith('jwt');
  expect(auth.resolveSessionUser).toHaveBeenCalledWith(payload);
  expect(request.user).toBe(user);
  expect(request.session).toEqual({ ...payload, role: 'viewer' });
});
it('rejects revoked JWT membership and verification failures', async () => {
  const { guard, request, auth, jwt } = setup({ authorization: 'Bearer jwt' });
  jwt.verifyAsync.mockResolvedValue({ userId: 'user' });
  auth.resolveSessionUser.mockResolvedValue(null);
  await expect(guard.canActivate(context(request))).rejects.toBeInstanceOf(
    UnauthorizedException,
  );
  jwt.verifyAsync.mockRejectedValue(new Error('expired'));
  await expect(guard.canActivate(context(request))).rejects.toBeInstanceOf(
    UnauthorizedException,
  );
});
it('permits authenticated routes with no resource permission mapping', async () => {
  const { guard, request, auth } = setup(
    { 'x-auth-token': 'token' },
    '/api/profile',
  );
  auth.resolveApiToken.mockResolvedValue({
    accountId: 'account',
    userId: 'user',
    accessTokenId: 'token-id',
    role: 'viewer',
    apiTokenPermissions: [],
  });
  await expect(guard.canActivate(context(request))).resolves.toBe(true);
});
