import { IsNull, Not, QueryFailedError } from 'typeorm';
import { teamsFixture } from '../../test/support/teams-service.fixture';
const tenant = { accountId: 'account', teamId: 'team' };
it('creates default teams with unique tenant-scoped slugs and a manager membership', async () => {
  const { service, teams, members } = teamsFixture();
  teams.existsBy
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  const created = await service.createDefaultTeam({
    accountId: tenant.accountId,
    userId: 'user',
    name: 'Legal',
  });
  expect(created.slug).toBe('legal-3');
  expect(teams.existsBy.mock.calls).toEqual([
    [{ accountId: 'account', slug: 'legal' }],
    [{ accountId: 'account', slug: 'legal-2' }],
    [{ accountId: 'account', slug: 'legal-3' }],
  ]);
  expect(members.create).toHaveBeenCalledWith({
    accountId: 'account',
    teamId: 'generated',
    userId: 'user',
    role: 'manager',
  });
});
it.each([undefined, 'archived'])(
  'lists account teams with status %s and active member counts',
  async (status) => {
    const { service, teams, team, member } = teamsFixture();
    team.members = [
      member,
      { ...member, id: 'archived', archivedAt: new Date() },
    ];
    teams.find.mockResolvedValue([team]);
    expect(
      await service.listTeams({ accountId: 'account', status }),
    ).toMatchObject([{ id: 'team', members_count: 1 }]);
    expect(teams.find).toHaveBeenCalledWith({
      where: {
        accountId: 'account',
        archivedAt: status === 'archived' ? Not(IsNull()) : IsNull(),
      },
      relations: { members: true },
      order: { id: 'DESC' },
    });
  },
);
it('creates teams only for account admins and adds their manager membership', async () => {
  const { service, user, teams, members } = teamsFixture();
  await service.createTeam({
    accountId: 'account',
    user,
    input: { name: '  Finance  ', description: 'Budget review' },
  });
  expect(teams.create).toHaveBeenCalledWith({
    accountId: 'account',
    createdByUserId: user.id,
    name: 'Finance',
    description: 'Budget review',
    slug: 'finance',
  });
  expect(members.create).toHaveBeenCalledWith(
    expect.objectContaining({ role: 'manager', userId: user.id }),
  );
  user.role = 'viewer';
  await expect(
    service.createTeam({
      accountId: 'account',
      user,
      input: { name: 'Forbidden' },
    }),
  ).rejects.toMatchObject({ status: 403 });
});
it('defaults missing team descriptions and rejects missing/foreign account teams', async () => {
  const { service, user, teams } = teamsFixture();
  await service.createTeam({
    accountId: 'account',
    user,
    input: { name: 'Legal' },
  });
  expect(teams.create).toHaveBeenCalledWith(
    expect.objectContaining({ description: null }),
  );
  teams.findOne.mockResolvedValue(null);
  await expect(
    service.getTeam({ accountId: 'foreign', teamId: 'team' }),
  ).rejects.toMatchObject({ status: 404 });
  expect(teams.findOne).toHaveBeenLastCalledWith({
    where: { accountId: 'foreign', id: 'team', archivedAt: IsNull() },
    relations: { members: true },
  });
});
it('lets team managers update names/descriptions and archive their own team', async () => {
  const { service, user, team, members } = teamsFixture();
  user.role = 'member';
  expect(
    await service.updateTeam({
      ...tenant,
      actor: user,
      input: { name: '  New name  ', description: 'Updated' },
    }),
  ).toMatchObject({ name: 'New name', description: 'Updated' });
  await service.updateTeam({ ...tenant, actor: user, input: {} });
  expect(team.description).toBe('Updated');
  await service.updateTeam({
    ...tenant,
    actor: user,
    input: { description: null },
  });
  expect(team.description).toBeNull();
  expect(await service.archiveTeam({ ...tenant, actor: user })).toMatchObject({
    archived_at: expect.any(Date) as unknown,
  });
  expect(members.findOneBy).toHaveBeenCalledWith({
    userId: user.id,
    teamId: 'team',
    role: 'manager',
    archivedAt: IsNull(),
  });
});
it('denies management actions to account users who are not team managers', async () => {
  const { service, user, members } = teamsFixture();
  user.role = 'editor';
  members.findOneBy.mockResolvedValue(null);
  await expect(
    service.updateTeam({ ...tenant, actor: user, input: {} }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.archiveTeam({ ...tenant, actor: user }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.assertCanUseTeamAction({ ...tenant, actor: user }),
  ).rejects.toMatchObject({ status: 403 });
});
it('checks active team existence for actions even when the actor is an account admin', async () => {
  const { service, user, teams } = teamsFixture();
  await expect(
    service.assertCanUseTeamAction({ ...tenant, actor: user }),
  ).resolves.toBeUndefined();
  teams.findOne.mockResolvedValue(null);
  await expect(
    service.assertCanUseTeamAction({ ...tenant, actor: user }),
  ).rejects.toMatchObject({ status: 404 });
});
it('maps unique database failures and preserves other persistence errors', async () => {
  const { service, user, teams } = teamsFixture();
  const error = new Error('database unavailable');
  teams.save.mockRejectedValueOnce(error);
  await expect(
    service.createTeam({
      accountId: 'account',
      user,
      input: { name: 'Legal' },
    }),
  ).rejects.toThrow(error);
  teams.save.mockRejectedValueOnce(
    new QueryFailedError(
      'UPDATE',
      [],
      Object.assign(new Error('duplicate'), { code: '23505' }),
    ),
  );
  await expect(
    service.updateTeam({
      ...tenant,
      actor: user,
      input: { name: 'Duplicate' },
    }),
  ).rejects.toMatchObject({ status: 409 });
  teams.save.mockRejectedValueOnce(error);
  await expect(service.archiveTeam({ ...tenant, actor: user })).rejects.toThrow(
    error,
  );
});
