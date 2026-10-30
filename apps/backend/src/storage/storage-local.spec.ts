import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Repository } from 'typeorm';
import { PdfjsProcessingService } from '../pdf-processing/pdfjs-processing.service';
import { PdfiumProcessingService } from '../pdf-processing/pdfium-processing.service';
import { StorageAttachment } from './entities/storage-attachment.entity';
import { StorageBlob } from './entities/storage-blob.entity';
import { StorageService } from './storage.service';
function setup(options: Record<string, unknown>) {
  const blobs = {
    create: jest.fn((input: Partial<StorageBlob>) =>
      Object.assign(new StorageBlob(), { id: 'blob' }, input),
    ),
    save: jest.fn((blob: StorageBlob) => Promise.resolve(blob)),
    findOne: jest.fn<Promise<StorageBlob | null>, [unknown]>(),
  };
  const attachments = {
    create: jest.fn((input: Partial<StorageAttachment>) =>
      Object.assign(new StorageAttachment(), { id: '1' }, input),
    ),
    save: jest.fn((attachment: StorageAttachment) =>
      Promise.resolve(attachment),
    ),
    findOne: jest.fn<Promise<StorageAttachment | null>, [unknown]>(),
    find: jest
      .fn<Promise<StorageAttachment[]>, [unknown]>()
      .mockResolvedValue([]),
    remove: jest.fn().mockResolvedValue([]),
  };
  const service = new StorageService(
    blobs as unknown as Repository<StorageBlob>,
    attachments as unknown as Repository<StorageAttachment>,
    new ConfigService(options),
    {} as PdfiumProcessingService,
    {} as PdfjsProcessingService,
  );
  return { service, blobs, attachments };
}
let storageRoot: string;
beforeEach(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'signa-storage-test-'));
});
afterEach(async () => {
  jest.restoreAllMocks();
  await rm(storageRoot, { force: true, recursive: true });
});
it('persists original attachment bytes, checksum, hash metadata and optional UUID on local storage', async () => {
  const { service, blobs, attachments } = setup({
    STORAGE_PATH: storageRoot,
    STORAGE_SERVICE: 'local',
  });
  const buffer = Buffer.from('test document content');
  const sha256 = createHash('sha256').update(buffer).digest('base64url');
  const attachment = await service.createAttachment({
    buffer,
    filename: 'Agreement.pdf',
    contentType: 'application/pdf',
    name: 'documents',
    recordType: 'Template',
    recordId: 'template',
    uuid: 'source-uuid',
    metadata: { sha256 },
  });
  expect(attachment).toMatchObject({
    uuid: 'source-uuid',
    recordType: 'Template',
    recordId: 'template',
    blobId: 'blob',
  });
  expect(blobs.create).toHaveBeenCalledWith(
    expect.objectContaining({
      filename: 'Agreement.pdf',
      sha256,
      byteSize: String(buffer.length),
      checksum: createHash('md5').update(buffer).digest('base64'),
    }),
  );
  expect(attachment.blob.key).toMatch(/^[a-f0-9]{32}\.pdf$/);
  expect(await readFile(service.getBlobPath(attachment.blob))).toEqual(buffer);
  expect(await service.readBlob(attachment.blob)).toEqual(buffer);
  const stream = await service.readBlobStream(attachment.blob);
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.from(chunk as Uint8Array));
  expect(Buffer.concat(chunks)).toEqual(buffer);
  expect(await service.checkAvailability()).toEqual({
    service: 'local',
    path: storageRoot,
  });
  expect(attachments.save).toHaveBeenCalledTimes(1);
});
it.each([undefined, { sha256: 'bad' }, { sha256: 42 }])(
  'omits invalid SHA-256 metadata while retaining application metadata',
  async (metadata) => {
    const { service } = setup({
      STORAGE_PATH: storageRoot,
      STORAGE_SERVICE: 'local',
    });
    const attachment = await service.createAttachment({
      buffer: Buffer.from('x'),
      filename: 'plain',
      contentType: 'text/plain',
      name: 'file',
      recordType: 'User',
      recordId: 'user',
      metadata,
    });
    expect(attachment.blob.metadata).toEqual(metadata ?? {});
    expect(attachment.blob.sha256).toBeNull();
    expect(attachment.blob.key).toMatch(/^[a-f0-9]{32}$/);
  },
);
it('clones attachment references without duplicating blob bytes and reports missing clones', async () => {
  const { service, attachments, blobs } = setup({ STORAGE_PATH: storageRoot });
  const sourceAttachment = Object.assign(new StorageAttachment(), {
    blobId: 'blob',
    blob: new StorageBlob(),
  });
  const existing = Object.assign(new StorageAttachment(), {
    id: 'clone',
    blob: sourceAttachment.blob,
  });
  attachments.findOne.mockResolvedValue(existing);
  expect(
    await service.cloneAttachment({
      sourceAttachment,
      name: 'documents',
      recordType: 'Submission',
      recordId: 'submission',
      uuid: 'clone-uuid',
    }),
  ).toBe(existing);
  expect(attachments.create).toHaveBeenCalledWith({
    blobId: 'blob',
    blob: sourceAttachment.blob,
    name: 'documents',
    recordType: 'Submission',
    recordId: 'submission',
    uuid: 'clone-uuid',
  });
  expect(blobs.save).not.toHaveBeenCalled();
  attachments.findOne.mockResolvedValue(null);
  await expect(
    service.cloneAttachment({
      sourceAttachment,
      name: 'documents',
      recordType: 'Submission',
      recordId: 'submission',
    }),
  ).rejects.toMatchObject({ status: 404 });
});
it('queries record/preview attachments deterministically and groups mixed bigint representations', async () => {
  const { service, attachments } = setup({});
  const preview = Object.assign(new StorageAttachment(), {
    id: '1',
    recordId: '101',
  });
  const second = Object.assign(new StorageAttachment(), {
    id: '2',
    recordId: 101,
  });
  const third = Object.assign(new StorageAttachment(), {
    id: '3',
    recordId: '202',
  });
  expect(await service.findPreviewAttachment('101')).toBeNull();
  attachments.find.mockResolvedValue([preview]);
  expect(await service.findPreviewAttachment('101')).toBe(preview);
  expect(attachments.find).toHaveBeenLastCalledWith({
    where: {
      recordType: 'ActiveStorage::Attachment',
      recordId: '101',
      name: 'preview_images',
    },
    relations: { blob: true },
    order: { id: 'ASC' },
  });
  const options = {
    recordType: 'Template',
    recordId: 'template',
    name: 'documents',
  };
  await service.findRecordAttachments(options);
  expect(attachments.find).toHaveBeenLastCalledWith({
    where: options,
    relations: { blob: true },
    order: { id: 'ASC' },
  });
  attachments.find.mockClear();
  expect(await service.findPreviewAttachmentsByRecordIds([])).toEqual(
    new Map(),
  );
  expect(attachments.find).not.toHaveBeenCalled();
  attachments.find.mockResolvedValue([preview, second, third]);
  expect(
    await service.findPreviewAttachmentsByRecordIds(['101', '202']),
  ).toEqual(
    new Map([
      ['101', [preview, second]],
      ['202', [third]],
    ]),
  );
});
it('deletes only versions before the supplied bigint cutoff, or all without a cutoff', async () => {
  const { service, attachments } = setup({});
  const items = [
    '9007199254740992',
    '9007199254740993',
    '9007199254740994',
  ].map((id) => Object.assign(new StorageAttachment(), { id }));
  attachments.find.mockResolvedValue(items);
  const options = {
    recordType: 'Template',
    recordId: 'template',
    name: 'documents',
  };
  await service.deleteRecordAttachments({
    ...options,
    beforeId: '9007199254740993',
  });
  expect(attachments.remove).toHaveBeenLastCalledWith([items[0]]);
  await service.deleteRecordAttachments(options);
  expect(attachments.remove).toHaveBeenLastCalledWith(items);
});
function extractToken(url: string): string {
  return url.split('/storage/blobs/')[1].split('/')[0];
}
it('signs expiring and permanent URLs, encodes filenames and verifies ownership lookup by signed blob id', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  const { service, blobs } = setup({
    JWT_SECRET: 'test-secret',
    API_PUBLIC_URL: 'https://api.example.test/api',
  });
  const blob = Object.assign(new StorageBlob(), {
    id: 'blob',
    filename: 'Agreement & signed.pdf',
  });
  blobs.findOne.mockResolvedValue(blob);
  const url = service.createBlobProxyUrl(blob);
  expect(url).toMatch(
    /^https:\/\/api.example.test\/api\/storage\/blobs\/.+\/Agreement%20%26%20signed.pdf$/,
  );
  const token = extractToken(url);
  expect(await service.getBlobForSignedToken(token)).toBe(blob);
  expect(blobs.findOne).toHaveBeenCalledWith({ where: { id: 'blob' } });
  jest.spyOn(Date, 'now').mockReturnValue(1_301_000);
  await expect(service.getBlobForSignedToken(token)).rejects.toMatchObject({
    status: 403,
  });
  const permanent = extractToken(service.createBlobProxyUrl(blob, null));
  expect(await service.getBlobForSignedToken(permanent)).toBe(blob);
  blobs.findOne.mockResolvedValue(null);
  await expect(service.getBlobForSignedToken(permanent)).rejects.toMatchObject({
    status: 404,
  });
});
it.each(['', 'unsigned', 'payload.signature', '.signature'])(
  'rejects invalid URL token %s before a blob lookup',
  async (token) => {
    const { service, blobs } = setup({});
    await expect(service.getBlobForSignedToken(token)).rejects.toMatchObject({
      status: 403,
    });
    expect(blobs.findOne).not.toHaveBeenCalled();
  },
);
it('rejects an authenticated token without a blob id and uses configured public-port fallback', async () => {
  const { service } = setup({ JWT_SECRET: 'test-secret', PORT: 3101 });
  const payload = Buffer.from('{}').toString('base64url');
  const signature = createHmac('sha256', 'test-secret')
    .update(payload)
    .digest('base64url');
  await expect(
    service.getBlobForSignedToken(`${payload}.${signature}`),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    service.createBlobProxyUrl(
      Object.assign(new StorageBlob(), { id: '1', filename: 'file' }),
    ),
  ).toMatch(/^http:\/\/localhost:3101\/api\//);
});
it('normalizes storage root paths and returns a basename for download headers', () => {
  const { service } = setup({ STORAGE_PATH: 'apps/backend/test-storage' });
  const blob = Object.assign(new StorageBlob(), {
    key: 'key',
    filename: '../../secret/document.pdf',
    serviceName: 'local',
  });
  expect(service.getBlobPath(blob)).toBe(
    resolve(process.cwd(), '..', '..', 'apps/backend/test-storage/blobs/key'),
  );
  expect(service.getSafeDownloadName(blob)).toBe('document.pdf');
  const cwd = process.cwd();
  jest.spyOn(process, 'cwd').mockReturnValue(resolve(cwd, '..', '..'));
  expect(service.getBlobPath(blob)).toBe(
    resolve('apps/backend/test-storage/blobs/key'),
  );
  blob.serviceName = 's3';
  expect(() => service.getBlobPath(blob)).toThrow('S3 blobs');
});
it.each([
  'http://localhost:3101/api',
  'https://files.example.test/prefix/api/',
])(
  'reads its own signed blob URL locally for %s without using HTTP',
  async (apiBase) => {
    const { service, blobs } = setup({
      STORAGE_PATH: storageRoot,
      API_PUBLIC_URL: apiBase,
      JWT_SECRET: 'local-test-key',
    });
    const attachment = await service.createAttachment({
      buffer: Buffer.from('local content'),
      filename: 'My agreement.pdf',
      contentType: 'application/pdf',
      name: 'documents',
      recordType: 'Template',
      recordId: 'template',
    });
    blobs.findOne.mockResolvedValue(attachment.blob);
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('Networking must not be used'));
    const url = service.createBlobProxyUrl(attachment.blob);
    expect(await service.readSignedBlobUrl(url, 100)).toEqual({
      buffer: Buffer.from('local content'),
      filename: 'My agreement.pdf',
      contentType: 'application/pdf',
    });
    expect(fetch).not.toHaveBeenCalled();
    attachment.blob.contentType = null;
    expect((await service.readSignedBlobUrl(url, 100))?.contentType).toBe(
      'application/octet-stream',
    );
    await expect(service.readSignedBlobUrl(url, 2)).rejects.toMatchObject({
      status: 422,
    });
    const originalSize = attachment.blob.byteSize;
    attachment.blob.byteSize = '0';
    await expect(service.readSignedBlobUrl(url, 2)).rejects.toMatchObject({
      status: 422,
    });
    attachment.blob.byteSize = originalSize;
    await expect(
      service.readSignedBlobUrl(
        url.replace('/storage/blobs/', '/storage/blobs/forged.'),
        100,
      ),
    ).rejects.toMatchObject({ status: 403 });
  },
);
it.each([
  'https://foreign.example/api/storage/blobs/token/file',
  'http://localhost:3001/api/storage/blobs/token',
  'http://localhost:3001/other/storage/blobs/token/file',
  'http://user:secret@localhost:3001/api/storage/blobs/token/file',
])(
  'does not treat arbitrary URL %s as an authenticated local blob',
  async (url) => {
    const { service, blobs } = setup({});
    expect(await service.readSignedBlobUrl(url, 100)).toBeNull();
    expect(blobs.findOne).not.toHaveBeenCalled();
  },
);
