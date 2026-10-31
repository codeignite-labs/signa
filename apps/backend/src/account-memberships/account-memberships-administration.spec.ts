import { IsNull, Not } from 'typeorm';
import { membershipsFixture } from '../../test/support/account-memberships.fixture';
import { AccountMembership } from './entities/account-membership.entity';
import { Account } from '../accounts/entities/account.entity';
import { User } from '../users/entities/user.entity';
it('changes account roles and archives only the selected membership, preserving the login identity', async () => {
  const { service, user, account, membership, manager } = membershipsFixture();
  expect(
    await service.changeMember(account.id, user.id, { role: 'editor' }),
  ).toMatchObject({ accountId: account.id, role: 'editor' });
  expect(membership.role).toBe('editor');
  expect(user.role).toBe('admin');
  expect(
    await service.changeMember(account.id, user.id, { archive: true }),
  ).toMatchObject({ archivedAt: expect.any(Date) as unknown });
  expect(user.archivedAt).toBeNull();
  expect(manager.findOne).toHaveBeenCalledWith(Account, {
    where: { id: account.id },
    lock: { mode: 'pessimistic_write' },
  });
});
it.each(['missing-user', 'not-archiving'])(
  'returns no membership when the legacy target is %s',
  async (state) => {
    const { service, user, account, rows, manager } = membershipsFixture();
    rows.set(AccountMembership, null);
    if (state === 'missing-user') rows.set(User, null);
    expect(
      await service.changeMember(account.id, user.id, {
        archive: state === 'missing-user',
      }),
    ).toBeNull();
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.findOneBy).toHaveBeenCalledWith(User, {
      id: user.id,
      accountId: account.id,
    });
  },
);
it('creates an explicit archived membership for a legacy user to prevent its original account fallback from restoring access', async () => {
  const { service, user, original, rows, manager } = membershipsFixture();
  user.role = 'viewer';
  rows.set(AccountMembership, null);
  expect(
    await service.changeMember(original.id, user.id, { archive: true }),
  ).toMatchObject({
    accountId: original.id,
    role: 'viewer',
    archivedAt: expect.any(Date) as unknown,
  });
  expect(manager.create).toHaveBeenCalledWith(
    AccountMembership,
    expect.objectContaining({
      accountId: original.id,
      userId: user.id,
      role: 'viewer',
      acceptedAt: expect.any(Date) as unknown,
    }),
  );
});
it.each([{ archive: true }, { role: 'viewer' }])(
  'protects the last active admin against %s',
  async (input) => {
    const { service, user, account, membership, collections, manager } =
      membershipsFixture();
    membership.role = 'admin';
    collections.set(AccountMembership, []);
    await expect(
      service.changeMember(account.id, user.id, input),
    ).rejects.toMatchObject({
      status: 403,
      message: 'At least one active admin is required',
    });
    expect(manager.save).not.toHaveBeenCalled();
  },
);
it('preserves the last-admin invariant when listed candidates no longer resolve to an active admin', async () => {
  const { service, user, account, membership, collections, manager } =
    membershipsFixture();
  membership.role = 'admin';
  collections.set(User, [Object.assign(new User(), { id: 'stale-admin' })]);
  collections.set(AccountMembership, []);
  manager.findOne.mockImplementation((Entity, options) => {
    const where = (options as { where: { id?: string } }).where;
    if (Entity === User && where.id === 'stale-admin')
      return Promise.resolve(null);
    return Promise.resolve(
      Entity === AccountMembership
        ? membership
        : Entity === Account
          ? account
          : user,
    );
  });
  await expect(
    service.changeMember(account.id, user.id, { archive: true }),
  ).rejects.toMatchObject({ status: 403 });
  expect(manager.save).not.toHaveBeenCalled();
});
it.each([false, true])(
  'permits admin demotion when another admin has an active %s membership',
  async (explicitMembership) => {
    const { service, user, account, membership, collections, manager } =
      membershipsFixture();
    membership.role = 'admin';
    const other: User = Object.assign(new User(), {
      id: 'other-admin',
      accountId: explicitMembership ? 'foreign' : account.id,
      account,
      role: explicitMembership ? 'viewer' : 'admin',
      archivedAt: null,
    });
    const otherMembership = explicitMembership
      ? Object.assign(new AccountMembership(), {
          accountId: account.id,
          account,
          userId: other.id,
          role: 'admin',
          acceptedAt: new Date(),
          archivedAt: null,
        })
      : null;
    collections.set(User, explicitMembership ? [] : [other]);
    collections.set(
      AccountMembership,
      otherMembership ? [otherMembership] : [],
    );
    manager.findOne.mockImplementation((Entity, options) => {
      const where = (options as { where: { id?: string; userId?: string } })
        .where;
      if (Entity === User)
        return Promise.resolve(where.id === other.id ? other : user);
      if (Entity === AccountMembership)
        return Promise.resolve(
          where.userId === other.id ? otherMembership : membership,
        );
      return Promise.resolve(account);
    });
    expect(
      await service.changeMember(account.id, user.id, { role: 'viewer' }),
    ).toMatchObject({ role: 'viewer' });
    expect(manager.find).toHaveBeenCalledWith(User, {
      where: {
        accountId: account.id,
        role: 'admin',
        archivedAt: IsNull(),
        id: Not(user.id),
      },
    });
    expect(manager.find).toHaveBeenCalledWith(AccountMembership, {
      where: {
        accountId: account.id,
        role: 'admin',
        archivedAt: IsNull(),
        acceptedAt: Not(IsNull()),
        userId: Not(user.id),
      },
    });
  },
);
it('does not require another admin for a no-op admin role update or ordinary member changes', async () => {
  const { service, user, account, membership, manager } = membershipsFixture();
  membership.role = 'admin';
  await service.changeMember(account.id, user.id, { role: 'admin' });
  expect(manager.find).not.toHaveBeenCalled();
  membership.role = 'viewer';
  await service.changeMember(account.id, user.id, { role: '' });
  expect(membership.role).toBe('viewer');
});
