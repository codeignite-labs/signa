import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DataSource } from 'typeorm';
const run = promisify(execFile);

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === 'string')
    throw new Error('No PostgreSQL test port available');
  return address.port;
}

async function startLocalPostgres() {
  const directory = await mkdtemp(join(tmpdir(), 'signa-test-postgres-'));
  const binary = process.env.PG_BIN ?? '/usr/lib/postgresql/16/bin';
  const port = await freePort();
  const stop = async () => {
    await run(join(binary, 'pg_ctl'), [
      '-D',
      directory,
      '-m',
      'immediate',
      '-w',
      'stop',
    ]).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await run(join(binary, 'initdb'), [
      '-D',
      directory,
      '-A',
      'trust',
      '-U',
      'signa',
      '--encoding=UTF8',
      '--no-locale',
    ]);
    await run(join(binary, 'pg_ctl'), [
      '-D',
      directory,
      '-l',
      join(directory, 'server.log'),
      '-w',
      '-t',
      '20',
      '-o',
      `-F -h 127.0.0.1 -p ${port} -k ${directory}`,
      'start',
    ]);
    return { url: `postgres://signa@127.0.0.1:${port}/postgres`, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

// Always creates a new database. Never runs application migrations or rollbacks
// against the configured database; the provided URL is only an admin connection.
export async function createPostgresFixture() {
  const configured =
    process.env.TEST_DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (
    configured &&
    !['localhost', '127.0.0.1', '[::1]', 'postgres'].includes(
      new URL(configured).hostname,
    )
  ) {
    throw new Error(
      'Migration fixtures require a local PostgreSQL test server.',
    );
  }
  const cluster = configured
    ? { url: configured, stop: () => Promise.resolve(undefined) }
    : await startLocalPostgres();
  const database = `signa_coverage_${randomBytes(10).toString('hex')}`;
  const admin = new DataSource({
    type: 'postgres',
    url: cluster.url,
    logging: false,
  });
  try {
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${database}"`);
    const url = new URL(cluster.url);
    url.pathname = `/${database}`;
    return {
      url: url.toString(),
      close: async () => {
        try {
          await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
        } finally {
          await admin.destroy();
          await cluster.stop();
        }
      },
    };
  } catch (error) {
    if (admin.isInitialized) await admin.destroy();
    await cluster.stop();
    throw error;
  }
}
