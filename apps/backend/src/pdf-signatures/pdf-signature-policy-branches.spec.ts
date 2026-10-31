import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import forge from 'node-forge';
import { Repository } from 'typeorm';
import { EncryptedConfig } from '../accounts/entities/encrypted-config.entity';
import * as certificateFactory from './pdf-signature-certificate';
import { PdfSignatureService } from './pdf-signature.service';
import {
  PdfRevocationCollectorService,
  PdfLtvCollectionResult,
} from './pdf-revocation-collector.service';
import { PdfDssVriEmbedder } from './pdf-dss-vri-embedder';
import { PdfAService } from './pdf-a.service';
import { PdfTrustRootService } from './pdf-trust-root.service';
import { Rfc3161TimestampClient } from './rfc3161-timestamp-client';
import { p12SigningIdentity } from './pades-signer';
import { readSigningIdentity } from './signing-identity';
import { parsePemCertificates } from './certificate-validation-path';
let stored: certificateFactory.StoredSigningCertificate;
let pdf: Buffer;
const originalKey = process.env.SIGNING_KEY_ENCRYPTION_KEY;
beforeAll(async () => {
  stored = certificateFactory.generateSignaDefaultCertificate();
  const document = await PDFDocument.create();
  document.addPage([200, 200]);
  pdf = Buffer.from(await document.save());
}, 30000);
beforeEach(() => {
  process.env.SIGNING_KEY_ENCRYPTION_KEY = 'a4'.repeat(32);
  jest
    .spyOn(certificateFactory, 'generateSignaDefaultCertificate')
    .mockReturnValue(stored);
  jest.spyOn(Logger.prototype, 'error').mockImplementation();
});
afterEach(() => {
  jest.restoreAllMocks();
  if (originalKey === undefined) delete process.env.SIGNING_KEY_ENCRYPTION_KEY;
  else process.env.SIGNING_KEY_ENCRYPTION_KEY = originalKey;
});
function setup(settings: Record<string, unknown> = {}) {
  const rows = new Map<string, EncryptedConfig>();
  const repository = {
    findOne: jest
      .fn<
        Promise<EncryptedConfig | null>,
        [{ where: { accountId: string; key: string } }]
      >()
      .mockImplementation(({ where }) =>
        Promise.resolve(rows.get(where.key) ?? null),
      ),
    create: jest.fn((input: Partial<EncryptedConfig>) =>
      Object.assign(new EncryptedConfig(), input),
    ),
    save: jest.fn((input: EncryptedConfig) => {
      rows.set(input.key, input);
      return Promise.resolve(input);
    }),
    remove: jest.fn((input: EncryptedConfig) => {
      rows.delete(input.key);
      return Promise.resolve(input);
    }),
  };
  const config = new ConfigService(settings);
  const timestamps = {
    assertTimestampServerWorks: jest
      .fn<Promise<void>, [string]>()
      .mockResolvedValue(undefined),
    requestTimestampToken: jest
      .fn<
        ReturnType<Rfc3161TimestampClient['requestTimestampToken']>,
        Parameters<Rfc3161TimestampClient['requestTimestampToken']>
      >()
      .mockResolvedValue({ attempts: [], token: null, url: null }),
  };
  const collector = {
    collectForSignedPdf: jest
      .fn<Promise<PdfLtvCollectionResult>, [unknown]>()
      .mockResolvedValue({
        evidences: [],
        metadata: { evidenceStatus: 'missing', ltvRequired: false },
      }),
  };
  const roots = {
    getTrustedCertificates: jest
      .fn<ReturnType<PdfTrustRootService['getTrustedCertificates']>, [string]>()
      .mockResolvedValue([]),
  };
  const service = new PdfSignatureService(
    repository as unknown as Repository<EncryptedConfig>,
    config,
    timestamps as unknown as Rfc3161TimestampClient,
    collector as unknown as PdfRevocationCollectorService,
    new PdfDssVriEmbedder(),
    new PdfAService(config),
    roots as unknown as PdfTrustRootService,
  );
  const sign = () =>
    service.signPdf({
      accountId: 'tenant',
      buffer: pdf,
      reason: 'Fixture signature',
      signerName: 'Organization',
    });
  return { rows, repository, timestamps, collector, roots, service, sign };
}
it('returns the concurrently created default identity after a unique constraint race', async () => {
  const { service, repository, rows } = setup();
  const key = `${certificateFactory.signingCertificatePrefix}${certificateFactory.signaDefaultCertificateName}`;
  const winner = Object.assign(new EncryptedConfig(), {
    key,
    accountId: 'tenant',
    value: 'winner identity',
  });
  rows.set(key, winner);
  repository.findOne.mockResolvedValueOnce(null);
  repository.save.mockRejectedValueOnce(
    Object.assign(new Error('duplicate'), { code: '23505' }),
  );
  expect(await service.ensureDefaultCertificate('tenant')).toBe(winner);
  expect(repository.findOne).toHaveBeenLastCalledWith({
    where: { accountId: 'tenant', key },
  });
});
it.each(['23505', 'other'])(
  'preserves default identity persistence failure when no safe winner exists (%s)',
  async (code) => {
    const { service, repository } = setup();
    const error = Object.assign(new Error('save failed'), { code });
    repository.save.mockRejectedValue(error);
    await expect(service.ensureDefaultCertificate('tenant')).rejects.toBe(
      error,
    );
  },
);
it('normalizes and validates timestamp settings before storing, updates existing values and removes empty settings', async () => {
  const { service, rows, timestamps, repository } = setup();
  expect(await service.getTimestampServerUrl('tenant')).toBeNull();
  expect(
    await service.upsertTimestampServerUrl(
      'tenant',
      '  https://tsa.example/  ',
    ),
  ).toBe('https://tsa.example/');
  expect(timestamps.assertTimestampServerWorks).toHaveBeenCalledWith(
    'https://tsa.example/',
  );
  expect(await service.getTimestampServerUrl('tenant')).toBe(
    'https://tsa.example/',
  );
  const first = rows.get(certificateFactory.timestampServerUrlKey);
  await service.upsertTimestampServerUrl('tenant', 'https://other.example/');
  expect(rows.get(certificateFactory.timestampServerUrlKey)).toBe(first);
  await service.upsertTimestampServerUrl('tenant', null);
  expect(repository.remove).toHaveBeenCalledWith(first);
  expect(await service.upsertTimestampServerUrl('tenant', ' ')).toBeNull();
  expect(rows.size).toBe(0);
});
it('does not persist an unverified timestamp endpoint when the TSA probe fails', async () => {
  const { service, rows, timestamps } = setup();
  timestamps.assertTimestampServerWorks.mockRejectedValue(
    new Error('TSA untrusted'),
  );
  await expect(
    service.upsertTimestampServerUrl('tenant', 'https://invalid.example'),
  ).rejects.toThrow('TSA untrusted');
  expect(rows.size).toBe(0);
});
it('enforces configured account CA trust rather than treating a private root as publicly approved', async () => {
  const { service, roots } = setup({ PDF_REQUIRE_TRUSTED_SIGNER: true });
  await expect(
    service.assertSigningPolicy(stored, 'tenant'),
  ).rejects.toMatchObject({ status: 422 });
  roots.getTrustedCertificates.mockResolvedValue([
    p12SigningIdentity(Buffer.from(stored.data, 'base64'), '').certificates[0],
  ]);
  await expect(service.assertSigningPolicy(stored, 'tenant')).rejects.toThrow(
    'approved account CA',
  );
  const root = readSigningIdentity(
    Buffer.from(stored.data, 'base64'),
    '',
  ).certificates.at(-1)!;
  roots.getTrustedCertificates.mockResolvedValue(
    parsePemCertificates(forge.pki.certificateToPem(root)),
  );
  await expect(
    service.assertSigningPolicy(stored, 'tenant'),
  ).resolves.toBeUndefined();
  expect(roots.getTrustedCertificates).toHaveBeenCalledWith('tenant');
});
it('supports an explicitly configured legacy Adobe signature without a TSA, and rejects timestamped Adobe mode', async () => {
  const legacy = setup({ PDF_SIGNATURE_SUBFILTER: 'adobe' });
  expect((await legacy.sign()).signatureSubFilter).toBe('adbe.pkcs7.detached');
  legacy.rows.set(
    certificateFactory.timestampServerUrlKey,
    Object.assign(new EncryptedConfig(), { value: 'https://tsa.example/' }),
  );
  await expect(legacy.sign()).rejects.toThrow('requires PAdES');
});
it.each([false, true])(
  'reports a failed optional timestamp and refuses it when required (%s)',
  async (required) => {
    const { sign, rows, timestamps } = setup({
      PDF_TIMESTAMP_REQUIRED: required,
    });
    rows.set(
      certificateFactory.timestampServerUrlKey,
      Object.assign(new EncryptedConfig(), { value: 'https://tsa.example/' }),
    );
    if (required)
      await expect(sign()).rejects.toThrow('valid trusted TSA token');
    else
      expect((await sign()).timestamp).toMatchObject({
        embedded: false,
        status: 'failed',
      });
    expect(timestamps.requestTimestampToken).toHaveBeenCalledTimes(1);
  },
);
it('rejects revoked certificates even when LTV is optional, and missing evidence when mandatory', async () => {
  const { sign, collector } = setup();
  collector.collectForSignedPdf.mockResolvedValue({
    evidences: [],
    metadata: { evidenceStatus: 'revoked', ltvRequired: false },
  });
  await expect(sign()).rejects.toMatchObject({
    status: 422,
    response: { revocation_status: 'revoked' },
  });
  collector.collectForSignedPdf.mockResolvedValue({
    evidences: [],
    metadata: { evidenceStatus: 'missing', ltvRequired: true },
  });
  await expect(sign()).rejects.toMatchObject({
    status: 422,
    response: { revocation_status: 'missing' },
  });
});
