import { ForbiddenException, INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { AuthService } from '../auth/auth.service';
import {
  controllerUser as user,
  createControllerFixture,
  serviceSpies,
} from '../test/controller-fixture';
const service = serviceSpies([
  'listTeams',
  'createTeam',
  'getTeam',
  'updateTeam',
  'archiveTeam',
  'listMembers',
  'addMember',
  'updateMember',
  'removeMember',
  'listInvitations',
  'createInvitation',
  'assertCanUseTeamAction',
  'revokeInvitation',
  'acceptInvitation',
]);
const auth = serviceSpies([
  'createTeamImpersonationResponse',
  'issueTeamApiToken',
]);
let app: INestApplication<Server>;
beforeAll(async () => {
  app = await createControllerFixture(
    [TeamsController],
    [
      { provide: TeamsService, useValue: service },
      { provide: AuthService, useValue: auth },
    ],
  );
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => jest.clearAllMocks());
it('binds team list filters and creation to the active account and actor', async () => {
  await request(app.getHttpServer())
    .get('/api/teams')
    .query({ status: 'archived', account_id: 'spoofed' })
    .expect(200);
  expect(service.listTeams).toHaveBeenCalledWith({
    accountId: user.accountId,
    status: 'archived',
  });
  const input = { name: 'Reviewers', account_id: 'spoofed' };
  await request(app.getHttpServer()).post('/api/teams').send(input).expect(201);
  expect(service.createTeam).toHaveBeenCalledWith({
    accountId: user.accountId,
    input,
    user,
  });
});
it.each([
  ['', 'getTeam'],
  ['/members', 'listMembers'],
  ['/invitations', 'listInvitations'],
] as const)(
  'reads a team%s from the authenticated tenant',
  async (suffix, method) => {
    await request(app.getHttpServer())
      .get(`/api/teams/team-2${suffix}`)
      .query({ account_id: 'spoofed' })
      .expect(200);
    expect(service[method]).toHaveBeenCalledWith({
      accountId: user.accountId,
      teamId: 'team-2',
    });
  },
);
it('passes the actor and tenant for edits and archive', async () => {
  const input = { name: 'Renamed', actor: 'spoofed' };
  await request(app.getHttpServer())
    .patch('/api/teams/team-2')
    .send(input)
    .expect(200);
  expect(service.updateTeam).toHaveBeenCalledWith({
    accountId: user.accountId,
    actor: user,
    teamId: 'team-2',
    input,
  });
  await request(app.getHttpServer()).delete('/api/teams/team-2').expect(200);
  expect(service.archiveTeam).toHaveBeenCalledWith({
    accountId: user.accountId,
    actor: user,
    teamId: 'team-2',
  });
});
it('preserves member target and actor for membership lifecycle actions', async () => {
  const input = { user_id: 'target', role: 'manager', account_id: 'spoofed' };
  await request(app.getHttpServer())
    .post('/api/teams/team-2/members')
    .send(input)
    .expect(201);
  expect(service.addMember).toHaveBeenCalledWith({
    accountId: user.accountId,
    actor: user,
    teamId: 'team-2',
    input,
  });
  await request(app.getHttpServer())
    .patch('/api/teams/team-2/members/member-3')
    .send({ role: 'member' })
    .expect(200);
  expect(service.updateMember).toHaveBeenCalledWith({
    accountId: user.accountId,
    actor: user,
    teamId: 'team-2',
    memberId: 'member-3',
    input: { role: 'member' },
  });
  await request(app.getHttpServer())
    .delete('/api/teams/team-2/members/member-3')
    .expect(200);
  expect(service.removeMember).toHaveBeenCalledWith({
    accountId: user.accountId,
    actor: user,
    teamId: 'team-2',
    memberId: 'member-3',
  });
});
it('creates/revokes an invitation in its team and accepts using the actual signed-in identity', async () => {
  const input = { email: 'invite@example.test', role: 'member' };
  await request(app.getHttpServer())
    .post('/api/teams/team-2/invitations')
    .send(input)
    .expect(201);
  expect(service.createInvitation).toHaveBeenCalledWith({
    accountId: user.accountId,
    actor: user,
    teamId: 'team-2',
    input,
  });
  await request(app.getHttpServer())
    .delete('/api/teams/team-2/invitations/invitation-4')
    .expect(200);
  expect(service.revokeInvitation).toHaveBeenCalledWith({
    accountId: user.accountId,
    actor: user,
    teamId: 'team-2',
    invitationId: 'invitation-4',
  });
  await request(app.getHttpServer())
    .post('/api/team-invitations/invite-token/accept')
    .expect(201, { member: { ok: true } });
  expect(service.acceptInvitation).toHaveBeenCalledWith({
    token: 'invite-token',
    user,
  });
});
it.each(['impersonate', 'api-token'])(
  'authorizes team %s before issuing credentials',
  async (action) => {
    const method =
      action === 'impersonate'
        ? 'createTeamImpersonationResponse'
        : 'issueTeamApiToken';
    await request(app.getHttpServer())
      .post(`/api/teams/team-2/${action}`)
      .expect(201);
    expect(service.assertCanUseTeamAction).toHaveBeenCalledWith({
      accountId: user.accountId,
      actor: user,
      teamId: 'team-2',
    });
    expect(
      service.assertCanUseTeamAction.mock.invocationCallOrder[0],
    ).toBeLessThan(auth[method].mock.invocationCallOrder[0]);
    expect(auth[method]).toHaveBeenCalledWith(
      action === 'impersonate'
        ? { account: user.account, teamId: 'team-2', user }
        : { teamId: 'team-2', user },
    );
  },
);
it.each(['impersonate', 'api-token'])(
  'does not issue credentials when team %s authorization fails',
  async (action) => {
    service.assertCanUseTeamAction.mockRejectedValueOnce(
      new ForbiddenException(),
    );
    await request(app.getHttpServer())
      .post(`/api/teams/team-2/${action}`)
      .expect(403);
    expect(auth.createTeamImpersonationResponse).not.toHaveBeenCalled();
    expect(auth.issueTeamApiToken).not.toHaveBeenCalled();
  },
);
