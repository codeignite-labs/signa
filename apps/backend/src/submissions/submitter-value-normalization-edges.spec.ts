import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';
import { Submitter } from '../submitters/entities/submitter.entity';
import { Submission } from './entities/submission.entity';
import { Template } from '../templates/entities/template.entity';
import type { TemplateField } from '../templates/types/template-json';
import { SubmitterValueNormalizer } from './submitter-value-normalizer.service';
function fixture(fields: TemplateField[] = []) {
  const storage = {
    findRecordAttachments: jest.fn().mockResolvedValue([]),
    readSignedBlobUrl: jest.fn().mockResolvedValue(null),
    createAttachment: jest.fn().mockResolvedValue(undefined),
  };
  const service = new SubmitterValueNormalizer(
    storage as unknown as StorageService,
    new ConfigService(),
  );
  const submitter: Submitter = Object.assign(new Submitter(), {
    id: 'signer',
    uuid: 'party',
    submission: Object.assign(new Submission(), { templateFields: fields }),
  });
  return { service, storage, submitter };
}
function field(
  type: string,
  overrides: Partial<TemplateField> = {},
): TemplateField {
  return {
    uuid: 'field',
    name: 'Field',
    submitter_uuid: 'party',
    type,
    ...overrides,
  };
}
it.each([
  {},
  { values: {} },
  { fields: [{ title: 'Unkeyed config', default_value: 'ignored' }] },
])(
  'returns an unchanged independent copy when no keyed defaults exist %j',
  async (input) => {
    const { service, storage, submitter } = fixture();
    const result = await service.normalizeUpdateInput(submitter, input);
    expect(result).toEqual({ input, pendingAttachments: [] });
    expect(result.input).not.toBe(input);
    expect(storage.findRecordAttachments).not.toHaveBeenCalled();
  },
);
it('ignores unknown and other-role field keys and legacy fields without UUIDs', async () => {
  const fields = [
    field('text'),
    field('text', { uuid: undefined, name: 'Legacy' }),
    field('text', {
      uuid: 'other',
      name: 'Other',
      submitter_uuid: 'another-party',
    }),
  ];
  const { service } = fixture(fields);
  const result = await service.normalizeCreateInput({
    templateFields: fields,
    submitterUuid: 'party',
    submitterInput: {
      values: {
        Field: 'accepted',
        Legacy: 'ignored',
        Other: 'private',
        unknown: 'ignored',
      },
    },
  });
  expect(result.input.values).toEqual({ field: 'accepted' });
  expect(result.pendingAttachments).toEqual([]);
});
it.each([
  ['checkbox', 'yes', true],
  ['checkbox', 'No', false],
  ['checkbox', 'custom', 'custom'],
  ['number', '42', 42],
  ['number', '42.5', 42.5],
  ['text', null, null],
  ['text', undefined, null],
  ['image', '', null],
])(
  'normalizes primitive %s value %s without attachment ingestion',
  async (type, value, expected) => {
    const fields = [field(type)];
    const { service, storage } = fixture(fields);
    const result = await service.normalizeCreateInput({
      templateFields: fields,
      submitterUuid: 'party',
      submitterInput: { values: { field: value } },
    });
    expect(result.input.values).toEqual({ field: expected });
    expect(result.pendingAttachments).toEqual([]);
    expect(storage.readSignedBlobUrl).not.toHaveBeenCalled();
  },
);
it('replaces both field config values and defaults while preserving unrelated field configuration', async () => {
  const fields = [field('number')];
  const { service } = fixture(fields);
  const input = {
    fields: [
      { uuid: 'field', default_value: '12', value: '15' },
      { uuid: 'unmatched', value: 'keep' },
      { name: 'No UUID', value: 'keep' },
    ],
  };
  const result = await service.normalizeCreateInput({
    templateFields: fields,
    submitterUuid: 'party',
    submitterInput: input,
  });
  expect(result.input.values).toEqual({ field: 15 });
  expect(result.input.fields?.[0]).toMatchObject({
    default_value: 15,
    value: 15,
  });
  expect(result.input.fields?.[1]).toEqual(input.fields[1]);
  expect(input.fields[0].value).toBe('15');
});
it('falls back to current template fields when a snapshot has not been stored', async () => {
  const fields = [field('text')];
  const { service, submitter } = fixture();
  submitter.submission.templateFields = null;
  submitter.submission.template = Object.assign(new Template(), { fields });
  await expect(
    service.normalizeUpdateInput(submitter, { values: { Field: 'Casey' } }),
  ).resolves.toMatchObject({ input: { values: { field: 'Casey' } } });
});
it('drops unresolved values when a detached template has neither snapshot nor source fields', async () => {
  const { service, submitter } = fixture();
  submitter.submission.templateFields = null;
  await expect(
    service.normalizeUpdateInput(submitter, { values: { Field: 'Casey' } }),
  ).resolves.toMatchObject({ input: { values: {} } });
});
it('rejects non-string attachment payloads instead of silently coercing them', async () => {
  const fields = [field('file')];
  const { service } = fixture(fields);
  await expect(
    service.normalizeCreateInput({
      templateFields: fields,
      submitterUuid: 'party',
      submitterInput: { values: { field: { uuid: 'untrusted' } } },
    }),
  ).rejects.toMatchObject({ response: { error: 'Invalid attachment value' } });
});
it('persists no attachments for an empty queue', async () => {
  const { service, submitter, storage } = fixture();
  await service.persistPendingAttachments(submitter, []);
  expect(storage.createAttachment).not.toHaveBeenCalled();
});
it('normalizes value-only field configs without creating an implicit default_value property', async () => {
  const fields = [field('number')];
  const { service } = fixture(fields);
  const result = await service.normalizeCreateInput({
    templateFields: fields,
    submitterUuid: 'party',
    submitterInput: { fields: [{ uuid: 'field', value: '7' }] },
  });
  expect(result.input.fields?.[0]).toEqual({ uuid: 'field', value: 7 });
  expect(result.input.values).toEqual({ field: 7 });
});
