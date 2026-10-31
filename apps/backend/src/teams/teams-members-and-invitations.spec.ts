import { createHash } from 'node:crypto';
import { IsNull } from 'typeorm';
import { teamsFixture } from '../../test/support/teams-service.fixture';
const tenant = { accountId: 'account', teamId: 'team' };
it('lists team members and invitations with tenant scope, including archived parent teams', async () => {
  const { service, teams, members, member, invitations, invitation } =
    teamsFixture();
  members.find.mockResolvedValue([member]);
  invitations.find.mockResolvedValue([invitation]);
  expect(await service.listMembers(tenant)).toMatchObject([
    { user_id: 'user', role: 'manager', user: { account_role: 'admin' } },
  ]);
  expect(members.find).toHaveBeenCalledWith({
    where: { accountId: 'account', teamId: 'team', archivedAt: IsNull() },
    relations: { user: true },
    order: { id: 'ASC' },
  });
  expect(await service.listInvitations(tenant)).toMatchObject([
    { id: 'invitation', email: 'invitee@example.test' },
  ]);
  expect(teams.findOne).toHaveBeenLastCalledWith({
    where: { accountId: 'account', id: 'team' },
    relations: { members: true },
  });
});
it('adds only active account members, defaults unrecognized roles and revives archived team memberships', async () => {
  const { service, user, members, member, memberships } = teamsFixture();
  expect(
    await service.addMember({
      ...tenant,
      actor: user,
      input: { user_id: user.id, role: 'invalid' },
    }),
  ).toMatchObject({ role: 'member' });
  expect(memberships.resolveUser).toHaveBeenCalledWith(
    user.id,
    'account',
    expect.anything(),
  );
  member.archivedAt = new Date();
  members.findOne.mockResolvedValue(member);
  expect(
    await service.addMember({
      ...tenant,
      actor: user,
      input: { user_id: user.id, role: 'viewer' },
    }),
  ).toMatchObject({ role: 'viewer', archived_at: null });
  memberships.resolveUser.mockResolvedValue(null);
  await expect(
    service.addMember({
      ...tenant,
      actor: user,
      input: { user_id: 'foreign' },
    }),
  ).rejects.toMatchObject({ status: 404 });
});
it('does not bypass management authorization while adding or changing team memberships', async () => {
  const { service, user, members } = teamsFixture();
  user.role = 'viewer';
  members.findOneBy.mockResolvedValue(null);
  await expect(
    service.addMember({ ...tenant, actor: user, input: { user_id: user.id } }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.updateMember({
      ...tenant,
      actor: user,
      memberId: 'member',
      input: { role: 'manager' },
    }),
  ).rejects.toMatchObject({ status: 403 });
});
it('protects the last manager from demotion or removal and permits changes once another manager exists', async () => {
  const { service, user, members, member } = teamsFixture();
  members.findOne.mockResolvedValue(member);
  members.count.mockResolvedValue(1);
  await expect(
    service.updateMember({
      ...tenant,
      actor: user,
      memberId: 'member',
      input: { role: 'viewer' },
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    service.removeMember({ ...tenant, actor: user, memberId: 'member' }),
  ).rejects.toMatchObject({ status: 400 });
  expect(members.save).not.toHaveBeenCalled();
  members.count.mockResolvedValue(2);
  expect(
    await service.updateMember({
      ...tenant,
      actor: user,
      memberId: 'member',
      input: { role: 'member' },
    }),
  ).toMatchObject({ role: 'member' });
  expect(
    await service.removeMember({ ...tenant, actor: user, memberId: 'member' }),
  ).toMatchObject({ archived_at: expect.any(Date) as unknown });
});
it('allows a manager to retain their own role and updates ordinary member roles without changing other members', async () => {
  const { service, user, members, member } = teamsFixture();
  members.findOne.mockResolvedValue(member);
  expect(
    await service.updateMember({
      ...tenant,
      actor: user,
      memberId: 'member',
      input: { role: 'manager' },
    }),
  ).toMatchObject({ role: 'manager' });
  expect(members.count).not.toHaveBeenCalled();
  member.role = 'viewer';
  expect(
    await service.updateMember({
      ...tenant,
      actor: user,
      memberId: 'member',
      input: { role: 'member' },
    }),
  ).toMatchObject({ role: 'member' });
});
it('rejects missing or foreign team member/invitation records and preserves write failures', async () => {
  const { service, user, members, invitations } = teamsFixture();
  members.findOne.mockResolvedValue(null);
  await expect(
    service.updateMember({
      ...tenant,
      actor: user,
      memberId: 'foreign',
      input: { role: 'member' },
    }),
  ).rejects.toMatchObject({ status: 404 });
  invitations.findOneBy.mockResolvedValue(null);
  await expect(
    service.revokeInvitation({
      ...tenant,
      actor: user,
      invitationId: 'foreign',
    }),
  ).rejects.toMatchObject({ status: 404 });
  const error = new Error('database unavailable');
  members.save.mockRejectedValueOnce(error);
  await expect(
    service.addMember({ ...tenant, actor: user, input: { user_id: user.id } }),
  ).rejects.toThrow(error);
});
it.each([false, true])(
  'sends a tenant invitation with normalized email, hashed token and inviter identity fallback %s',
  async (useFallback) => {
    const { service, user, invitations, mail } = teamsFixture();
    if (useFallback) {
      user.firstName = '';
      user.lastName = null;
      Reflect.deleteProperty(user, 'account');
    }
    const response = await service.createInvitation({
      ...tenant,
      actor: user,
      input: { email: 'INVITEE@EXAMPLE.TEST', role: 'viewer' },
    });
    expect(response.accept_token).toHaveLength(43);
    const created = invitations.create.mock.calls[0][0];
    expect(created.email).toBe('invitee@example.test');
    expect(created.tokenHash).toBe(
      createHash('sha256').update(response.accept_token!).digest('hex'),
    );
    expect(created.tokenHash).not.toBe(response.accept_token);
    expect(created.expiresAt!.getTime() - Date.now()).toBeGreaterThan(
      6.9 * 86_400_000,
    );
    expect(mail.sendTeamInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'invitee@example.test',
        accountName: useFallback ? 'Legal' : 'Example organization',
        inviterName: useFallback ? user.email : 'Casey Example',
        token: response.accept_token,
      }),
    );
  },
);
it('records revocation only for pending invitations and delegates token acceptance to the account membership transaction', async () => {
  const { service, user, invitation, memberships } = teamsFixture();
  expect(
    await service.revokeInvitation({
      ...tenant,
      actor: user,
      invitationId: invitation.id,
    }),
  ).toMatchObject({ status: 'revoked' });
  invitation.status = 'accepted';
  expect(
    await service.revokeInvitation({
      ...tenant,
      actor: user,
      invitationId: invitation.id,
    }),
  ).toMatchObject({ status: 'accepted' });
  expect(
    await service.acceptInvitation({ token: 'token', user }),
  ).toMatchObject({ user_id: user.id });
  expect(memberships.acceptTeamInvitation).toHaveBeenCalledWith('token', user);
});
it('surfaces failed invitation persistence or delivery without falsely returning an accept token', async () => {
  const { service, user, invitations, mail } = teamsFixture();
  const error = new Error('delivery failed');
  invitations.save.mockRejectedValueOnce(error);
  await expect(
    service.createInvitation({
      ...tenant,
      actor: user,
      input: { email: user.email },
    }),
  ).rejects.toThrow(error);
  mail.sendTeamInvitation.mockRejectedValueOnce(error);
  await expect(
    service.createInvitation({
      ...tenant,
      actor: user,
      input: { email: user.email },
    }),
  ).rejects.toThrow(error);
});
it('does not let the add-member endpoint demote the last active manager', async () => {
  const { service, user, members, member } = teamsFixture();
  members.findOne.mockResolvedValue(member);
  members.count.mockResolvedValue(1);
  await expect(
    service.addMember({
      ...tenant,
      actor: user,
      input: { user_id: user.id, role: 'viewer' },
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(members.save).not.toHaveBeenCalled();
});
