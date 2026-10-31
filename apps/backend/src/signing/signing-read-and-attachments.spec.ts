import sharp from 'sharp';
import { createSigningServiceFixture } from '../../test/support/signing-service.fixture';
import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageBlob } from '../storage/entities/storage-blob.entity';
import { Submitter } from '../submitters/entities/submitter.entity';
it('opens a branded signing form, filters role fields and keeps other signers values readonly', async () => {
  const {
    service,
    submitter,
    submission,
    template,
    recordedEvents,
    events,
    branding,
  } = createSigningServiceFixture();
  template.fields = [
    { uuid: 'own', submitter_uuid: 'party', type: 'text' },
    { uuid: 'other', submitter_uuid: 'other', type: 'text' },
  ];
  submission.submitters.push(
    {
      ...submitter,
      id: 'other',
      uuid: 'other',
      values: { other: 'Already entered' },
    },
    {
      ...submitter,
      id: 'blank',
      uuid: 'blank',
      values: undefined as unknown as Record<string, unknown>,
    },
  );
  const result = await service.getSigningForm('slug', {
    ip: '127.0.0.1',
    ua: 'Mozilla/5.0',
    timezone: 'UTC',
    locale: 'en',
  });
  expect(result).toMatchObject({
    branding: { account_name: 'Example Org' },
    title: 'My Agreement',
    submitter: { id: '1', role: 'Signer' },
    fields: [{ uuid: 'own' }],
    readonly_values: { other: 'Already entered' },
    configs: {
      with_typed_signature: true,
      with_decline: true,
      with_delegate: false,
      prefill_signature: true,
      download_links_expire: true,
    },
  });
  expect(submitter.openedAt).toBeInstanceOf(Date);
  expect(submitter).toMatchObject({
    ip: '127.0.0.1',
    timezone: 'UTC',
    ua: 'Mozilla/5.0',
    metadata: { latest_signing_context: { locale: 'en' } },
  });
  expect(recordedEvents.create).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'view_form',
      accountId: 'tenant',
      submitterId: '1',
    }),
  );
  expect(events.emit).toHaveBeenCalledWith(
    'form.viewed',
    expect.objectContaining({ submitterId: '1', accountId: 'tenant' }),
  );
  expect(branding.get).toHaveBeenCalledWith('tenant');
});
it('uses submission snapshots, schema document order, preview metadata and configured UI flags', async () => {
  const { service, submission, attachment, storage, configValues } =
    createSigningServiceFixture();
  submission.templateFields = [{ uuid: 'snapshot', submitter_uuid: 'party' }];
  submission.templateSubmitters = [{ uuid: 'party', name: 'Snapshot role' }];
  submission.templateSchema = [
    { attachment_uuid: 'second', name: 'Annex' },
    {},
    { attachment_uuid: 'missing' },
    { attachment_uuid: 'asset' },
  ];
  const second = Object.assign(new StorageAttachment(), attachment, {
    id: 'second',
    uuid: 'second',
    blob: Object.assign(new StorageBlob(), {
      filename: 'second.pdf',
      metadata: { custom: 'metadata' },
    }),
  });
  storage.findRecordAttachments.mockImplementation((options) =>
    Promise.resolve(
      options.recordType === 'Template' ? [attachment, second] : [attachment],
    ),
  );
  storage.findPreviewAttachments.mockResolvedValue([
    {
      ...attachment,
      blob: Object.assign(new StorageBlob(), {
        filename: '0.png',
        metadata: null,
      }),
    },
  ]);
  for (const key of [
    'allow_typed_signature',
    'allow_to_decline',
    'form_prefill_signature',
    'download_links_expire',
    'flatten_result_pdf',
  ])
    configValues.set(key, false);
  for (const key of [
    'allow_to_delegate',
    'require_signing_reason',
    'with_signature_id',
    'download_links_auth',
    'combine_pdf_result_key',
    'force_mfa',
    'form_with_confetti',
  ])
    configValues.set(key, true);
  configValues.set('form_completed_button', {
    title: 'Back',
    url: 'https://example.test',
    ignored: 42,
  });
  configValues.set('form_completed_message', []);
  configValues.set('policy_links', '[Privacy](https://example.test/privacy)');
  const result = await service.getSigningForm('slug');
  expect(result.fields).toEqual([
    { uuid: 'snapshot', submitter_uuid: 'party' },
  ]);
  expect(result.submitter.role).toBe('Snapshot role');
  expect(
    result.documents.map((document) => [document.uuid, document.name]),
  ).toEqual([
    ['second', 'Annex'],
    ['asset', 'signature.png'],
  ]);
  expect(result.documents[0].preview_images[0].metadata).toEqual({});
  expect(result.configs).toMatchObject({
    with_typed_signature: false,
    with_decline: false,
    with_delegate: true,
    require_signing_reason: true,
    with_signature_id: true,
    prefill_signature: false,
    download_links_expire: false,
    download_links_auth: true,
    combine_pdf_result: true,
    flatten_result_pdf: false,
    force_mfa: true,
    with_confetti: true,
    completed_button: { title: 'Back', url: 'https://example.test' },
    completed_message: {},
    policy_links: '[Privacy](https://example.test/privacy)',
  });
});
it('returns an explicit not found for unknown signing slugs and stable fallbacks for deleted template references', async () => {
  const { service, submitter, submission, submitters } =
    createSigningServiceFixture();
  submitters.findOne.mockResolvedValueOnce(null);
  await expect(service.getSigningForm('missing')).rejects.toMatchObject({
    status: 404,
  });
  submission.templateId = null;
  submission.template = null;
  submission.name = null;
  submission.submitters = undefined as unknown as Submitter[];
  submitter.values = undefined as unknown as Record<string, unknown>;
  const result = await service.getSigningForm('slug');
  expect(result).toMatchObject({
    title: 'Document',
    documents: [],
    fields: [],
    values: {},
    readonly_values: {},
    submitter: { role: '' },
  });
});
it.each([undefined, 'invalid-date', '2025-01-01', '2027-01-01'])(
  'looks up attachment-backed field values with a parsed cursor (%s)',
  async (after) => {
    const { service, submitter, attachment, storage } =
      createSigningServiceFixture();
    storage.findRecordAttachments.mockResolvedValue([attachment]);
    submitter.values = { signature: 'asset', plain: ['non-attachment'] };
    expect(
      await service.getFieldValue('slug', 'signature', after),
    ).toMatchObject({
      value: 'asset',
      attachment: { uuid: 'asset', filename: 'signature.png' },
    });
    expect(await service.getFieldValue('slug', 'plain', after)).toEqual({
      value: ['non-attachment'],
      attachment: null,
    });
    expect(await service.getFieldValue('slug', 'missing')).toEqual({
      value: null,
      attachment: null,
    });
  },
);
it('uploads generic attachments with safe defaults and preserves API attachment creation metadata', async () => {
  const { service, storage, attachment } = createSigningServiceFixture();
  const buffer = Buffer.from('document');
  const file = { buffer, size: buffer.length, originalname: '' };
  expect(await service.uploadAttachment('slug', file, undefined)).toMatchObject(
    { uuid: 'asset', content_type: 'image/png' },
  );
  expect(storage.createAttachment).toHaveBeenCalledWith({
    buffer,
    filename: 'attachment.png',
    contentType: 'application/octet-stream',
    name: 'attachments',
    recordType: 'Submitter',
    recordId: '1',
    metadata: { analyzed: true, identified: true, signing_type: 'attachment' },
  });
  expect(
    await service.uploadApiAttachment(
      'slug',
      { ...file, originalname: 'document.txt', mimetype: 'text/plain' },
      'file',
    ),
  ).toMatchObject({
    uuid: 'asset',
    created_at: attachment.createdAt,
    filename: 'signature.png',
  });
  await expect(
    service.uploadAttachment(
      'slug',
      { ...file, buffer: Buffer.alloc(0) },
      'file',
    ),
  ).rejects.toMatchObject({ status: 422 });
});
it.each(['signature', 'initials'])(
  'accepts an inked %s image and rejects a blank image before storage',
  async (type) => {
    const { service, storage } = createSigningServiceFixture();
    const inked = await sharp(Buffer.from([0, 0, 0, 255, 255, 255]), {
      raw: { width: 2, height: 1, channels: 3 },
    })
      .png()
      .toBuffer();
    await service.uploadAttachment(
      'slug',
      {
        buffer: inked,
        size: inked.length,
        originalname: 'signature.png',
        mimetype: 'image/png',
      },
      type,
    );
    expect(storage.createAttachment).toHaveBeenCalledTimes(1);
    const blank = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(
      service.uploadAttachment(
        'slug',
        {
          buffer: blank,
          size: blank.length,
          originalname: 'blank.png',
          mimetype: 'image/png',
        },
        type,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(storage.createAttachment).toHaveBeenCalledTimes(1);
  },
);
it.each([
  'completed',
  'declined',
  'archived submission',
  'archived template',
  'expired',
])('refuses updates to a %s form', async (state) => {
  const { service, submitter, submission, template, source } =
    createSigningServiceFixture();
  if (state === 'completed') submitter.completedAt = new Date();
  if (state === 'declined') submitter.declinedAt = new Date();
  if (state === 'archived submission') submission.archivedAt = new Date();
  if (state === 'archived template') template.archivedAt = new Date();
  if (state === 'expired') submission.expireAt = new Date('2020-01-01');
  await expect(
    service.updateValues('slug', { values: {} }),
  ).rejects.toMatchObject({ status: 422 });
  expect(source.transaction).not.toHaveBeenCalled();
});
it('downloads completed separate/combined results using account lifetime rules and blocks required authentication', async () => {
  const {
    service,
    submitter,
    submission,
    attachment,
    configValues,
    documents,
    storage,
  } = createSigningServiceFixture();
  expect(await service.getDownload('slug')).toEqual({ documents: [] });
  submitter.completedAt = new Date();
  documents.getSubmissionDocuments.mockResolvedValue([attachment]);
  expect((await service.getDownload('slug')).documents[0]).toMatchObject({
    uuid: 'asset',
    preview_images: [],
  });
  expect(documents.getSubmissionDocuments).toHaveBeenCalledWith(submission, {
    merge: false,
  });
  expect(storage.createBlobProxyUrl).toHaveBeenLastCalledWith(
    attachment.blob,
    3600,
  );
  configValues.set('combine_pdf_result_key', true);
  configValues.set('download_links_expire', false);
  expect(await service.getDownload('slug')).toEqual({ documents: [] });
  documents.getCombinedDocumentAttachment.mockResolvedValue(attachment);
  await service.getDownload('slug');
  expect(storage.createBlobProxyUrl).toHaveBeenLastCalledWith(
    attachment.blob,
    null,
  );
  configValues.set('download_links_auth', true);
  await expect(service.getDownload('slug')).rejects.toMatchObject({
    status: 403,
  });
});
