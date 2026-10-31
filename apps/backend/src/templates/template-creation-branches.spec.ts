import { zipSync, strToU8 } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { createTemplatesServiceFixture } from '../../test/support/templates-service.fixture';
import { UploadedBufferFile } from '../storage/storage.types';
const docx = Buffer.from(
  zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    'word/document.xml': strToU8(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Agreement</w:t></w:r></w:p></w:body></w:document>',
    ),
  }),
);
function upload(
  buffer: Buffer,
  originalname: string,
  mimetype?: string,
): UploadedBufferFile {
  return { buffer, originalname, mimetype, size: buffer.length };
}
it('uses the default title when an API-created template has a blank name', async () => {
  const { service, user } = await createTemplatesServiceFixture();
  expect(await service.createTemplate(user, { name: ' ' })).toMatchObject({
    name: 'Untitled Template',
  });
});
it.each([false, true])(
  'creates an internal PDF backing template with explicit sharing=%s',
  async (shared) => {
    const { service, user, pdfBuffer, storedBuffers } =
      await createTemplatesServiceFixture();
    const result = await service.createBackingTemplateFromPdf(user, {
      documents: [
        {
          name: 'Agreement.pdf',
          file: pdfBuffer.toString('base64'),
          fields: [{ name: 'Signature', type: 'signature', role: 'Signer' }],
        },
      ],
      ...(shared ? { shared_link: true } : {}),
    });
    expect(result.sharedLink).toBe(shared);
    expect(result.fields[0].areas).toEqual([]);
    expect((await PDFDocument.load(storedBuffers[0])).getPageCount()).toBe(1);
  },
);
it.each([false, true])(
  'creates HTML backing templates with explicit sharing=%s',
  async (shared) => {
    const { service, user, dynamicDocuments } =
      await createTemplatesServiceFixture();
    const result = await service.createBackingTemplateFromHtml(user, {
      html: '<h1>Agreement</h1>',
      ...(shared ? { shared_link: true } : {}),
    });
    expect(result.sharedLink).toBe(shared);
    expect(dynamicDocuments.save).toHaveBeenCalledTimes(1);
  },
);
it.each([false, true])(
  'creates DOCX backing templates with explicit sharing=%s',
  async (shared) => {
    const { service, user, conversion, docxVariables, storedBuffers } =
      await createTemplatesServiceFixture();
    const result = await service.createBackingTemplateFromDocx(user, {
      documents: [{ name: 'Agreement.docx', file: docx.toString('base64') }],
      ...(shared ? { shared_link: true } : {}),
    });
    expect(result.sharedLink).toBe(shared);
    expect(conversion.convertDocxToPdf).toHaveBeenCalledTimes(1);
    expect(docxVariables.expandVariables).toHaveBeenCalledWith(docx, undefined);
    expect((await PDFDocument.load(storedBuffers[0])).getPageCount()).toBe(1);
  },
);
it.each(['documents', 'files', 'file'])(
  'accepts multipart PDF input from the %s alias and forwards tag removal',
  async (key) => {
    const { service, user, pdfBuffer, textTags, storedBuffers } =
      await createTemplatesServiceFixture();
    await service.createTemplateFromPdf(
      user,
      { remove_tags: true },
      { [key]: [upload(pdfBuffer, 'Agreement.pdf', 'application/pdf')] },
    );
    expect(textTags.extractAndMaybeRemoveTags).toHaveBeenCalledWith(
      expect.objectContaining({ removeTags: true }),
    );
    expect(storedBuffers[0]).toEqual(pdfBuffer);
  },
);
it.each(['pdf', 'docx', 'html'])(
  'rejects %s creation without any source documents',
  async (kind) => {
    const { service, user, storedBuffers } =
      await createTemplatesServiceFixture();
    const result =
      kind === 'pdf'
        ? service.createTemplateFromPdf(user, {})
        : kind === 'docx'
          ? service.createTemplateFromDocx(user, {})
          : service.createTemplateFromHtml(user, {});
    await expect(result).rejects.toMatchObject({ status: 422 });
    expect(storedBuffers).toHaveLength(0);
  },
);
it('uses an external id to replace an existing API template instead of allocating a duplicate', async () => {
  const { service, user, template, pdfBuffer, templates } =
    await createTemplatesServiceFixture();
  template.externalId = 'crm-agreement';
  const result = await service.createTemplateFromPdf(user, {
    external_id: 'crm-agreement',
    documents: [
      { name: 'Replacement.pdf', file: pdfBuffer.toString('base64') },
    ],
  });
  expect(result.id).toBe(template.id);
  expect(templates.create).not.toHaveBeenCalled();
  expect(templates.findOne).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { accountId: 'tenant', externalId: 'crm-agreement' },
    }),
  );
});
it('assigns stable document names when HTML input omits per-document names', async () => {
  const { service, user, conversion } = await createTemplatesServiceFixture();
  await service.createTemplateFromHtml(user, {
    documents: [{ html: '<p>First</p>' }, { html: '<p>Second</p>' }],
  });
  expect(conversion.renderHtmlDocument).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ name: 'document-1' }),
  );
  expect(conversion.renderHtmlDocument).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ name: 'document-2' }),
  );
});
it('uses an overall HTML document name when individual names are omitted', async () => {
  const { service, user, conversion } = await createTemplatesServiceFixture();
  await service.createTemplateFromHtml(user, {
    name: 'Agreement',
    documents: [{ html: '<p>Body</p>' }],
  });
  expect(conversion.renderHtmlDocument).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'Agreement' }),
  );
});
it('updates documents from a multipart DOCX and stores converted PDF bytes', async () => {
  const { service, user, template, storedBuffers } =
    await createTemplatesServiceFixture();
  await service.updateTemplateDocuments(
    user,
    template.id,
    { merge: true },
    { file: [upload(docx, 'Agreement.docx')] },
  );
  expect((await PDFDocument.load(storedBuffers[0])).getPageCount()).toBe(1);
});
it.each([
  { file: Buffer.from('not zip'), name: 'Agreement.docx' },
  { file: docx, name: 'Agreement.zip' },
])(
  'rejects invalid DOCX containers or extensions (%s)',
  async ({ file, name }) => {
    const { service, user, storedBuffers } =
      await createTemplatesServiceFixture();
    await expect(
      service.createTemplateFromDocx(user, {
        documents: [{ file: file.toString('base64'), name }],
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(storedBuffers).toHaveLength(0);
  },
);
it('rejects a multipart document lacking PDF MIME, suffix and magic bytes', async () => {
  const { service, user } = await createTemplatesServiceFixture();
  await expect(
    service.createTemplateFromPdf(
      user,
      {},
      { file: [upload(Buffer.from('not PDF'), 'file.txt', 'text/plain')] },
    ),
  ).rejects.toMatchObject({ status: 422 });
});

it('preserves PDF text tags unless multipart removal is explicitly requested', async () => {
  const { service, user, pdfBuffer, textTags } =
    await createTemplatesServiceFixture();
  await service.createTemplateFromPdf(
    user,
    {},
    { file: [upload(pdfBuffer, 'Agreement.pdf', 'application/pdf')] },
  );
  expect(textTags.extractAndMaybeRemoveTags).toHaveBeenCalledWith(
    expect.objectContaining({ removeTags: false }),
  );
});
