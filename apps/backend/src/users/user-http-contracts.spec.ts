import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import {
  controllerUser as user,
  createControllerFixture,
  serviceSpies,
} from '../test/controller-fixture';
const service = serviceSpies([
  'toUserResponse',
  'updateProfile',
  'updatePassword',
  'getProfileAsset',
  'uploadProfileAsset',
  'deleteProfileAsset',
  'getMfaStatus',
  'startMfaSetup',
  'enableMfa',
  'disableMfa',
  'listUsers',
  'createUser',
  'importUsers',
  'updateUser',
  'archiveUser',
]);
let app: INestApplication<Server>;
beforeAll(async () => {
  app = await createControllerFixture(
    [UsersController],
    [{ provide: UsersService, useValue: service }],
  );
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => jest.clearAllMocks());
it('returns only the documented public identity in the API-token smoke response', async () => {
  await request(app.getHttpServer()).get('/api/user').expect(200, {
    id: user.id,
    email: user.email,
    first_name: user.firstName,
    last_name: user.lastName,
  });
});
it('binds the signed-in identity to profile and password changes', async () => {
  await request(app.getHttpServer()).get('/api/profile').expect(200);
  expect(service.toUserResponse).toHaveBeenCalledWith(user);
  for (const [path, method, input] of [
    [
      '/profile',
      'updateProfile',
      { first_name: 'Updated', user_id: 'spoofed' },
    ],
    [
      '/profile/password',
      'updatePassword',
      { current_password: 'old', password: 'new', user_id: 'spoofed' },
    ],
  ] as const) {
    await request(app.getHttpServer())
      .patch(`/api${path}`)
      .send(input)
      .expect(200);
    expect(service[method]).toHaveBeenCalledWith({ userId: user.id, input });
  }
});
it.each(['signature', 'initials'])(
  'gets, uploads and deletes only the current user’s %s asset',
  async (key) => {
    await request(app.getHttpServer()).get(`/api/profile/${key}`).expect(200);
    expect(service.getProfileAsset).toHaveBeenCalledWith(user.id, key);
    const buffer = Buffer.from('synthetic-image');
    await request(app.getHttpServer())
      .post(`/api/profile/${key}`)
      .attach('file', buffer, `${key}.png`)
      .expect(201);
    expect(service.uploadProfileAsset).toHaveBeenCalledWith({
      userId: user.id,
      key,
      file: expect.objectContaining({
        originalname: `${key}.png`,
        buffer,
      }) as unknown,
    });
    await request(app.getHttpServer())
      .delete(`/api/profile/${key}`)
      .expect(200);
    expect(service.deleteProfileAsset).toHaveBeenCalledWith(user.id, key);
  },
);
it('binds MFA status, setup and verification attempts to the session identity', async () => {
  await request(app.getHttpServer()).get('/api/profile/mfa').expect(200);
  expect(service.getMfaStatus).toHaveBeenCalledWith(user.id);
  await request(app.getHttpServer()).post('/api/profile/mfa/setup').expect(201);
  expect(service.startMfaSetup).toHaveBeenCalledWith(user.id);
  await request(app.getHttpServer())
    .post('/api/profile/mfa')
    .send({ otp_attempt: '123456', user_id: 'spoofed' })
    .expect(201);
  await request(app.getHttpServer())
    .delete('/api/profile/mfa')
    .send({ otp_attempt: '123456', user_id: 'spoofed' })
    .expect(200);
  for (const method of ['enableMfa', 'disableMfa'])
    expect(service[method]).toHaveBeenCalledWith({
      userId: user.id,
      otpAttempt: '123456',
    });
});
it('passes the status filter while deriving the users list account from hydration', async () => {
  await request(app.getHttpServer())
    .get('/api/users')
    .query({ status: 'archived', account_id: 'spoofed' })
    .expect(200);
  expect(service.listUsers).toHaveBeenCalledWith({
    accountId: user.accountId,
    status: 'archived',
  });
});
it('scopes user creation and imports to the active account', async () => {
  const create = {
    email: 'invite@example.test',
    role: 'member',
    account_id: 'spoofed',
  };
  await request(app.getHttpServer())
    .post('/api/users')
    .send(create)
    .expect(201);
  expect(service.createUser).toHaveBeenCalledWith(user.accountId, create);
  const imported = {
    users: [{ email: 'other@example.test' }],
    account_id: 'spoofed',
  };
  await request(app.getHttpServer())
    .post('/api/users/import')
    .send(imported)
    .expect(201);
  expect(service.importUsers).toHaveBeenCalledWith(user.accountId, imported);
});
it('preserves both acting and target user identifiers for role changes and archive', async () => {
  const input = {
    role: 'admin',
    current_user_id: 'spoofed',
    account_id: 'spoofed',
  };
  await request(app.getHttpServer())
    .patch('/api/users/target')
    .send(input)
    .expect(200);
  expect(service.updateUser).toHaveBeenCalledWith({
    accountId: user.accountId,
    currentUserId: user.id,
    userId: 'target',
    input,
  });
  await request(app.getHttpServer()).delete('/api/users/target').expect(200);
  expect(service.archiveUser).toHaveBeenCalledWith({
    accountId: user.accountId,
    currentUserId: user.id,
    userId: 'target',
  });
});
