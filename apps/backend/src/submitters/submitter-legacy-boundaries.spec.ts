import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageBlob } from '../storage/entities/storage-blob.entity';
import { validate } from 'class-validator';
import { createSubmittersServiceFixture } from '../../test/support/submitters-service.fixture';
import { SubmissionEvent } from '../submissions/entities/submission-event.entity';
import { UpdateSubmitterDto } from './dto/update-submitter.dto';
it('accepts explicitly null optional fields through DTO validation and clears stored contact and correlation data', async () => {
  const fixture = createSubmittersServiceFixture();
  const input = Object.assign(new UpdateSubmitterDto(), {
    email: null,
    name: null,
    phone: null,
    metadata: null,
    application_key: null,
    external_id: null,
  });
  expect(await validate(input)).toEqual([]);
  await fixture.service.updateSubmitter(
    fixture.user,
    fixture.submitter.id,
    input,
  );
  expect(fixture.submitter).toMatchObject({
    email: null,
    name: null,
    phone: null,
    metadata: {},
    externalId: null,
  });
});
it('keeps an empty request message without inventing subject or body overrides', async () => {
  const fixture = createSubmittersServiceFixture();
  await fixture.service.updateSubmitter(fixture.user, fixture.submitter.id, {
    message: {},
  });
  expect(fixture.submitter.preferences).toEqual({ message: {} });
  expect(fixture.events.emit).not.toHaveBeenCalled();
});
it('applies readonly configuration to named role fields and safely skips unnamed fields', async () => {
  const fixture = createSubmittersServiceFixture();
  fixture.template.fields = [
    { uuid: 'unnamed', type: 'text', submitter_uuid: 'party' },
    { uuid: 'name', name: 'Full name', submitter_uuid: 'party' },
  ];
  await fixture.service.updateSubmitter(
    fixture.user,
    fixture.submitter.id,
    { readonly_fields: ['full name'] },
    'fields',
  );
  expect(fixture.submission.templateFields).toEqual([
    { uuid: 'unnamed', type: 'text', submitter_uuid: 'party' },
    {
      uuid: 'name',
      name: 'Full name',
      submitter_uuid: 'party',
      readonly: true,
    },
  ]);
});
it('can complete a detached submission without inventing fields, roles or document URLs', async () => {
  const fixture = createSubmittersServiceFixture();
  fixture.submission.template = null;
  fixture.submission.templateId = null;
  fixture.submission.templateFields = null;
  fixture.submission.templateSchema = null;
  fixture.submission.templateSubmitters = null;
  const result = await fixture.service.updateSubmitter(
    fixture.user,
    fixture.submitter.id,
    { completed: true },
    'fields',
  );
  expect(result).toMatchObject({
    status: 'completed',
    role: '',
    fields: [],
    values: [],
    documents: [],
  });
  expect(fixture.queue.enqueueSubmitterCompletion).toHaveBeenCalledWith(
    fixture.submitter.id,
  );
});
it('serializes optional unloaded legacy data and unnamed fields using stable UUID labels', async () => {
  const fixture = createSubmittersServiceFixture();
  fixture.submitter.preferences = undefined as never;
  fixture.submitter.values = { unnamed: 'existing' };
  fixture.submitter.metadata = undefined as never;
  fixture.submitter.submissionEvents = [
    Object.assign(new SubmissionEvent(), { id: 'old-event', data: undefined }),
  ];
  fixture.submission.templateFields = [
    { uuid: 'unnamed', type: 'text', submitter_uuid: 'party' },
  ];
  const result = await fixture.service.getSubmitter(
    fixture.user,
    fixture.submitter.id,
  );
  expect(result).toMatchObject({
    preferences: {},
    metadata: {},
    values: [{ field: 'unnamed', value: 'existing' }],
    submission_events: [{ id: 'old-event', data: {} }],
  });
});
it('does not send requested SMS or email invitations when their contact details are absent', async () => {
  const fixture = createSubmittersServiceFixture();
  fixture.submitter.email = null;
  fixture.submitter.phone = null;
  await fixture.service.updateSubmitter(fixture.user, fixture.submitter.id, {
    send_email: true,
    send_sms: true,
  });
  expect(fixture.events.emit).not.toHaveBeenCalled();
});
it('retains visible values for a legacy condition without an explicit operation', async () => {
  const fixture = createSubmittersServiceFixture();
  fixture.template.fields = [
    { uuid: 'source', submitter_uuid: 'party', default_value: 7 },
    {
      uuid: 'target',
      submitter_uuid: 'party',
      default_value: 'hidden',
      conditions: [{ action: 'hide', field_uuid: 'source', value: 7 }],
    },
  ];
  await fixture.service.updateSubmitter(fixture.user, fixture.submitter.id, {
    completed: true,
  });
  expect(fixture.submitter.values).toEqual({ source: 7 });
});
it('falls back to original attachment filenames when schema names are missing', async () => {
  const fixture = createSubmittersServiceFixture();
  fixture.template.schema = [];
  fixture.storage.findRecordAttachments.mockResolvedValue([
    Object.assign(new StorageAttachment(), {
      uuid: 'file',
      blob: Object.assign(new StorageBlob(), { filename: 'Original.File.PDF' }),
    }),
  ]);
  expect(
    (await fixture.service.getSubmitter(fixture.user, fixture.submitter.id))
      .documents,
  ).toEqual([
    {
      name: 'Original.File',
      url: 'https://files.example.test/Original.File.PDF',
    },
  ]);
});
it('updates an older partially loaded submitter without stored preferences or value defaults', async () => {
  const fixture = createSubmittersServiceFixture();
  fixture.submitter.values = undefined as never;
  fixture.submitter.preferences = undefined as never;
  fixture.submission.template = null;
  fixture.submission.templateFields = null;
  fixture.submission.templateSchema = null;
  const result = await fixture.service.updateSubmitter(
    fixture.user,
    fixture.submitter.id,
    { values: { deleted_field: 'ignored' }, phone: '---' },
    'fields',
  );
  expect(result).toMatchObject({
    phone: null,
    values: [],
    preferences: {},
    fields: [],
  });
  expect(fixture.submission.templateFields).toEqual([]);
  expect(fixture.submission.templateSchema).toEqual([]);
});
it('compares structured conditional values by their JSON content at completion', async () => {
  const fixture = createSubmittersServiceFixture();
  fixture.template.fields = [
    {
      uuid: 'source',
      submitter_uuid: 'party',
      default_value: { accepted: true },
    },
    {
      uuid: 'target',
      submitter_uuid: 'party',
      default_value: 'hidden',
      conditions: [
        { action: 'hide', field_uuid: 'source', value: { accepted: true } },
      ],
    },
  ];
  await fixture.service.updateSubmitter(fixture.user, fixture.submitter.id, {
    completed: true,
  });
  expect(fixture.submitter.values).toEqual({ source: { accepted: true } });
});
it('serializes a legacy submitter without loaded values as an empty value list', async () => {
  const fixture = createSubmittersServiceFixture();
  fixture.submitter.values = undefined as never;
  expect(
    (await fixture.service.getSubmitter(fixture.user, fixture.submitter.id))
      .values,
  ).toEqual([]);
});
