import { createTemplatesServiceFixture } from '../../test/support/templates-service.fixture';
import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageBlob } from '../storage/entities/storage-blob.entity';
import { Template } from './entities/template.entity';
it('clones role/field/document identifiers and their condition/formula links without mutating the original', async () => {
  const { service, user, template, templates, attachmentRows, storage } =
    await createTemplatesServiceFixture();
  template.submitters = [
    {
      uuid: 'party',
      name: 'Signer',
      invite_by_uuid: 'second',
      optional_invite_by_uuid: 'second',
      linked_to_uuid: 'second',
      invite_via_field_uuid: 'field',
    },
    { uuid: 'second', name: 'Reviewer' },
    { name: 'Legacy role' },
  ];
  template.preferences = {
    submitters: [null, {}, { uuid: 'party', custom: true }],
    team_id: 'old-team',
  };
  template.schema = [
    {
      attachment_uuid: 'document',
      name: 'Agreement',
      conditions: [{ field_uuid: 'field' }],
    },
    {},
    { attachment_uuid: 'missing' },
  ];
  template.fields = [
    {
      uuid: 'field',
      submitter_uuid: 'party',
      name: 'Value',
      type: 'number',
      areas: [{ attachment_uuid: 'document', page: 0 }],
      conditions: [
        null,
        { field_uuid: 'field' },
        { field_uuid: 'external' },
        { field_uuid: 42 },
      ],
      preferences: { formula: '{{field}} + 1' },
    },
    { name: 'Legacy field', areas: [{ page: 1 }] },
    {
      uuid: 'external-field',
      submitter_uuid: 'external-party',
      areas: [{ attachment_uuid: 'external-document' }],
    },
  ];
  const original = structuredClone({
    fields: template.fields,
    schema: template.schema,
    submitters: template.submitters,
    preferences: template.preferences,
  });
  const sourceDocument = Object.assign(new StorageAttachment(), {
    id: 'source',
    uuid: 'document',
    name: 'documents',
    recordType: 'Template',
    recordId: 'template',
    blob: Object.assign(new StorageBlob(), { filename: 'Agreement.pdf' }),
  });
  attachmentRows.push(sourceDocument);
  storage.findPreviewAttachments.mockResolvedValue([
    Object.assign(new StorageAttachment(), {
      id: 'preview',
      blob: new StorageBlob(),
    }),
  ]);
  const result = await service.cloneTemplate(user, 'template', {
    name: 'Clone',
    folder_name: 'Legal',
    team_id: 'new-team',
    application_key: 'crm-alias',
  });
  const clone = templates.create.mock.calls[0][0];
  expect(result).toMatchObject({
    id: 'created-template',
    name: 'Clone',
    folder_name: 'Legal',
    external_id: 'crm-alias',
    preferences: { team_id: 'new-team' },
  });
  const role = clone.submitters?.[0];
  const reviewer = clone.submitters?.[1];
  const field = clone.fields?.[0];
  const schema = clone.schema?.[0];
  expect(role?.uuid).not.toBe('party');
  expect(role).toMatchObject({
    invite_by_uuid: reviewer?.uuid,
    optional_invite_by_uuid: reviewer?.uuid,
    linked_to_uuid: reviewer?.uuid,
    invite_via_field_uuid: field?.uuid,
  });
  expect(field).toMatchObject({
    submitter_uuid: role?.uuid,
    preferences: { formula: `{{${field?.uuid}}} + 1` },
    areas: [{ attachment_uuid: schema?.attachment_uuid }],
  });
  expect(field?.conditions).toEqual([
    null,
    { field_uuid: field?.uuid },
    { field_uuid: 'external' },
    { field_uuid: 42 },
  ]);
  expect(schema?.conditions).toEqual([{ field_uuid: field?.uuid }]);
  expect(clone.fields?.[2]).toMatchObject({
    submitter_uuid: 'external-party',
    areas: [{ attachment_uuid: 'external-document' }],
  });
  expect(clone.submitters?.[2].uuid).toBeTruthy();
  expect(clone.fields?.[1].uuid).toBeTruthy();
  expect(storage.cloneAttachment).toHaveBeenCalledWith(
    expect.objectContaining({
      sourceAttachment: sourceDocument,
      recordId: 'created-template',
      uuid: schema?.attachment_uuid,
    }),
  );
  expect({
    fields: template.fields,
    schema: template.schema,
    submitters: template.submitters,
    preferences: template.preferences,
  }).toEqual(original);
});
it('renames a single source-named document for an explicitly named clone and defaults clone names otherwise', async () => {
  const { service, user, template, templates } =
    await createTemplatesServiceFixture();
  template.schema = [{ attachment_uuid: 'document', name: 'Agreement' }];
  await service.cloneTemplate(user, 'template', {
    name: 'New Agreement',
    external_id: 'explicit',
  });
  expect(templates.create.mock.calls[0][0]).toMatchObject({
    name: 'New Agreement',
    schema: [{ name: 'New Agreement' }],
    externalId: 'explicit',
  });
  expect((await service.cloneTemplate(user, 'template', {})).name).toBe(
    'Agreement (Clone)',
  );
});
it('merges unique template ids in requested order and supports extra role names without sharing mutable source JSON', async () => {
  const { service, user, template, templateRows, templates, events } =
    await createTemplatesServiceFixture();
  const other: Template = Object.assign(new Template(), template, {
    id: 'other',
    name: 'Other',
    fields: [
      {
        uuid: 'other-field',
        submitter_uuid: 'other-role',
        name: 'Other field',
      },
    ],
    submitters: [{ uuid: 'other-role', name: 'Other role' }],
    preferences: { custom: true },
  });
  templateRows.set('other', other);
  const result = await service.mergeTemplates(user, {
    template_ids: [' other ', 'template', 'other', ''],
    name: 'Merged Agreement',
    folder_name: 'Legal',
    external_id: 'crm-merged',
    shared_link: false,
    roles: ['First signer', 'Second signer', 'Additional signer'],
  });
  expect(result).toMatchObject({
    name: 'Merged Agreement',
    external_id: 'crm-merged',
    shared_link: false,
    folder_name: 'Legal',
    submitters: [
      { name: 'First signer' },
      { name: 'Second signer' },
      { name: 'Additional signer' },
    ],
  });
  expect(
    templates.create.mock.calls[0][0].fields?.map((field) => field.name),
  ).toEqual(['Other field', 'Full name']);
  expect(templates.create.mock.calls[0][0].preferences).not.toBe(
    other.preferences,
  );
  expect(events.emit).toHaveBeenCalledWith('template.created', {
    accountId: 'tenant',
    templateId: 'created-template',
  });
});
it('uses default merged names/roles and reports merge/copy persistence failures', async () => {
  const { service, user, template, templateRows, templates } =
    await createTemplatesServiceFixture();
  templateRows.set(
    'other',
    Object.assign(new Template(), template, { id: 'other', name: 'Other' }),
  );
  expect(
    (
      await service.mergeTemplates(user, {
        template_ids: ['template', 'other'],
      })
    ).name,
  ).toBe('Agreement (Merged)');
  await expect(
    service.mergeTemplates(user, { template_ids: ['template', 'template'] }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.mergeTemplates(user, { template_ids: [] }),
  ).rejects.toMatchObject({ status: 422 });
  templates.save.mockRejectedValue(new Error('write failed'));
  await expect(
    service.mergeTemplates(user, { template_ids: ['template', 'other'] }),
  ).rejects.toThrow('write failed');
  await expect(service.cloneTemplate(user, 'template', {})).rejects.toThrow(
    'write failed',
  );
});
