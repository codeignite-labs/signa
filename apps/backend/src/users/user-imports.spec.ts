import {
  BadRequestException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { createUsersServiceFixture } from '../../test/support/user-service.fixture';
import { TeamMember } from '../teams/entities/team-member.entity';
import { Team } from '../teams/entities/team.entity';
it('imports a new user and creates a tenant team with a collision-free slug and owner', async () => {
  const { service, user, users, teams, teamMembers } =
    createUsersServiceFixture();
  users.findOne
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ ...user, id: 'owner', role: 'admin' });
  teams.existsBy
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockResolvedValue(false);
  const result = await service.importUsers('tenant', {
    users: [{ email: 'NEW@EXAMPLE.TEST', first_name: 'New', team: ' Legal ' }],
  });
  expect(result).toMatchObject({
    total: 1,
    created: 1,
    restored: 0,
    skipped: 0,
    failed: 0,
    results: [{ row: 1, email: 'new@example.test', status: 'created' }],
  });
  expect(teams.create).toHaveBeenCalledWith({
    accountId: 'tenant',
    createdByUserId: 'owner',
    description: null,
    name: 'Legal',
    slug: 'legal-3',
  });
  expect(teamMembers.create).toHaveBeenCalledWith({
    accountId: 'tenant',
    role: 'member',
    teamId: 'team',
    userId: 'user',
  });
});
it('restores an archived user and previously archived team membership without creating duplicates', async () => {
  const { service, user, users, teams, teamMembers } =
    createUsersServiceFixture();
  user.archivedAt = new Date();
  users.findOne.mockResolvedValue(user);
  teams.findOneBy.mockResolvedValue(Object.assign(new Team(), { id: 'team' }));
  const membership: TeamMember = Object.assign(new TeamMember(), {
    archivedAt: new Date(),
    role: 'manager',
  });
  teamMembers.findOne.mockResolvedValue(membership);
  expect(
    await service.importUsers('tenant', {
      users: [{ email: user.email, team: 'Legal' }],
    }),
  ).toMatchObject({ restored: 1, created: 0, failed: 0 });
  expect(membership).toMatchObject({ archivedAt: null, role: 'member' });
  expect(teamMembers.save).toHaveBeenCalledWith(membership);
  expect(teamMembers.create).not.toHaveBeenCalled();
  expect(teams.create).not.toHaveBeenCalled();
});
it('skips existing users, avoids empty team names and counts row results independently', async () => {
  const { service, user, users, teams } = createUsersServiceFixture();
  users.findOne
    .mockResolvedValueOnce(user)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null);
  expect(
    await service.importUsers('tenant', {
      users: [
        { email: 'EXISTING@EXAMPLE.TEST' },
        { email: 'new@example.test', team: ' ' },
      ],
    }),
  ).toMatchObject({
    total: 2,
    skipped: 1,
    created: 1,
    failed: 0,
    results: [
      {
        row: 1,
        email: 'existing@example.test',
        status: 'skipped',
        message: 'Email already exists',
      },
      { row: 2, email: 'new@example.test', status: 'created' },
    ],
  });
  expect(teams.findOneBy).not.toHaveBeenCalled();
  expect(await service.importUsers('tenant', { users: [] })).toEqual({
    total: 0,
    created: 0,
    restored: 0,
    skipped: 0,
    failed: 0,
    results: [],
  });
});
it('reports a missing team owner as a row failure without aborting the import operation', async () => {
  const { service } = createUsersServiceFixture();
  expect(
    await service.importUsers('tenant', {
      users: [{ email: 'new@example.test', team: 'Legal' }],
    }),
  ).toMatchObject({
    failed: 1,
    results: [{ row: 1, status: 'failed', message: 'Team owner not found' }],
  });
});
it.each([
  [
    new ConflictException({ error: 'Duplicate identity' }),
    'skipped',
    'Duplicate identity',
  ],
  [
    new BadRequestException({ error: 'Invalid import row' }),
    'failed',
    'Invalid import row',
  ],
  [
    new HttpException('Service unavailable', 503),
    'failed',
    'Service unavailable',
  ],
  [new Error('Database unavailable'), 'failed', 'Database unavailable'],
  ['unexpected failure', 'failed', 'Unable to import user'],
])(
  'preserves actionable row-level failure details for %s',
  async (failure, status, message) => {
    const { service, users } = createUsersServiceFixture();
    users.findOne.mockRejectedValueOnce(failure);
    expect(
      await service.importUsers('tenant', {
        users: [{ email: 'user@example.test' }],
      }),
    ).toMatchObject({
      results: [{ row: 1, email: 'user@example.test', status, message }],
    });
  },
);
