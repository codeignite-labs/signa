import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { authFixture, password } from '../../test/support/auth-service.fixture';
import { User } from '../users/entities/user.entity';
import { verifyPassword } from './passwords';
const resetToken = 'a-test-reset-token-with-enough-entropy';
const resetHash = createHash('sha256').update(resetToken).digest('hex');
afterEach(() => jest.restoreAllMocks());
it('stores only a reset token hash and sends the original token through the email side channel', async () => {
  const { service, user, users, mail } = await authFixture();
  expect(
    await service.requestPasswordReset({ email: user.email.toUpperCase() }),
  ).toEqual({ ok: true });
  const input = mail.sendPasswordReset.mock.calls[0][0] as {
    token: string;
    accountId: string;
    email: string;
  };
  expect(input.token).toHaveLength(43);
  expect(user.resetPasswordToken).toBe(
    createHash('sha256').update(input.token).digest('hex'),
  );
  expect(user.resetPasswordToken).not.toBe(input.token);
  expect(user.resetPasswordSentAt).toBeInstanceOf(Date);
  expect(users.save).toHaveBeenCalledWith(user);
  expect(input).toMatchObject({ accountId: user.accountId, email: user.email });
});
it.each(['missing', 'archived-user', 'archived-account'])(
  'returns the same acknowledgement for %s reset requests without sending mail',
  async (state) => {
    const { service, user, users, mail, memberships } = await authFixture();
    if (state === 'missing') users.findOne.mockResolvedValue(null);
    if (state === 'archived-user') user.archivedAt = new Date();
    if (state === 'archived-account') {
      user.account.archivedAt = new Date();
      memberships.resolveUser.mockResolvedValue(null);
    }
    expect(
      await service.requestPasswordReset({ email: 'casey@example.test' }),
    ).toEqual({ ok: true });
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    expect(users.save).not.toHaveBeenCalled();
  },
);
it('acknowledges a valid recovery request even if sending mail fails and logs no raw reset token', async () => {
  const { service, user, mail } = await authFixture();
  const warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  mail.sendPasswordReset.mockRejectedValueOnce(
    new Error('Provider unavailable'),
  );
  expect(await service.requestPasswordReset({ email: user.email })).toEqual({
    ok: true,
  });
  const sent = mail.sendPasswordReset.mock.calls[0][0] as { token: string };
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('Provider unavailable'),
  );
  expect(JSON.stringify(warn.mock.calls)).not.toContain(sent.token);
});
it('resets a fresh token, hashes the new password and consumes the token without creating an authenticated session', async () => {
  const { service, user, users } = await authFixture();
  user.resetPasswordToken = resetHash;
  user.resetPasswordSentAt = new Date();
  users.update.mockImplementation((_criteria, patch) => {
    Object.assign(user, patch);
    return Promise.resolve({ affected: 1 });
  });
  expect(
    await service.resetPassword({
      token: resetToken,
      password: 'new-test-password',
      password_confirmation: 'new-test-password',
    }),
  ).toEqual({ ok: true });
  expect(
    await verifyPassword('new-test-password', user.encryptedPassword),
  ).toBe(true);
  expect(await verifyPassword(password, user.encryptedPassword)).toBe(false);
  expect(user.resetPasswordToken).toBeNull();
  expect(user.resetPasswordSentAt).toBeNull();
  expect(users.findOne).toHaveBeenCalledWith({
    where: { resetPasswordToken: resetHash },
    relations: { account: true },
  });
});
it('rejects mismatched passwords before looking up or consuming a reset token', async () => {
  const { service, users } = await authFixture();
  await expect(
    service.resetPassword({
      token: resetToken,
      password: 'new-test-password',
      password_confirmation: 'different',
    }),
  ).rejects.toMatchObject({
    status: 422,
    response: { error: 'Password confirmation does not match' },
  });
  expect(users.findOne).not.toHaveBeenCalled();
});
it.each([
  'missing-user',
  'archived-user',
  'archived-account',
  'missing-timestamp',
  'expired',
])('refuses %s tokens without changing the password', async (state) => {
  const { service, user, users, memberships } = await authFixture({
    PASSWORD_RESET_TOKEN_TTL_MINUTES: 5,
  });
  user.resetPasswordToken = resetHash;
  user.resetPasswordSentAt = new Date();
  const previous = user.encryptedPassword;
  if (state === 'missing-user') users.findOne.mockResolvedValue(null);
  if (state === 'archived-user') user.archivedAt = new Date();
  if (state === 'archived-account') {
    user.account.archivedAt = new Date();
    memberships.resolveUser.mockResolvedValue(null);
  }
  if (state === 'missing-timestamp') user.resetPasswordSentAt = null;
  if (state === 'expired')
    user.resetPasswordSentAt = new Date(Date.now() - 6 * 60_000);
  await expect(
    service.resetPassword({
      token: resetToken,
      password: 'new-test-password',
      password_confirmation: 'new-test-password',
    }),
  ).rejects.toMatchObject({
    status: 422,
    response: { error: 'Password reset token is invalid or expired' },
  });
  expect(user.encryptedPassword).toBe(previous);
  expect(users.update).not.toHaveBeenCalled();
});
it('uses the configured reset lifetime with an inclusive freshness boundary', async () => {
  const { service, user, users } = await authFixture({
    PASSWORD_RESET_TOKEN_TTL_MINUTES: 5,
  });
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  user.resetPasswordToken = resetHash;
  user.resetPasswordSentAt = new Date(now - 5 * 60_000);
  users.update.mockImplementation((_criteria, patch) => {
    Object.assign(user, patch);
    return Promise.resolve({ affected: 1 });
  });
  await expect(
    service.resetPassword({
      token: resetToken,
      password: 'new-test-password',
      password_confirmation: 'new-test-password',
    }),
  ).resolves.toEqual({ ok: true });
});
it('consumes a reset token only once when two reset requests race', async () => {
  const { service, user, users } = await authFixture();
  user.resetPasswordToken = resetHash;
  user.resetPasswordSentAt = new Date();
  users.findOne.mockImplementation(() =>
    Promise.resolve(Object.assign(new User(), user)),
  );
  users.update.mockImplementation((criteria, patch) => {
    const where = criteria as { resetPasswordToken: string };
    if (user.resetPasswordToken !== where.resetPasswordToken)
      return Promise.resolve({ affected: 0 });
    Object.assign(user, patch);
    return Promise.resolve({ affected: 1 });
  });
  const requests = ['first-new-password', 'second-new-password'].map((next) =>
    service.resetPassword({
      token: resetToken,
      password: next,
      password_confirmation: next,
    }),
  );
  const results = await Promise.allSettled(requests);
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(
    1,
  );
  expect(users.update).toHaveBeenCalledWith(
    expect.objectContaining({ resetPasswordToken: resetHash }),
    expect.objectContaining({
      resetPasswordToken: null,
      resetPasswordSentAt: null,
    }),
  );
});
it('sends recovery for an active secondary membership when the original account has been archived', async () => {
  const { service, user, memberships, mail } = await authFixture();
  user.account.archivedAt = new Date();
  const secondary = Object.assign(new User(), user, {
    accountId: 'secondary',
    account: { ...user.account, id: 'secondary', archivedAt: null },
  });
  memberships.resolveUser
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(secondary);
  memberships.listAccounts.mockResolvedValue([
    { id: 'secondary', status: 'active' },
  ]);
  expect(await service.requestPasswordReset({ email: user.email })).toEqual({
    ok: true,
  });
  expect(mail.sendPasswordReset).toHaveBeenCalledWith(
    expect.objectContaining({ accountId: 'secondary', email: user.email }),
  );
});
it('permits a fresh reset token for an identity whose active membership is now in a secondary account', async () => {
  const { service, user, users, memberships } = await authFixture();
  user.account.archivedAt = new Date();
  user.resetPasswordToken = resetHash;
  user.resetPasswordSentAt = new Date();
  const secondary = Object.assign(new User(), user, {
    accountId: 'secondary',
    account: { ...user.account, id: 'secondary', archivedAt: null },
  });
  memberships.resolveUser
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(secondary);
  memberships.listAccounts.mockResolvedValue([
    { id: 'secondary', status: 'active' },
  ]);
  users.update.mockImplementation((_criteria, patch) => {
    Object.assign(user, patch);
    return Promise.resolve({ affected: 1 });
  });
  await expect(
    service.resetPassword({
      token: resetToken,
      password: 'new-test-password',
      password_confirmation: 'new-test-password',
    }),
  ).resolves.toEqual({ ok: true });
});

it('does not issue or consume a reset token when an identity has no remaining active membership', async () => {
  const { service, user, users, memberships, mail } = await authFixture();
  memberships.resolveUser.mockResolvedValue(null);
  expect(await service.requestPasswordReset({ email: user.email })).toEqual({
    ok: true,
  });
  expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  user.resetPasswordToken = resetHash;
  user.resetPasswordSentAt = new Date();
  await expect(
    service.resetPassword({
      token: resetToken,
      password: 'new-test-password',
      password_confirmation: 'new-test-password',
    }),
  ).rejects.toMatchObject({ status: 422 });
  expect(users.update).not.toHaveBeenCalled();
});
