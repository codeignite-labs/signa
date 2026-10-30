import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageBlob } from '../storage/entities/storage-blob.entity';
import { EntityNotFoundError } from 'typeorm';
import { createSubmissionsServiceFixture } from '../../test/support/submissions-service.fixture';
import { Submitter } from '../submitters/entities/submitter.entity';
import { Submission } from './entities/submission.entity';
it('preserves explicit recipient order and submission ordering while applying a nonblank field default override', async () => {
  const fixture = createSubmissionsServiceFixture();
  await fixture.service.createSubmission(fixture.user, {
    template_id: 'template',
    submitters_order: 'random',
    submitters: [
      {
        email: 'casey@example.test',
        order: 2,
        fields: [{ uuid: 'field', default_value: 'Casey' }],
      },
    ],
  });
  expect(fixture.submissions.create).toHaveBeenCalledWith(
    expect.objectContaining({
      submittersOrder: 'random',
      templateSubmitters: [{ uuid: 'party', name: 'Signer', order: 2 }],
    }),
  );
  expect(
    fixture.submissions.create.mock.calls[0][0].templateFields?.[0]
      .default_value,
  ).toBe('Casey');
});
it('completes only initially finished parties and leaves remaining parties pending', async () => {
  const fixture = createSubmissionsServiceFixture();
  fixture.template.submitters = [
    { uuid: 'first', name: 'First' },
    { uuid: 'second', name: 'Second' },
  ];
  await fixture.service.createSubmission(fixture.user, {
    template_id: 'template',
    submitters: [
      { role: 'First', email: 'one@example.test', completed: true },
      { role: 'Second', email: 'two@example.test' },
    ],
  });
  expect(fixture.documents.processSubmitterCompletion).toHaveBeenCalledTimes(1);
  expect(fixture.events.emit).toHaveBeenCalledWith(
    'form.completed',
    expect.anything(),
  );
  expect(fixture.events.emit).not.toHaveBeenCalledWith(
    'submission.completed',
    expect.anything(),
  );
});
it('merges named role fields without area arrays and derives the combined role name', async () => {
  const fixture = createSubmissionsServiceFixture();
  fixture.template.submitters = [
    { uuid: 'first', name: 'First' },
    { uuid: 'second', name: 'Second' },
  ];
  fixture.template.fields = [
    { uuid: 'one', name: 'Shared', submitter_uuid: 'first' },
    { uuid: 'two', name: 'Shared', submitter_uuid: 'second' },
  ];
  const result = await fixture.service.createSubmission(fixture.user, {
    template_id: 'template',
    submitters: [{ email: 'casey@example.test', roles: ['First', 'Second'] }],
  });
  expect(result[0].role).toBe('First / Second');
  expect(
    fixture.submissions.create.mock.calls[0][0].templateFields,
  ).toHaveLength(1);
  expect(
    fixture.submissions.create.mock.calls[0][0].templateFields?.[0].areas,
  ).toEqual([]);
});
it('returns a generic 404 when a test account has no matching production submission either', async () => {
  const fixture = createSubmissionsServiceFixture();
  fixture.submissions.findOneOrFail.mockRejectedValue(
    new EntityNotFoundError(Submission, {}),
  );
  fixture.submissions.findOne.mockResolvedValue(null);
  fixture.accounts.getTestingAccountContext.mockResolvedValue({
    isTestMode: true,
    productionAccountId: 'production',
    testingAccountId: 'tenant',
  });
  await expect(
    fixture.service.getSubmission(fixture.user, 'missing'),
  ).rejects.toMatchObject({ response: { error: 'Submission not found' } });
  expect(fixture.submissions.findOne).toHaveBeenCalledWith({
    where: { accountId: 'production', id: 'missing' },
  });
});
it('selects the latest completion timestamp for multiparty submissions regardless of relation order', async () => {
  const fixture = createSubmissionsServiceFixture();
  fixture.submitter.completedAt = new Date('2026-10-31');
  fixture.submission.submitters.push(
    Object.assign(new Submitter(), fixture.submitter, {
      id: 'earlier',
      completedAt: new Date('2026-10-30'),
    }),
  );
  expect(
    (await fixture.service.getSubmission(fixture.user, 'submission'))
      .completed_at,
  ).toEqual(new Date('2026-10-31'));
});
it('serializes detached roles, unknown values and empty attachment selections in webhook payloads', async () => {
  const fixture = createSubmissionsServiceFixture();
  fixture.submission.template = null;
  fixture.submission.templateFields = null;
  fixture.submission.templateSubmitters = null;
  fixture.submitter.metadata = undefined as never;
  fixture.submitter.values = {
    empty_file: [],
    unresolved_file: ['removed-asset'],
    unknown: 'stored',
    complex: { accepted: true },
  };
  const payload = await fixture.service.getSubmitterWebhookPayload(
    fixture.submitter.id,
  );
  expect(payload).toMatchObject({
    role: '',
    values: [
      { field: 'empty_file', value: [] },
      { field: 'unresolved_file', value: ['removed-asset'] },
      { field: 'unknown', value: 'stored' },
      { field: 'complex', value: { accepted: true } },
    ],
  });
});
it('persists a recipient-specific email body without inventing a subject override', async () => {
  const fixture = createSubmissionsServiceFixture();
  await fixture.service.createSubmission(fixture.user, {
    template_id: 'template',
    submitters: [
      {
        email: 'casey@example.test',
        message: { body: 'Please sign this agreement.' },
      },
    ],
  });
  expect(fixture.submitters.create).toHaveBeenCalledWith(
    expect.objectContaining({
      preferences: expect.objectContaining({
        message: { body: 'Please sign this agreement.' },
        request_email_body: 'Please sign this agreement.',
      }) as unknown,
    }),
  );
  expect(
    fixture.submitters.create.mock.calls[0][0].preferences,
  ).not.toHaveProperty('request_email_subject');
});
it('returns a generic missing-record error when the linked testing account has no matching record', async () => {
  const fixture = createSubmissionsServiceFixture();
  fixture.submissions.findOneOrFail.mockRejectedValue(
    new EntityNotFoundError(Submission, {}),
  );
  fixture.submissions.findOne.mockResolvedValue(null);
  fixture.accounts.getTestingAccountContext.mockResolvedValue({
    isTestMode: false,
    productionAccountId: 'tenant',
    testingAccountId: 'testing',
  });
  await expect(
    fixture.service.getSubmission(fixture.user, 'missing'),
  ).rejects.toMatchObject({ response: { error: 'Submission not found' } });
  expect(fixture.submissions.findOne).toHaveBeenCalledWith({
    where: { accountId: 'testing', id: 'missing' },
  });
});
it('returns generated document metadata while page previews are still unavailable', async () => {
  const fixture = createSubmissionsServiceFixture();
  const attachment = Object.assign(new StorageAttachment(), {
    id: 'generated',
    uuid: 'generated',
    blob: Object.assign(new StorageBlob(), {
      filename: 'Agreement.pdf',
      metadata: {},
    }),
  });
  fixture.documents.getSubmissionDocuments.mockResolvedValue([attachment]);
  const result = await fixture.service.getSubmission(
    fixture.user,
    fixture.submission.id,
  );
  expect(result.documents).toMatchObject([
    { id: 'generated', name: 'Agreement', preview_images: [] },
  ]);
  expect(
    fixture.storage.findPreviewAttachmentsByRecordIds,
  ).toHaveBeenCalledWith(['generated']);
});
