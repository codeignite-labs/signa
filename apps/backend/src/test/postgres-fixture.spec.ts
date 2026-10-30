import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPostgresFixture } from './postgres-fixture';
const previous = process.env.TEST_DATABASE_ADMIN_URL;
afterEach(() => {
  if (previous === undefined) delete process.env.TEST_DATABASE_ADMIN_URL;
  else process.env.TEST_DATABASE_ADMIN_URL = previous;
});
it('rejects remote database configuration before attempting a connection', async () => {
  process.env.TEST_DATABASE_ADMIN_URL =
    'postgres://user@database.example.test/production';
  await expect(createPostgresFixture()).rejects.toThrow(
    'local PostgreSQL test server',
  );
});
it('creates separate disposable databases on an explicitly configured local test server', async () => {
  if (previous === undefined) delete process.env.TEST_DATABASE_ADMIN_URL;
  else process.env.TEST_DATABASE_ADMIN_URL = previous;
  const parent = await createPostgresFixture();
  try {
    process.env.TEST_DATABASE_ADMIN_URL = parent.url;
    const child = await createPostgresFixture();
    try {
      expect(new URL(child.url).pathname).not.toBe(
        new URL(parent.url).pathname,
      );
    } finally {
      await child.close();
    }
    const missing = new URL(parent.url);
    missing.pathname += '_missing';
    process.env.TEST_DATABASE_ADMIN_URL = missing.toString();
    await expect(createPostgresFixture()).rejects.toMatchObject({
      code: '3D000',
    });
  } finally {
    await parent.close();
  }
});

it('cleans up a failed local bootstrap when PostgreSQL binaries are unavailable', async () => {
  const originalUrl = process.env.DATABASE_URL;
  const originalBinary = process.env.PG_BIN;
  const filesystem =
    jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
  const temporary = jest.spyOn(filesystem, 'mkdtemp');
  try {
    delete process.env.DATABASE_URL;
    delete process.env.TEST_DATABASE_ADMIN_URL;
    process.env.PG_BIN = join(
      tmpdir(),
      `missing-signa-postgres-${randomUUID()}`,
    );
    await expect(createPostgresFixture()).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const directory = await (temporary.mock.results[0]
      .value as Promise<string>);
    await expect(fs.access(directory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (originalBinary === undefined) delete process.env.PG_BIN;
    else process.env.PG_BIN = originalBinary;
    temporary.mockRestore();
  }
});
