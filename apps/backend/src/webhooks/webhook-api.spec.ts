import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Server } from 'node:http';
import request from 'supertest';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import {
  WebhooksController,
  WebhookEventsController,
} from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
let app: INestApplication<Server>;
const user = Object.assign(new User(), {
  id: 'user',
  accountId: 'account',
  role: 'admin',
});
let permissions: string[];
const findActiveUser = jest.fn().mockResolvedValue(user);
const endpoint = {
  id: 'hook',
  url: 'https://hooks.example.test',
  events: ['form.completed'],
  hmac_secret: 'secret',
  secret: {},
  created_at: new Date(),
  updated_at: new Date(),
};
const webhooks = {
  listWebhooks: jest.fn().mockResolvedValue({ data: [endpoint] }),
  createWebhook: jest.fn().mockResolvedValue(endpoint),
  getWebhook: jest.fn().mockResolvedValue(endpoint),
  updateWebhook: jest.fn().mockResolvedValue(endpoint),
  deleteWebhook: jest.fn().mockResolvedValue(endpoint),
  listWebhookEvents: jest.fn().mockResolvedValue({ data: [] }),
  testWebhook: jest.fn().mockResolvedValue(undefined),
  resendWebhookEvent: jest.fn().mockResolvedValue(undefined),
};
beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [WebhooksController, WebhookEventsController],
    providers: [
      { provide: WebhooksService, useValue: webhooks },
      { provide: UsersService, useValue: { findActiveUser } },
      { provide: JwtService, useValue: {} },
      {
        provide: AuthService,
        useValue: {
          resolveApiToken: (token: string) =>
            token === 'scoped-token'
              ? Promise.resolve({
                  accountId: user.accountId,
                  userId: user.id,
                  role: user.role,
                  apiTokenPermissions: permissions,
                })
              : Promise.resolve(null),
        },
      },
    ],
  }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  permissions = ['webhooks:read', 'webhooks:write'];
  jest.clearAllMocks();
});
it('requires authentication and derives the tenant from the token before listing endpoints', async () => {
  await request(app.getHttpServer()).get('/api/webhooks').expect(401);
  await request(app.getHttpServer())
    .get('/api/webhooks')
    .set('X-Auth-Token', 'unknown')
    .expect(401);
  await request(app.getHttpServer())
    .get('/api/webhooks')
    .set('X-Auth-Token', 'scoped-token')
    .expect(200);
  expect(findActiveUser).toHaveBeenCalledWith('user', 'account');
  expect(webhooks.listWebhooks).toHaveBeenCalledWith(user);
});
it('uses webhook scope for nested event routes and transforms event queries', async () => {
  permissions = ['webhooks:read'];
  await request(app.getHttpServer())
    .get('/api/webhooks/hook/events?status=error&limit=20')
    .set('X-Auth-Token', 'scoped-token')
    .expect(200, { data: [] });
  expect(webhooks.listWebhookEvents).toHaveBeenCalledWith(
    user,
    'hook',
    expect.objectContaining({ status: 'error', limit: 20 }),
  );
  permissions = ['submissions:read'];
  await request(app.getHttpServer())
    .get('/api/webhooks/hook/events')
    .set('X-Auth-Token', 'scoped-token')
    .expect(403);
  await request(app.getHttpServer())
    .get('/api/webhooks/hook')
    .set('X-Auth-Token', 'scoped-token')
    .expect(403);
});
it('validates create/update input and does not accept a client account override', async () => {
  await request(app.getHttpServer())
    .post('/api/webhooks')
    .set('X-Auth-Token', 'scoped-token')
    .send({ url: 'https://hooks.example.test', events: ['form.completed'] })
    .expect(201);
  expect(webhooks.createWebhook).toHaveBeenCalledWith(
    user,
    expect.objectContaining({ url: endpoint.url, events: ['form.completed'] }),
  );
  for (const body of [
    { url: 'not a URL' },
    { url: endpoint.url, account_id: 'foreign' },
    { url: endpoint.url, events: ['unknown'] },
  ])
    await request(app.getHttpServer())
      .post('/api/webhooks')
      .set('X-Auth-Token', 'scoped-token')
      .send(body)
      .expect(400);
  expect(webhooks.createWebhook).toHaveBeenCalledTimes(1);
  await request(app.getHttpServer())
    .patch('/api/webhooks/hook')
    .set('X-Auth-Token', 'scoped-token')
    .send({ secret: { 'X-Custom': 'value' } })
    .expect(200);
  expect(webhooks.updateWebhook).toHaveBeenCalledWith(
    user,
    'hook',
    expect.objectContaining({ secret: { 'X-Custom': 'value' } }),
  );
});
it('supports tenant-scoped read/delete/test/resend actions and denies writes to read-only tokens', async () => {
  await request(app.getHttpServer())
    .get('/api/webhooks/hook')
    .set('X-Auth-Token', 'scoped-token')
    .expect(200);
  expect(webhooks.getWebhook).toHaveBeenCalledWith(user, 'hook');
  await request(app.getHttpServer())
    .delete('/api/webhooks/hook')
    .set('X-Auth-Token', 'scoped-token')
    .expect(200);
  expect(webhooks.deleteWebhook).toHaveBeenCalledWith(user, 'hook');
  await request(app.getHttpServer())
    .post('/api/webhooks/hook/test')
    .set('X-Auth-Token', 'scoped-token')
    .expect(201, { queued: true });
  expect(webhooks.testWebhook).toHaveBeenCalledWith(user, 'hook');
  await request(app.getHttpServer())
    .post('/api/webhook-events/event/resend')
    .set('X-Auth-Token', 'scoped-token')
    .expect(201, { queued: true });
  expect(webhooks.resendWebhookEvent).toHaveBeenCalledWith(user, 'event');
  permissions = ['webhooks:read'];
  await request(app.getHttpServer())
    .post('/api/webhook-events/event/resend')
    .set('X-Auth-Token', 'scoped-token')
    .expect(403);
  await request(app.getHttpServer())
    .delete('/api/webhooks/hook')
    .set('X-Auth-Token', 'scoped-token')
    .expect(403);
});
