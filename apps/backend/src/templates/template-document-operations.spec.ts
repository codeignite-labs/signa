import { PDFDocument } from 'pdf-lib';
import { createTemplatesServiceFixture } from '../../test/support/templates-service.fixture';
import { TemplateField } from './types/template-json';
const firstArea = {
  attachment_uuid: 'first-document',
  page: 0,
  x: 0.1,
  y: 0.1,
  w: 0.3,
  h: 0.05,
};
const secondArea = {
  ...firstArea,
  attachment_uuid: 'second-document',
  page: 1,
};
function fields(): TemplateField[] {
  return [
    {
      uuid: 'shared',
      name: 'Shared',
      submitter_uuid: 'party',
      required: true,
      areas: [firstArea, secondArea],
    },
    { uuid: 'only-first', submitter_uuid: 'party', areas: [firstArea] },
    { uuid: 'only-second', submitter_uuid: 'party', areas: [secondArea] },
    { uuid: 'no-area', submitter_uuid: 'party' },
  ];
}
it('removes only areas on a removed document and keeps unaffected field order/metadata', async () => {
  const { service, user, template } = await createTemplatesServiceFixture();
  template.schema = [
    { name: 'First', attachment_uuid: 'first-document' },
    { name: 'Second', attachment_uuid: 'second-document' },
  ];
  template.fields = fields();
  const result = await service.updateTemplateDocuments(user, 'template', {
    documents: [{ remove: true, name: 'First.pdf' }],
  });
  expect(template.schema).toEqual([
    { name: 'Second', attachment_uuid: 'second-document' },
  ]);
  expect(template.fields).toEqual([
    {
      uuid: 'shared',
      name: 'Shared',
      submitter_uuid: 'party',
      required: true,
      areas: [secondArea],
    },
    { uuid: 'only-second', submitter_uuid: 'party', areas: [secondArea] },
    { uuid: 'no-area', submitter_uuid: 'party' },
  ]);
  expect(result.fields).toEqual(template.fields);
});
it('rewrites only areas on the replaced document and preserves all unrelated areas and field ordering', async () => {
  const { service, user, template } = await createTemplatesServiceFixture();
  template.schema = [
    { name: 'First', attachment_uuid: 'first-document' },
    { name: 'Second', attachment_uuid: 'second-document' },
  ];
  template.fields = fields();
  await service.updateTemplateDocuments(user, 'template', {
    documents: [
      { type: 'blank', replace: true, position: 0, name: 'Replacement' },
    ],
  });
  const replacementUuid = template.schema[0].attachment_uuid;
  expect(template.fields.map((field) => field.uuid)).toEqual([
    'shared',
    'only-first',
    'only-second',
    'no-area',
  ]);
  expect(template.fields[0]).toEqual({
    uuid: 'shared',
    name: 'Shared',
    submitter_uuid: 'party',
    required: true,
    areas: [{ ...firstArea, attachment_uuid: replacementUuid }, secondArea],
  });
  expect(template.fields[1].areas).toEqual([
    { ...firstArea, attachment_uuid: replacementUuid },
  ]);
  expect(template.fields[2].areas).toEqual([secondArea]);
  expect(template.fields[3]).not.toHaveProperty('areas');
});
it.each([
  ['a4', 595.28, 841.89],
  ['legal', 612, 1008],
  ['letter', 612, 792],
  ['unknown', 612, 792],
] as const)(
  'inserts generated %s pages with verified dimensions and bounded positions',
  async (size, width, height) => {
    const { service, user, template, storedBuffers } =
      await createTemplatesServiceFixture();
    template.schema = [{ attachment_uuid: 'existing', name: 'Existing' }];
    await service.updateTemplateDocuments(user, 'template', {
      documents: [{ type: 'blank', name: 'Inserted', size, position: -100 }],
    });
    expect(template.schema.map((item) => item.name)).toEqual([
      'Inserted',
      'Existing',
    ]);
    expect(
      (await PDFDocument.load(storedBuffers[0])).getPage(0).getSize(),
    ).toEqual({ width, height });
    await service.updateTemplateDocuments(user, 'template', {
      documents: [{ type: 'blank', name: 'Last', position: 100 }],
    });
    expect(template.schema.at(-1)?.name).toBe('Last');
  },
);
it('appends/merges native PDF fields with inferred roles and marks detected fields pending', async () => {
  const { service, user, template, acro, pdfBuffer } =
    await createTemplatesServiceFixture();
  acro.extractFields.mockResolvedValue([
    {
      uuid: 'detected',
      name: 'Detected',
      role: 'Reviewer',
      type: 'text',
      areas: [{ page: 1, x: 0.1, y: 0.2 }],
    },
  ]);
  const result = await service.updateTemplateDocuments(user, 'template', {
    documents: [{ name: 'Uploaded', file: pdfBuffer.toString('base64') }],
    merge: true,
  });
  expect(template.schema).toMatchObject([
    { name: 'Uploaded', pending_fields: true },
  ]);
  expect(template.submitters.map((submitter) => submitter.name)).toEqual([
    'Signer',
    'Reviewer',
  ]);
  expect(
    template.fields.find((field) => field.uuid === 'detected'),
  ).toMatchObject({
    required: false,
    areas: [{ page: 0, attachment_uuid: template.schema[0].attachment_uuid }],
  });
  expect(result.submitters).toEqual(template.submitters);
});
it('uses imported fields when replacing a document that has no existing field areas', async () => {
  const { service, user, template, acro, pdfBuffer } =
    await createTemplatesServiceFixture();
  template.schema = [{ name: 'First', attachment_uuid: 'first-document' }];
  template.fields = [{ uuid: 'unrelated', areas: [secondArea] }];
  acro.extractFields.mockResolvedValue([
    { uuid: 'new', type: 'text', areas: [{ page: 0 }] },
  ]);
  await service.updateTemplateDocuments(user, 'template', {
    documents: [
      { name: 'First.pdf', file: pdfBuffer.toString('base64'), replace: true },
    ],
  });
  expect(template.fields.map((field) => field.uuid)).toEqual([
    'unrelated',
    'new',
  ]);
});
it('renders HTML updates into versioned dynamic documents and supports file uploads from every multipart field', async () => {
  const {
    service,
    user,
    template,
    conversion,
    dynamicDocuments,
    dynamicVersions,
    pdfBuffer,
  } = await createTemplatesServiceFixture();
  await service.updateTemplateDocuments(user, 'template', {
    documents: [
      {
        html: '<p>Agreement</p>',
        html_header: '<header>Header</header>',
        html_footer: '<footer>Footer</footer>',
      },
    ],
  });
  expect(conversion.renderHtmlDocument).toHaveBeenCalledWith(
    expect.objectContaining({
      html: '<p>Agreement</p>',
      htmlHeader: '<header>Header</header>',
      htmlFooter: '<footer>Footer</footer>',
    }),
  );
  expect(template.schema[0]).toMatchObject({ dynamic: true });
  expect(dynamicDocuments.save).toHaveBeenCalledTimes(1);
  expect(dynamicVersions.save).toHaveBeenCalledTimes(1);
  for (const key of ['documents', 'files', 'file'])
    await service.updateTemplateDocuments(
      user,
      'template',
      { merge: true },
      {
        [key]: [
          {
            buffer: pdfBuffer,
            originalname: 'Upload.pdf',
            size: pdfBuffer.length,
            mimetype: 'application/pdf',
          },
        ],
      },
    );
  expect(template.schema).toHaveLength(4);
});
it('rejects missing/removal/replacement targets and propagates save failures without reporting success', async () => {
  const { service, user, template, templates } =
    await createTemplatesServiceFixture();
  await expect(
    service.updateTemplateDocuments(user, 'template', {}),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.updateTemplateDocuments(user, 'template', { documents: [{}] }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.updateTemplateDocuments(user, 'template', {
      documents: [{ remove: true, name: 'Missing' }],
    }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.updateTemplateDocuments(user, 'template', {
      documents: [{ type: 'blank', replace: true, position: 0 }],
    }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.updateTemplateDocuments(user, 'template', {
      documents: [{ remove: true, position: -1 }],
    }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.updateTemplateDocuments(user, 'template', {
      merge: true,
      documents: [{ remove: true }],
    }),
  ).rejects.toMatchObject({ status: 422 });
  template.schema = [{ attachment_uuid: 'existing', name: 'Existing' }];
  templates.save.mockRejectedValue(new Error('write failed'));
  await expect(
    service.updateTemplateDocuments(user, 'template', {
      documents: [{ type: 'blank' }],
    }),
  ).rejects.toThrow('write failed');
});
