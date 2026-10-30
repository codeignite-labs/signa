import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import {
  defaultSigningCertificateKey,
  generateSignaDefaultCertificate,
  signaDefaultCertificateName,
  signingCertificatePrefix,
  StoredSigningCertificate,
} from '../pdf-signatures/pdf-signature-certificate';
import { PdfSignatureService } from '../pdf-signatures/pdf-signature.service';
import { PdfTrustRootService } from '../pdf-signatures/pdf-trust-root.service';
import { isEncryptedSigningKey } from '../pdf-signatures/signing-key-envelope';
import { StorageService } from '../storage/storage.service';
import { UploadedBufferFile } from '../storage/storage.types';
import { User } from '../users/entities/user.entity';
import { AccountsService } from './accounts.service';
import { AccountConfig } from './entities/account-config.entity';
import { AccountLinkedAccount } from './entities/account-linked-account.entity';
import { Account } from './entities/account.entity';
import { EncryptedConfig } from './entities/encrypted-config.entity';
let identity: StoredSigningCertificate;
let certificateFile: UploadedBufferFile;
const originalEncryptionKey = process.env.SIGNING_KEY_ENCRYPTION_KEY;
beforeAll(() => {
  process.env.SIGNING_KEY_ENCRYPTION_KEY = 'd4'.repeat(32);
  identity = generateSignaDefaultCertificate();
  const buffer = Buffer.from(identity.data, 'base64');
  certificateFile = {
    buffer,
    size: buffer.length,
    originalname: 'Organization.p12',
    mimetype: 'application/x-pkcs12',
  };
});
afterAll(() => {
  if (originalEncryptionKey === undefined)
    delete process.env.SIGNING_KEY_ENCRYPTION_KEY;
  else process.env.SIGNING_KEY_ENCRYPTION_KEY = originalEncryptionKey;
});
function setup() {
  const rows = new Map<string, EncryptedConfig>();
  const accounts = {
    findOneByOrFail: jest.fn().mockResolvedValue({ id: 'tenant' }),
    findOne: jest.fn().mockResolvedValue({ id: 'tenant' }),
  };
  const encrypted = {
    find: jest.fn(() => Promise.resolve([...rows.values()])),
    findOne: jest.fn(
      ({ where }: { where: { accountId: string; key: string } }) =>
        Promise.resolve(rows.get(`${where.accountId}/${where.key}`) ?? null),
    ),
    create: jest.fn((input: Partial<EncryptedConfig>) =>
      Object.assign(new EncryptedConfig(), input),
    ),
    save: jest.fn((row: EncryptedConfig) => {
      rows.set(`${row.accountId}/${row.key}`, row);
      return Promise.resolve(row);
    }),
    remove: jest.fn((row: EncryptedConfig) => {
      rows.delete(`${row.accountId}/${row.key}`);
      return Promise.resolve(row);
    }),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) =>
      entity === Account ? accounts : encrypted,
    ),
  };
  const source = {
    options: { type: 'postgres' },
    transaction: jest.fn(
      (callback: (manager: EntityManager) => Promise<unknown>) =>
        callback(manager as unknown as EntityManager),
    ),
  };
  const signatures = {
    ensureDefaultCertificate: jest.fn().mockResolvedValue(undefined),
    getTimestampServerUrl: jest
      .fn()
      .mockResolvedValue('https://tsa.example.test'),
    upsertTimestampServerUrl: jest.fn().mockResolvedValue(undefined),
    assertSigningPolicy: jest.fn().mockResolvedValue(undefined),
  };
  const trust = {
    list: jest.fn().mockResolvedValue([{ id: 'root' }]),
    upload: jest.fn().mockResolvedValue({ id: 'root' }),
    remove: jest.fn().mockResolvedValue({ id: 'root' }),
  };
  const service = new AccountsService(
    accounts as unknown as Repository<Account>,
    {} as Repository<AccountConfig>,
    {} as Repository<AccountLinkedAccount>,
    {} as Repository<User>,
    encrypted as unknown as Repository<EncryptedConfig>,
    source as unknown as DataSource,
    {} as StorageService,
    new ConfigService(),
    {} as MailService,
    signatures as unknown as PdfSignatureService,
    trust as unknown as PdfTrustRootService,
  );
  return { service, signatures, trust, rows, encrypted, accounts };
}
it('uploads named identities encrypted at rest without activating them and rotates the active selection under policy checks', async () => {
  const { service, rows, signatures, accounts } = setup();
  const uploaded = await service.uploadSigningCertificate(
    'tenant',
    '  Organization.pfx  ',
    certificateFile,
  );
  expect(uploaded).toMatchObject({
    name: 'Organization',
    is_active: false,
    fingerprint_sha256: identity.fingerprint_sha256,
    subject: identity.subject,
    issuer: identity.issuer,
    status: 'active',
  });
  expect(
    isEncryptedSigningKey(
      rows.get(`tenant/${signingCertificatePrefix}Organization`)!.value,
    ),
  ).toBe(true);
  expect(rows.has(`tenant/${defaultSigningCertificateKey}`)).toBe(false);
  expect(
    await service.makeDefaultSigningCertificate('tenant', 'Organization.p12'),
  ).toMatchObject({ name: 'Organization', is_active: true, status: 'default' });
  expect(signatures.assertSigningPolicy).toHaveBeenCalledWith(
    expect.objectContaining({ data: identity.data }),
    'tenant',
  );
  expect(accounts.findOne).toHaveBeenCalledWith({
    where: { id: 'tenant' },
    lock: { mode: 'pessimistic_write' },
  });
  await expect(
    service.deleteSigningCertificate('tenant', 'Organization'),
  ).rejects.toMatchObject({ status: 409 });
  await service.uploadSigningCertificate(
    'tenant',
    'Replacement',
    certificateFile,
  );
  await service.makeDefaultSigningCertificate('tenant', 'Replacement');
  expect(
    await service.deleteSigningCertificate('tenant', 'Organization'),
  ).toMatchObject({ name: 'Organization', is_active: false });
  expect(rows.has(`tenant/${signingCertificatePrefix}Organization`)).toBe(
    false,
  );
});
it('lists only account certificate entries, reports their active pointer, and tolerates absent legacy metadata', async () => {
  const { service, rows, signatures } = setup();
  rows.set(
    `tenant/${signingCertificatePrefix}${signaDefaultCertificateName}`,
    Object.assign(new EncryptedConfig(), {
      accountId: 'tenant',
      key: `${signingCertificatePrefix}${signaDefaultCertificateName}`,
      value: JSON.stringify(identity),
    }),
  );
  rows.set(
    'tenant/unrelated',
    Object.assign(new EncryptedConfig(), {
      accountId: 'tenant',
      key: 'other',
      value: 'ignored',
    }),
  );
  let result = await service.listSigningCertificates('tenant');
  expect(result.data).toHaveLength(1);
  expect(result.data[0]).toMatchObject({
    name: signaDefaultCertificateName,
    is_active: true,
  });
  expect(result.timestamp_server_url).toBe('https://tsa.example.test');
  expect(signatures.ensureDefaultCertificate).toHaveBeenCalledWith('tenant');
  rows.set(
    'tenant/broken',
    Object.assign(new EncryptedConfig(), {
      accountId: 'tenant',
      key: `${signingCertificatePrefix}Broken`,
      value: '{}',
    }),
  );
  rows.set(
    `tenant/${defaultSigningCertificateKey}`,
    Object.assign(new EncryptedConfig(), {
      accountId: 'tenant',
      key: defaultSigningCertificateKey,
      value: 'Broken',
    }),
  );
  result = await service.listSigningCertificates('tenant');
  expect(result.data.find((row) => row.name === 'Broken')).toMatchObject({
    fingerprint_sha256: null,
    subject: null,
    issuer: null,
    serial_number: null,
    valid_from: null,
    valid_to: null,
    is_active: true,
  });
});
it('keeps selection unchanged for missing, malformed or policy-rejected signing identities', async () => {
  const { service, rows, signatures } = setup();
  await expect(
    service.makeDefaultSigningCertificate('tenant', 'Missing'),
  ).rejects.toMatchObject({ status: 404 });
  rows.set(
    'tenant/broken',
    Object.assign(new EncryptedConfig(), {
      accountId: 'tenant',
      key: `${signingCertificatePrefix}Broken`,
      value: '{}',
    }),
  );
  // Persistence lookup keys mirror (account_id,key), including invalid legacy identity rows.
  const broken = rows.get('tenant/broken')!;
  rows.set(`tenant/${broken.key}`, broken);
  await expect(
    service.makeDefaultSigningCertificate('tenant', 'Broken'),
  ).rejects.toMatchObject({ status: 422 });
  await service.uploadSigningCertificate(
    'tenant',
    'Candidate',
    certificateFile,
  );
  signatures.assertSigningPolicy.mockRejectedValue(
    new Error('untrusted signing chain'),
  );
  await expect(
    service.makeDefaultSigningCertificate('tenant', 'Candidate'),
  ).rejects.toThrow('untrusted signing chain');
  expect(rows.has(`tenant/${defaultSigningCertificateKey}`)).toBe(false);
  await expect(
    service.makeDefaultSigningCertificate('other', 'Candidate'),
  ).rejects.toMatchObject({ status: 404 });
});
it('derives names from uploads, supports absent original filenames and rejects invalid or duplicate names', async () => {
  const { service } = setup();
  expect(
    await service.uploadSigningCertificate(
      'tenant',
      undefined,
      certificateFile,
    ),
  ).toMatchObject({ name: 'Organization', filename: 'Organization.p12' });
  expect(
    await service.uploadSigningCertificate('tenant', 'No filename', {
      ...certificateFile,
      originalname: '',
    }),
  ).toMatchObject({ name: 'No filename', filename: 'No filename.p12' });
  await expect(
    service.uploadSigningCertificate('tenant', 'Organization', certificateFile),
  ).rejects.toMatchObject({ status: 409 });
  for (const name of ['', 'x'.repeat(201), 'bad\u007fname', 'bad\u0001name'])
    await expect(
      service.makeDefaultSigningCertificate('tenant', name),
    ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.uploadSigningCertificate(
      'tenant',
      'Missing file',
      undefined as unknown as UploadedBufferFile,
    ),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.uploadSigningCertificate('tenant', 'Empty file', {
      ...certificateFile,
      buffer: Buffer.alloc(0),
    }),
  ).rejects.toMatchObject({ status: 422 });
});
it('updates TSA settings and delegates account-scoped trust-root operations', async () => {
  const { service, signatures, trust } = setup();
  expect(await service.updateTimestampServerUrl('tenant', null)).toMatchObject({
    data: [],
  });
  expect(signatures.upsertTimestampServerUrl).toHaveBeenCalledWith(
    'tenant',
    null,
  );
  expect(await service.listSigningTrustRoots('tenant')).toEqual({
    data: [{ id: 'root' }],
  });
  expect(
    await service.uploadSigningTrustRoot(
      'tenant',
      'Corporate root',
      certificateFile,
    ),
  ).toEqual({ id: 'root' });
  expect(trust.upload).toHaveBeenCalledWith({
    accountId: 'tenant',
    name: 'Corporate root',
    file: certificateFile,
  });
  expect(await service.deleteSigningTrustRoot('tenant', 'root')).toEqual({
    id: 'root',
  });
  expect(trust.remove).toHaveBeenCalledWith({
    accountId: 'tenant',
    id: 'root',
  });
});

it('rejects identity mutations if the account no longer exists', async () => {
  const { service, accounts, encrypted } = setup();
  accounts.findOne.mockResolvedValue(null);
  await expect(
    service.deleteSigningCertificate('tenant', 'Retired'),
  ).rejects.toMatchObject({ status: 404, message: 'Account not found' });
  expect(accounts.findOne).toHaveBeenCalledWith({
    where: { id: 'tenant' },
    lock: { mode: 'pessimistic_write' },
  });
  expect(encrypted.remove).not.toHaveBeenCalled();
  expect(encrypted.save).not.toHaveBeenCalled();
});

it('treats the generated identity as active when a legacy account has no selection pointer', async () => {
  const { service, rows, encrypted } = setup();
  const key = `${signingCertificatePrefix}${signaDefaultCertificateName}`;
  rows.set(
    `tenant/${key}`,
    Object.assign(new EncryptedConfig(), {
      accountId: 'tenant',
      key,
      value: JSON.stringify(identity),
    }),
  );
  await expect(
    service.deleteSigningCertificate('tenant', signaDefaultCertificateName),
  ).rejects.toMatchObject({
    status: 409,
    message: 'Activate another signing certificate before removing this one',
  });
  expect(rows.has(`tenant/${key}`)).toBe(true);
  expect(encrypted.remove).not.toHaveBeenCalled();
});

it('keeps the generated fallback identity after activating an uploaded replacement', async () => {
  const { service, rows, encrypted } = setup();
  const key = `${signingCertificatePrefix}${signaDefaultCertificateName}`;
  rows.set(
    `tenant/${key}`,
    Object.assign(new EncryptedConfig(), {
      accountId: 'tenant',
      key,
      value: JSON.stringify(identity),
    }),
  );
  await service.uploadSigningCertificate(
    'tenant',
    'Replacement',
    certificateFile,
  );
  await service.makeDefaultSigningCertificate('tenant', 'Replacement');
  await expect(
    service.deleteSigningCertificate('tenant', signaDefaultCertificateName),
  ).rejects.toMatchObject({
    status: 409,
    message: 'The generated signing identity cannot be removed',
  });
  expect(rows.has(`tenant/${key}`)).toBe(true);
  expect(rows.get(`tenant/${defaultSigningCertificateKey}`)?.value).toBe(
    'Replacement',
  );
  expect(encrypted.remove).not.toHaveBeenCalled();
});
