import { downloadPublicDocument } from '../common/http/public-download';
import { buildAttachmentFromRawValue } from './submitter-attachment-ingestion';
jest.mock('../common/http/public-download', () => ({
  downloadPublicDocument: jest.fn(),
}));
const download = jest.mocked(downloadPublicDocument);
beforeEach(() => jest.resetAllMocks());
it('downloads external attachments only through the bounded pinned transport and retains MIME metadata', async () => {
  const buffer = Buffer.from('%PDF attachment fixture');
  download.mockResolvedValue(
    new Response(buffer, { headers: { 'content-type': 'application/pdf' } }),
  );
  const attachment = await buildAttachmentFromRawValue({
    value: 'https://files.example/Agreement%20Final.pdf',
    type: 'file',
    maxDownloadBytes: 100,
  });
  expect(download).toHaveBeenCalledWith(
    'https://files.example/Agreement%20Final.pdf',
    100,
  );
  expect(attachment).toMatchObject({
    buffer,
    filename: 'Agreement Final.pdf',
    contentType: 'application/pdf',
  });
});
it('rejects executable remote filenames and oversized content even when transport is replaced', async () => {
  download.mockImplementation(() => Promise.resolve(new Response('unsafe')));
  await expect(
    buildAttachmentFromRawValue({
      value: 'https://files.example/install.exe',
      type: 'file',
      maxDownloadBytes: 100,
    }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    buildAttachmentFromRawValue({
      value: 'https://files.example/file.pdf',
      type: 'file',
      maxDownloadBytes: 2,
    }),
  ).rejects.toMatchObject({ status: 422 });
});
