import { verifyPassword } from './passwords';
import {
  completeOAuth,
  mockOAuthToken,
  oauthFixture,
} from '../../test/support/oauth-auth.fixture';
let fixture: ReturnType<typeof oauthFixture>;
beforeEach(() => {
  fixture = oauthFixture();
});
afterEach(() => jest.restoreAllMocks());
it.each([
  [{ given_name: 'Casey', family_name: 'Example' }, 'Casey', 'Example'],
  [{ given_name: 'Casey' }, 'Casey', null],
  [{ family_name: 'Example' }, null, 'Example'],
  [{ name: '  Casey Van Example  ' }, 'Casey', 'Van Example'],
  [{ name: 'Casey' }, 'Casey', null],
  [{ name: '   ' }, null, null],
  [{}, 'casey', null],
])(
  'creates a confirmed tenant admin and manager team from provider names %j',
  async (claims, firstName, lastName) => {
    const { state } = fixture.service.start('google', { mode: 'register' });
    mockOAuthToken(fixture, state, claims);
    await expect(completeOAuth(fixture, state)).resolves.toEqual({
      access_token: 'session',
    });
    expect(fixture.accounts.create).toHaveBeenCalledWith({
      locale: 'en-US',
      name: `${firstName ?? 'casey'}'s Workspace`,
      timezone: 'UTC',
    });
    expect(fixture.users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account',
        email: 'casey@example.test',
        firstName,
        lastName,
        role: 'admin',
      }),
    );
    const created = fixture.users.create.mock.calls[0][0];
    expect(created.confirmedAt).toBeInstanceOf(Date);
    expect(created.encryptedPassword).toMatch(/^\$2[aby]\$/);
    expect(
      await verifyPassword('authorization-code', created.encryptedPassword!),
    ).toBe(false);
    expect(fixture.teams.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account',
        createdByUserId: 'user',
        name: `${firstName ?? 'casey'}'s Workspace`,
      }),
    );
    expect(fixture.members.create).toHaveBeenCalledWith({
      accountId: 'account',
      role: 'manager',
      teamId: 'team',
      userId: 'user',
    });
    expect(fixture.login).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user', accountId: 'account' }),
    );
  },
);
it('does not create a tenant or log in when the registration transaction fails', async () => {
  fixture.accounts.save.mockRejectedValueOnce(
    new Error('Database unavailable'),
  );
  const state = fixture.service.start('google', {}).state;
  mockOAuthToken(fixture, state);
  await expect(completeOAuth(fixture, state)).rejects.toThrow(
    'Database unavailable',
  );
  expect(fixture.users.create).not.toHaveBeenCalled();
  expect(fixture.login).not.toHaveBeenCalled();
});
