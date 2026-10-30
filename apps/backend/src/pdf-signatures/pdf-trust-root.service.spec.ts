import { createHash } from 'node:crypto';
import forge from 'node-forge';
import { Repository } from 'typeorm';
import { UploadedBufferFile } from '../storage/storage.types';
import { PdfTrustRoot } from './entities/pdf-trust-root.entity';
import { PdfTrustRootService } from './pdf-trust-root.service';
let keys: forge.pki.rsa.KeyPair;
beforeAll(() => {
  keys = forge.pki.rsa.generateKeyPair(1024);
});
function certificate(
  extensions: Array<Record<string, unknown>> = [
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true },
  ],
) {
  const root = forge.pki.createCertificate();
  root.publicKey = keys.publicKey;
  root.serialNumber = '01';
  root.validity.notBefore = new Date('2026-01-01');
  root.validity.notAfter = new Date('2030-01-01');
  root.setSubject([
    { name: 'commonName', value: 'Synthetic test CA' },
    { name: 'organizationName', value: 'Signa Tests' },
  ]);
  root.setIssuer(root.subject.attributes);
  root.setExtensions(extensions);
  root.sign(keys.privateKey, forge.md.sha256.create());
  const der = Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(root)).getBytes(),
    'binary',
  );
  const pem = Buffer.from(forge.pki.certificateToPem(root));
  return { der, pem };
}
function setup() {
  const roots = {
    find: jest.fn<Promise<PdfTrustRoot[]>, [unknown]>().mockResolvedValue([]),
    findOne: jest
      .fn<Promise<PdfTrustRoot | null>, [unknown]>()
      .mockResolvedValue(null),
    create: jest.fn((input: Partial<PdfTrustRoot>) =>
      Object.assign(
        new PdfTrustRoot(),
        { id: 'root', createdAt: new Date('2026-01-01') },
        input,
      ),
    ),
    save: jest.fn((root: PdfTrustRoot) => Promise.resolve(root)),
    remove: jest.fn((root: PdfTrustRoot) => Promise.resolve(root)),
  };
  return {
    roots,
    service: new PdfTrustRootService(
      roots as unknown as Repository<PdfTrustRoot>,
    ),
  };
}
function file(
  buffer: Buffer,
  originalname = 'Synthetic CA.pem',
): UploadedBufferFile {
  return { buffer, originalname, size: buffer.length };
}
it.each(['pem', 'der'] as const)(
  'imports %s CA certificates with deterministic fingerprints and tenant-scoped records',
  async (format) => {
    const { service, roots } = setup();
    const bytes = certificate();
    const result = await service.upload({
      accountId: 'tenant',
      file: file(bytes[format]),
    });
    expect(result).toMatchObject({
      id: 'root',
      name: 'Synthetic CA',
      enabled: true,
      fingerprint_sha256: createHash('sha256').update(bytes.der).digest('hex'),
      serial_number: '01',
      subject: 'CN=Synthetic test CA, O=Signa Tests',
      issuer: 'CN=Synthetic test CA, O=Signa Tests',
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_to: '2030-01-01T00:00:00.000Z',
    });
    expect(roots.findOne).toHaveBeenCalledWith({
      where: {
        accountId: 'tenant',
        fingerprintSha256: result.fingerprint_sha256,
      },
    });
    expect(roots.save.mock.calls[0][0].certificateDerBase64).toBe(
      bytes.der.toString('base64'),
    );
  },
);
it('updates an existing fingerprint instead of duplicating it and returns only public certificate metadata', async () => {
  const { service, roots } = setup();
  const bytes = certificate();
  await service.upload({ accountId: 'tenant', file: file(bytes.pem) });
  const existing = roots.save.mock.calls[0][0];
  roots.findOne.mockResolvedValue(existing);
  roots.create.mockClear();
  expect(
    await service.upload({
      accountId: 'tenant',
      name: ' Renamed organization ',
      file: file(bytes.der),
    }),
  ).toMatchObject({ name: 'Renamed organization', enabled: true });
  expect(roots.create).not.toHaveBeenCalled();
  roots.find.mockResolvedValue([existing]);
  const result = await service.list('tenant');
  expect(result).toHaveLength(1);
  expect(result[0]).not.toHaveProperty('certificateDerBase64');
  expect(roots.find).toHaveBeenCalledWith({
    where: { accountId: 'tenant' },
    order: { createdAt: 'ASC' },
  });
});
it.each([
  [{ name: 'basicConstraints', cA: false }],
  [
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', digitalSignature: true, keyCertSign: false },
  ],
  [{ name: 'keyUsage', keyCertSign: true }],
])(
  'rejects certificates without CA signing authority (%s)',
  async (...extensions) => {
    const { service, roots } = setup();
    const bytes = certificate(extensions);
    await expect(
      service.upload({ accountId: 'tenant', file: file(bytes.pem) }),
    ).rejects.toMatchObject({ status: 422 });
    expect(roots.save).not.toHaveBeenCalled();
  },
);
it('allows a CA with no optional key-usage extension and caps normalized names', async () => {
  const { service } = setup();
  const bytes = certificate([{ name: 'basicConstraints', cA: true }]);
  expect(
    (
      await service.upload({
        accountId: 'tenant',
        name: 'x'.repeat(300),
        file: file(bytes.pem),
      })
    ).name,
  ).toHaveLength(255);
});
it('rejects missing files, malformed certificate bytes and blank derived/explicit names', async () => {
  const { service } = setup();
  await expect(
    service.upload({
      accountId: 'tenant',
      file: undefined as unknown as UploadedBufferFile,
    }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.upload({ accountId: 'tenant', file: file(Buffer.alloc(0)) }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.upload({
      accountId: 'tenant',
      file: file(Buffer.from('not a certificate')),
    }),
  ).rejects.toMatchObject({ status: 422 });
  const bytes = certificate();
  await expect(
    service.upload({ accountId: 'tenant', file: file(bytes.pem, '.pem') }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.upload({ accountId: 'tenant', name: ' ', file: file(bytes.pem) }),
  ).rejects.toMatchObject({ status: 422 });
});
it('returns enabled trusted PKI certificates and rejects corrupt persisted DER', async () => {
  const { service, roots } = setup();
  const bytes = certificate();
  roots.find.mockResolvedValue([
    Object.assign(new PdfTrustRoot(), {
      certificateDerBase64: bytes.der.toString('base64'),
    }),
  ]);
  const trusted = await service.getTrustedCertificates('tenant');
  expect(trusted).toHaveLength(1);
  expect(
    Buffer.from(trusted[0].serialNumber.valueBlock.valueHexView).toString(
      'hex',
    ),
  ).toBe('01');
  expect(roots.find).toHaveBeenCalledWith({
    where: { accountId: 'tenant', enabled: true },
  });
  roots.find.mockResolvedValue([
    Object.assign(new PdfTrustRoot(), {
      certificateDerBase64: Buffer.from('corrupt').toString('base64'),
    }),
  ]);
  await expect(service.getTrustedCertificates('tenant')).rejects.toMatchObject({
    status: 422,
  });
});
it('removes only the current account root and returns not found for a missing foreign root', async () => {
  const { service, roots } = setup();
  const bytes = certificate();
  await service.upload({ accountId: 'tenant', file: file(bytes.pem) });
  const root = roots.save.mock.calls[0][0];
  roots.findOne.mockResolvedValue(root);
  expect(
    await service.remove({ accountId: 'tenant', id: 'root' }),
  ).toMatchObject({ id: 'root' });
  expect(roots.findOne).toHaveBeenLastCalledWith({
    where: { accountId: 'tenant', id: 'root' },
  });
  expect(roots.remove).toHaveBeenCalledWith(root);
  roots.findOne.mockResolvedValue(null);
  await expect(
    service.remove({ accountId: 'other', id: 'root' }),
  ).rejects.toMatchObject({ status: 404 });
});
