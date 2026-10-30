import { EntityManager, IsNull, Not } from 'typeorm';
import { membershipsFixture } from '../../test/support/account-memberships.fixture';
import { AccountMembership } from './entities/account-membership.entity';
import { User } from '../users/entities/user.entity';
it('resolves an account-specific identity without mutating the global login or original account role', async () => {
  const { service, user, account, manager } = membershipsFixture();
  const resolved = await service.resolveUser(user.id, account.id);
  expect(resolved).toBeInstanceOf(User);
  expect(resolved).toMatchObject({
    id: user.id,
    accountId: account.id,
    role: 'viewer',
    account,
  });
  expect(resolved).not.toBe(user);
  expect(user.accountId).toBe('original');
  expect(user.role).toBe('admin');
  expect(manager.findOne).toHaveBeenCalledWith(User, {
    where: { id: user.id, archivedAt: IsNull() },
    relations: { account: true },
  });
  expect(manager.findOne).toHaveBeenCalledWith(AccountMembership, {
    where: { userId: user.id, accountId: account.id },
    relations: { account: true },
  });
});
it('supports an original-account identity only when it has no explicit membership record', async () => {
  const { service, user, original, rows } = membershipsFixture();
  rows.set(AccountMembership, null);
  expect(await service.resolveUser(user.id, original.id)).toBe(user);
  expect(await service.resolveUser(user.id, 'foreign')).toBeNull();
});
it.each([
  'missing-user',
  'missing-original-account',
  'archived-original-account',
  'archived-membership',
  'unaccepted',
  'missing-account',
  'archived-account',
])('refuses inaccessible membership state %s', async (condition) => {
  const { service, user, original, account, membership, rows } =
    membershipsFixture();
  let target = account.id;
  if (condition === 'missing-user') rows.set(User, null);
  if (condition === 'missing-original-account') {
    rows.set(AccountMembership, null);
    Reflect.deleteProperty(user, 'account');
    target = original.id;
  }
  if (condition === 'archived-original-account') {
    rows.set(AccountMembership, null);
    original.archivedAt = new Date();
    target = original.id;
  }
  if (condition === 'archived-membership') membership.archivedAt = new Date();
  if (condition === 'unaccepted') membership.acceptedAt = null;
  if (condition === 'missing-account')
    Reflect.deleteProperty(membership, 'account');
  if (condition === 'archived-account') account.archivedAt = new Date();
  expect(await service.resolveUser(user.id, target)).toBeNull();
});
it('lists legacy and explicit memberships with active, invited and expired states while filtering unavailable accounts', async () => {
  const { service, user, membership, collections, manager } =
    membershipsFixture();
  collections.set(AccountMembership, [
    membership,
    { ...membership, accountId: 'invited', acceptedAt: null, expiresAt: null },
    {
      ...membership,
      accountId: 'future',
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
    {
      ...membership,
      accountId: 'expired',
      acceptedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    },
    { ...membership, account: { archivedAt: new Date() } },
    { ...membership, account: null },
  ]);
  expect(
    (await service.listAccounts(user.id)).map((item) => [item.id, item.status]),
  ).toEqual([
    ['original', 'active'],
    ['secondary', 'active'],
    ['invited', 'invited'],
    ['future', 'invited'],
    ['expired', 'expired'],
  ]);
  expect(manager.find).toHaveBeenCalledWith(AccountMembership, {
    where: { userId: user.id, archivedAt: IsNull() },
    relations: { account: true },
    order: { createdAt: 'ASC' },
  });
});
it('never restores an archived explicit original membership through the legacy-account fallback', async () => {
  const { service, user, manager, collections } = membershipsFixture();
  manager.existsBy.mockResolvedValue(true);
  collections.set(AccountMembership, []);
  expect(await service.listAccounts(user.id)).toEqual([]);
});
it.each([false, true])(
  'lists tenant member status with archive filter %s without archiving their global login',
  async (archived) => {
    const { service, account, membership, collections, manager, user } =
      membershipsFixture();
    collections.set(AccountMembership, [
      membership,
      {
        ...membership,
        acceptedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      },
      { ...membership, acceptedAt: null, expiresAt: null },
      { ...membership, user: null },
      { ...membership, user: { ...user, archivedAt: new Date() } },
    ]);
    const listed = await service.listMembers(account.id, archived);
    expect(listed.map((item) => item.status)).toEqual([
      'active',
      'expired',
      'invited',
    ]);
    expect(listed[0].user).toMatchObject({
      accountId: account.id,
      role: membership.role,
    });
    expect(user.accountId).toBe('original');
    expect(manager.find).toHaveBeenCalledWith(AccountMembership, {
      where: {
        accountId: account.id,
        archivedAt: archived ? Not(IsNull()) : IsNull(),
      },
      relations: { user: true },
    });
  },
);
it('looks up explicit tenant membership records and normalizes membership identity sets', async () => {
  const { service, account, user, collections, manager } = membershipsFixture();
  collections.set(AccountMembership, [
    { userId: 1 },
    { userId: '1' },
    { userId: '2' },
  ]);
  expect(await service.membershipUserIds(account.id)).toEqual(
    new Set(['1', '2']),
  );
  expect(await service.hasMembershipRecord(account.id, user.id)).toBe(false);
  expect(manager.existsBy).toHaveBeenCalledWith(AccountMembership, {
    accountId: account.id,
    userId: user.id,
  });
});
it('does not list a missing or archived legacy account as available', async () => {
  const { service, user, collections, original } = membershipsFixture();
  collections.set(AccountMembership, []);
  original.archivedAt = new Date();
  expect(await service.listAccounts(user.id)).toEqual([]);
  Reflect.deleteProperty(user, 'account');
  expect(await service.listAccounts(user.id)).toEqual([]);
});
it('resolves through an explicitly supplied transaction manager', async () => {
  const { service, user, account, manager } = membershipsFixture();
  expect(
    await service.resolveUser(
      user.id,
      account.id,
      manager as unknown as EntityManager,
    ),
  ).toMatchObject({ accountId: account.id });
  expect(manager.findOne).toHaveBeenCalledWith(
    AccountMembership,
    expect.objectContaining({
      where: { accountId: account.id, userId: user.id },
    }),
  );
});
