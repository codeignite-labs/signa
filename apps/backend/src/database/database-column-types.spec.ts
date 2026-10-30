import {
  getConfiguredDatabaseType,
  hasPostgresConfig,
} from './database-column-types';
const names = ['DATABASE_TYPE', 'DATABASE_URL', 'DATABASE_HOST'] as const;
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
});
afterEach(() => {
  for (const name of names) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
});
it.each(['sqlite', 'better-sqlite3', ' SQLITE '])(
  'honors explicit SQLite dialect %s even with PostgreSQL variables',
  (dialect) => {
    process.env.DATABASE_TYPE = dialect;
    process.env.DATABASE_URL = 'postgres://localhost/test';
    expect(getConfiguredDatabaseType()).toBe('sqlite');
  },
);
it.each(['postgres', 'postgresql', ' POSTGRES '])(
  'honors explicit PostgreSQL dialect %s',
  (dialect) => {
    process.env.DATABASE_TYPE = dialect;
    expect(getConfiguredDatabaseType()).toBe('postgres');
  },
);
it.each(['DATABASE_URL', 'DATABASE_HOST'] as const)(
  'infers PostgreSQL from %s when the dialect is unset',
  (name) => {
    process.env[name] = 'local-fixture';
    expect(hasPostgresConfig()).toBe(true);
    expect(getConfiguredDatabaseType()).toBe('postgres');
  },
);
it('uses SQLite when no PostgreSQL configuration exists', () => {
  expect(hasPostgresConfig()).toBe(false);
  expect(getConfiguredDatabaseType()).toBe('sqlite');
});
