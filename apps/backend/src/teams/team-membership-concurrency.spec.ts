import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { IsNull } from 'typeorm';
import { createTeamRaceApplication } from '../../test/support/team-race-application.fixture';
import { AccountMembershipsService } from '../account-memberships/account-memberships.service';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';
import { TeamsService } from './teams.service';
import { Team } from './entities/team.entity';
import { TeamMember } from './entities/team-member.entity';
import { TeamInvitation } from './entities/team-invitation.entity';

type Session = {
  access_token: string;
  user: { id: string };
  account: { id: string };
};
type Operation = 'add' | 'update' | 'remove';
let runtime: Awaited<ReturnType<typeof createTeamRaceApplication>>;
let session: Session;
let actor: User;
let target: User;
let team: Team;
let members: TeamMember[];
const auth = () => ({ Authorization: `Bearer ${session.access_token}` });

beforeAll(async () => {
  runtime = await createTeamRaceApplication();
  // Real database latency makes both count-before-write requests overlap in the
  // unfixed implementation. The production methods and repositories stay real.
  await runtime.source.query(
    `CREATE FUNCTION delay_membership_write() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END; $$ LANGUAGE plpgsql`,
  );
  await runtime.source.query(
    `CREATE TRIGGER delay_membership_write BEFORE UPDATE ON team_members FOR EACH ROW EXECUTE FUNCTION delay_membership_write()`,
  );
}, 60000);
afterAll(async () => {
  await runtime?.close();
});
beforeEach(async () => {
  const response = await request(runtime.app.getHttpServer())
    .post('/api/auth/register')
    .send({
      account_name: 'Race fixture',
      first_name: 'Owner',
      last_name: 'Fixture',
      email: `${randomUUID()}@example.test`,
      password: 'Fixture-password-123',
    })
    .expect(201);
  session = response.body as Session;
  actor = await runtime.source.getRepository(User).findOneOrFail({
    where: { id: session.user.id },
    relations: { account: true },
  });
  const created = await request(runtime.app.getHttpServer())
    .post('/api/users')
    .set(auth())
    .send({
      email: `${randomUUID()}@example.test`,
      password: 'Fixture-password-123',
      role: 'member',
    })
    .expect(201);
  target = await runtime.source
    .getRepository(User)
    .findOneByOrFail({ id: (created.body as { id: string }).id });
  team = await runtime.source
    .getRepository(Team)
    .findOneByOrFail({ accountId: session.account.id });
  await request(runtime.app.getHttpServer())
    .post(`/api/teams/${team.id}/members`)
    .set(auth())
    .send({ user_id: String(target.id), role: 'manager' })
    .expect(201);
  members = await runtime.source
    .getRepository(TeamMember)
    .find({ where: { teamId: String(team.id) }, order: { id: 'ASC' } });
});
function independentService() {
  const source = runtime.source;
  return new TeamsService(
    source.getRepository(Team),
    source.getRepository(TeamMember),
    source.getRepository(TeamInvitation),
    source.getRepository(User),
    runtime.app.get(MailService),
    runtime.app.get(AccountMembershipsService),
  );
}
async function change(
  service: TeamsService,
  operation: Operation,
  member: TeamMember,
) {
  const options = {
    accountId: session.account.id,
    teamId: String(team.id),
    actor,
  };
  if (operation === 'add')
    return service.addMember({
      ...options,
      input: { user_id: member.userId, role: 'member' },
    });
  if (operation === 'update')
    return service.updateMember({
      ...options,
      memberId: String(member.id),
      input: { role: 'member' },
    });
  return service.removeMember({ ...options, memberId: String(member.id) });
}
it.each<[Operation, Operation]>([
  ['add', 'add'],
  ['update', 'update'],
  ['remove', 'remove'],
  ['add', 'remove'],
  ['update', 'remove'],
  ['add', 'update'],
])(
  'retains one manager under concurrent %s/%s requests',
  async (first, second) => {
    const results = await Promise.allSettled([
      change(independentService(), first, members[0]),
      change(independentService(), second, members[1]),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason as unknown).toMatchObject({
      status: 400,
      response: { error: 'A team must have at least one manager' },
    });
    expect(
      await runtime.source.getRepository(TeamMember).count({
        where: {
          accountId: session.account.id,
          teamId: String(team.id),
          role: 'manager',
          archivedAt: IsNull(),
        },
      }),
    ).toBe(1);
  },
);
it.each([false, true])(
  'restores an imported user while respecting archived team-role restoration=%s',
  async (archived) => {
    await runtime.source
      .getRepository(User)
      .update({ id: target.id }, { archivedAt: new Date() });
    if (archived)
      await runtime.source
        .getRepository(TeamMember)
        .update({ id: members[1].id }, { archivedAt: new Date() });
    const response = await request(runtime.app.getHttpServer())
      .post('/api/users/import')
      .set(auth())
      .send({ users: [{ email: target.email, team: team.name }] })
      .expect(201);
    expect(response.body as unknown).toMatchObject({
      restored: 1,
      created: 0,
      failed: 0,
    });
    const restored = await runtime.source
      .getRepository(TeamMember)
      .findOneByOrFail({ id: members[1].id });
    expect(restored.archivedAt).toBeNull();
    expect(restored.role).toBe(archived ? 'member' : 'manager');
  },
);
it('serializes invitation acceptance behind the same team row lock', async () => {
  const token = randomUUID();
  await runtime.source.getRepository(TeamInvitation).save({
    accountId: session.account.id,
    teamId: String(team.id),
    createdByUserId: actor.id,
    email: target.email,
    role: 'member',
    status: 'pending',
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 60000),
  });
  const blocker = runtime.source.createQueryRunner();
  await blocker.connect();
  await blocker.startTransaction();
  await blocker.manager.getRepository(Team).findOneOrFail({
    where: { id: team.id },
    lock: { mode: 'pessimistic_write' },
  });
  let settled = false;
  const acceptance = runtime.app
    .get(AccountMembershipsService)
    .acceptTeamInvitation(token, target)
    .finally(() => {
      settled = true;
    });
  try {
    const deadline = Date.now() + 3000;
    let blocked = false;
    while (!settled && Date.now() < deadline) {
      const rows = await runtime.source.query<Array<{ blocked: boolean }>>(
        `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND state='active') AS blocked`,
      );
      if (rows[0].blocked) {
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);
  } finally {
    await blocker.rollbackTransaction();
    await blocker.release();
  }
  expect((await acceptance).role).toBe('manager');
});

it('skips an existing active identity instead of escalating its role through re-import', async () => {
  const response = await request(runtime.app.getHttpServer())
    .post('/api/users/import')
    .set(auth())
    .send({ users: [{ email: target.email, role: 'admin', team: team.name }] })
    .expect(201);
  expect(response.body as unknown).toMatchObject({
    skipped: 1,
    created: 0,
    restored: 0,
    failed: 0,
  });
  expect(
    (
      await runtime.app
        .get(AccountMembershipsService)
        .resolveUser(String(target.id), session.account.id)
    )?.role,
  ).toBe('member');
  expect(
    (
      await runtime.source
        .getRepository(TeamMember)
        .findOneByOrFail({ id: members[1].id })
    ).role,
  ).toBe('manager');
});
