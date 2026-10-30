import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { createTemplatesServiceFixture } from '../../test/support/templates-service.fixture';
let fetchSpy: jest.SpiedFunction<typeof fetch>;
beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch');
});
afterEach(() => jest.restoreAllMocks());
it('imports an encoded Drive file id with bearer authentication, PDF bytes and metadata fallback names', async () => {
  const { service, user, pdfBuffer, storage, templateEvents } =
    await createTemplatesServiceFixture();
  fetchSpy
    .mockResolvedValueOnce(
      Response.json({ name: 'Agreement', mimeType: 'application/pdf' }),
    )
    .mockResolvedValueOnce(new Response(new Uint8Array(pdfBuffer)));
  const result = await service.importGoogleDriveDocuments(user, 'template', {
    access_token: 'drive-token',
    files: [{ id: 'id/with ?' }],
  });
  expect(result.documents).toMatchObject([{ filename: 'Agreement.pdf' }]);
  expect(fetchSpy).toHaveBeenCalledWith(
    'https://www.googleapis.com/drive/v3/files/id%2Fwith%20%3F?fields=id,name,mimeType',
    { headers: { Authorization: 'Bearer drive-token' } },
  );
  expect(fetchSpy).toHaveBeenCalledWith(
    'https://www.googleapis.com/drive/v3/files/id%2Fwith%20%3F?alt=media',
    { headers: { Authorization: 'Bearer drive-token' } },
  );
  expect(storage.createPdfAttachment).toHaveBeenCalledWith(
    expect.objectContaining({
      filename: 'Agreement.pdf',
      buffer: pdfBuffer,
      recordId: 'template',
    }),
  );
  expect(templateEvents.create).toHaveBeenCalledWith(
    expect.objectContaining({
      summary: 'Template documents imported from Google Drive',
    }),
  );
});
it('exports Google Workspace documents as PDF and respects explicitly selected names and MIME types', async () => {
  const { service, user, pdfBuffer } = await createTemplatesServiceFixture();
  fetchSpy
    .mockResolvedValueOnce(
      Response.json({ name: 'Metadata name', mimeType: 'application/pdf' }),
    )
    .mockResolvedValueOnce(
      new Response(new Uint8Array(pdfBuffer), {
        headers: {
          'Content-Disposition': 'attachment; filename="ignored.pdf"',
        },
      }),
    );
  const result = await service.importGoogleDriveDocuments(user, 'template', {
    access_token: 'drive-token',
    files: [
      {
        id: 'workspace',
        name: 'Selected title',
        mime_type: 'application/vnd.google-apps.document',
      },
    ],
    merge: false,
  });
  expect(result.documents).toMatchObject([{ filename: 'Selected title.pdf' }]);
  expect(fetchSpy.mock.calls[1][0]).toBe(
    'https://www.googleapis.com/drive/v3/files/workspace/export?mimeType=application/pdf',
  );
});
it.each([
  ['attachment; filename="download.pdf"', 'download.pdf'],
  ['attachment; filename=plain.pdf', 'plain.pdf'],
  ['attachment; filename=literal%20name.pdf', 'literal%20name.pdf'],
  [
    "attachment; filename=legacy.pdf; filename*=UTF-8'en'preferred%20name.pdf",
    'preferred name.pdf',
  ],
  [
    "attachment; filename=legacy.pdf; filename*=UTF-8''bad%name.pdf",
    'legacy.pdf',
  ],
  ["attachment; filename*=UTF-8''bad%name.pdf", 'Google Drive document.pdf'],
  ["attachment; filename*=UTF-8''encoded%20name.pdf", 'encoded name.pdf'],
  ['attachment; filename="100% Agreement.pdf"', '100% Agreement.pdf'],
  ['attachment', 'Google Drive document.pdf'],
])(
  'preserves Drive download filenames from Content-Disposition %s',
  async (disposition, filename) => {
    const { service, user, pdfBuffer } = await createTemplatesServiceFixture();
    fetchSpy.mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(
      new Response(new Uint8Array(pdfBuffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': disposition,
        },
      }),
    );
    expect(
      (
        await service.importGoogleDriveDocuments(user, 'template', {
          access_token: 'token',
          files: [{ id: 'file' }],
        })
      ).documents[0].filename,
    ).toBe(filename);
  },
);
it('converts Drive image bytes into an actual PDF using the image dimensions', async () => {
  const { service, user, storedBuffers } =
    await createTemplatesServiceFixture();
  const image = await sharp({
    create: { width: 20, height: 10, channels: 3, background: 'red' },
  })
    .jpeg()
    .toBuffer();
  fetchSpy
    .mockResolvedValueOnce(
      Response.json({ name: 'Photo.jpg', mimeType: 'image/jpeg' }),
    )
    .mockResolvedValueOnce(
      new Response(new Uint8Array(image), {
        headers: { 'Content-Type': 'image/jpeg' },
      }),
    );
  const result = await service.importGoogleDriveDocuments(user, 'template', {
    access_token: 'token',
    files: [{ id: 'image' }],
  });
  expect(result.documents[0].filename).toBe('Photo.pdf');
  const pdf = await PDFDocument.load(storedBuffers[0]);
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPage(0).getSize()).toEqual({ width: 20, height: 10 });
});
it.each(['metadata', 'download', 'export'])(
  'returns a validation error when Drive %s fails and stores no attachment',
  async (phase) => {
    const { service, user, storage } = await createTemplatesServiceFixture();
    if (phase === 'metadata')
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 403 }));
    else
      fetchSpy
        .mockResolvedValueOnce(
          Response.json({
            name: 'Document',
            mimeType:
              phase === 'export'
                ? 'application/vnd.google-apps.document'
                : 'application/pdf',
          }),
        )
        .mockResolvedValueOnce(new Response('', { status: 403 }));
    await expect(
      service.importGoogleDriveDocuments(user, 'template', {
        access_token: 'token',
        files: [{ id: 'file' }],
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(storage.createPdfAttachment).not.toHaveBeenCalled();
  },
);
it('propagates an import persistence error and rejects an empty selection explicitly', async () => {
  const { service, user, pdfBuffer, templates } =
    await createTemplatesServiceFixture();
  await expect(
    service.importGoogleDriveDocuments(user, 'template', {
      access_token: 'token',
      files: [],
    }),
  ).rejects.toMatchObject({ status: 422 });
  fetchSpy
    .mockResolvedValueOnce(
      Response.json({ name: 'Agreement.pdf', mimeType: 'application/pdf' }),
    )
    .mockResolvedValueOnce(new Response(new Uint8Array(pdfBuffer)));
  templates.save.mockRejectedValue(new Error('write failed'));
  await expect(
    service.importGoogleDriveDocuments(user, 'template', {
      access_token: 'token',
      files: [{ id: 'file' }],
    }),
  ).rejects.toThrow('write failed');
});
