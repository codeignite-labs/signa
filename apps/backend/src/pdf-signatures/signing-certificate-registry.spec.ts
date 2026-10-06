/* eslint-disable @typescript-eslint/require-await -- Test adapters deliberately implement asynchronous interfaces. */
import { Repository } from 'typeorm';
import { EncryptedConfig } from '../accounts/entities/encrypted-config.entity';
import {
  activateSigningCertificate,
  insertSigningCertificate,
  removeSigningCertificate,
} from './signing-certificate-registry';
import {
  defaultSigningCertificateKey,
  generateSignaDefaultCertificate,
  signingCertificatePrefix,
} from './pdf-signature-certificate';
import { decryptSigningKey } from './signing-key-envelope';

describe('account signing identity rotation', () => {
  const rows = new Map<string, EncryptedConfig>();
  const rowKey = (row: { accountId: string; key: string }) =>
    `${row.accountId}/${row.key}`;
  const repository = {
    create: (row: EncryptedConfig) => row,
    findOne: async ({ where }: { where: EncryptedConfig }) =>
      rows.get(rowKey(where)) ?? null,
    save: async (row: EncryptedConfig) => {
      rows.set(rowKey(row), row);
      return row;
    },
    remove: async (row: EncryptedConfig) => {
      rows.delete(rowKey(row));
      return row;
    },
  } as unknown as Repository<EncryptedConfig>;
  let identity: string;
  const originalKey = process.env.SIGNING_KEY_ENCRYPTION_KEY;
  beforeAll(() => {
    process.env.SIGNING_KEY_ENCRYPTION_KEY = 'c3'.repeat(32);
    identity = JSON.stringify(generateSignaDefaultCertificate());
  });
  beforeEach(() => rows.clear());
  afterAll(() => {
    if (originalKey === undefined)
      delete process.env.SIGNING_KEY_ENCRYPTION_KEY;
    else process.env.SIGNING_KEY_ENCRYPTION_KEY = originalKey;
  });

  it('encrypts uploads, preserves the active selection, and rejects duplicate names', async () => {
    await repository.save({
      accountId: '1',
      key: defaultSigningCertificateKey,
      value: 'Existing',
    } as EncryptedConfig);
    const uploaded = await insertSigningCertificate(repository, {
      accountId: '1',
      name: 'Renewal',
      value: identity,
    });
    expect(uploaded.value).not.toContain('"data"');
    expect(decryptSigningKey(uploaded.value, '1')).toBe(identity);
    expect(rows.get(`1/${defaultSigningCertificateKey}`)?.value).toBe(
      'Existing',
    );
    await expect(
      insertSigningCertificate(repository, {
        accountId: '1',
        name: 'Renewal',
        value: identity,
      }),
    ).rejects.toThrow('already exists');
  });

  it('selects one identity, blocks active deletion, and isolates tenants', async () => {
    await insertSigningCertificate(repository, {
      accountId: '1',
      name: 'Renewal',
      value: identity,
    });
    await expect(
      activateSigningCertificate(repository, '2', 'Renewal'),
    ).rejects.toThrow('not found');
    await activateSigningCertificate(repository, '1', 'Renewal');
    expect(rows.get(`1/${defaultSigningCertificateKey}`)?.value).toBe(
      'Renewal',
    );
    await expect(
      removeSigningCertificate(repository, '1', 'Renewal'),
    ).rejects.toThrow('Activate another');
    await insertSigningCertificate(repository, {
      accountId: '1',
      name: 'Next',
      value: identity,
    });
    await activateSigningCertificate(repository, '1', 'Next');
    await removeSigningCertificate(repository, '1', 'Renewal');
    expect(rows.has(`1/${signingCertificatePrefix}Renewal`)).toBe(false);
  });

  it('leaves selection unchanged when a candidate is malformed', async () => {
    await repository.save({
      accountId: '1',
      key: defaultSigningCertificateKey,
      value: 'Existing',
    } as EncryptedConfig);
    await repository.save({
      accountId: '1',
      key: `${signingCertificatePrefix}Broken`,
      value: '{}',
    } as EncryptedConfig);
    await expect(
      activateSigningCertificate(repository, '1', 'Broken'),
    ).rejects.toThrow('malformed');
    expect(rows.get(`1/${defaultSigningCertificateKey}`)?.value).toBe(
      'Existing',
    );
  });
});
