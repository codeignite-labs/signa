import { createSubmissionsServiceFixture } from '../../test/support/submissions-service.fixture';
import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageBlob } from '../storage/entities/storage-blob.entity';
import { Template } from '../templates/entities/template.entity';
it('creates backing templates from PDF/HTML/DOCX inputs before entering the shared submission workflow', async () => {
  const { service, user, templateService } = createSubmissionsServiceFixture();
  const submitters = [{ email: 'signer@example.test' }];
  const files = {
    documents: [
      { buffer: Buffer.from('document'), size: 8, originalname: 'file.pdf' },
    ],
  };
  expect(
    await service.createSubmissionFromPdf(
      user,
      { submitters, name: 'PDF Agreement', flatten: false, remove_tags: true },
      files,
    ),
  ).toHaveLength(1);
  expect(templateService.createBackingTemplateFromPdf).toHaveBeenCalledWith(
    user,
    {
      name: 'PDF Agreement',
      folder_name: 'Default',
      documents: undefined,
      flatten: false,
      remove_tags: true,
      shared_link: false,
    },
    files,
  );
  expect(
    await service.createSubmissionFromHtml(user, {
      submitters,
      documents: [],
      folder_name: 'Legal',
      name: 'HTML Agreement',
    }),
  ).toHaveLength(1);
  expect(templateService.createBackingTemplateFromHtml).toHaveBeenCalledWith(
    user,
    {
      documents: [],
      folder_name: 'Legal',
      name: 'HTML Agreement',
      shared_link: false,
    },
  );
  expect(
    await service.createSubmissionFromDocx(user, {
      submitters,
      documents: [],
      name: 'DOCX Agreement',
    }),
  ).toHaveLength(1);
  expect(templateService.createBackingTemplateFromDocx).toHaveBeenCalledWith(
    user,
    {
      documents: [],
      folder_name: 'Default',
      name: 'DOCX Agreement',
      shared_link: false,
    },
  );
});
it('merges account-owned templates in requested order, cloning previews and remapping document/role identifiers', async () => {
  const { service, user, template, templates, storage } =
    createSubmissionsServiceFixture();
  const source: Template = Object.assign(new Template(), {
    id: 'source',
    accountId: 'tenant',
    archivedAt: null,
    schema: [
      {},
      { attachment_uuid: 'source-document', name: 'Annex' },
      { attachment_uuid: 'missing' },
    ],
    submitters: [
      { uuid: 'source-party', name: 'signer' },
      { uuid: 'source-reviewer', name: 'Reviewer' },
      { name: 'Extra' },
    ],
    fields: [
      {
        uuid: 'source-field',
        name: 'Annex signer',
        submitter_uuid: 'source-party',
        areas: [{ attachment_uuid: 'source-document', page: 0 }, { page: 0 }],
      },
      { uuid: 'reviewer', submitter_uuid: 'source-reviewer' },
      { uuid: 'global' },
    ],
  });
  const sourceDocument = Object.assign(new StorageAttachment(), {
    id: 'source-file',
    uuid: 'source-document',
    blob: Object.assign(new StorageBlob(), { filename: 'annex.pdf' }),
  });
  const preview = Object.assign(new StorageAttachment(), {
    id: 'preview',
    uuid: 'preview',
    blob: Object.assign(new StorageBlob(), { filename: '0.png' }),
  });
  templates.find.mockResolvedValue([source]);
  storage.findRecordAttachments.mockImplementation((options) =>
    Promise.resolve(options.recordId === 'source' ? [sourceDocument] : []),
  );
  storage.findPreviewAttachments.mockResolvedValue([preview]);
  await service.createSubmissionFromPdf(user, {
    submitters: [{ email: 'signer@example.test' }],
    template_ids: ['source'],
  });
  expect(templates.find).toHaveBeenCalledWith({
    where: [{ id: 'source', accountId: 'tenant' }],
  });
  expect(storage.cloneAttachment).toHaveBeenCalledWith(
    expect.objectContaining({
      sourceAttachment: sourceDocument,
      recordType: 'Template',
      recordId: 'template',
      name: 'documents',
    }),
  );
  expect(storage.cloneAttachment).toHaveBeenCalledWith(
    expect.objectContaining({
      sourceAttachment: preview,
      recordType: 'ActiveStorage::Attachment',
      recordId: 'cloned',
      name: 'preview_images',
    }),
  );
  expect(template.submitters).toHaveLength(3);
  expect(template.submitters[0]).toMatchObject({
    uuid: 'party',
    name: 'Signer',
  });
  expect(template.submitters[1].uuid).not.toBe('source-reviewer');
  expect(template.schema).toHaveLength(1);
  const clonedDocumentUuid = template.schema[0].attachment_uuid;
  expect(clonedDocumentUuid).not.toBe('source-document');
  const clonedField = template.fields.find(
    (field) => field.name === 'Annex signer',
  );
  expect(clonedField).toMatchObject({
    submitter_uuid: 'party',
    areas: [{ attachment_uuid: clonedDocumentUuid, page: 0 }, { page: 0 }],
  });
  expect(clonedField?.uuid).not.toBe('source-field');
  expect(templates.save).toHaveBeenCalledWith(template);
});
it.each(['html', 'docx'])(
  'applies additional templates to %s backing documents before submission creation',
  async (format) => {
    const { service, user, templates } = createSubmissionsServiceFixture();
    templates.find.mockResolvedValue([
      Object.assign(new Template(), {
        id: 'source',
        archivedAt: null,
        submitters: [],
        schema: [],
        fields: [],
      }),
    ]);
    const input = {
      submitters: [{ email: 'signer@example.test' }],
      documents: [],
      template_ids: ['source'],
    };
    if (format === 'html') await service.createSubmissionFromHtml(user, input);
    else await service.createSubmissionFromDocx(user, input);
    expect(templates.save).toHaveBeenCalledTimes(1);
  },
);
it.each([true, false])(
  'rejects missing or archived extra template references before creating a signing submission (archived=%s)',
  async (archived) => {
    const { service, user, templates, submissions } =
      createSubmissionsServiceFixture();
    templates.find.mockResolvedValue(
      archived
        ? [
            Object.assign(new Template(), {
              id: 'source',
              archivedAt: new Date(),
            }),
          ]
        : [],
    );
    await expect(
      service.createSubmissionFromPdf(user, {
        submitters: [{ email: 'signer@example.test' }],
        template_ids: ['source'],
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(submissions.save).not.toHaveBeenCalled();
  },
);
