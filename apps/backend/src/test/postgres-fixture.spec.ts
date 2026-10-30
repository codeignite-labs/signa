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
