import { QueryFailedError } from 'typeorm';
import { authFixture, password } from '../../test/support/auth-service.fixture';
import { User } from '../users/entities/user.entity';
import { WebSessionJwtPayload } from './web-session';
import { verifyPassword } from './passwords';
afterEach(() => jest.restoreAllMocks());
it('authenticates a case-normalized login and signs current account membership claims', async () => {
  const { service, users, jwt, user } = await authFixture();
  const response = await service.login({
    email: 'CASEY@EXAMPLE.TEST',
    password,
  });
  expect(users.findOne).toHaveBeenCalledWith({
    where: { email: 'casey@example.test' },
    relations: { account: true },
  });
  expect(jwt.verify<WebSessionJwtPayload>(response.access_token)).toMatchObject(
    { sub: user.id, userId: user.id, role: 'admin', accountId: user.accountId },
  );
  expect(response).toMatchObject({
    user: { email: 'casey@example.test', role: 'admin' },
    account: {
      id: 'account',
      is_test_mode: false,
      testing_account_id: null,
      production_account_id: null,
    },
  });
});
it.each(['missing', 'archived', 'wrong-password'])(
  'rejects %s logins with the same credentials error',
  async (condition) => {
    const { service, users, user } = await authFixture();
    if (condition === 'missing') users.findOne.mockResolvedValue(null);
    if (condition === 'archived') user.archivedAt = new Date();
    await expect(
      service.login({
        email: user.email,
        password: condition === 'wrong-password' ? 'incorrect' : password,
      }),
    ).rejects.toMatchObject({
      status: 401,
      response: { error: 'Invalid email or password' },
    });
  },
);
it('challenges MFA, rejects absent secrets and invalid codes, and accepts a valid authenticator code', async () => {
  const { service, user, codes } = await authFixture();
  user.otpRequiredForLogin = true;
  await expect(
    service.login({ email: user.email, password }),
  ).rejects.toMatchObject({ response: { code: 'otp_required' } });
  await expect(
    service.login({ email: user.email, password, otp_attempt: '123456' }),
  ).rejects.toMatchObject({ response: { code: 'otp_invalid' } });
  user.otpSecret = 'test-secret';
  codes.verifyAuthenticatorCode.mockReturnValueOnce(false);
  await expect(
    service.login({ email: user.email, password, otp_attempt: '000000' }),
  ).rejects.toMatchObject({ response: { code: 'otp_invalid' } });
  expect(
    await service.login({ email: user.email, password, otp_attempt: '123456' }),
  ).toHaveProperty('access_token');
  expect(codes.verifyAuthenticatorCode).toHaveBeenLastCalledWith({
    code: '123456',
    secret: 'test-secret',
  });
});
it('chooses an active secondary account after the original membership has been archived', async () => {
  const { service, memberships, user, jwt } = await authFixture();
  memberships.resolveUser.mockResolvedValueOnce(null).mockResolvedValueOnce(
    Object.assign(new User(), user, {
      accountId: 'secondary',
      role: 'viewer',
      account: { ...user.account, id: 'secondary' },
    }),
  );
  memberships.listAccounts.mockResolvedValue([
    { id: 'invited', status: 'invited' },
    { id: 'secondary', status: 'active' },
  ]);
  const response = await service.createLoginResponse(user);
  expect(jwt.verify<WebSessionJwtPayload>(response.access_token)).toMatchObject(
    { accountId: 'secondary', role: 'viewer' },
  );
  expect(memberships.resolveUser).toHaveBeenLastCalledWith(
    user.id,
    'secondary',
  );
});
it.each([false, true])(
  'refuses login without any active resolvable account (listed %s)',
  async (listed) => {
    const { service, memberships, user } = await authFixture();
    memberships.resolveUser.mockResolvedValue(null);
    memberships.listAccounts.mockResolvedValue(
      listed ? [{ id: 'archived', status: 'active' }] : [],
    );
    await expect(service.createLoginResponse(user)).rejects.toMatchObject({
      status: 401,
      message: 'No active account membership',
    });
  },
);
it('resolves a JWT against fresh account membership instead of trusting a stale role', async () => {
  const { service, memberships, user } = await authFixture();
  expect(
    await service.resolveSessionUser({
      sub: user.id,
      userId: user.id,
      accountId: 'account',
      role: 'viewer',
    }),
  ).toBe(user);
  expect(memberships.resolveUser).toHaveBeenCalledWith(user.id, 'account');
});
it('creates signed test-mode and team-impersonation responses without exposing password material', async () => {
  const { service, user, account, jwt } = await authFixture();
  const response = service.createAuthResponse(user, account, {
    isTestMode: true,
    productionAccountId: 'production',
    testingAccountId: 'testing',
    trueUserId: 'admin',
    trueAccountId: 'source',
  });
  expect(jwt.verify<WebSessionJwtPayload>(response.access_token)).toMatchObject(
    { isTestMode: true, trueUserId: 'admin', trueAccountId: 'source' },
  );
  expect(response.account).toMatchObject({
    is_test_mode: true,
    production_account_id: 'production',
    testing_account_id: 'testing',
  });
  const team = service.createTeamImpersonationResponse({
    user,
    account,
    teamId: 'team',
  });
  expect(jwt.verify<WebSessionJwtPayload>(team.access_token)).toMatchObject({
    teamId: 'team',
    userId: user.id,
  });
  expect(JSON.stringify(response)).not.toContain('encryptedPassword');
});
const registration = {
  account_name: 'Example Org',
  email: 'CASEY@EXAMPLE.TEST',
  first_name: 'Casey',
  last_name: 'Example',
  password,
};
it.each([false, true])(
  'registers an account, hashed login identity and initial manager team with configured defaults %s',
  async (custom) => {
    const { service, users, accounts, teamMembers, teams } =
      await authFixture();
    users.findOne.mockResolvedValue(null);
    const response = await service.register({
      ...registration,
      ...(custom ? { locale: 'fr-FR', timezone: 'Africa/Nairobi' } : {}),
    });
    expect(accounts.create).toHaveBeenCalledWith({
      name: 'Example Org',
      locale: custom ? 'fr-FR' : 'en-US',
      timezone: custom ? 'Africa/Nairobi' : 'UTC',
    });
    const savedUser = users.save.mock.calls[0][0];
    expect(savedUser.email).toBe('casey@example.test');
    expect(await verifyPassword(password, savedUser.encryptedPassword)).toBe(
      true,
    );
    expect(savedUser.encryptedPassword).not.toBe(password);
    expect(teams.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'generated',
        createdByUserId: 'generated',
        name: 'Example Org',
        slug: 'example-org',
      }),
    );
    expect(teamMembers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'manager',
        teamId: 'generated',
        userId: 'generated',
      }),
    );
    expect(response.account.locale).toBe(custom ? 'fr-FR' : 'en-US');
  },
);
it('enforces disabled registration before doing user writes and reports current registration policy', async () => {
  const { service, users } = await authFixture({
    REGISTRATION_MODE: 'disabled',
  });
  expect(await service.getRegistrationStatus()).toMatchObject({
    can_register: false,
    mode: 'disabled',
  });
  await expect(service.register(registration)).rejects.toMatchObject({
    status: 403,
  });
  expect(users.save).not.toHaveBeenCalled();
});
it('rejects duplicate identities and translates a concurrent unique-constraint conflict', async () => {
  const { service, users, dataSource } = await authFixture();
  await expect(service.register(registration)).rejects.toMatchObject({
    status: 409,
  });
  users.findOne.mockResolvedValue(null);
  const conflict = Object.assign(new Error('duplicate'), { code: '23505' });
  dataSource.transaction.mockRejectedValueOnce(
    new QueryFailedError('INSERT', [], conflict),
  );
  await expect(service.register(registration)).rejects.toMatchObject({
    status: 409,
    response: { error: 'Email already exists' },
  });
});
it('rechecks initial-only registration inside its transaction and preserves unexpected database errors', async () => {
  const { service, users, dataSource } = await authFixture({
    REGISTRATION_MODE: 'initial_only',
  });
  users.findOne.mockResolvedValue(null);
  users.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
  await expect(service.register(registration)).rejects.toMatchObject({
    status: 403,
  });
  expect(users.save).not.toHaveBeenCalled();
  users.count.mockResolvedValue(0);
  const failure = new Error('database unavailable');
  dataSource.transaction.mockRejectedValueOnce(failure);
  await expect(service.register(registration)).rejects.toThrow(failure);
});
