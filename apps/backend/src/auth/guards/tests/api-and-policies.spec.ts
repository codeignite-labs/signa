import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../../auth.service';
import { AuthenticatedRequest } from '../../authenticated-request';
import { ApiTokenGuard } from '../api-token/api-token.guard';
import { AbilityFactory } from '../../../authorization/ability.factory';
import { PoliciesGuard } from '../../../authorization/policies.guard';
import { User } from '../../../users/entities/user.entity';
import { AuthorizationAction as Action } from '../../../authorization/authorization-actions';
function context(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getClass: () => Object,
    getHandler: () => Function,
  } as unknown as ExecutionContext;
}
it('requires a valid scoped API token and resolves header arrays without JWT fallback', async () => {
  const resolveApiToken = jest.fn().mockResolvedValue({
    accountId: 'account',
    apiTokenPermissions: ['templates:read'],
  });
  const guard = new ApiTokenGuard({
    resolveApiToken,
  } as unknown as AuthService);
  const request = {
    headers: { 'x-auth-token': ['token'] },
    path: '/api/templates',
    method: 'GET',
  } as unknown as AuthenticatedRequest;
  expect(await guard.canActivate(context(request))).toBe(true);
  expect(resolveApiToken).toHaveBeenCalledWith('token');
  expect(request.tenant?.accountId).toBe('account');
  request.method = 'POST';
  await expect(guard.canActivate(context(request))).rejects.toMatchObject({
    status: 403,
  });
  Object.defineProperty(request, 'path', {
    value: '/api/health',
    writable: true,
  });
  expect(await guard.canActivate(context(request))).toBe(true);
  resolveApiToken.mockResolvedValue({ accountId: 'account' });
  Object.defineProperty(request, 'path', {
    value: '/api/templates',
    writable: true,
  });
  await expect(guard.canActivate(context(request))).rejects.toMatchObject({
    status: 403,
  });
  resolveApiToken.mockResolvedValue(null);
  await expect(guard.canActivate(context(request))).rejects.toMatchObject({
    status: 401,
  });
  for (const header of [undefined, '', []])
    await expect(
      guard.canActivate(
        context({
          headers: { 'x-auth-token': header },
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
});
it('permits handlers without policies and evaluates all policies against current user ability', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new PoliciesGuard(
    new AbilityFactory(),
    reflector as unknown as Reflector,
  );
  expect(guard.canActivate(context({}))).toBe(true);
  reflector.getAllAndOverride.mockReturnValue([]);
  expect(guard.canActivate(context({}))).toBe(true);
  reflector.getAllAndOverride.mockReturnValue([
    (ability: ReturnType<AbilityFactory['createForUser']>) =>
      ability.can(Action.Read, 'Template'),
  ]);
  expect(() => guard.canActivate(context({}))).toThrow('Forbidden');
  const user = Object.assign(new User(), { role: 'viewer' });
  expect(guard.canActivate(context({ user }))).toBe(true);
  reflector.getAllAndOverride.mockReturnValue([() => true, () => false]);
  expect(() => guard.canActivate(context({ user }))).toThrow('Forbidden');
});
