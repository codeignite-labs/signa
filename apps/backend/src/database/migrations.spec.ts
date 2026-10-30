import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { createPostgresFixture } from '../test/postgres-fixture';
import { AutoMigration1782254167735 } from './migrations/1782254167735-AutoMigration';
import { AutoMigration1782588500692 } from './migrations/1782588500692-AutoMigration';
import { AutoMigration1782659835709 } from './migrations/1782659835709-AutoMigration';
import { AutoMigration1782943023551 } from './migrations/1782943023551-AutoMigration';
import { AutoMigration1783287631566 } from './migrations/1783287631566-AutoMigration';
import { IndexStorageBlobSha2561786492800000 } from './migrations/1786492800000-IndexStorageBlobSha256';
import { OptimizeRevocationEvidence1786492801000 } from './migrations/1786492801000-OptimizeRevocationEvidence';
import { AccountMemberships1791290297145 } from './migrations/1791290297145-AccountMemberships';
const migrations = [
  AutoMigration1782254167735,
  AutoMigration1782588500692,
  AutoMigration1782659835709,
  AutoMigration1782943023551,
  AutoMigration1783287631566,
  IndexStorageBlobSha2561786492800000,
  OptimizeRevocationEvidence1786492801000,
  AccountMemberships1791290297145,
];
let fixture: Awaited<ReturnType<typeof createPostgresFixture>>;
let source: DataSource;
const previousType = process.env.DATABASE_TYPE;
beforeAll(async () => {
  fixture = await createPostgresFixture();
  process.env.DATABASE_TYPE = 'postgres';
  source = new DataSource({
    type: 'postgres',
    url: fixture.url,
    synchronize: false,
    logging: false,
    migrations,
    entities: [join(__dirname, '../**/*.entity{.ts,.js}')],
  });
  await source.initialize();
  await source.runMigrations({ transaction: 'all' });
}, 60000);
afterAll(async () => {
  try {
    if (source?.isInitialized) await source.destroy();
  } finally {
    await fixture?.close();
    if (previousType === undefined) delete process.env.DATABASE_TYPE;
    else process.env.DATABASE_TYPE = previousType;
  }
});
it('migrates an empty PostgreSQL database to the complete application schema without synchronization', async () => {
  expect(source.entityMetadatas.length).toBeGreaterThan(25);
  expect(await source.showMigrations()).toBe(false);
  const tables = await source.query<Array<{ table_name: string }>>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
  );
  expect(tables.map((table) => table.table_name)).toEqual(
    expect.arrayContaining([
      'accounts',
      'users',
      'account_memberships',
      'submissions',
      'submitters',
      'templates',
      'active_storage_blobs',
      'payment_attempts',
      'identity_verifications',
    ]),
  );
});
it('enforces membership uniqueness per account while allowing one identity across organizations', async () => {
  const accounts = await source.query<Array<{ id: number }>>(
    'INSERT INTO accounts (uuid,name) VALUES ($1,$2),($3,$4) RETURNING id',
    [randomUUID(), 'First', randomUUID(), 'Second'],
  );
  const [user] = await source.query<Array<{ id: number }>>(
    'INSERT INTO users (account_id,email,uuid,encrypted_password) VALUES ($1,$2,$3,$4) RETURNING id',
    [
      accounts[0].id,
      'fixture@example.test',
      randomUUID(),
      'test-only-placeholder',
    ],
  );
  for (const account of accounts)
    await source.query(
      'INSERT INTO account_memberships (account_id,user_id,role,accepted_at) VALUES ($1,$2,$3,now())',
      [account.id, user.id, 'member'],
    );
  const memberships = await source.query<Array<{ count: string }>>(
    'SELECT count(*) FROM account_memberships WHERE user_id=$1',
    [user.id],
  );
  expect(memberships[0].count).toBe('2');
  await expect(
    source.query(
      'INSERT INTO account_memberships (account_id,user_id) VALUES ($1,$2)',
      [accounts[0].id, user.id],
    ),
  ).rejects.toMatchObject({ driverError: { code: '23505' } });
  await expect(
    source.query(
      'INSERT INTO account_memberships (account_id,user_id) VALUES ($1,$2)',
      [2147483647, user.id],
    ),
  ).rejects.toMatchObject({ driverError: { code: '23503' } });
});
it('rolls every migration back on PostgreSQL and can rebuild the application schema afterwards', async () => {
  for (let index = 0; index < migrations.length; index++)
    await source.undoLastMigration({ transaction: 'all' });
  const tables = await source.query<Array<{ table_name: string }>>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name <> 'migrations'",
  );
  expect(tables).toEqual([]);
  await source.runMigrations({ transaction: 'all' });
  expect(await source.showMigrations()).toBe(false);
}, 30000);
