import { Server } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queueNames } from '../../src/runtime/queue-options';
import { createPostgresFixture } from '../../src/test/postgres-fixture';

export async function createTeamRaceApplication() {
  const database = await createPostgresFixture();
  const previous = { ...process.env };
  const values = teamRaceSettings(database.url);
  Object.assign(
    process.env,
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, String(value)]),
    ),
  );
  try {
    const app = await startApplication(values);
    return {
      app,
      source: app.get(DataSource),
      close: () => closeApplication(app, database, previous),
    };
  } catch (error) {
    await database.close();
    process.env = previous;
    throw error;
  }
}
async function startApplication(values: ReturnType<typeof teamRaceSettings>) {
  const { AppModule } = jest.requireActual<
    typeof import('../../src/app.module')
  >('../../src/app.module');
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(new ConfigService(values));
  for (const name of Object.values(queueNames))
    builder.overrideProvider(getQueueToken(name)).useValue(queueBoundary(name));
  const module = await builder.compile();
  const app = module.createNestApplication<INestApplication<Server>>();
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
  return app;
}
async function closeApplication(
  app: INestApplication<Server>,
  database: Awaited<ReturnType<typeof createPostgresFixture>>,
  previous: NodeJS.ProcessEnv,
) {
  try {
    await app.close();
  } finally {
    await database.close();
    process.env = previous;
  }
}

function queueBoundary(name: string) {
  return {
    name,
    metaValues: { version: 'bullmq:test-adapter' },
    opts: {},
    add: jest.fn().mockResolvedValue({ id: 'job' }),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    getRepeatableJobs: jest.fn().mockResolvedValue([]),
    getJobSchedulers: jest.fn().mockResolvedValue([]),
  };
}
function teamRaceSettings(url: string) {
  return {
    NODE_ENV: 'test',
    DATABASE_TYPE: 'postgres',
    DATABASE_URL: url,
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
    JWT_SECRET: 'team-race-fixture-secret',
    JWT_EXPIRES_IN: '1h',
    SIGNING_KEY_ENCRYPTION_KEY: 'ab'.repeat(32),
    PDF_REQUIRE_TRUSTED_SIGNER: false,
    PDF_TIMESTAMP_REQUIRED: false,
    PDF_LTV_REQUIRED: false,
    PDF_A_ENABLED: false,
    THROTTLE_LIMIT: 10000,
  };
}
