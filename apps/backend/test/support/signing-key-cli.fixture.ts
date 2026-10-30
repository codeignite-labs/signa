import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { createPostgresFixture } from '../../src/test/postgres-fixture';
export async function createSigningKeyCliDatabase() {
  const database = await createPostgresFixture();
  const source = new DataSource({
    type: 'postgres',
    url: database.url,
    logging: false,
    synchronize: false,
    migrationsRun: false,
    migrations: [join(__dirname, '../../src/database/migrations/*{.ts,.js}')],
    entities: [join(__dirname, '../../src/**/*.entity{.ts,.js}')],
  });
  try {
    await source.initialize();
    await source.runMigrations({ transaction: 'all' });
  } catch (error) {
    if (source.isInitialized) await source.destroy();
    await database.close();
    throw error;
  }
  return {
    source,
    close: async () => {
      if (source.isInitialized) await source.destroy();
      await database.close();
    },
  };
}
// Each spec imports this command once. Its only replaced dependency is the
// actual DataSource for the disposable database; application dotenv is never read.
export async function runSigningKeyMaintenance(source: DataSource) {
  jest.doMock('../../src/database/data-source', () => ({
    __esModule: true,
    default: source,
  }));
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const error = jest.spyOn(console, 'error').mockImplementation(() => {
    finish();
  });
  const originalDestroy = source.destroy.bind(source);
  const destroy = jest.spyOn(source, 'destroy').mockImplementation(async () => {
    try {
      await originalDestroy();
    } finally {
      finish();
    }
  });
  const initialize = jest.spyOn(source, 'initialize');
  jest.requireActual(
    '../../src/pdf-signatures/encrypt-legacy-signing-keys.cli',
  );
  await finished;
  // The top-level catch runs after the command's awaited finally cleanup.
  await Promise.resolve();
  await Promise.resolve();
  return { log, error, destroy, initialize };
}
