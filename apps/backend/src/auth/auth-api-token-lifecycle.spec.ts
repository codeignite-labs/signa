import { createHash } from 'node:crypto';
import { IsNull } from 'typeorm';
import { authFixture, password } from '../../test/support/auth-service.fixture';
import { AccountLinkedAccount } from '../accounts/entities/account-linked-account.entity';
import { AccessToken } from './entities/access-token.entity';
import { defaultApiTokenPermissions } from './api-token-permissions';
function tokenFixture(
  user: Awaited<ReturnType<typeof authFixture>>['user'],
  overrides: Partial<AccessToken> = {},
): AccessToken {
  return Object.assign(new AccessToken(), {
    id: 'token',
    accountId: user.accountId,
    userId: user.id,
    user,
    teamId: null,
    permissions: ['templates:read'],
    token: 'legacy-token',
    sha256: '',
    revokedAt: null,
    lastUsedAt: null,
    ...overrides,
  });
}
it('creates an encrypted-at-rest token, masks normal responses and reveals it only after password verification', async () => {
  const { service, accessTokens } = await authFixture();
  const displayed = await service.getUserApiToken('user');
  const stored = accessTokens.save.mock.calls[0][0];
  expect(stored.token).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
  expect(stored.sha256).toHaveLength(64);
  expect(displayed.token).toContain('*');
  expect(displayed.token).not.toContain('v1:');
  accessTokens.findOne.mockResolvedValue(stored);
  const revealed = await service.revealUserApiToken('user', password);
  expect(revealed.revealed_token).toMatch(/^sgna_[\w-]{32}$/);
  expect(stored.sha256).toBe(
    createHash('sha256').update(revealed.revealed_token).digest('hex'),
  );
  expect(stored.token).not.toContain(revealed.revealed_token);
  expect(revealed.permissions).toEqual(defaultApiTokenPermissions);
});
it.each([false, true])(
  'requires a current membership for account-scoped token access (legacy scope %s)',
  async (originalAccount) => {
    const { service, user, accessTokens, memberships } = await authFixture();
    accessTokens.findOne.mockResolvedValue(tokenFixture(user));
    const accountId = originalAccount ? user.accountId : 'secondary';
    await service.getUserApiToken(user.id, accountId);
    const scoped = { accountId, teamId: IsNull(), userId: user.id };
    expect(accessTokens.findOne).toHaveBeenCalledWith({
      where: originalAccount
        ? [scoped, { accountId: IsNull(), teamId: IsNull(), userId: user.id }]
        : [scoped],
      order: { id: 'ASC' },
    });
    memberships.resolveUser.mockResolvedValue(null);
    accessTokens.findOne.mockClear();
    await expect(
      service.getUserApiToken(user.id, accountId),
    ).rejects.toMatchObject({ status: 401 });
    expect(accessTokens.findOne).not.toHaveBeenCalled();
  },
);
it('migrates legacy permissions, preserves valid permissions and handles short legacy token masking', async () => {
  const { service, user, accessTokens, users } = await authFixture();
  const legacy = tokenFixture(user, {
    token: 'short',
    permissions: null as unknown as string[],
  });
  accessTokens.findOne.mockResolvedValue(legacy);
  expect(await service.getUserApiToken(user.id)).toMatchObject({
    token: '*****',
    permissions: defaultApiTokenPermissions,
  });
  expect(accessTokens.save).toHaveBeenCalledWith(legacy);
  accessTokens.save.mockClear();
  users.findOne.mockResolvedValue(null);
  expect(await service.getUserApiToken(user.id)).toMatchObject({
    role: 'unknown',
  });
  expect(accessTokens.save).not.toHaveBeenCalled();
});
it.each([false, true])(
  'rotates the token, resets revoked/usage state and preserves or replaces scopes (%s)',
  async (replaceScopes) => {
    const { service, user, accessTokens } = await authFixture();
    const previous = tokenFixture(user, {
      revokedAt: new Date(),
      lastUsedAt: new Date(),
    });
    accessTokens.findOne.mockResolvedValue(previous);
    const rotated = await service.rotateUserApiToken(user.id, {
      password,
      ...(replaceScopes ? { permissions: ['webhooks:read'] } : {}),
    });
    expect(rotated.revealed_token).not.toBe('legacy-token');
    expect(previous.token).toMatch(/^v1:/);
    expect(previous.revokedAt).toBeNull();
    expect(previous.lastUsedAt).toBeNull();
    expect(rotated.permissions).toEqual(
      replaceScopes ? ['webhooks:read'] : ['templates:read'],
    );
    expect(
      (await service.revealUserApiToken(user.id, password)).revealed_token,
    ).toBe(rotated.revealed_token);
  },
);
it('allows revoking all API permissions without silently restoring defaults', async () => {
  const { service, user, accessTokens } = await authFixture();
  const stored = tokenFixture(user);
  accessTokens.findOne.mockResolvedValue(stored);
  expect(
    await service.updateUserApiTokenPermissions(user.id, { permissions: [] }),
  ).toMatchObject({ permissions: [] });
  expect(stored.permissions).toEqual([]);
});
it.each(['missing-user', 'wrong-password'])(
  'refuses token reveal and rotation for %s',
  async (condition) => {
    const { service, user, users, accessTokens } = await authFixture();
    if (condition === 'missing-user') users.findOne.mockResolvedValue(null);
    const entered = condition === 'wrong-password' ? 'wrong' : password;
    await expect(
      service.revealUserApiToken(user.id, entered),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.rotateUserApiToken(user.id, { password: entered }),
    ).rejects.toMatchObject({ status: 401 });
    expect(accessTokens.findOne).not.toHaveBeenCalled();
  },
);
it('rejects an altered AES-GCM envelope rather than exposing unauthenticated token data', async () => {
  const { service, accessTokens, user } = await authFixture();
  await service.getUserApiToken(user.id);
  const stored = accessTokens.save.mock.calls[0][0];
  const parts = stored.token.split(':');
  const tag = Buffer.from(parts[2], 'base64url');
  tag[0] ^= 1;
  parts[2] = tag.toString('base64url');
  stored.token = parts.join(':');
  accessTokens.findOne.mockResolvedValue(stored);
  await expect(service.revealUserApiToken(user.id, password)).rejects.toThrow();
});
it('issues a team-scoped encrypted token linked to the current tenant and role', async () => {
  const { service, user, accessTokens } = await authFixture();
  const result = await service.issueTeamApiToken({ teamId: 'team', user });
  expect(accessTokens.create).toHaveBeenCalledWith(
    expect.objectContaining({
      teamId: 'team',
      accountId: user.accountId,
      userId: user.id,
      token: expect.stringMatching(/^v1:/) as unknown,
    }),
  );
  expect(result.role).toBe('admin');
  expect(result.permissions_note).toContain('selected team');
});
it.each(['missing', 'no-user', 'revoked', 'archived'])(
  'does not resolve %s API tokens or record usage',
  async (condition) => {
    const { service, user, accessTokens } = await authFixture();
    const stored = tokenFixture(user);
    if (condition === 'no-user') stored.user = null as unknown as typeof user;
    if (condition === 'revoked') stored.revokedAt = new Date();
    if (condition === 'archived') user.archivedAt = new Date();
    accessTokens.findOne.mockResolvedValue(
      condition === 'missing' ? null : stored,
    );
    expect(await service.resolveApiToken('raw-token')).toBeNull();
    expect(accessTokens.update).not.toHaveBeenCalled();
  },
);
it.each([
  ['admin', true, false, true],
  ['viewer', true, true, true],
  ['viewer', true, false, false],
  ['admin', false, true, false],
] as const)(
  'rechecks team ownership/membership for role %s',
  async (role, teamExists, memberExists, allowed) => {
    const { service, user, accessTokens, teams, teamMembers } =
      await authFixture();
    user.role = role;
    teams.existsBy.mockResolvedValue(teamExists);
    teamMembers.existsBy.mockResolvedValue(memberExists);
    accessTokens.findOne.mockResolvedValue(
      tokenFixture(user, { teamId: 'team' }),
    );
    const resolved = await service.resolveApiToken('raw-token');
    expect(Boolean(resolved)).toBe(allowed);
    expect(teams.existsBy).toHaveBeenCalledWith({
      id: 'team',
      accountId: user.accountId,
      archivedAt: IsNull(),
    });
    if (allowed)
      expect(resolved).toMatchObject({
        role,
        accountId: user.accountId,
        teamId: 'team',
      });
    else expect(accessTokens.update).not.toHaveBeenCalled();
  },
);
it.each(['testing', 'production-linked', 'production-unlinked'])(
  'resolves %s account links after a successful API token lookup',
  async (mode) => {
    const { service, user, accessTokens, links } = await authFixture();
    accessTokens.findOne.mockResolvedValue(
      tokenFixture(user, { accountId: null }),
    );
    if (mode === 'testing')
      links.findOne.mockResolvedValueOnce(
        Object.assign(new AccountLinkedAccount(), {
          accountId: 'production',
          linkedAccountId: user.accountId,
        }),
      );
    if (mode === 'production-linked')
      links.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(
        Object.assign(new AccountLinkedAccount(), {
          linkedAccountId: 'testing',
        }),
      );
    const resolved = await service.resolveApiToken('raw-token');
    expect(resolved).toMatchObject({
      isTestMode: mode === 'testing',
      productionAccountId: mode === 'testing' ? 'production' : user.accountId,
      testingAccountId:
        mode === 'testing'
          ? user.accountId
          : mode === 'production-linked'
            ? 'testing'
            : null,
    });
    expect(accessTokens.update).toHaveBeenCalledWith('token', {
      lastUsedAt: expect.any(Date) as unknown,
    });
  },
);
it('returns no tenant context when membership was revoked after token issuance and masks a lost display role', async () => {
  const { service, user, accessTokens, memberships } = await authFixture();
  accessTokens.findOne.mockResolvedValue(tokenFixture(user));
  memberships.resolveUser.mockResolvedValueOnce(null);
  expect(await service.resolveApiToken('raw-token')).toBeNull();
  memberships.resolveUser
    .mockResolvedValueOnce(user)
    .mockResolvedValueOnce(null);
  expect((await service.getUserApiToken(user.id, user.accountId)).role).toBe(
    'unknown',
  );
});
