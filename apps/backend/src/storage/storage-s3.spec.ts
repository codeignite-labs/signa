import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { Repository } from 'typeorm';
import { PdfjsProcessingService } from '../pdf-processing/pdfjs-processing.service';
import { PdfiumProcessingService } from '../pdf-processing/pdfium-processing.service';
import { StorageAttachment } from './entities/storage-attachment.entity';
import { StorageBlob } from './entities/storage-blob.entity';
import { StorageService } from './storage.service';
jest.mock('@aws-sdk/client-s3', () => ({
  ...jest.requireActual<typeof import('@aws-sdk/client-s3')>(
    '@aws-sdk/client-s3',
  ),
  S3Client: jest.fn(),
}));
function setup(options: Record<string, unknown> = {}) {
  const send = jest
    .fn<Promise<Record<string, unknown>>, [unknown]>()
    .mockResolvedValue({});
  jest
    .mocked(S3Client)
    .mockImplementation(() => ({ send }) as unknown as S3Client);
  const blobs = {
    create: jest.fn((input: Partial<StorageBlob>) =>
      Object.assign(new StorageBlob(), { id: 'blob' }, input),
    ),
    save: jest.fn((blob: StorageBlob) => Promise.resolve(blob)),
  };
  const attachments = {
    create: jest.fn((input: Partial<StorageAttachment>) =>
      Object.assign(new StorageAttachment(), { id: 'attachment' }, input),
    ),
    save: jest.fn((attachment: StorageAttachment) =>
      Promise.resolve(attachment),
    ),
  };
  const service = new StorageService(
    blobs as unknown as Repository<StorageBlob>,
    attachments as unknown as Repository<StorageAttachment>,
    new ConfigService({
      STORAGE_SERVICE: 's3',
      S3_ATTACHMENTS_BUCKET: 'test-bucket',
      AWS_REGION: 'eu-west-1',
      ...options,
    }),
    {} as PdfiumProcessingService,
    {} as PdfjsProcessingService,
  );
  const blob = Object.assign(new StorageBlob(), {
    id: 'blob',
    key: 'key.pdf',
    filename: 'Agreement.pdf',
    serviceName: 's3',
  });
  return { service, send, blob, blobs };
}
beforeEach(() => {
  jest.clearAllMocks();
});
it('checks bucket access and reuses a lazily configured SDK client', async () => {
  const { service, send } = setup({
    S3_ENDPOINT: 'https://objects.example.test',
    AWS_S3_PREFIX: '/blobs/',
    AWS_ACCESS_KEY_ID: 'test-access',
    AWS_SECRET_ACCESS_KEY: 'test-secret',
  });
  expect(await service.checkAvailability()).toEqual({
    service: 's3',
    bucket: 'test-bucket',
    region: 'eu-west-1',
    endpoint: 'https://objects.example.test',
  });
  expect(send).toHaveBeenCalledWith(expect.any(HeadBucketCommand));
  expect(send.mock.calls[0][0]).toMatchObject({
    input: { Bucket: 'test-bucket' },
  });
  expect(S3Client).toHaveBeenCalledWith({
    endpoint: 'https://objects.example.test',
    forcePathStyle: true,
    region: 'eu-west-1',
    credentials: { accessKeyId: 'test-access', secretAccessKey: 'test-secret' },
  });
  await service.checkAvailability();
  expect(S3Client).toHaveBeenCalledTimes(1);
});
it('persists object contents, encryption settings and prefix without touching local files', async () => {
  const { service, send } = setup({
    AWS_S3_PREFIX: '/tenant/blobs/',
    AWS_S3_SERVER_SIDE_ENCRYPTION: 'AES256',
  });
  const buffer = Buffer.from('document');
  const result = await service.createAttachment({
    buffer,
    filename: 'test.pdf',
    contentType: 'application/pdf',
    name: 'documents',
    recordType: 'Template',
    recordId: 'template',
  });
  expect(result.blob.serviceName).toBe('s3');
  expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
  expect(send.mock.calls[0][0]).toMatchObject({
    input: {
      Body: buffer,
      Bucket: 'test-bucket',
      ContentLength: buffer.length,
      ContentType: 'application/pdf',
      Key: `tenant/blobs/${result.blob.key}`,
      ServerSideEncryption: 'AES256',
    },
  });
});
it('preserves optional content type and unprefixed keys on S3 writes', async () => {
  const { service, send, blobs } = setup();
  blobs.create.mockImplementation((input) =>
    Object.assign(new StorageBlob(), input, { contentType: null }),
  );
  const result = await service.createAttachment({
    buffer: Buffer.from('x'),
    filename: 'test',
    contentType: '',
    name: 'documents',
    recordType: 'Template',
    recordId: 'template',
  });
  expect(send.mock.calls[0][0]).toMatchObject({
    input: { ContentType: undefined, Key: result.blob.key },
  });
});
it('reads SDK byte-array bodies and stream bodies into an equivalent buffer', async () => {
  const { service, send, blob } = setup({ AWS_S3_PREFIX: 'blobs' });
  send.mockResolvedValueOnce({
    Body: {
      transformToByteArray: () => Promise.resolve(new Uint8Array([97, 98])),
    },
  });
  expect(await service.readBlob(blob)).toEqual(Buffer.from('ab'));
  expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
  expect(send.mock.calls[0][0]).toMatchObject({
    input: { Bucket: 'test-bucket', Key: 'blobs/key.pdf' },
  });
  send.mockResolvedValueOnce({ Body: Readable.from(['a', Buffer.from('b')]) });
  expect(await service.readBlob(blob)).toEqual(Buffer.from('ab'));
});
it('passes SDK readable streams through and converts byte-array bodies for streaming downloads', async () => {
  const { service, send, blob } = setup();
  const source = Readable.from([Buffer.from('ab')]);
  send.mockResolvedValueOnce({ Body: source });
  expect(await service.readBlobStream(blob)).toBe(source);
  send.mockResolvedValueOnce({
    Body: {
      transformToByteArray: () => Promise.resolve(new Uint8Array([97, 98])),
    },
  });
  const converted = await service.readBlobStream(blob);
  const chunks: Buffer[] = [];
  for await (const chunk of converted)
    chunks.push(Buffer.from(chunk as Uint8Array));
  expect(Buffer.concat(chunks)).toEqual(Buffer.from('ab'));
});
it('reports missing and incompatible bodies as not found instead of returning empty documents', async () => {
  const { service, send, blob } = setup();
  send.mockResolvedValue({});
  await expect(service.readBlob(blob)).rejects.toMatchObject({ status: 404 });
  await expect(service.readBlobStream(blob)).rejects.toMatchObject({
    status: 404,
  });
  send.mockResolvedValue({ Body: { pipe: false } });
  await expect(service.readBlobStream(blob)).rejects.toMatchObject({
    status: 404,
  });
});
it('propagates bucket and object transport errors to callers', async () => {
  const { service, send, blob } = setup();
  send.mockRejectedValue(new Error('S3 unavailable'));
  await expect(service.checkAvailability()).rejects.toThrow('S3 unavailable');
  await expect(service.readBlob(blob)).rejects.toThrow('S3 unavailable');
  await expect(service.readBlobStream(blob)).rejects.toThrow('S3 unavailable');
});
it('checks a standard AWS bucket without requiring a custom endpoint', async () => {
  const { service, send } = setup();
  expect(await service.checkAvailability()).toEqual({
    service: 's3',
    bucket: 'test-bucket',
    region: 'eu-west-1',
  });
  expect(send).toHaveBeenCalledWith(expect.any(HeadBucketCommand));
});
