import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import { createUsersServiceFixture } from '../../test/support/user-service.fixture';
import { verifyPassword } from '../auth/passwords';
import { hashPasswordResetToken } from '../auth/password-reset-tokens';
import { User } from './entities/user.entity';
it('creates users with normalized identity fields, hashed passwords and no invitation when a password is supplied', async () => {
  const { service, users, mail } = createUsersServiceFixture();
  const result = await service.createUser('tenant', {
    email: 'NEW@EXAMPLE.TEST',
    first_name: ' New ',
    last_name: ' ',
    role: 'unsupported',
    password: 'initial password',
  });
  expect(result).toMatchObject({
    id: 'created',
    email: 'new@example.test',
    first_name: 'New',
    last_name: null,
    role: 'member',
    archived_at: null,
  });
  const saved = users.save.mock.calls[0][0];
  expect(
    await verifyPassword('initial password', saved.encryptedPassword),
  ).toBe(true);
  expect(saved.resetPasswordToken).toBeNull();
  expect(saved.resetPasswordSentAt).toBeNull();
  expect(mail.sendUserInvitation).not.toHaveBeenCalled();
});
it('generates invitation reset tokens without persisting plaintext tokens and restores archived tenant identities', async () => {
  const { service, users, user, mail } = createUsersServiceFixture();
  user.archivedAt = new Date();
  users.findOne.mockResolvedValue(user);
  const result = await service.createUser('tenant', {
    email: user.email,
    role: 'editor',
  });
  expect(result).toMatchObject({
    id: 'user',
    role: 'editor',
    archived_at: null,
  });
  expect(users.create).not.toHaveBeenCalled();
  expect(user.resetPasswordSentAt).toBeInstanceOf(Date);
  const invitation = mail.sendUserInvitation.mock.calls[0][0] as {
    token: string;
    accountId: string;
    email: string;
  };
  expect(invitation).toMatchObject({ accountId: 'tenant', email: user.email });
  expect(user.resetPasswordToken).toBe(
    hashPasswordResetToken(invitation.token),
  );
  expect(user.resetPasswordToken).not.toBe(invitation.token);
});
it('rejects duplicate active tenant users and translates unique persistence errors', async () => {
  const { service, users, user } = createUsersServiceFixture();
  users.findOne.mockResolvedValueOnce(user);
  await expect(
    service.createUser('tenant', { email: user.email }),
  ).rejects.toMatchObject({ status: 409 });
  users.save.mockRejectedValue(
    new QueryFailedError(
      'INSERT',
      [],
      Object.assign(new Error('duplicate'), { code: '23505' }),
    ),
  );
  await expect(
    service.createUser('tenant', {
      email: 'duplicate@example.test',
      password: 'initial password',
    }),
  ).rejects.toMatchObject({ status: 409 });
  users.save.mockRejectedValue(new Error('storage unavailable'));
  await expect(
    service.createUser('tenant', {
      email: 'new@example.test',
      password: 'initial password',
    }),
  ).rejects.toThrow('storage unavailable');
});
it.each([true, false])(
  'invites an existing shared identity without modifying its password or global profile (foreign=%s)',
  async (foreign) => {
    const { service, user, users, memberships, mail } =
      createUsersServiceFixture();
    user.accountId = foreign ? 'other-tenant' : 'tenant';
    users.findOne.mockResolvedValue(user);
    memberships.hasMembershipRecord.mockResolvedValue(!foreign);
    expect(
      await service.createUser('tenant', {
        email: user.email,
        first_name: 'Do not overwrite',
        role: 'viewer',
      }),
    ).toMatchObject({
      id: 'user',
      shared_identity: true,
      membership_status: 'invited',
    });
    expect(memberships.invite).toHaveBeenCalledWith('tenant', user, 'viewer');
    expect(users.save).not.toHaveBeenCalled();
    expect(mail.sendUserInvitation).not.toHaveBeenCalled();
  },
);
it('lists direct users and shared memberships without duplicate identities', async () => {
  const { service, user, users, memberships } = createUsersServiceFixture();
  users.find.mockResolvedValue([user, { ...user, id: 'direct' }]);
  memberships.membershipUserIds.mockResolvedValue(new Set(['user']));
  memberships.listMembers.mockResolvedValue([{ user, status: 'invited' }]);
  expect(await service.listUsers({ accountId: 'tenant' })).toEqual([
    expect.objectContaining({ id: 'direct' }),
    expect.objectContaining({
      id: 'user',
      shared_identity: true,
      membership_status: 'invited',
    }),
  ]);
  await service.listUsers({ accountId: 'tenant', status: 'archived' });
  expect(memberships.listMembers).toHaveBeenLastCalledWith('tenant', true);
  expect(await service.findActiveUser('user', 'tenant')).toBe(user);
  expect(memberships.resolveUser).toHaveBeenCalledWith('user', 'tenant');
});
it('limits shared identity updates to account roles and prevents users from changing their own role', async () => {
  const { service, user, users, memberships } = createUsersServiceFixture();
  user.accountId = 'original-tenant';
  users.findOneBy.mockResolvedValue(user);
  const options = {
    accountId: 'tenant',
    userId: 'user',
    currentUserId: 'admin',
  };
  await expect(
    service.updateUser({
      ...options,
      input: { email: 'overwrite@example.test', role: 'editor' },
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.updateUser({
      ...options,
      currentUserId: 'user',
      input: { role: 'editor' },
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.updateUser({ ...options, input: { role: 'editor' } }),
  ).rejects.toMatchObject({ status: 403 });
  memberships.changeMember.mockResolvedValue(user);
  expect(
    await service.updateUser({
      ...options,
      input: { role: 'editor', first_name: undefined },
    }),
  ).toMatchObject({ shared_identity: true });
  expect(memberships.changeMember).toHaveBeenCalledWith('tenant', 'user', {
    role: 'editor',
  });
  expect(users.save).not.toHaveBeenCalled();
});
it('routes owner-account shared membership updates through account-role permissions too', async () => {
  const { service, user, users, memberships } = createUsersServiceFixture();
  users.findOneBy.mockResolvedValue(user);
  memberships.hasMembershipRecord.mockResolvedValue(true);
  memberships.changeMember.mockResolvedValue(user);
  await service.updateUser({
    accountId: 'tenant',
    userId: 'user',
    currentUserId: 'admin',
    input: { role: 'viewer' },
  });
  expect(memberships.changeMember).toHaveBeenCalledTimes(1);
});
it('updates ordinary account users, preserving omitted fields and hashing administrator password changes', async () => {
  const { service, user, users } = createUsersServiceFixture();
  const options = {
    accountId: 'tenant',
    userId: 'user',
    currentUserId: 'admin',
  };
  expect(await service.updateUser({ ...options, input: {} })).toMatchObject({
    first_name: 'First',
    last_name: 'Last',
    role: 'member',
  });
  expect(
    await service.updateUser({
      ...options,
      input: {
        email: 'NEW@EXAMPLE.TEST',
        first_name: ' New ',
        last_name: '',
        role: 'editor',
        otp_required_for_login: true,
        password: 'changed password',
      },
    }),
  ).toMatchObject({
    email: 'new@example.test',
    first_name: 'New',
    last_name: null,
    role: 'editor',
    otp_required_for_login: true,
  });
  expect(await verifyPassword('changed password', user.encryptedPassword)).toBe(
    true,
  );
  expect(users.findOneByOrFail).toHaveBeenCalledWith({
    id: 'user',
    accountId: 'tenant',
  });
});
it('keeps self-updates from changing role, MFA requirement or password through the admin endpoint', async () => {
  const { service, user } = createUsersServiceFixture();
  const oldPassword = user.encryptedPassword;
  await service.updateUser({
    accountId: 'tenant',
    userId: 'user',
    currentUserId: 'user',
    input: {
      role: 'admin',
      otp_required_for_login: true,
      password: 'attempted password',
      first_name: 'Updated',
    },
  });
  expect(user).toMatchObject({
    role: 'member',
    otpRequiredForLogin: false,
    encryptedPassword: oldPassword,
    firstName: 'Updated',
  });
});
it('protects the last active administrator from demotion and removal while permitting a second admin', async () => {
  const { service, user, users } = createUsersServiceFixture();
  user.role = 'admin';
  users.count.mockResolvedValue(1);
  const options = {
    accountId: 'tenant',
    userId: 'user',
    currentUserId: 'other-admin',
  };
  await expect(
    service.updateUser({ ...options, input: { role: 'viewer' } }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(service.archiveUser(options)).rejects.toMatchObject({
    status: 403,
  });
  users.count.mockResolvedValue(2);
  expect(
    await service.updateUser({ ...options, input: { role: 'viewer' } }),
  ).toMatchObject({ role: 'viewer' });
  user.role = 'admin';
  expect((await service.archiveUser(options)).archived_at).toBeInstanceOf(Date);
});
it('rejects conflicting emails and propagates lookup/persistence failures on account user updates', async () => {
  const { service, user, users } = createUsersServiceFixture();
  const options = {
    accountId: 'tenant',
    userId: 'user',
    currentUserId: 'admin',
  };
  users.findOne.mockResolvedValueOnce({ ...user, id: 'other' });
  await expect(
    service.updateUser({ ...options, input: { email: 'taken@example.test' } }),
  ).rejects.toMatchObject({ status: 409 });
  users.findOneByOrFail.mockRejectedValueOnce(
    new EntityNotFoundError(User, {}),
  );
  await expect(
    service.updateUser({ ...options, input: {} }),
  ).rejects.toMatchObject({ status: 404 });
  users.save.mockRejectedValueOnce(new Error('offline'));
  await expect(service.updateUser({ ...options, input: {} })).rejects.toThrow(
    'offline',
  );
});
it('archives account membership before the underlying shared identity and refuses self-removal', async () => {
  const { service, user, memberships, users } = createUsersServiceFixture();
  const options = {
    accountId: 'tenant',
    userId: 'user',
    currentUserId: 'admin',
  };
  await expect(
    service.archiveUser({ ...options, currentUserId: 'user' }),
  ).rejects.toMatchObject({ status: 403 });
  memberships.changeMember.mockResolvedValueOnce(user);
  expect(await service.archiveUser(options)).toMatchObject({
    shared_identity: true,
  });
  expect(memberships.changeMember).toHaveBeenCalledWith('tenant', 'user', {
    archive: true,
  });
  expect(users.save).not.toHaveBeenCalled();
  expect((await service.archiveUser(options)).archived_at).toBeInstanceOf(Date);
  users.save.mockRejectedValue(new Error('archive failed'));
  await expect(service.archiveUser(options)).rejects.toThrow('archive failed');
});
