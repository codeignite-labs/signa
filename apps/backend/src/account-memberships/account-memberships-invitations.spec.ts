import { createHash } from 'node:crypto';
import { IsNull } from 'typeorm';
import { membershipsFixture } from '../../test/support/account-memberships.fixture';
import { AccountMembership } from './entities/account-membership.entity';
import { Account } from '../accounts/entities/account.entity';
import { Team } from '../teams/entities/team.entity';
import { TeamInvitation } from '../teams/entities/team-invitation.entity';
import { TeamMember } from '../teams/entities/team-member.entity';
it('invites an existing global identity into a new account without duplicating or changing its original login', async () => {
  const { service, user, account, members, mail, manager } =
    membershipsFixture();
  const invited = await service.invite(account.id, user, 'editor');
  expect(invited).toMatchObject({
    id: user.id,
    accountId: account.id,
    role: 'editor',
  });
  expect(user.accountId).toBe('original');
  expect(members.create).toHaveBeenCalledWith(
    expect.objectContaining({
      accountId: account.id,
      userId: user.id,
      role: 'editor',
      acceptedAt: null,
      archivedAt: null,
    }),
  );
  expect(mail.sendAccountInvitation).toHaveBeenCalledWith({
    accountId: account.id,
    accountName: account.name,
    email: user.email,
    firstName: user.firstName,
  });
  expect(manager.findOneByOrFail).toHaveBeenCalledWith(Account, {
    id: account.id,
    archivedAt: IsNull(),
  });
});
it('rejects inactive identities and existing active memberships but permits renewed pending/archived invitations', async () => {
  const { service, user, account, membership, members } = membershipsFixture();
  user.archivedAt = new Date();
  await expect(
    service.invite(account.id, user, 'member'),
  ).rejects.toMatchObject({ status: 403 });
  user.archivedAt = null;
  members.findOneBy.mockResolvedValue(membership);
  await expect(
    service.invite(account.id, user, 'member'),
  ).rejects.toMatchObject({ status: 409 });
  membership.archivedAt = new Date();
  await service.invite(account.id, user, 'member');
  expect(members.create).toHaveBeenLastCalledWith(
    expect.objectContaining({
      id: membership.id,
      archivedAt: null,
      acceptedAt: null,
    }),
  );
  membership.acceptedAt = null;
  membership.archivedAt = null;
  await expect(
    service.invite(account.id, user, 'viewer'),
  ).resolves.toMatchObject({ role: 'viewer' });
});
it.each(['missing', 'expired', 'no-expiry'])(
  'refuses %s account invitations without activating them',
  async (state) => {
    const { service, user, account, rows, membership, manager } =
      membershipsFixture();
    membership.acceptedAt = null;
    if (state === 'missing') rows.set(AccountMembership, null);
    else
      membership.expiresAt =
        state === 'expired' ? new Date(Date.now() - 1000) : null;
    await expect(service.accept(account.id, user.id)).rejects.toMatchObject({
      status: state === 'missing' ? 404 : 403,
    });
    expect(manager.save).not.toHaveBeenCalled();
  },
);
it('accepts an account invitation under a row lock and makes repeated acceptance idempotent', async () => {
  const { service, user, account, membership, manager } = membershipsFixture();
  membership.acceptedAt = null;
  membership.expiresAt = new Date(Date.now() + 86_400_000);
  expect(await service.accept(account.id, user.id)).toMatchObject({
    accountId: account.id,
    role: membership.role,
  });
  expect(manager.findOne).toHaveBeenCalledWith(AccountMembership, {
    where: { accountId: account.id, userId: user.id, archivedAt: IsNull() },
    lock: { mode: 'pessimistic_write' },
  });
  expect(membership.acceptedAt).toBeInstanceOf(Date);
  manager.save.mockClear();
  await service.accept(account.id, user.id);
  expect(manager.save).not.toHaveBeenCalled();
});
it('refuses an unavailable account even after invitation acceptance', async () => {
  const { service, user, account } = membershipsFixture();
  account.archivedAt = new Date();
  await expect(service.accept(account.id, user.id)).rejects.toMatchObject({
    status: 403,
    message: 'Account is unavailable',
  });
});
it.each([
  'missing',
  'expired',
  'wrong-email',
  'missing-team',
  'missing-account',
])(
  'rejects team invitation state %s before adding any membership',
  async (state) => {
    const { service, user, invitation, rows, manager } = membershipsFixture();
    if (state === 'missing') rows.set(TeamInvitation, null);
    if (state === 'expired') invitation.expiresAt = new Date(Date.now() - 1000);
    if (state === 'wrong-email') invitation.email = 'other@example.test';
    if (state === 'missing-team') rows.set(Team, null);
    if (state === 'missing-account') rows.set(Account, null);
    await expect(
      service.acceptTeamInvitation('raw-token', user),
    ).rejects.toMatchObject({ status: 403 });
    expect(manager.save).not.toHaveBeenCalled();
  },
);
it('accepts same-email team invitations under locks, preserving an existing active team role', async () => {
  const { service, user, invitation, rows, account, team, manager } =
    membershipsFixture();
  invitation.email = user.email.toUpperCase();
  const existing = Object.assign(new TeamMember(), {
    id: 'member',
    role: 'viewer',
    archivedAt: null,
  });
  rows.set(TeamMember, existing);
  const joined = await service.acceptTeamInvitation('raw-token', user);
  expect(joined).toMatchObject({
    id: 'member',
    accountId: account.id,
    teamId: team.id,
    userId: user.id,
    role: 'viewer',
    archivedAt: null,
  });
  expect(joined.user).toMatchObject({ accountId: account.id, role: 'viewer' });
  expect(invitation.status).toBe('accepted');
  expect(invitation.acceptedAt).toBeInstanceOf(Date);
  expect(manager.findOne).toHaveBeenCalledWith(TeamInvitation, {
    where: {
      tokenHash: createHash('sha256').update('raw-token').digest('hex'),
      status: 'pending',
    },
    lock: { mode: 'pessimistic_write' },
  });
  expect(manager.findOne).toHaveBeenCalledWith(Account, {
    where: { id: account.id, archivedAt: IsNull() },
    lock: { mode: 'pessimistic_write' },
  });
});
it.each(['missing', 'pending', 'archived'])(
  'joins a %s account membership through a team invitation without restoring archived admin privileges',
  async (state) => {
    const { service, user, account, membership, rows, manager } =
      membershipsFixture();
    const existing =
      state === 'missing'
        ? null
        : {
            ...membership,
            role: 'admin',
            acceptedAt: null,
            archivedAt: state === 'archived' ? new Date() : null,
          };
    rows.set(AccountMembership, existing);
    // The fake persistence boundary reflects the membership written in this transaction.
    manager.save.mockImplementation((...input) => {
      const entity = input.at(-1);
      if (entity instanceof AccountMembership)
        rows.set(AccountMembership, Object.assign(entity, { account, user }));
      return Promise.resolve(entity);
    });
    const joined = await service.acceptTeamInvitation('raw-token', user);
    const created = manager.create.mock.calls.find(
      ([Entity]) => Entity === AccountMembership,
    )?.[1] as Partial<AccountMembership>;
    expect(created).toMatchObject({
      accountId: account.id,
      userId: user.id,
      role: state === 'pending' ? 'admin' : 'member',
      archivedAt: null,
    });
    expect(created.acceptedAt).toBeInstanceOf(Date);
    expect(joined.role).toBe('manager');
  },
);
it('reinstates an archived team member using the invitation role rather than stale team privileges', async () => {
  const { service, user, rows, invitation } = membershipsFixture();
  invitation.role = 'viewer';
  rows.set(
    TeamMember,
    Object.assign(new TeamMember(), {
      id: 'member',
      role: 'manager',
      archivedAt: new Date(),
    }),
  );
  expect(await service.acceptTeamInvitation('raw-token', user)).toMatchObject({
    id: 'member',
    role: 'viewer',
    archivedAt: null,
  });
});
