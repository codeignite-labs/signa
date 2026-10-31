import { downloadPublicDocument } from '../common/http/public-download';
import { createTemplatesServiceFixture } from '../../test/support/templates-service.fixture';
jest.mock('../common/http/public-download', () => ({
  downloadPublicDocument: jest.fn(),
}));
const download = jest.mocked(downloadPublicDocument);
beforeEach(() => jest.resetAllMocks());
it('imports an external PDF using the bounded public transport', async () => {
  const { service, user, pdfBuffer, storedBuffers, storage } =
    await createTemplatesServiceFixture();
  download.mockResolvedValue(new Response(pdfBuffer));
  await service.createTemplateFromPdf(user, {
    documents: [
      { name: 'Agreement.pdf', file: 'https://files.example/Agreement.pdf' },
    ],
  });
  expect(storage.readSignedBlobUrl).toHaveBeenCalledWith(
    'https://files.example/Agreement.pdf',
    50 * 1024 * 1024,
  );
  expect(download).toHaveBeenCalledWith(
    'https://files.example/Agreement.pdf',
    50 * 1024 * 1024,
  );
  expect(storedBuffers[0]).toEqual(pdfBuffer);
});
it('reuses signed own-instance PDF URLs through storage without network access', async () => {
  const { service, user, pdfBuffer, storedBuffers, storage } =
    await createTemplatesServiceFixture();
  storage.readSignedBlobUrl.mockResolvedValue({
    buffer: pdfBuffer,
    filename: 'Original.pdf',
    contentType: 'application/pdf',
  });
  await service.createTemplateFromPdf(user, {
    documents: [
      {
        name: 'Agreement.pdf',
        file: 'http://localhost:3001/api/storage/blobs/signed/file.pdf',
      },
    ],
  });
  expect(download).not.toHaveBeenCalled();
  expect(storedBuffers[0]).toEqual(pdfBuffer);
});
it('propagates rejected external imports before saving any PDF bytes', async () => {
  const { service, user, storedBuffers } =
    await createTemplatesServiceFixture();
  download.mockRejectedValue(
    new Error('public transport rejected private destination'),
  );
  await expect(
    service.createTemplateFromPdf(user, {
      documents: [
        { name: 'Agreement.pdf', file: 'https://hostile.example/file' },
      ],
    }),
  ).rejects.toThrow('private destination');
  expect(storedBuffers).toHaveLength(0);
});
