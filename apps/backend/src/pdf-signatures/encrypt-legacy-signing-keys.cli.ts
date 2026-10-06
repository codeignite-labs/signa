import { Like, MoreThan } from 'typeorm';
import dataSource from '../database/data-source';
import { EncryptedConfig } from '../accounts/entities/encrypted-config.entity';
import { signingCertificatePrefix } from './pdf-signature-certificate';
import {
  decryptSigningKey,
  encryptSigningKey,
  isEncryptedSigningKey,
} from './signing-key-envelope';

// Maintenance command: no schema changes and no private material in output.
async function encryptLegacyKeys() {
  encryptSigningKey('configuration check', 'maintenance');
  dataSource.setOptions({
    logging: false,
    synchronize: false,
    migrationsRun: false,
  });
  await dataSource.initialize();
  let cursor = '0';
  let encrypted = 0;
  try {
    const repository = dataSource.getRepository(EncryptedConfig);
    while (true) {
      const rows = await repository.find({
        where: {
          id: MoreThan(cursor),
          key: Like(`${signingCertificatePrefix}%`),
        },
        order: { id: 'ASC' },
        take: 100,
      });
      if (!rows.length) break;
      for (const row of rows) {
        if (isEncryptedSigningKey(row.value)) {
          decryptSigningKey(row.value, row.accountId);
          continue;
        }
        const result = await repository.update(
          { id: row.id, accountId: row.accountId, value: row.value },
          { value: encryptSigningKey(row.value, row.accountId) },
        );
        encrypted += result.affected ?? 0;
      }
      cursor = rows.at(-1)!.id;
    }
    console.log(
      `Encrypted ${encrypted} legacy signing identities. Existing encrypted records were authenticated.`,
    );
  } finally {
    await dataSource.destroy();
  }
}

void encryptLegacyKeys().catch(() => {
  console.error(
    'Signing-key migration failed. Check database access and encryption-key configuration; no key material has been logged.',
  );
  process.exitCode = 1;
});
