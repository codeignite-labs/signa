import { DataSource } from 'typeorm';
import { runSigningKeyMaintenance } from '../../test/support/signing-key-cli.fixture';
it('rejects an invalid encryption key before connecting to the database and logs no key material', async () => {
  const previousKey = process.env.SIGNING_KEY_ENCRYPTION_KEY;
  const previousExitCode = process.exitCode;
  const source = new DataSource({
    type: 'postgres',
    host: '127.0.0.1',
    port: 1,
    database: 'must-not-connect',
    synchronize: false,
    logging: false,
  });
  try {
    process.env.SIGNING_KEY_ENCRYPTION_KEY = 'invalid-configuration';
    const result = await runSigningKeyMaintenance(source);
    expect(result.initialize).not.toHaveBeenCalled();
    expect(result.destroy).not.toHaveBeenCalled();
    expect(result.log).not.toHaveBeenCalled();
    expect(result.error).toHaveBeenCalledWith(
      'Signing-key migration failed. Check database access and encryption-key configuration; no key material has been logged.',
    );
    expect(JSON.stringify(result.error.mock.calls)).not.toContain(
      'invalid-configuration',
    );
    expect(process.exitCode).toBe(1);
  } finally {
    jest.restoreAllMocks();
    process.exitCode = previousExitCode;
    if (previousKey === undefined)
      delete process.env.SIGNING_KEY_ENCRYPTION_KEY;
    else process.env.SIGNING_KEY_ENCRYPTION_KEY = previousKey;
  }
});
