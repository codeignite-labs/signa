import { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OAuthAuthService } from './oauth-auth.service';
import {
  controllerUser as user,
  createControllerFixture,
  serviceSpies,
} from '../test/controller-fixture';
const service = serviceSpies([
  'getRegistrationStatus',
  'register',
  'login',
  'requestPasswordReset',
  'resetPassword',
  'getUserApiToken',
  'revealUserApiToken',
  'rotateUserApiToken',
  'updateUserApiTokenPermissions',
]);
const oauth = serviceSpies(['start', 'complete']);
let app: INestApplication<Server>;
beforeAll(async () => {
  app = await createControllerFixture(
    [AuthController],
    [
      { provide: AuthService, useValue: service },
      { provide: OAuthAuthService, useValue: oauth },
    ],
  );
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => jest.clearAllMocks());
it('exposes registration status without a session', async () => {
  await request(app.getHttpServer())
    .get('/api/auth/registration-status')
    .expect(200);
  expect(service.getRegistrationStatus).toHaveBeenCalledWith();
});
it.each([
  [
    'register',
    'register',
    { email: 'user@example.test', password: 'fixture-password' },
  ],
  [
    'login',
    'login',
    {
      email: 'user@example.test',
      password: 'fixture-password',
      otp_attempt: '123456',
    },
  ],
  ['forgot-password', 'requestPasswordReset', { email: 'user@example.test' }],
  [
    'reset-password',
    'resetPassword',
    { reset_password_token: 'fixture-token', password: 'fixture-password' },
  ],
] as const)(
  'binds %s credentials to the corresponding authentication operation',
  async (path, method, body) => {
    await request(app.getHttpServer())
      .post(`/api/auth/${path}`)
      .send(body)
      .expect(201);
    expect(service[method]).toHaveBeenCalledWith(body);
  },
);
it('preserves the Google OAuth state and authorization code through both endpoints', async () => {
  const body = { intent: 'login', return_to: '/templates' };
  await request(app.getHttpServer())
    .post('/api/auth/oauth/google/start')
    .send(body)
    .expect(201);
  expect(oauth.start).toHaveBeenCalledWith('google', body);
  await request(app.getHttpServer())
    .post('/api/auth/oauth/google/callback')
    .send({ code: 'fixture-code', state: 'signed-state', provider: 'spoofed' })
    .expect(201);
  expect(oauth.complete).toHaveBeenCalledWith({
    provider: 'google',
    code: 'fixture-code',
    state: 'signed-state',
  });
});
it('scopes token reads/reveals/rotation/permissions to the active session account', async () => {
  await request(app.getHttpServer())
    .get('/api/auth/api-token')
    .query({ account_id: 'spoofed' })
    .expect(200);
  expect(service.getUserApiToken).toHaveBeenCalledWith(user.id, user.accountId);
  await request(app.getHttpServer())
    .post('/api/auth/api-token/reveal')
    .send({ password: 'fixture-password', account_id: 'spoofed' })
    .expect(201);
  expect(service.revealUserApiToken).toHaveBeenCalledWith(
    user.id,
    'fixture-password',
    user.accountId,
  );
  const rotate = { password: 'fixture-password', name: 'Production key' };
  await request(app.getHttpServer())
    .post('/api/auth/api-token/rotate')
    .send(rotate)
    .expect(201);
  expect(service.rotateUserApiToken).toHaveBeenCalledWith(
    user.id,
    rotate,
    user.accountId,
  );
  const permissions = {
    password: 'fixture-password',
    permissions: ['templates:read'],
  };
  await request(app.getHttpServer())
    .patch('/api/auth/api-token/permissions')
    .send(permissions)
    .expect(200);
  expect(service.updateUserApiTokenPermissions).toHaveBeenCalledWith(
    user.id,
    permissions,
    user.accountId,
  );
});
