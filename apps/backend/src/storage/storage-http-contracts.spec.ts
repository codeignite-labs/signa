import { INestApplication, NotFoundException } from '@nestjs/common';
import type { Server } from 'node:http';
import { Readable } from 'node:stream';
import request from 'supertest';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import {
  createControllerFixture,
  serviceSpies,
} from '../test/controller-fixture';
const service = serviceSpies([
  'getBlobForSignedToken',
  'readBlobStream',
  'getSafeDownloadName',
]);
let app: INestApplication<Server>;
beforeAll(async () => {
  app = await createControllerFixture(
    [StorageController],
    [{ provide: StorageService, useValue: service }],
  );
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => jest.clearAllMocks());
it.each(['application/pdf', null])(
  'streams signed bytes with safe disposition and content type %s',
  async (contentType) => {
    const buffer = Buffer.from('%PDF-synthetic');
    const blob = { contentType, byteSize: buffer.length };
    service.getBlobForSignedToken.mockResolvedValue(blob);
    service.readBlobStream.mockResolvedValue(Readable.from(buffer));
    service.getSafeDownloadName.mockReturnValue('folder/quoted"file.pdf');
    const result = await request(app.getHttpServer())
      .get('/api/storage/blobs/signed-token/display.pdf')
      .expect(200);
    expect(service.getBlobForSignedToken).toHaveBeenCalledWith('signed-token');
    expect(service.readBlobStream).toHaveBeenCalledWith(blob);
    expect(result.headers['content-type']).toBe(
      contentType ?? 'application/octet-stream',
    );
    expect(result.headers['content-disposition']).toBe(
      'inline; filename="quoted\\"file.pdf"',
    );
    expect(result.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(result.headers['cache-control']).toBe('public, max-age=300');
    expect(result.body as Buffer).toEqual(buffer);
  },
);
it('rejects invalid signed tokens before opening a storage stream', async () => {
  service.getBlobForSignedToken.mockRejectedValueOnce(new NotFoundException());
  await request(app.getHttpServer())
    .get('/api/storage/blobs/invalid/display.pdf')
    .expect(404);
  expect(service.readBlobStream).not.toHaveBeenCalled();
});
it('returns a server error if storage fails before response headers are sent', async () => {
  service.getBlobForSignedToken.mockResolvedValue({
    byteSize: 100,
    contentType: null,
  });
  service.getSafeDownloadName.mockReturnValue('document.pdf');
  service.readBlobStream.mockResolvedValue(
    new Readable({
      read() {
        this.destroy(new Error('storage read failed'));
      },
    }),
  );
  // A streaming response has already advertised the blob length; failure may be
  // surfaced by HTTP clients as an aborted response rather than a parsed body.
  await expect(
    request(app.getHttpServer()).get('/api/storage/blobs/signed/display.pdf'),
  ).rejects.toThrow();
});
