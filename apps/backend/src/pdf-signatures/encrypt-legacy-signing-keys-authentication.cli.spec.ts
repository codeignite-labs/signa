import { randomUUID } from 'node:crypto';
import {
  createSigningKeyCliDatabase,
  runSigningKeyMaintenance,
} from '../../test/support/signing-key-cli.fixture';
import { encryptSigningKey } from './signing-key-envelope';
const previousKey = process.env.SIGNING_KEY_ENCRYPTION_KEY;
const previousDatabaseType = process.env.DATABASE_TYPE;
const previousExitCode = process.exitCode;
let database: Awaited<ReturnType<typeof createSigningKeyCliDatabase>>;
beforeAll(async () => {
  process.env.DATABASE_TYPE = 'postgres';
  process.env.SIGNING_KEY_ENCRYPTION_KEY = 'ba'.repeat(32);
  database = await createSigningKeyCliDatabase();
}, 60000);
afterAll(async () => {
  jest.restoreAllMocks();
  await database?.close();
  process.exitCode = previousExitCode;
  if (previousKey === undefined) delete process.env.SIGNING_KEY_ENCRYPTION_KEY;
  else process.env.SIGNING_KEY_ENCRYPTION_KEY = previousKey;
  if (previousDatabaseType === undefined) delete process.env.DATABASE_TYPE;
  else process.env.DATABASE_TYPE = previousDatabaseType;
});
it('refuses an existing envelope copied from another account, closes the database, and reports only a redacted failure', async () => {
  const { source } = database;
  const [account] = await source.query<Array<{ id: string }>>(
    'INSERT INTO accounts(uuid,name) VALUES ($1,$2) RETURNING id',
    [randomUUID(), 'CLI Account'],
  );
  const envelope = encryptSigningKey(
    'private-material-that-must-not-appear',
    'another-account',
  );
  await source.query(
    'INSERT INTO encrypted_configs(account_id,key,value) VALUES ($1,$2,$3)',
    [account.id, 'signing_certificate:copied-envelope', envelope],
  );
  await source.destroy();
  const result = await runSigningKeyMaintenance(source);
  expect(result.initialize).toHaveBeenCalledTimes(1);
  expect(result.destroy).toHaveBeenCalledTimes(1);
  expect(result.log).not.toHaveBeenCalled();
  expect(result.error).toHaveBeenCalledTimes(1);
  expect(process.exitCode).toBe(1);
  expect(source.isInitialized).toBe(false);
  expect(JSON.stringify(result.error.mock.calls)).not.toContain(envelope);
  expect(JSON.stringify(result.error.mock.calls)).not.toContain(
    'private-material-that-must-not-appear',
  );
  await source.initialize();
  const [stored] = await source.query<Array<{ value: string }>>(
    'SELECT value FROM encrypted_configs',
  );
  expect(stored.value).toBe(envelope);
}, 30000);
