import { ConfigService } from '@nestjs/config';
import { strFromU8, unzipSync } from 'fflate';
import { Brackets, Repository, WhereExpressionBuilder } from 'typeorm';
import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageBlob } from '../storage/entities/storage-blob.entity';
import { StorageService } from '../storage/storage.service';
import { Submitter } from '../submitters/entities/submitter.entity';
import { Template } from '../templates/entities/template.entity';
import { Submission } from './entities/submission.entity';
import { SubmissionExportService } from './submission-export.service';
function setup(records: Submission[] = []) {
  const query = {
    withDeleted: jest.fn(),
    leftJoinAndSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    getMany: jest.fn().mockResolvedValue(records),
  };
  for (const method of Object.values(query)) method.mockReturnValue(query);
  query.getMany.mockResolvedValue(records);
  query.andWhere.mockImplementation((condition: string | Brackets) => {
    if (condition instanceof Brackets)
      condition.whereFactory(query as unknown as WhereExpressionBuilder);
    return query;
  });
  const repository = { createQueryBuilder: jest.fn().mockReturnValue(query) };
  const storage = {
    findRecordAttachments: jest
      .fn<Promise<StorageAttachment[]>, [unknown]>()
      .mockResolvedValue([]),
    createBlobProxyUrl: jest.fn(
      (blob: StorageBlob) => `https://files.example.test/${blob.filename}`,
    ),
  };
  const service = new SubmissionExportService(
    repository as unknown as Repository<Submission>,
    new ConfigService({ FRONTEND_ORIGIN: 'https://sign.example.test' }),
    storage as unknown as StorageService,
  );
  return { service, storage, query };
}
function record() {
  const submitter: Submitter = Object.assign(new Submitter(), {
    id: '2',
    uuid: 'party',
    name: 'Signer',
    email: 'signer@example.test',
    phone: null,
    slug: 'slug',
    completedAt: null,
    declinedAt: null,
    openedAt: null,
    sentAt: null,
    values: {},
  });
  const template: Template = Object.assign(new Template(), {
    name: 'Employment Agreement',
    fields: [],
    submitters: [{ uuid: 'party', name: 'Employee' }],
  });
  const submission: Submission = Object.assign(new Submission(), {
    id: 'submission',
    name: 'Signed Agreement',
    templateFields: null,
    templateSubmitters: null,
    template,
    submitters: [submitter],
  });
  return { submission, submitter, template };
}
function attachment(uuid: string, filename: string) {
  return Object.assign(new StorageAttachment(), {
    uuid,
    blob: Object.assign(new StorageBlob(), { filename }),
  });
}
it('exports a stable CSV table with named fields, escaped quotes, links and tenant/template query constraints', async () => {
  const { submission, submitter, template } = record();
  submitter.name = 'A "Quoted", Signer';
  template.fields = [
    {
      uuid: 'text',
      submitter_uuid: 'party',
      type: 'text',
      name: 'Postal address',
    },
  ];
  submitter.values = { text: 'Line one\nLine two' };
  const { service, query } = setup([submission]);
  const result = await service.exportTemplateSubmissions(
    'tenant',
    'template',
    {},
  );
  expect(result).toEqual({
    filename: 'Employment_Agreement.csv',
    contentType: 'text/csv; charset=utf-8',
    content:
      '"Name","Email","Status","Link","Postal address"\n"A ""Quoted"", Signer","signer@example.test","awaiting","https://sign.example.test/s/slug","Line one\nLine two"',
  });
  expect(query.where).toHaveBeenCalledWith(
    'submission.account_id = :accountId',
    { accountId: 'tenant' },
  );
  expect(query.andWhere).toHaveBeenCalledWith(
    'submission.template_id = :templateId',
    { templateId: 'template' },
  );
  expect(query.andWhere).toHaveBeenCalledWith('submission.archived_at IS NULL');
  expect(query.orderBy).toHaveBeenCalledWith('submission.id', 'ASC');
  expect(query.addOrderBy).toHaveBeenCalledWith('submitter.id', 'ASC');
});
it.each([
  ['completed', 'NOT EXISTS'],
  ['declined', 'declined_submitter.declined_at IS NOT NULL'],
  ['expired', 'submission.expire_at < :now'],
  ['pending', 'pending_submitter.declined_at IS NULL'],
] as const)(
  'applies the %s export status filter and escaped parameterized search',
  async (status, expectedSql) => {
    const { service, query } = setup();
    await service.exportTemplateSubmissions('tenant', 'template', {
      status,
      q: "O'Reilly",
      archived: true,
    });
    expect(query.andWhere).toHaveBeenCalledWith(
      'submission.archived_at IS NOT NULL',
    );
    expect(
      query.andWhere.mock.calls.some(
        ([condition]) =>
          typeof condition === 'string' && condition.includes(expectedSql),
      ),
    ).toBe(true);
    expect(query.where).toHaveBeenCalledWith('submitter.name ILIKE :q', {
      q: "%O'Reilly%",
    });
    expect(query.orWhere).toHaveBeenCalledWith('submission.name ILIKE :q', {
      q: "%O'Reilly%",
    });
  },
);
it('formats scalar, array, boolean and attachment field values while omitting missing values and other roles', async () => {
  const { submission, submitter } = record();
  const fields = [
    { uuid: 'number', type: 'number', name: 'Amount' },
    { uuid: 'bool', type: 'checkbox', name: 'Approved' },
    { uuid: 'array', type: 'multiple', name: 'Options' },
    { uuid: 'object', type: 'text', name: 'JSON' },
    { uuid: 'image', type: 'image', name: 'Photo' },
    { uuid: 'signature', type: 'signature', name: 'Signed' },
    { uuid: 'missing', type: 'stamp', name: 'Missing image' },
    { uuid: 'files', type: 'file', name: 'Files' },
    { uuid: 'file', type: 'file', name: 'One file' },
    { uuid: 'empty', type: 'text', name: 'Empty' },
    { uuid: 'nil', type: 'text', name: 'Null' },
    { uuid: 'unset', type: 'text', name: 'Unset' },
  ];
  submission.templateFields = [
    ...fields.map((field) => ({ ...field, submitter_uuid: 'party' })),
    { uuid: 'other', name: 'Other role', submitter_uuid: 'other' },
  ];
  submitter.values = {
    number: 42,
    bool: false,
    array: ['One', 2, true, { nested: 'value' }],
    object: { nested: 'value' },
    image: 'photo',
    signature: 'sign',
    missing: 'absent',
    files: ['photo', 'sign', 'absent'],
    file: 'photo',
    empty: '',
    nil: null,
  };
  const { service, storage } = setup([submission]);
  storage.findRecordAttachments.mockResolvedValue([
    attachment('photo', 'photo.png'),
    attachment('sign', 'signature.png'),
  ]);
  const result = await service.exportTemplateSubmissions(
    'tenant',
    'template',
    {},
  );
  expect(result.content).toContain(
    '"42","false","One, 2, true, {""nested"":""value""}","{""nested"":""value""}"',
  );
  expect(result.content).toContain(
    'https://files.example.test/photo.png\nhttps://files.example.test/signature.png',
  );
  expect(result.content).not.toContain('Other role');
  expect(result.content).not.toContain('Missing image');
  expect(result.content).not.toContain('"Null"');
  expect(storage.findRecordAttachments).toHaveBeenCalledWith({
    recordType: 'Submitter',
    recordId: '2',
    name: 'attachments',
  });
});
it('exports role-prefixed columns in submitter id order and documents from the final completed signer only', async () => {
  const { submission, submitter } = record();
  submitter.completedAt = new Date('2026-01-02');
  const first = Object.assign(new Submitter(), {
    ...submitter,
    id: '1',
    uuid: 'first',
    name: 'First signer',
    completedAt: new Date('2026-01-01'),
  });
  submission.submitters = [submitter, first];
  submission.templateSubmitters = [
    { uuid: 'first', name: 'Employer' },
    { uuid: 'party', name: 'Employee' },
  ];
  const { service, storage } = setup([submission]);
  storage.findRecordAttachments.mockImplementation((options) =>
    Promise.resolve(
      (options as { name: string }).name === 'documents'
        ? [attachment('doc', 'completed.pdf')]
        : [],
    ),
  );
  const result = await service.exportTemplateSubmissions(
    'tenant',
    'template',
    {},
  );
  expect(result.content).toContain(
    '"Employer - Name","Employer - Email","Employer - Status","Employer - Completed At","Employee - Name"',
  );
  expect(result.content).toContain('https://files.example.test/completed.pdf');
  expect(
    storage.findRecordAttachments.mock.calls.filter(
      ([options]) => (options as { name: string }).name === 'documents',
    ),
  ).toEqual([[{ recordType: 'Submitter', recordId: '2', name: 'documents' }]]);
  expect(result.content).not.toContain('/s/slug');
});
it.each(['declined', 'opened', 'sent', 'awaiting'])(
  'represents %s status correctly for an incomplete signer',
  async (status) => {
    const { submission, submitter } = record();
    if (status === 'declined') submitter.declinedAt = new Date();
    if (status === 'opened') submitter.openedAt = new Date();
    if (status === 'sent') submitter.sentAt = new Date();
    const { service } = setup([submission]);
    expect(
      (await service.exportTemplateSubmissions('tenant', 'template', {}))
        .content,
    ).toContain(`"${status}"`);
  },
);
it('generates unnamed field labels/counters and falls back to submitter identity when roles are absent', async () => {
  const { submission, submitter } = record();
  submission.template = null;
  submission.templateFields = [
    { uuid: 'one', submitter_uuid: 'party', type: 'text' },
    { uuid: 'two', submitter_uuid: 'party', type: 'text' },
    { uuid: 'three', submitter_uuid: 'party', type: 'date_time' },
    { uuid: 'four', submitter_uuid: 'party' },
  ];
  submitter.values = {
    one: 'first',
    two: 'second',
    three: 'today',
    four: 'fallback',
  };
  submission.submitters.push(
    Object.assign(new Submitter(), {
      ...submitter,
      id: '3',
      uuid: 'other',
      name: null,
      email: null,
      phone: null,
    }),
  );
  const { service } = setup([submission]);
  const result = await service.exportTemplateSubmissions(
    'tenant',
    'template',
    {},
  );
  expect(result.filename).toBe('submissions.csv');
  expect(result.content).toContain('Signer - Text Field 1');
  expect(result.content).toContain('Signer - Text Field 2');
  expect(result.content).toContain('Signer - Date Time Field 1');
  expect(result.content).toContain('Signer - Field Field 1');
  expect(result.content).toContain('Submitter - Status');
});
it.each(['email', 'phone'])(
  'uses a missing role/name fallback from %s',
  async (identity) => {
    const { submission, submitter, template } = record();
    template.submitters = [];
    submitter.name = null;
    submitter.phone = '+15551234567';
    if (identity === 'phone') submitter.email = null;
    submission.submitters.push({
      ...submitter,
      id: '3',
      uuid: 'other',
      name: 'Second',
    });
    const { service } = setup([submission]);
    const result = await service.exportTemplateSubmissions(
      'tenant',
      'template',
      {},
    );
    expect(result.content).toContain(
      identity === 'email'
        ? 'signer@example.test - Status'
        : '+15551234567 - Status',
    );
  },
);
it('creates a standards-readable XLSX ZIP with escaped XML and columns beyond Z', async () => {
  const { submission, submitter, template } = record();
  template.name = '___';
  submission.templateFields = Array.from({ length: 30 }, (_, index) => ({
    uuid: `field-${index}`,
    submitter_uuid: 'party',
    name: `Field ${index}`,
    type: 'text',
  }));
  submitter.values = Object.fromEntries(
    submission.templateFields.map((field) => [
      field.uuid!,
      'A & B < C > D "quote"',
    ]),
  );
  const { service } = setup([submission]);
  const result = await service.exportTemplateSubmissions('tenant', 'template', {
    format: 'xlsx',
  });
  expect(result.contentType).toBe(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  expect(result.filename).toBe('submissions.xlsx');
  expect(Buffer.isBuffer(result.content)).toBe(true);
  const files = unzipSync(result.content as Buffer);
  expect(Object.keys(files).sort()).toEqual(
    [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ].sort(),
  );
  expect(strFromU8(files['xl/workbook.xml'])).toContain('name="Submissions"');
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  expect(sheet).toContain('r="AA1"');
  expect(sheet).toContain('A &amp; B &lt; C &gt; D &quot;quote&quot;');
});
it('unifies sparse headers across rows, defaults invalid formats and exports empty collections', async () => {
  const first = record();
  first.submitter.phone = '+15551234567';
  const second = record();
  second.submitter.email = null;
  const { service } = setup([first.submission, second.submission]);
  const result = await service.exportTemplateSubmissions('tenant', 'template', {
    format: 'unsupported',
  });
  expect(result.filename).toMatch(/\.csv$/);
  expect(result.content).toContain('"Name","Email","Phone","Status","Link"');
  expect(result.content).toContain('"Signer","","","awaiting"');
  expect(
    await setup().service.exportTemplateSubmissions('tenant', 'template', {}),
  ).toMatchObject({ filename: 'submissions.csv', content: '' });
  const empty = Object.assign(new Submission(), { submitters: undefined });
  expect(
    (
      await setup([empty]).service.exportTemplateSubmissions(
        'tenant',
        'template',
        {},
      )
    ).content,
  ).toBe('\n');
});
