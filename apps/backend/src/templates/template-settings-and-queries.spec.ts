import { createTemplatesServiceFixture } from '../../test/support/templates-service.fixture';
import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageBlob } from '../storage/entities/storage-blob.entity';
import { TemplateEvent } from './entities/template-event.entity';
import { TemplateSharing } from './entities/template-sharing.entity';
import { TemplateVersion } from './entities/template-version.entity';
it('lists templates with tenant/test-sharing access, parameterized filters, folder resolution and capped pagination', async () => {
  const { service, user, template, templates, folders } =
    await createTemplatesServiceFixture();
  templates.query.getMany.mockResolvedValue([template]);
  expect(
    await service.listTemplates(user, {
      q: 'A & B',
      slug: 'slug',
      application_key: 'external',
      after: '10',
      before: '20',
      limit: 1000,
    }),
  ).toMatchObject({
    data: [{ id: 'template' }],
    pagination: { count: 1, next: 'template', prev: 'template' },
  });
  expect(templates.query.where).toHaveBeenCalledWith(
    'template.account_id = :accountId',
    { accountId: 'tenant' },
  );
  expect(templates.query.orWhere).toHaveBeenCalledWith(
    'testing_sharing.id IS NOT NULL',
  );
  expect(templates.query.where).toHaveBeenCalledWith('template.name ILIKE :q', {
    q: '%A & B%',
  });
  expect(templates.query.andWhere).toHaveBeenCalledWith(
    'template.external_id = :externalId',
    { externalId: 'external' },
  );
  expect(templates.query.andWhere).toHaveBeenCalledWith(
    'template.id >= :before',
    { before: '21' },
  );
  expect(templates.query.andWhere).toHaveBeenCalledWith(
    'template.folder_id = :folderId',
    { folderId: 'default' },
  );
  expect(templates.query.limit).toHaveBeenCalledWith(100);
  templates.query.getMany.mockResolvedValue([]);
  folders.find.mockResolvedValue([]);
  expect(
    (await service.listTemplates(user, { folder: 'Missing' })).pagination,
  ).toEqual({ count: 0, next: null, prev: null });
  expect(templates.query.andWhere).toHaveBeenCalledWith('1 = 0');
  await service.listTemplates(user, {
    archived: true,
    external_id: 'explicit',
  });
  expect(templates.query.withDeleted).toHaveBeenCalled();
  expect(templates.query.andWhere).toHaveBeenCalledWith(
    'template.archivedAt IS NOT NULL',
  );
});
it('does not force the Default folder filter onto test-mode template lists unless a folder is selected', async () => {
  const { service, user, accounts, folders } =
    await createTemplatesServiceFixture();
  accounts.getTestingAccountContext.mockResolvedValue({
    isTestMode: true,
    productionAccountId: 'production',
    testingAccountId: 'tenant',
  });
  await service.listTemplates(user, {});
  expect(folders.find).not.toHaveBeenCalled();
  await service.listTemplates(user, { folder: 'Default' });
  expect(folders.find).toHaveBeenCalledTimes(1);
});
it('serializes document schema order and preview metadata, including the download URL list', async () => {
  const { service, user, template, attachmentRows, storage } =
    await createTemplatesServiceFixture();
  const attachment = Object.assign(new StorageAttachment(), {
    id: 'file',
    uuid: 'document',
    recordType: 'Template',
    recordId: 'template',
    name: 'documents',
    blob: Object.assign(new StorageBlob(), { filename: 'Agreement.pdf' }),
  });
  attachmentRows.push(attachment);
  template.schema = [
    {},
    { attachment_uuid: 'missing' },
    { attachment_uuid: 'document' },
  ];
  const preview = Object.assign(new StorageAttachment(), {
    id: 'preview',
    blob: Object.assign(new StorageBlob(), {
      filename: '0.png',
      metadata: null,
    }),
  });
  storage.findPreviewAttachmentsByRecordIds.mockResolvedValue(
    new Map([['file', [preview]]]),
  );
  expect((await service.getTemplate(user, 'template')).documents).toMatchObject(
    [
      {
        id: 'file',
        preview_image_url: 'https://files.example.test/0.png',
        preview_images: [{ metadata: {} }],
      },
    ],
  );
  expect(
    await service.getTemplateDocumentDownloadUrls(user, 'template'),
  ).toEqual(['https://files.example.test/Agreement.pdf']);
  storage.findPreviewAttachmentsByRecordIds.mockResolvedValue(new Map());
  expect(
    (await service.getTemplate(user, 'template')).documents[0]
      .preview_image_url,
  ).toBeNull();
});
it('returns tenant-scoped event/version history with optional actor information and bounded result sets', async () => {
  const { service, user, templateEvents, templateVersions } =
    await createTemplatesServiceFixture();
  templateEvents.find.mockResolvedValue([
    Object.assign(new TemplateEvent(), {
      id: 'event',
      templateId: 'template',
      eventType: 'template.updated',
      summary: 'Updated',
      user,
      data: { changed_paths: ['name'] },
    }),
    Object.assign(new TemplateEvent(), {
      id: 'system-event',
      templateId: 'template',
      user: null,
    }),
  ]);
  templateVersions.find.mockResolvedValue([
    Object.assign(new TemplateVersion(), {
      id: 'version',
      templateId: 'template',
      sha1: 'hash',
      author: user,
      data: { name: 'Agreement' },
    }),
    Object.assign(new TemplateVersion(), {
      id: 'system-version',
      author: null,
    }),
  ]);
  expect(
    (await service.listTemplateEvents(user, 'template')).data,
  ).toMatchObject([
    { id: 'event', user: { id: 'owner', email: 'owner@example.test' } },
    { id: 'system-event', user: null },
  ]);
  expect(
    (await service.listTemplateVersions(user, 'template')).data,
  ).toMatchObject([
    { id: 'version', author: { id: 'owner' }, data: { name: 'Agreement' } },
    { id: 'system-version', author: null },
  ]);
  expect(templateEvents.find).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { accountId: 'tenant', templateId: 'template' },
      take: 100,
    }),
  );
  expect(templateVersions.find).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { accountId: 'tenant', templateId: 'template' },
      take: 50,
    }),
  );
});
it('updates template settings with nested-body precedence, preserves false/zero preferences and removes blank overrides', async () => {
  const { service, user, template, templateEvents, templateVersions } =
    await createTemplatesServiceFixture();
  template.preferences = {
    keep: true,
    remove: 'previous',
    clearArray: ['old'],
    clearObject: { old: true },
    clearNull: true,
  };
  await service.updateTemplate(user, 'template', {
    name: 'Outer name',
    template: {
      name: 'Nested name',
      external_id: 'crm-id',
      shared_link: false,
      folder_name: 'Legal',
      fields: [],
      schema: [],
      submitters: [{ uuid: 'new-party', name: 'New role' }],
      preferences: {
        remove: ' ',
        clearArray: [],
        clearObject: {},
        clearNull: null,
        zero: 0,
        disabled: false,
        list: ['one'],
        object: { custom: true },
      },
    },
  });
  expect(template).toMatchObject({
    name: 'Nested name',
    externalId: 'crm-id',
    sharedLink: false,
    folder: { name: 'Legal' },
    fields: [],
    schema: [],
    submitters: [{ uuid: 'new-party' }],
    preferences: {
      keep: true,
      zero: 0,
      disabled: false,
      list: ['one'],
      object: { custom: true },
    },
  });
  expect(template.preferences).not.toHaveProperty('remove');
  expect(template.preferences).not.toHaveProperty('clearArray');
  expect(templateEvents.create).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'template.renamed',
      data: {
        changed_paths: expect.arrayContaining([
          'name',
          'preferences',
          'fields',
        ]) as unknown,
      },
    }),
  );
  expect(templateVersions.save).toHaveBeenCalledTimes(1);
  templateVersions.findOne.mockResolvedValue(
    Object.assign(new TemplateVersion(), { sha1: 'existing' }),
  );
  await service.updateTemplate(user, 'template', {
    roles: ['Renamed', 'Added'],
  });
  expect(template.submitters.map((submitter) => submitter.name)).toEqual([
    'Renamed',
    'Added',
  ]);
  expect(templateVersions.save).toHaveBeenCalledTimes(1);
});
it('records archive/restore activity and propagates template persistence failures', async () => {
  const { service, user, template, templates, templateEvents, events } =
    await createTemplatesServiceFixture();
  await service.updateTemplate(user, 'template', { archived: true });
  expect(template.archivedAt).toBeInstanceOf(Date);
  expect(templateEvents.create).toHaveBeenCalledWith(
    expect.objectContaining({ eventType: 'template.archived' }),
  );
  expect(events.emit).toHaveBeenCalledWith('template.archived', {
    accountId: 'tenant',
    templateId: 'template',
  });
  await service.updateTemplate(user, 'template', { archived: false });
  expect(template.archivedAt).toBeNull();
  expect(templateEvents.create).toHaveBeenCalledWith(
    expect.objectContaining({ eventType: 'template.restored' }),
  );
  templates.save.mockRejectedValue(new Error('write failed'));
  await expect(
    service.updateTemplate(user, 'template', { name: 'Failed' }),
  ).rejects.toThrow('write failed');
  await expect(service.deleteTemplate(user, 'template', {})).rejects.toThrow(
    'write failed',
  );
  templates.remove.mockRejectedValue(new Error('delete failed'));
  await expect(
    service.deleteTemplate(user, 'template', { permanently: true }),
  ).rejects.toThrow('delete failed');
});
it('shares templates with a linked test account idempotently and removes only that sharing record', async () => {
  const { service, user, accounts, templateSharings, templateEvents } =
    await createTemplatesServiceFixture();
  accounts.getTestingAccountContext.mockResolvedValue({
    isTestMode: false,
    productionAccountId: 'tenant',
    testingAccountId: 'testing',
  });
  await service.updateTestingSharing(user, 'template', true);
  expect(templateSharings.create).toHaveBeenCalledWith({
    ability: 'manage',
    accountId: 'testing',
    templateId: 'template',
  });
  templateSharings.findOne.mockResolvedValue(
    Object.assign(new TemplateSharing(), { accountId: 'testing' }),
  );
  expect(
    (await service.updateTestingSharing(user, 'template', true))
      .shared_with_test_mode,
  ).toBe(true);
  expect(templateSharings.save).toHaveBeenCalledTimes(1);
  await service.updateTestingSharing(user, 'template', false);
  expect(templateSharings.delete).toHaveBeenCalledWith({
    accountId: 'testing',
    templateId: 'template',
  });
  expect(templateEvents.create).toHaveBeenCalledWith(
    expect.objectContaining({ summary: 'Template unshared from Test mode' }),
  );
});
it('resolves test-mode shared templates but preserves production/testing key isolation for unshared records', async () => {
  const { service, user, template, accounts, templates } =
    await createTemplatesServiceFixture();
  template.accountId = 'production';
  accounts.getTestingAccountContext.mockResolvedValue({
    isTestMode: true,
    productionAccountId: 'production',
    testingAccountId: 'tenant',
  });
  templates.query.getOne.mockResolvedValueOnce(template);
  expect((await service.getTemplate(user, 'template')).id).toBe('template');
  await expect(service.getTemplate(user, 'template')).rejects.toMatchObject({
    status: 404,
    response: {
      error: expect.stringContaining('Use production API key') as unknown,
    },
  });
  accounts.getTestingAccountContext.mockResolvedValue({
    isTestMode: false,
    productionAccountId: 'tenant',
    testingAccountId: 'production',
  });
  await expect(service.getTemplate(user, 'template')).rejects.toMatchObject({
    status: 404,
    response: {
      error: expect.stringContaining('Use testing API key') as unknown,
    },
  });
  await expect(service.getTemplate(user, 'unknown')).rejects.toMatchObject({
    status: 404,
  });
});
it('returns internal template/archive webhook payloads while rejecting missing records', async () => {
  const { service, template, templates } =
    await createTemplatesServiceFixture();
  expect(await service.getTemplateWebhookPayload('template')).toMatchObject({
    id: 'template',
    name: 'Agreement',
  });
  template.archivedAt = new Date();
  expect(await service.getTemplateArchiveWebhookPayload('template')).toEqual({
    id: 'template',
    archived_at: template.archivedAt,
  });
  templates.findOne.mockResolvedValue(null);
  await expect(
    service.getTemplateWebhookPayload('unknown'),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service.getTemplateArchiveWebhookPayload('unknown'),
  ).rejects.toMatchObject({ status: 404 });
});
