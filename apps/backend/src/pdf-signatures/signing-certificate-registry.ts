import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { EncryptedConfig } from '../accounts/entities/encrypted-config.entity';
import {
  defaultSigningCertificateKey,
  inspectP12Certificate,
  parseStoredSigningCertificate,
  signaDefaultCertificateName,
  signingCertificatePrefix,
} from './pdf-signature-certificate';
import { decryptSigningKey, encryptSigningKey } from './signing-key-envelope';

// Account-row locking serializes rotation/deletion across all workers. The existing
// unique (account_id, key) index makes the active pointer unambiguous.
export async function mutateSigningCertificates<T>(
  source: DataSource,
  accountId: string,
  change: (repo: Repository<EncryptedConfig>) => Promise<T>,
): Promise<T> {
  return source.transaction(async (manager) => {
    const sqlite = ['sqlite', 'better-sqlite3'].includes(source.options.type);
    if (sqlite)
      await manager.query('UPDATE accounts SET id = id WHERE id = ?', [
        accountId,
      ]);
    const account = await manager.getRepository(Account).findOne({
      where: { id: accountId },
      ...(sqlite ? {} : { lock: { mode: 'pessimistic_write' as const } }),
    });
    if (!account) throw new NotFoundException('Account not found');
    return change(manager.getRepository(EncryptedConfig));
  });
}

export async function activateSigningCertificate(
  repo: Repository<EncryptedConfig>,
  accountId: string,
  name: string,
) {
  const certificate = await findCertificate(repo, accountId, name);
  const plaintext = decryptSigningKey(certificate.value, accountId);
  const stored = parseStoredSigningCertificate(plaintext);
  if (!stored)
    throw new UnprocessableEntityException('Signing certificate is malformed');
  inspectP12Certificate(
    Buffer.from(stored.data, 'base64'),
    stored.password ?? '',
  );
  certificate.value = encryptSigningKey(plaintext, accountId);
  await repo.save(certificate);
  const selection =
    (await repo.findOne({
      where: { accountId, key: defaultSigningCertificateKey },
    })) ?? repo.create({ accountId, key: defaultSigningCertificateKey });
  selection.value = name;
  await repo.save(selection);
  return certificate;
}

export async function removeSigningCertificate(
  repo: Repository<EncryptedConfig>,
  accountId: string,
  name: string,
) {
  const selected = await repo.findOne({
    where: { accountId, key: defaultSigningCertificateKey },
  });
  if (name === (selected?.value ?? signaDefaultCertificateName))
    throw new ConflictException(
      'Activate another signing certificate before removing this one',
    );
  if (name === signaDefaultCertificateName)
    throw new ConflictException(
      'The generated signing identity cannot be removed',
    );
  const certificate = await findCertificate(repo, accountId, name);
  await repo.remove(certificate);
  return certificate;
}

export async function insertSigningCertificate(
  repo: Repository<EncryptedConfig>,
  input: { accountId: string; name: string; value: string },
) {
  const key = `${signingCertificatePrefix}${input.name}`;
  if (
    input.name === signaDefaultCertificateName ||
    (await repo.findOne({ where: { accountId: input.accountId, key } }))
  ) {
    throw new ConflictException(
      'A signing certificate with this name already exists. Use a different name for a new certificate.',
    );
  }
  return repo.save(
    repo.create({
      accountId: input.accountId,
      key,
      value: encryptSigningKey(input.value, input.accountId),
    }),
  );
}

async function findCertificate(
  repo: Repository<EncryptedConfig>,
  accountId: string,
  name: string,
) {
  const certificate = await repo.findOne({
    where: { accountId, key: `${signingCertificatePrefix}${name}` },
  });
  if (!certificate)
    throw new NotFoundException('Signing certificate not found');
  return certificate;
}
