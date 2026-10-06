/* eslint-disable @typescript-eslint/require-await -- Test adapters deliberately implement asynchronous interfaces. */
import { ConfigService } from '@nestjs/config';
import { PDFDocument } from 'pdf-lib';
import { EncryptedConfig } from '../accounts/entities/encrypted-config.entity';
import {
  defaultSigningCertificateKey,
  generateSignaDefaultCertificate,
  signaDefaultCertificateName,
  signingCertificatePrefix,
} from './pdf-signature-certificate';
import { PdfSignatureService } from './pdf-signature.service';
import { decryptSigningKey } from './signing-key-envelope';

const testKey = 'a1'.repeat(32);

describe('PdfSignatureService policy', () => {
  const records = new Map<string, EncryptedConfig>();
  let service: PdfSignatureService;
  let settings: Record<string, unknown>;
  let collector: { collectForSignedPdf: jest.Mock };
  let findConfig: jest.Mock;
  const originalKey = process.env.SIGNING_KEY_ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.SIGNING_KEY_ENCRYPTION_KEY = testKey;
    records.clear();
    findConfig = jest.fn(({ where }: { where: { key: string } }) =>
      Promise.resolve(records.get(where.key) ?? null),
    );
    settings = {};
    collector = {
      collectForSignedPdf: jest.fn().mockResolvedValue({
        evidences: [],
        metadata: { ltvRequired: false, evidenceStatus: 'missing' },
      }),
    };
    service = new PdfSignatureService(
      {
        create: (value: EncryptedConfig) => value,
        findOne: findConfig,
        save: async (value: EncryptedConfig) => {
          records.set(value.key, value);
          return value;
        },
      } as never,
      new ConfigService(settings),
      {
        requestTimestampToken: jest
          .fn()
          .mockResolvedValue({ token: null, attempts: [], url: null }),
      } as never,
      collector as never,
      { embed: ({ pdfBuffer }: { pdfBuffer: Buffer }) => pdfBuffer } as never,
      {
        convertBeforeSigning: async (buffer: Buffer) => ({
          buffer,
          metadata: {},
        }),
      } as never,
    );
  });
  afterAll(() => {
    if (originalKey === undefined)
      delete process.env.SIGNING_KEY_ENCRYPTION_KEY;
    else process.env.SIGNING_KEY_ENCRYPTION_KEY = originalKey;
  });

  async function sign() {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    return service.signPdf({
      accountId: '1',
      buffer: Buffer.from(await pdf.save()),
      signerName: 'Organization',
      reason: 'Document completion',
    });
  }

  it.each([undefined, 'invalid-key'])(
    'reads only tenant-scoped identity metadata with encryption key %s',
    async (key) => {
      if (key === undefined) delete process.env.SIGNING_KEY_ENCRYPTION_KEY;
      else process.env.SIGNING_KEY_ENCRYPTION_KEY = key;
      await expect(service.getActiveCertificateName('1')).resolves.toBe(
        signaDefaultCertificateName,
      );
      expect(records.size).toBe(0);
      records.set(defaultSigningCertificateKey, {
        value: 'Corporate',
      } as EncryptedConfig);
      await expect(service.getActiveCertificateName('1')).resolves.toBe(
        'Corporate',
      );
      expect(records.size).toBe(1);
      expect(findConfig.mock.calls).toEqual([
        [{ where: { accountId: '1', key: defaultSigningCertificateKey } }],
        [{ where: { accountId: '1', key: defaultSigningCertificateKey } }],
      ]);
    },
  );

  it('still refuses signing without the encryption key', async () => {
    delete process.env.SIGNING_KEY_ENCRYPTION_KEY;
    await expect(sign()).rejects.toThrow('SIGNING_KEY_ENCRYPTION_KEY');
    expect(records.size).toBe(0);
  });

  it('encrypts the generated key and creates a PAdES signature', async () => {
    const result = await sign();
    expect(result.signed).toBe(true);
    expect(result.signatureSubFilter).toBe('ETSI.CAdES.detached');
    const stored = records.get(
      `${signingCertificatePrefix}${signaDefaultCertificateName}`,
    )!;
    expect(stored.value).toMatch(/^signing-key:v1:/);
    expect(
      JSON.parse(decryptSigningKey(stored.value, '1')) as unknown,
    ).toHaveProperty('data');
    expect(() => decryptSigningKey(stored.value, '2')).toThrow();
    const parts = stored.value.split(':');
    const ciphertext = Buffer.from(parts[4], 'base64url');
    ciphertext[0] ^= 1;
    parts[4] = ciphertext.toString('base64url');
    expect(() => decryptSigningKey(parts.join(':'), '1')).toThrow();
  });

  it('never falls back when the explicitly active certificate is missing or malformed', async () => {
    records.set(defaultSigningCertificateKey, {
      value: 'Corporate',
      accountId: '1',
      key: defaultSigningCertificateKey,
    } as EncryptedConfig);
    await expect(sign()).rejects.toThrow('missing');
    records.set(`${signingCertificatePrefix}Corporate`, {
      value: '{}',
      accountId: '1',
      key: `${signingCertificatePrefix}Corporate`,
    } as EncryptedConfig);
    await expect(sign()).rejects.toThrow('malformed');
    expect(
      records.has(`${signingCertificatePrefix}${signaDefaultCertificateName}`),
    ).toBe(false);
  });

  it('uses the selected identity and migrates legacy plaintext on use', async () => {
    const value = generateSignaDefaultCertificate();
    records.set(defaultSigningCertificateKey, {
      value: 'Corporate',
      accountId: '1',
      key: defaultSigningCertificateKey,
    } as EncryptedConfig);
    records.set(`${signingCertificatePrefix}Corporate`, {
      value: JSON.stringify(value),
      accountId: '1',
      key: `${signingCertificatePrefix}Corporate`,
    } as EncryptedConfig);
    const result = await sign();
    expect(result.certificateName).toBe('Corporate');
    expect(result.certificateFingerprint).toBe(value.fingerprint_sha256);
    expect(records.get(`${signingCertificatePrefix}Corporate`)?.value).toMatch(
      /^signing-key:v1:/,
    );
  });

  it('requires a TSA for long-term validation', async () => {
    settings.PDF_LTV_REQUIRED = true;
    await expect(sign()).rejects.toThrow('timestamp server');
  });

  it('rejects a private chain when approved signing trust is required', async () => {
    settings.PDF_REQUIRE_TRUSTED_SIGNER = true;
    await expect(sign()).rejects.toThrow('approved CA');
  });
});
