import { randomUUID } from 'node:crypto';
import {
  createSigningKeyCliDatabase,
  runSigningKeyMaintenance,
} from '../../test/support/signing-key-cli.fixture';
import {
  decryptSigningKey,
  encryptSigningKey,
  isEncryptedSigningKey,
} from './signing-key-envelope';
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
it('encrypts every legacy identity across cursor pages and accounts, authenticates existing envelopes, and leaves unrelated settings intact', async () => {
  const { source } = database;
  const accounts = await source.query<Array<{ id: string }>>(
    'INSERT INTO accounts (uuid,name) VALUES ($1,$2),($3,$4) RETURNING id',
    [randomUUID(), 'CLI One', randomUUID(), 'CLI Two'],
  );
  const privateMaterial = 'synthetic-private-signing-key-material';
  for (let index = 0; index < 101; index++)
    await source.query(
      'INSERT INTO encrypted_configs(account_id,key,value) VALUES ($1,$2,$3)',
      [
        accounts[0].id,
        `signing_certificate:legacy-${index}`,
        JSON.stringify({ data: `${privateMaterial}-${index}` }),
      ],
    );
  await source.query(
    'INSERT INTO encrypted_configs(account_id,key,value) VALUES ($1,$2,$3)',
    [
      accounts[1].id,
      'signing_certificate:other-account',
      'other-tenant-private-material',
    ],
  );
  const envelope = encryptSigningKey(
    'already-encrypted-private-material',
    String(accounts[0].id),
  );
  await source.query(
    'INSERT INTO encrypted_configs(account_id,key,value) VALUES ($1,$2,$3),($1,$4,$5)',
    [
      accounts[0].id,
      'signing_certificate:encrypted',
      envelope,
      'unrelated_config',
      'unrelated-value',
    ],
  );
  await source.destroy();
  source.setOptions({ logging: true });
  const result = await runSigningKeyMaintenance(source);
  expect(result.initialize).toHaveBeenCalledTimes(1);
  expect(result.destroy).toHaveBeenCalledTimes(1);
  expect(result.error).not.toHaveBeenCalled();
  expect(source.options).toMatchObject({
    logging: false,
    synchronize: false,
    migrationsRun: false,
  });
  expect(result.log).toHaveBeenCalledWith(
    'Encrypted 102 legacy signing identities. Existing encrypted records were authenticated.',
  );
  expect(result.log).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result.log.mock.calls)).not.toContain('private');
  expect(JSON.stringify(result.log.mock.calls)).not.toContain(
    'signing-key:v1:',
  );
  await source.initialize();
  const rows = await source.query<
    Array<{ account_id: string; key: string; value: string }>
  >('SELECT account_id,key,value FROM encrypted_configs ORDER BY id');
  expect(rows).toHaveLength(104);
  for (const row of rows.filter((row) =>
    row.key.startsWith('signing_certificate:'),
  )) {
    expect(isEncryptedSigningKey(row.value)).toBe(true);
    const plain = decryptSigningKey(row.value, String(row.account_id));
    if (row.key === 'signing_certificate:encrypted') {
      expect(row.value).toBe(envelope);
      expect(plain).toBe('already-encrypted-private-material');
    } else if (row.key === 'signing_certificate:other-account')
      expect(plain).toBe('other-tenant-private-material');
    else
      expect(plain).toBe(
        JSON.stringify({
          data: `${privateMaterial}-${row.key.split('-').at(-1)}`,
        }),
      );
  }
  expect(rows.find((row) => row.key === 'unrelated_config')?.value).toBe(
    'unrelated-value',
  );
  expect(process.exitCode).toBe(previousExitCode);
}, 30000);
