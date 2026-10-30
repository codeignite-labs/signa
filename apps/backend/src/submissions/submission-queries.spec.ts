import { EntityNotFoundError } from 'typeorm';
import { createSubmissionsServiceFixture } from '../../test/support/submissions-service.fixture';
import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageBlob } from '../storage/entities/storage-blob.entity';
import { Submitter } from '../submitters/entities/submitter.entity';
import { TemplateFolder } from '../templates/entities/template-folder.entity';
import { SubmissionEvent } from './entities/submission-event.entity';
import { Submission } from './entities/submission.entity';
it('lists tenant-scoped submissions with bounded pagination and optional snapshot fields', async () => {
  const { service, user, submission, submissionQuery } =
    createSubmissionsServiceFixture();
  submission.templateFields = [{ uuid: 'snapshot', type: 'text' }];
  submissionQuery.getMany.mockResolvedValue([submission]);
  expect(
    await service.listSubmissions(user, {
      include: 'values, fields',
      limit: 1000,
    }),
  ).toMatchObject({
    data: [
      { id: 'submission', status: 'pending', fields: [{ uuid: 'snapshot' }] },
    ],
    pagination: { count: 1, next: 'submission', prev: 'submission' },
  });
  expect(submissionQuery.where).toHaveBeenCalledWith(
    'submission.account_id = :accountId',
    { accountId: 'tenant' },
  );
  expect(submissionQuery.limit).toHaveBeenCalledWith(100);
  submissionQuery.getMany.mockResolvedValue([]);
  expect((await service.listSubmissions(user, {})).pagination).toEqual({
    count: 0,
    next: null,
    prev: null,
  });
  expect(submissionQuery.limit).toHaveBeenLastCalledWith(10);
});
it.each([
  ['completed', 'NOT EXISTS'],
  ['declined', 'declined_at IS NOT NULL'],
  ['expired', 'submission.expire_at < :now'],
  ['pending', 'completed_at IS NULL'],
] as const)(
  'applies %s status, search, archive, template, folder and cursor filters without interpolating user values',
  async (status, expectedSql) => {
    const { service, user, submissionQuery } =
      createSubmissionsServiceFixture();
    await service.listSubmissions(user, {
      status,
      archived: true,
      template_id: 'template',
      template_folder: 'Legal',
      slug: 'public-slug',
      q: "O'Reilly",
      after: '10',
      before: '20',
    });
    expect(submissionQuery.andWhere).toHaveBeenCalledWith(
      'submission.archived_at IS NOT NULL',
    );
    expect(submissionQuery.andWhere).toHaveBeenCalledWith(
      'submission.template_id = :templateId',
      { templateId: 'template' },
    );
    expect(submissionQuery.andWhere).toHaveBeenCalledWith(
      'templateFolder.name = :templateFolder',
      { templateFolder: 'Legal' },
    );
    expect(submissionQuery.andWhere).toHaveBeenCalledWith(
      'submission.slug = :slug',
      { slug: 'public-slug' },
    );
    expect(submissionQuery.andWhere).toHaveBeenCalledWith(
      'submission.id < :after',
      { after: '10' },
    );
    expect(submissionQuery.andWhere).toHaveBeenCalledWith(
      'submission.id >= :before',
      { before: '21' },
    );
    expect(submissionQuery.where).toHaveBeenCalledWith(
      'submitter.name ILIKE :q',
      { q: "%O'Reilly%" },
    );
    expect(submissionQuery.orWhere).toHaveBeenCalledWith(
      'submitter.email ILIKE :q',
      { q: "%O'Reilly%" },
    );
    expect(
      submissionQuery.andWhere.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes(expectedSql),
      ),
    ).toBe(true);
  },
);
it('serializes complete submissions with named attachment values, generated previews and audit URLs', async () => {
  const { service, user, submitter, submission, template, storage, documents } =
    createSubmissionsServiceFixture();
  submitter.completedAt = new Date('2026-01-02');
  template.fields = [
    { uuid: 'signature', name: 'Signed by', type: 'signature' },
  ];
  submitter.values = {
    signature: ['asset'],
    other: { nested: true },
    missing: 'unknown',
  };
  submitter.preferences = {
    default_values: { private: 'default' },
    send_email: false,
  };
  template.folder.parentFolder = Object.assign(new TemplateFolder(), {
    name: 'Parent',
  });
  const attachment = Object.assign(new StorageAttachment(), {
    id: 'file',
    uuid: 'asset',
    blob: Object.assign(new StorageBlob(), {
      filename: 'signed.pdf',
      contentType: 'application/pdf',
    }),
  });
  const preview = Object.assign(new StorageAttachment(), {
    id: 'preview',
    blob: Object.assign(new StorageBlob(), {
      filename: '0.png',
      metadata: null,
    }),
  });
  storage.findRecordAttachments.mockResolvedValue([attachment]);
  storage.findPreviewAttachmentsByRecordIds.mockResolvedValue(
    new Map([['file', [preview]]]),
  );
  documents.getSubmissionDocuments.mockResolvedValue([attachment]);
  submission.submissionEvents = [
    Object.assign(new SubmissionEvent(), {
      id: 'event',
      submitterId: '1',
      eventType: 'complete_form',
      eventTimestamp: new Date('2026-01-02'),
      data: { ip: '127.0.0.1' },
    }),
  ];
  const result = await service.getSubmission(user, 'submission', 'fields');
  expect(result).toMatchObject({
    status: 'completed',
    completed_at: submitter.completedAt,
    audit_log_url: 'https://files.example.test/audit.pdf',
    combined_document_url: 'https://files.example.test/combined.pdf',
    template: { folder_name: 'Parent / Contracts' },
    submitters: [
      {
        preferences: { send_email: false },
        values: [
          {
            field: 'Signed by',
            value: ['asset'],
            attachment: { uuid: 'asset', filename: 'signed.pdf' },
          },
          { field: 'other', value: { nested: true } },
          { field: 'missing', value: 'unknown' },
        ],
      },
    ],
    documents: [
      { id: 'file', name: 'signed', preview_images: [{ metadata: {} }] },
    ],
    submission_events: [{ id: 'event', event_type: 'complete_form' }],
  });
  expect(result.submitters[0].preferences).not.toHaveProperty('default_values');
  expect(storage.findPreviewAttachmentsByRecordIds).toHaveBeenCalledWith([
    'file',
  ]);
  expect(
    (await service.getSubmissionDocuments(user, 'submission', { merge: true }))
      .documents,
  ).toHaveLength(1);
  expect(documents.getSubmissionDocuments).toHaveBeenLastCalledWith(
    submission,
    { merge: true },
  );
});
it.each(['declined', 'expired', 'opened', 'sent', 'awaiting'])(
  'derives submission and signer statuses for %s signers',
  async (state) => {
    const { service, user, submitter, submission } =
      createSubmissionsServiceFixture();
    if (state === 'declined') submitter.declinedAt = new Date();
    if (state === 'expired') submission.expireAt = new Date('2020-01-01');
    if (state === 'opened') submitter.openedAt = new Date();
    if (state === 'sent') submitter.sentAt = new Date();
    const result = await service.getSubmission(user, 'submission');
    expect(result.status).toBe(
      ['declined', 'expired'].includes(state) ? state : 'pending',
    );
    expect(result.submitters[0].status).toBe(
      state === 'expired' ? 'awaiting' : state,
    );
    expect(result.audit_log_url).toBeNull();
  },
);
it('serializes missing optional template/user/submission relations without leaking values into list responses', async () => {
  const { service, user, submission } = createSubmissionsServiceFixture();
  submission.template = null;
  submission.templateId = null;
  submission.createdByUser = null;
  submission.variables = null;
  submission.submitters = undefined as unknown as Submitter[];
  submission.submissionEvents = undefined as unknown as SubmissionEvent[];
  expect(
    await service.getSubmission(user, 'submission', 'fields'),
  ).toMatchObject({
    template: null,
    created_by_user: null,
    variables: {},
    fields: [],
    submitters: [],
    submission_events: [],
  });
});
it('distinguishes testing-vs-production key mismatches while preserving tenant isolation', async () => {
  const { service, user, submissions, accounts, submission } =
    createSubmissionsServiceFixture();
  submissions.findOneOrFail.mockRejectedValue(
    new EntityNotFoundError(Submission, {}),
  );
  accounts.getTestingAccountContext.mockResolvedValueOnce({
    isTestMode: true,
    productionAccountId: 'production',
    testingAccountId: 'tenant',
  });
  await expect(service.getSubmission(user, 'submission')).rejects.toMatchObject(
    {
      status: 404,
      response: {
        error: expect.stringContaining('Use production API key') as unknown,
      },
    },
  );
  expect(submissions.findOne).toHaveBeenLastCalledWith({
    where: { accountId: 'production', id: 'submission' },
  });
  accounts.getTestingAccountContext.mockResolvedValueOnce({
    isTestMode: false,
    productionAccountId: 'tenant',
    testingAccountId: 'testing',
  });
  await expect(service.getSubmission(user, 'submission')).rejects.toMatchObject(
    {
      status: 404,
      response: {
        error: expect.stringContaining('Use testing API key') as unknown,
      },
    },
  );
  submissions.findOne.mockResolvedValue(null);
  await expect(service.getSubmission(user, 'missing')).rejects.toMatchObject({
    status: 404,
    response: { error: 'Submission not found' },
  });
  submissions.findOneOrFail.mockRejectedValue(
    new Error('database unavailable'),
  );
  await expect(service.getSubmission(user, submission.id)).rejects.toThrow(
    'database unavailable',
  );
});
it('returns persisted submission events using the public audit-log mapper', async () => {
  const { service, user, submission } = createSubmissionsServiceFixture();
  submission.submissionEvents = [
    Object.assign(new SubmissionEvent(), {
      id: 'event',
      submitterId: '1',
      eventType: 'view_form',
      eventTimestamp: new Date('2026-01-02'),
      data: { ip: '127.0.0.1' },
    }),
  ];
  expect(await service.getSubmissionEvents(user, 'submission')).toMatchObject({
    data: [
      { event_type: 'submission_created' },
      { event_type: 'view_form', actor: 'Signer', ip: '127.0.0.1' },
    ],
  });
});
