import { ConfigService } from '@nestjs/config';
import validationSchema from '../env.schema';
import { createTypeOrmOptions } from './database-options';

describe('database options', () => {
  it('uses SQLite when DATABASE_URL is not configured', () => {
    const options = createTypeOrmOptions(
      createConfig({
        DATABASE_TYPE: '',
        DATABASE_URL: '',
        DATABASE_HOST: '',
        SQLITE_DATABASE_PATH: '/data/signa.sqlite',
      }),
    );

    expect(options).toMatchObject({
      type: 'better-sqlite3',
      database: '/data/signa.sqlite',
    });
  });

  it('uses DATABASE_URL as the complete PostgreSQL connection contract', () => {
    const options = createTypeOrmOptions(
      createConfig({
        DATABASE_TYPE: '',
        DATABASE_URL:
          'postgresql://signa:secret@database.example.com:5432/signa',
        DATABASE_HOST: 'stale-host.example.com',
        DATABASE_PORT: 6543,
        DATABASE_USER: 'stale-user',
      }),
    );

    expect(options).toMatchObject({
      type: 'postgres',
      url: 'postgresql://signa:secret@database.example.com:5432/signa',
    });
    expect(options).not.toHaveProperty('host');
    expect(options).not.toHaveProperty('port');
    expect(options).not.toHaveProperty('username');
  });

  it('encrypts PostgreSQL connections without requiring a custom CA', () => {
    const options = createTypeOrmOptions(
      createConfig({
        DATABASE_URL:
          'postgresql://signa:secret@database.example.com:5432/signa',
        DATABASE_SSL: true,
      }),
    );

    expect(options).toMatchObject({
      type: 'postgres',
      ssl: { rejectUnauthorized: false },
    });
  });

  it('keeps PostgreSQL TLS disabled unless DATABASE_SSL is enabled', () => {
    const options = createTypeOrmOptions(
      createConfig({
        DATABASE_URL:
          'postgresql://signa:secret@database.example.com:5432/signa',
        DATABASE_SSL: false,
      }),
    );

    expect(options).toMatchObject({
      type: 'postgres',
      ssl: false,
    });
  });

  it('accepts empty optional values emitted by Docker Compose', () => {
    const validationResult = validationSchema.validate({
      DATABASE_MIGRATIONS_RUN: '',
      DATABASE_PORT: '',
      SMTP_ENABLE_SSL: '',
      SMTP_ENABLE_STARTTLS: '',
      SMTP_ENABLE_TLS: '',
      SMTP_OPEN_TIMEOUT: '',
      SMTP_PORT: '',
      SMTP_READ_TIMEOUT: '',
      SMTP_SSL_VERIFY: '',
    });

    expect(validationResult.error).toBeUndefined();
    expect(validationResult.value).toMatchObject({
      DATABASE_MIGRATIONS_RUN: false,
      DATABASE_PORT: 5432,
    });
  });
});

function createConfig(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      const value = values[key];

      return value === undefined ? defaultValue : value;
    }),
  } as unknown as ConfigService;
}

it('reads PostgreSQL CLI environment strings and host defaults without schema coercion', () => {
  const options = createTypeOrmOptions(
    new ConfigService({
      DATABASE_TYPE: 'postgresql',
      DATABASE_URL: '',
      DATABASE_HOST: '',
      DATABASE_PORT: '6543',
      DATABASE_SSL: 'true',
      DATABASE_LOGGING: 'false',
    }),
  );
  expect(options).toMatchObject({
    type: 'postgres',
    host: 'localhost',
    port: 6543,
    ssl: { rejectUnauthorized: false },
    logging: false,
    synchronize: false,
  });
});
it('honors the alternate SQLite dialect identifier in CLI configuration', () => {
  const options = createTypeOrmOptions(
    new ConfigService({
      DATABASE_TYPE: 'better-sqlite3',
      SQLITE_SYNCHRONIZE: 'false',
      DATABASE_LOGGING: 'true',
    }),
  );
  expect(options).toMatchObject({
    type: 'better-sqlite3',
    synchronize: false,
    logging: true,
  });
});
