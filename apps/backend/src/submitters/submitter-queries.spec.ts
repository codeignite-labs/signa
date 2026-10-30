import { EntityNotFoundError } from 'typeorm';
import { createSubmittersServiceFixture } from '../../test/support/submitters-service.fixture';
import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageBlob } from '../storage/entities/storage-blob.entity';
import { SubmissionEvent } from '../submissions/entities/submission-event.entity';
import { Submitter } from './entities/submitter.entity';
function attachment(uuid: string, filename: string): StorageAttachment {
  return Object.assign(new StorageAttachment(), {
    uuid,
    blob: Object.assign(new StorageBlob(), { filename }),
  });
}
it('combines search, dates, tenant, template, alias and cursor filters and caps the result limit', async () => {
  const { service, user, submitter, submitterQuery } =
    createSubmittersServiceFixture();
  submitterQuery.getMany.mockResolvedValue([submitter]);
  const result = await service.listSubmitters(user, {
    q: 'Ada',
    submission_id: 'submission',
    slug: 'slug',
    completed_after: '2026-01-01',
    completed_before: '2026-02-01',
    application_key: 'alias',
    external_id: 'ignored',
    template_id: 'template',
    after: '30',
    before: '10',
    limit: 1000,
    include: ' fields , other ',
  });
  expect(submitterQuery.where).toHaveBeenCalledWith(
    'submitter.account_id = :accountId',
    { accountId: 'tenant' },
  );
  expect(submitterQuery.orWhere).toHaveBeenCalledWith(
    'submitter.phone ILIKE :q',
    { q: '%Ada%' },
  );
  expect(submitterQuery.andWhere).toHaveBeenCalledWith(
    'submitter.external_id = :externalId',
    { externalId: 'alias' },
  );
  expect(submitterQuery.andWhere).toHaveBeenCalledWith(
    'submitter.completed_at >= :completedAfter',
    { completedAfter: new Date('2026-01-01') },
  );
  expect(submitterQuery.andWhere).toHaveBeenCalledWith(
    'submitter.id >= :before',
    { before: '11' },
  );
  expect(submitterQuery.limit).toHaveBeenCalledWith(100);
  expect(result.pagination).toEqual({
    count: 1,
    next: submitter.id,
    prev: submitter.id,
  });
  expect(result.data[0].fields).toHaveLength(1);
});
it('returns empty pagination and filters an external id when no application alias is present', async () => {
  const { service, user, submitterQuery } = createSubmittersServiceFixture();
  expect(
    await service.listSubmitters(user, { external_id: 'external' }),
  ).toEqual({ data: [], pagination: { count: 0, next: null, prev: null } });
  expect(submitterQuery.andWhere).toHaveBeenCalledWith(
    'submitter.external_id = :externalId',
    { externalId: 'external' },
  );
  expect(submitterQuery.limit).toHaveBeenCalledWith(10);
});
it.each(['completed', 'declined', 'opened', 'sent', 'awaiting'])(
  'serializes %s lifecycle state while withholding private event data and default preferences',
  async (status) => {
    const { service, user, submitter, documents } =
      createSubmittersServiceFixture();
    if (status !== 'awaiting')
      Object.assign(submitter, { [`${status}At`]: new Date() });
    submitter.preferences = {
      default_values: { private: true },
      go_to_last: true,
    };
    submitter.submissionEvents = [
      Object.assign(new SubmissionEvent(), {
        id: 'event',
        submitterId: submitter.id,
        eventType: 'verify',
        eventTimestamp: new Date(),
        data: { method: 'email', ip: 'private', secret: 'private' },
      }),
    ];
    const response = await service.getSubmitter(user, submitter.id);
    expect(response.status).toBe(status);
    expect(response.preferences).toEqual({ go_to_last: true });
    expect(response.submission_events?.[0].data).toEqual({ method: 'email' });
    expect(documents.processSubmitterCompletion).toHaveBeenCalledTimes(
      status === 'completed' ? 1 : 0,
    );
  },
);
it('serializes generated completed documents before falling back to template documents and snapshot schema names', async () => {
  const { service, user, submitter, submission, storage } =
    createSubmittersServiceFixture();
  submitter.completedAt = new Date();
  storage.findRecordAttachments.mockResolvedValueOnce([
    attachment('result', 'Final.signed.pdf'),
  ]);
  expect((await service.getSubmitter(user, submitter.id)).documents).toEqual([
    {
      name: 'Final.signed',
      url: 'https://files.example.test/Final.signed.pdf',
    },
  ]);
  submission.templateSchema = [
    { attachment_uuid: 'original', name: 'Snapshot title' },
  ];
  storage.findRecordAttachments
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([attachment('original', 'Original.pdf')]);
  expect((await service.getSubmitter(user, submitter.id)).documents).toEqual([
    { name: 'Snapshot title', url: 'https://files.example.test/Original.pdf' },
  ]);
});
it('handles detached templates and unknown field names without leaking another submitter fields', async () => {
  const { service, user, submitter, submission } =
    createSubmittersServiceFixture();
  submission.template = null;
  submission.templateId = null;
  submission.templateFields = null;
  submission.templateSubmitters = null;
  submitter.values = { unknown: 'saved' };
  expect(
    await service.getSubmitter(user, submitter.id, 'fields'),
  ).toMatchObject({
    role: '',
    values: [{ field: 'unknown', value: 'saved' }],
    documents: [],
    metadata: {},
    preferences: {},
    fields: [],
    submission_events: [],
  });
});
it('maps missing tenant-scoped lookups to 404', async () => {
  const { service, user, repository } = createSubmittersServiceFixture();
  repository.findOneOrFail.mockRejectedValue(
    new EntityNotFoundError(Submitter, { id: 'missing' }),
  );
  await expect(service.getSubmitter(user, 'missing')).rejects.toMatchObject({
    status: 404,
  });
  expect(repository.findOneOrFail.mock.calls[0][0]).toMatchObject({
    where: { id: 'missing', accountId: 'tenant' },
  });
});
