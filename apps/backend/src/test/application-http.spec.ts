import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { queueNames } from '../runtime/queue-options';
import { createPostgresFixture } from './postgres-fixture';
type Session = {
  access_token: string;
  user: { id: string; email: string };
  account: { id: string; name: string };
};
type Template = {
  id: string;
  slug: string;
  fields: unknown[];
  submitters: Array<{ uuid: string; name?: string }>;
  documents: Array<{ uuid: string }>;
};
let app: INestApplication<Server>;
let fixture: Awaited<ReturnType<typeof createPostgresFixture>>;
let directory: string;
let owner: Session;
let stranger: Session;
let template: Template;
const password = 'Application-fixture-only-password';
const previousEnvironment = { ...process.env };
const queues = new Map<string, { add: jest.Mock }>();
const auth = (session = owner) => ({
  Authorization: `Bearer ${session.access_token}`,
});
beforeAll(async () => {
  fixture = await createPostgresFixture();
  directory = await mkdtemp(join(tmpdir(), 'signa-http-fixture-'));
  const settings = {
    NODE_ENV: 'test',
    DATABASE_TYPE: 'postgres',
    DATABASE_URL: fixture.url,
    DATABASE_SSL: false,
    DATABASE_MIGRATIONS_RUN: false,
    DATABASE_LOGGING: false,
    QUEUE_ENABLED: false,
    BULL_BOARD_ENABLED: false,
    MAIL_ENABLED: false,
    SMTP_ADDRESS: '',
    SMTP_USERNAME: '',
    SMTP_PASSWORD: '',
    REDIS_URL: '',
    REGISTRATION_MODE: 'open',
    STORAGE_PATH: directory,
    JWT_SECRET: 'application-fixture-secret-32-characters',
    JWT_EXPIRES_IN: '1h',
    SIGNING_KEY_ENCRYPTION_KEY: 'ab'.repeat(32),
    PDF_REQUIRE_TRUSTED_SIGNER: false,
    PDF_TIMESTAMP_REQUIRED: false,
    PDF_LTV_REQUIRED: false,
    PDF_A_ENABLED: false,
    THROTTLE_LIMIT: 10000,
    HEALTH_HEAP_LIMIT_MB: 4096,
  };
  Object.assign(
    process.env,
    Object.fromEntries(
      Object.entries(settings).map(([key, value]) => [key, String(value)]),
    ),
  );
  const { AppModule } =
    jest.requireActual<typeof import('../app.module')>('../app.module');
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(new ConfigService(settings));
  for (const name of Object.values(queueNames)) {
    const queue = {
      name,
      metaValues: { version: 'bullmq:test-adapter' },
      opts: {},
      add: jest.fn().mockResolvedValue({ id: 'recorded-job' }),
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
      getRepeatableJobs: jest.fn().mockResolvedValue([]),
      getJobSchedulers: jest.fn().mockResolvedValue([]),
    };
    queues.set(name, queue);
    builder.overrideProvider(getQueueToken(name)).useValue(queue);
  }
  const module = await builder.compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.get(DataSource).runMigrations();
  await app.init();
  const register = async (prefix: string): Promise<Session> => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        account_name: `${prefix} Organization`,
        email: `${prefix}-${randomUUID()}@example.test`,
        password,
        first_name: prefix,
        last_name: 'Fixture',
      })
      .expect(201);
    return response.body as Session;
  };
  owner = await register('Owner');
  stranger = await register('Stranger');
}, 60000);
afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await fixture?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    process.env = previousEnvironment;
  }
});
it('boots the complete application against isolated PostgreSQL with healthy dependencies and strict authentication', async () => {
  await request(app.getHttpServer()).get('/api/health/live').expect(200);
  await request(app.getHttpServer()).get('/api/health/ready').expect(200);
  await request(app.getHttpServer()).get('/api/account').expect(401);
  const response = await request(app.getHttpServer())
    .get('/api/account')
    .set(auth())
    .expect(200);
  expect(response.body as unknown).toMatchObject({
    id: owner.account.id,
    name: 'Owner Organization',
  });
});
it('updates account preferences and branding without leaking them to another tenant', async () => {
  await request(app.getHttpServer())
    .patch('/api/account')
    .set(auth())
    .send({ name: 'Updated Organization' })
    .expect(200);
  await request(app.getHttpServer())
    .patch('/api/account/branding')
    .set(auth())
    .send({
      primary_color: '#123456',
      white_label: true,
      show_business_name: true,
    })
    .expect(200);
  const branding = await request(app.getHttpServer())
    .get('/api/account/branding')
    .set(auth())
    .expect(200);
  expect(branding.body as unknown).toMatchObject({
    account_name: 'Updated Organization',
    primary_color: '#123456',
    white_label: true,
  });
  const other = await request(app.getHttpServer())
    .get('/api/account/branding')
    .set(auth(stranger))
    .expect(200);
  expect(other.body as unknown).toMatchObject({
    account_name: 'Stranger Organization',
    primary_color: null,
  });
  await request(app.getHttpServer())
    .get('/api/account/preferences')
    .set(auth())
    .expect(200);
});
it('creates and updates a real template while denying cross-account access and malformed submissions', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/templates')
    .set(auth())
    .send({
      name: 'Agreement',
      submitters: [{ uuid: 'signer-role', name: 'Signer' }],
    })
    .expect(201);
  template = response.body as Template;
  await request(app.getHttpServer())
    .get(`/api/templates/${template.id}`)
    .set(auth())
    .expect(200);
  await request(app.getHttpServer())
    .get(`/api/templates/${template.id}`)
    .set(auth(stranger))
    .expect(404);
  await request(app.getHttpServer())
    .put(`/api/templates/${template.id}`)
    .set(auth())
    .send({ name: 'Updated Agreement', fields: [], shared_link: false })
    .expect(200);
  const added = await request(app.getHttpServer())
    .put(`/api/templates/${template.id}/documents`)
    .set(auth())
    .send({
      merge: true,
      documents: [{ type: 'blank', name: 'Agreement', size: 'letter' }],
    })
    .expect(200);
  const documents = added.body as { documents: Array<{ uuid: string }> };
  expect(documents.documents.length).toBeGreaterThan(0);
  await request(app.getHttpServer())
    .put(`/api/templates/${template.id}`)
    .set(auth())
    .send({
      fields: [
        {
          uuid: randomUUID(),
          type: 'text',
          name: 'Full name',
          required: true,
          submitter_uuid: 'signer-role',
          areas: [
            {
              attachment_uuid: documents.documents[0].uuid,
              page: 0,
              x: 0.1,
              y: 0.1,
              w: 0.3,
              h: 0.04,
            },
          ],
        },
      ],
    })
    .expect(200);
  await request(app.getHttpServer())
    .post('/api/submissions')
    .set(auth())
    .send({ template_id: template.id, submitters: [{ email: 123 }] })
    .expect(400);
  await request(app.getHttpServer())
    .post('/api/submissions')
    .set(auth())
    .send({
      submissions: [
        { template_id: template.id, submitters: [{ metadata: 'invalid' }] },
      ],
    })
    .expect(400);
});
it('creates a request from the template, exposes the public signer form and denies another tenant access', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/submissions')
    .set(auth())
    .send({
      template_id: Number(template.id),
      send_email: false,
      submitters: [{ email: 'recipient@example.test', role: 'Signer' }],
    })
    .expect(201);
  const [submitter] = response.body as Array<{
    id: string;
    slug: string;
    submission_id: string;
  }>;
  expect(submitter.slug).toBeTruthy();
  await request(app.getHttpServer())
    .get(`/api/signing/${submitter.slug}`)
    .expect(200);
  await request(app.getHttpServer())
    .get(`/api/submissions/${submitter.submission_id}`)
    .set(auth())
    .expect(200);
  await request(app.getHttpServer())
    .get(`/api/submissions/${submitter.submission_id}`)
    .set(auth(stranger))
    .expect(404);
  expect(queues.get(queueNames.mail)?.add).not.toHaveBeenCalled();
});
it('creates a team and exercises account-scoped membership/notification routes in the real module graph', async () => {
  await request(app.getHttpServer())
    .post('/api/teams')
    .set(auth())
    .send({ name: 'Operations' })
    .expect(201);
  await request(app.getHttpServer()).get('/api/teams').set(auth()).expect(200);
  await request(app.getHttpServer()).get('/api/users').set(auth()).expect(200);
  await request(app.getHttpServer())
    .get('/api/account-memberships')
    .set(auth())
    .expect(200);
  await request(app.getHttpServer())
    .get('/api/profile')
    .set(auth())
    .expect(200);
});

it('protects private mail history with authentication, administrator role and account-scoped lookups', async () => {
  for (const path of [
    '/api/email-events/messages',
    '/api/email-events/messages/1/events',
  ])
    await request(app.getHttpServer()).get(path).expect(401);
  await request(app.getHttpServer())
    .get('/api/email-events/messages')
    .set(auth())
    .expect(200);
  const source = app.get(DataSource);
  const [message] = await source.query<Array<{ id: number }>>(
    'INSERT INTO email_messages (account_id,template,subject,recipients,sha1,status,data) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [
      owner.account.id,
      'fixture',
      'Fixture mail',
      'fixture@example.test',
      'fixture-digest',
      'sent',
      '{}',
    ],
  );
  await request(app.getHttpServer())
    .get(`/api/email-events/messages/${message.id}/events`)
    .set(auth())
    .expect(200);
  await request(app.getHttpServer())
    .get(`/api/email-events/messages/${message.id}/events`)
    .set(auth(stranger))
    .expect(404);
});

it('rotates only the API token of the active account for a shared login identity', async () => {
  await request(app.getHttpServer())
    .post('/api/users')
    .set(auth(stranger))
    .send({ email: owner.user.email, role: 'admin' })
    .expect(201);
  await request(app.getHttpServer())
    .post(`/api/account-memberships/${stranger.account.id}/accept`)
    .set(auth())
    .expect(201);
  const switched = await request(app.getHttpServer())
    .post(`/api/account-memberships/${stranger.account.id}/switch`)
    .set(auth())
    .expect(201);
  const secondary = switched.body as Session;
  expect(secondary.user.id).toBe(owner.user.id);
  expect(secondary.account.id).toBe(stranger.account.id);
  const primaryBeforeResponse = await request(app.getHttpServer())
    .post('/api/auth/api-token/reveal')
    .set(auth())
    .send({ password })
    .expect(201);
  const secondaryBeforeResponse = await request(app.getHttpServer())
    .post('/api/auth/api-token/reveal')
    .set(auth(secondary))
    .send({ password })
    .expect(201);
  const primaryBefore = primaryBeforeResponse.body as {
    id: string;
    revealed_token: string;
  };
  const secondaryBefore = secondaryBeforeResponse.body as {
    id: string;
    revealed_token: string;
  };
  expect(secondaryBefore.id).not.toBe(primaryBefore.id);
  const rotatedResponse = await request(app.getHttpServer())
    .post('/api/auth/api-token/rotate')
    .set(auth(secondary))
    .send({ password, permissions: ['templates:read'] })
    .expect(201);
  const rotated = rotatedResponse.body as {
    id: string;
    revealed_token: string;
    permissions: string[];
  };
  expect(rotated.id).toBe(secondaryBefore.id);
  expect(rotated.revealed_token).not.toBe(secondaryBefore.revealed_token);
  expect(rotated.permissions).toEqual(['templates:read']);
  const primaryAfter = await request(app.getHttpServer())
    .post('/api/auth/api-token/reveal')
    .set(auth())
    .send({ password })
    .expect(201);
  expect(primaryAfter.body as unknown).toMatchObject(primaryBefore);
  await request(app.getHttpServer())
    .get('/api/templates')
    .set('X-Auth-Token', secondaryBefore.revealed_token)
    .expect(401);
  await request(app.getHttpServer())
    .get(`/api/templates/${template.id}`)
    .set('X-Auth-Token', primaryBefore.revealed_token)
    .expect(200);
  await request(app.getHttpServer())
    .get('/api/templates')
    .set('X-Auth-Token', rotated.revealed_token)
    .expect(200);
  await request(app.getHttpServer())
    .get(`/api/templates/${template.id}`)
    .set('X-Auth-Token', rotated.revealed_token)
    .expect(404);
});

it('consumes a password-reset token only once under concurrent HTTP requests', async () => {
  const token = randomUUID();
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await app
    .get(DataSource)
    .query(
      'UPDATE users SET reset_password_token=$1, reset_password_sent_at=now() WHERE id=$2',
      [tokenHash, owner.user.id],
    );
  const passwords = [
    'First-new-fixture-password',
    'Second-new-fixture-password',
  ];
  const responses = await Promise.all(
    passwords.map((password) =>
      request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token, password, password_confirmation: password }),
    ),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([
    201, 422,
  ]);
  const winner = responses.findIndex((response) => response.status === 201);
  await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: owner.user.email, password: passwords[winner] })
    .expect(201);
  await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: owner.user.email, password: passwords[1 - winner] })
    .expect(401);
});
