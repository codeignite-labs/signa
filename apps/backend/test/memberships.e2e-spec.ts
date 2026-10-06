/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Supertest response bodies are asserted at the HTTP boundary. */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import dataSource from '../src/database/data-source';
import { Account } from '../src/accounts/entities/account.entity';
import { AccountLinkedAccount } from '../src/accounts/entities/account-linked-account.entity';
import { AccountMembershipsController } from '../src/accounts/account-memberships.controller';
import { AccountMembershipsService } from '../src/account-memberships/account-memberships.service';
import { AccountMembership } from '../src/account-memberships/entities/account-membership.entity';
import { User } from '../src/users/entities/user.entity';
import { UserConfig } from '../src/users/entities/user-config.entity';
import { UsersController } from '../src/users/users.controller';
import { UsersService } from '../src/users/users.service';
import { Team } from '../src/teams/entities/team.entity';
import { TeamMember } from '../src/teams/entities/team-member.entity';
import { TeamInvitation } from '../src/teams/entities/team-invitation.entity';
import { TeamsService } from '../src/teams/teams.service';
import { TeamsController } from '../src/teams/teams.controller';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { OAuthAuthService } from '../src/auth/oauth-auth.service';
import { AccessToken } from '../src/auth/entities/access-token.entity';
import { hashPassword } from '../src/auth/passwords';
import { MailService } from '../src/mail/mail.service';
import { EmailVerificationCodeService } from '../src/mail/email-verification-code.service';
import { StorageService } from '../src/storage/storage.service';
import { AbilityFactory } from '../src/authorization/ability.factory';

// Real PostgreSQL, repositories, controllers, guards, transactions and password hashes.
// Every fixture is rolled back. External delivery is replaced with a recording adapter.
describe('Multi-account HTTP UAT', () => {
  let app: INestApplication;
  let runner: QueryRunner;
  let auth: AuthService;
  let memberships: AccountMembershipsService;
  let owner: User;
  let guest: User;
  let stranger: User;
  let ownerToken: string;
  let guestToken: string;
  let strangerToken: string;
  let memberToken: string;
  let teamId: string;
  const password = 'UAT-only-password-179129';
  const mail = {
    sendUserInvitation: jest.fn().mockResolvedValue({}),
    sendAccountInvitation: jest.fn().mockResolvedValue({}),
    sendTeamInvitation: jest.fn().mockResolvedValue({}),
  };

  beforeAll(async () => {
    dataSource.setOptions({
      logging: false,
      synchronize: false,
      migrationsRun: false,
    });
    await dataSource.initialize();
    runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const scoped = Object.create(dataSource) as DataSource;
    Object.defineProperty(scoped, 'manager', { value: runner.manager });
    scoped.getRepository = (target) => runner.manager.getRepository(target);
    scoped.transaction = ((
      run: (manager: typeof runner.manager) => Promise<unknown>,
    ) => run(runner.manager)) as DataSource['transaction'];
    const repositories = [
      Account,
      AccountLinkedAccount,
      User,
      UserConfig,
      Team,
      TeamMember,
      TeamInvitation,
      AccessToken,
    ];
    const module = await Test.createTestingModule({
      controllers: [
        UsersController,
        TeamsController,
        AccountMembershipsController,
        AuthController,
      ],
      providers: [
        UsersService,
        TeamsService,
        AuthService,
        AccountMembershipsService,
        AbilityFactory,
        { provide: DataSource, useValue: scoped },
        {
          provide: ConfigService,
          useValue: new ConfigService({ JWT_SECRET: 'uat-isolated-secret' }),
        },
        {
          provide: JwtService,
          useValue: new JwtService({ secret: 'uat-isolated-secret' }),
        },
        { provide: OAuthAuthService, useValue: {} },
        { provide: MailService, useValue: mail },
        { provide: EmailVerificationCodeService, useValue: {} },
        { provide: StorageService, useValue: {} },
        ...repositories.map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: runner.manager.getRepository(entity),
        })),
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
    auth = module.get(AuthService);
    memberships = module.get(AccountMembershipsService);
    const encryptedPassword = await hashPassword(password);
    async function identity(name: string) {
      const account = await runner.manager.save(
        Account,
        runner.manager.create(Account, { name: `UAT ${name}` }),
      );
      return runner.manager.save(
        User,
        runner.manager.create(User, {
          accountId: account.id,
          account,
          email: `uat-${randomUUID()}@example.invalid`,
          role: 'admin',
          encryptedPassword,
        }),
      );
    }
    owner = await identity('Owner');
    guest = await identity('Guest');
    stranger = await identity('Stranger');
    ownerToken = auth.createAuthResponse(owner, owner.account).access_token;
    guestToken = auth.createAuthResponse(guest, guest.account).access_token;
    strangerToken = auth.createAuthResponse(
      stranger,
      stranger.account,
    ).access_token;
  }, 30000);

  afterAll(async () => {
    await app?.close();
    if (runner?.isTransactionActive) await runner.rollbackTransaction();
    await runner?.release();
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  const api = () =>
    request(app.getHttpServer() as Parameters<typeof request>[0]);
  const bearer = (token: string) => `Bearer ${token}`;

  it('invites an existing identity without moving it or changing its password', async () => {
    const response = await api()
      .post('/users')
      .set('Authorization', bearer(ownerToken))
      .send({
        email: guest.email,
        role: 'viewer',
        password: 'must-not-replace-password',
      })
      .expect(201);
    expect(response.body.id).toBe(String(guest.id));
    expect(response.body.membership_status).toBe('invited');
    const identity = await runner.manager.findOneByOrFail(User, {
      id: guest.id,
    });
    expect(identity.accountId).toBe(guest.accountId);
    expect(identity.encryptedPassword).toBe(guest.encryptedPassword);
    expect(mail.sendAccountInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ email: guest.email }),
    );
    await api()
      .post(`/account-memberships/${owner.accountId}/switch`)
      .set('Authorization', bearer(guestToken))
      .expect(403);
  });

  it('requires the invited login to accept, then switches into the requested role', async () => {
    await api()
      .post(`/account-memberships/${owner.accountId}/accept`)
      .set('Authorization', bearer(strangerToken))
      .expect(404);
    const response = await api()
      .post(`/account-memberships/${owner.accountId}/accept`)
      .set('Authorization', bearer(guestToken))
      .expect(201);
    memberToken = response.body.access_token as string;
    expect(response.body.user.role).toBe('viewer');
    expect(response.body.account.id).toBe(owner.accountId);
    const accounts = await api()
      .get('/account-memberships')
      .set('Authorization', bearer(memberToken))
      .expect(200);
    expect(accounts.body).toHaveLength(2);
    await api()
      .get('/users')
      .set('Authorization', bearer(memberToken))
      .expect(403);
    await api()
      .post('/teams')
      .set('Authorization', bearer(memberToken))
      .send({ name: 'Forbidden team' })
      .expect(403);
  });

  it('creates a team and accepts an invitation for an existing member', async () => {
    const team = await api()
      .post('/teams')
      .set('Authorization', bearer(ownerToken))
      .send({ name: 'UAT signing team' })
      .expect(201);
    teamId = String(team.body.id);
    const invite = await api()
      .post(`/teams/${teamId}/invitations`)
      .set('Authorization', bearer(ownerToken))
      .send({ email: guest.email, role: 'viewer' })
      .expect(201);
    const token = invite.body.accept_token as string;
    await api()
      .post(`/team-invitations/${token}/accept`)
      .set('Authorization', bearer(strangerToken))
      .expect(403);
    const accepted = await api()
      .post(`/team-invitations/${token}/accept`)
      .set('Authorization', bearer(guestToken))
      .expect(201);
    expect(accepted.body.member.account_id).toBe(String(owner.accountId));
    await api()
      .post(`/team-invitations/${token}/accept`)
      .set('Authorization', bearer(guestToken))
      .expect(403);
    await api()
      .get(`/teams/${teamId}`)
      .set('Authorization', bearer(strangerToken))
      .expect(404);
  });

  it('supports cross-account team invites without a pre-existing account membership', async () => {
    const invite = await api()
      .post(`/teams/${teamId}/invitations`)
      .set('Authorization', bearer(ownerToken))
      .send({ email: stranger.email, role: 'member' })
      .expect(201);
    await api()
      .post(`/team-invitations/${invite.body.accept_token}/accept`)
      .set('Authorization', bearer(strangerToken))
      .expect(201);
    expect(
      (await memberships.resolveUser(stranger.id, owner.accountId))?.role,
    ).toBe('member');
  });

  it('keeps account API tokens separate and revokes access immediately after removal', async () => {
    const homeKey = await api()
      .post('/auth/api-token/reveal')
      .set('Authorization', bearer(guestToken))
      .send({ password })
      .expect(201);
    const joinedKey = await api()
      .post('/auth/api-token/reveal')
      .set('Authorization', bearer(memberToken))
      .send({ password })
      .expect(201);
    expect(homeKey.body.revealed_token).not.toBe(joinedKey.body.revealed_token);
    expect(
      (await auth.resolveApiToken(joinedKey.body.revealed_token as string))
        ?.accountId,
    ).toBe(owner.accountId);
    await api()
      .delete(`/users/${guest.id}`)
      .set('Authorization', bearer(ownerToken))
      .expect(200);
    await api()
      .get('/teams')
      .set('Authorization', bearer(memberToken))
      .expect(401);
    expect(
      await auth.resolveApiToken(joinedKey.body.revealed_token as string),
    ).toBeNull();
    await api()
      .get('/teams')
      .set('Authorization', bearer(guestToken))
      .expect(200);
  });

  it('reflects role changes even when an older JWT says admin', async () => {
    await memberships.invite(owner.accountId, guest, 'admin');
    const accepted = await api()
      .post(`/account-memberships/${owner.accountId}/accept`)
      .set('Authorization', bearer(guestToken))
      .expect(201);
    await api()
      .patch(`/users/${guest.id}`)
      .set('Authorization', bearer(ownerToken))
      .send({ role: 'viewer' })
      .expect(200);
    await api()
      .get('/users')
      .set('Authorization', bearer(accepted.body.access_token as string))
      .expect(403);
    await api()
      .patch(`/users/${guest.id}`)
      .set('Authorization', bearer(ownerToken))
      .send({ password: 'No-identity-takeover' })
      .expect(403);
  });

  it('rejects expired invitations', async () => {
    await memberships.changeMember(owner.accountId, stranger.id, {
      archive: true,
    });
    await memberships.invite(owner.accountId, stranger, 'member');
    await runner.manager.update(
      AccountMembership,
      { accountId: owner.accountId, userId: stranger.id },
      { expiresAt: new Date(0) },
    );
    await api()
      .post(`/account-memberships/${owner.accountId}/accept`)
      .set('Authorization', bearer(strangerToken))
      .expect(403);
  });
  it('revokes a team API key when its non-admin owner leaves the team', async () => {
    const user = await memberships.resolveUser(guest.id, owner.accountId);
    const key = await auth.issueTeamApiToken({ teamId, user: user! });
    expect(await auth.resolveApiToken(key.revealed_token)).not.toBeNull();
    await runner.manager.softDelete(TeamMember, {
      accountId: owner.accountId,
      teamId,
      userId: guest.id,
    });
    expect(await auth.resolveApiToken(key.revealed_token)).toBeNull();
  });

  it('preserves an invited account role when joining through its team invitation', async () => {
    await memberships.invite(owner.accountId, stranger, 'viewer');
    const invite = await api()
      .post(`/teams/${teamId}/invitations`)
      .set('Authorization', bearer(ownerToken))
      .send({ email: stranger.email, role: 'viewer' })
      .expect(201);
    await api()
      .post(`/team-invitations/${invite.body.accept_token}/accept`)
      .set('Authorization', bearer(strangerToken))
      .expect(201);
    expect(
      (await memberships.resolveUser(stranger.id, owner.accountId))?.role,
    ).toBe('viewer');
  });

  it('keeps login working through another account after home membership removal', async () => {
    await memberships.invite(guest.accountId, owner, 'admin');
    await memberships.accept(guest.accountId, owner.id);
    await memberships.changeMember(guest.accountId, guest.id, {
      archive: true,
    });
    const login = await api()
      .post('/auth/login')
      .send({ email: guest.email, password })
      .expect(201);
    expect(login.body.account.id).toBe(owner.accountId);
    expect(login.body.user.role).toBe('viewer');
    const identity = await runner.manager.findOneByOrFail(User, {
      id: guest.id,
    });
    expect(identity.archivedAt).toBeNull();
    expect(identity.encryptedPassword).toBe(guest.encryptedPassword);
  });

  it('rejects last-admin removal and ignores archived accounts', async () => {
    await expect(
      memberships.changeMember(owner.accountId, owner.id, { archive: true }),
    ).rejects.toThrow('At least one active admin');
    await runner.manager.softDelete(Account, { id: owner.accountId });
    expect(await memberships.resolveUser(guest.id, owner.accountId)).toBeNull();
    expect(
      (await memberships.listAccounts(guest.id)).some(
        (account) => String(account.id) === String(owner.accountId),
      ),
    ).toBe(false);
  });
});
