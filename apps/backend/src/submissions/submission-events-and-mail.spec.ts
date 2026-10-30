import { createSubmissionsServiceFixture } from '../../test/support/submissions-service.fixture';
import { EmailMessage } from '../mail/entities/email-message.entity';
import { Submitter } from '../submitters/entities/submitter.entity';
it('returns form-completion events with timestamp pagination, tenant filtering and bounded limits', async () => {
  const { service, user, submitter, submitterQuery } =
    createSubmissionsServiceFixture();
  submitter.completedAt = new Date('2026-01-02');
  submitterQuery.getMany.mockResolvedValue([submitter]);
  const result = await service.listFormEvents(user, 'completed', {
    after: '1767312000',
    before: '1767225600',
    limit: '1000',
  });
  expect(result).toMatchObject({
    data: [
      {
        event_type: 'form.completed',
        timestamp: submitter.completedAt,
        data: { id: '1', role: 'Signer' },
      },
    ],
    pagination: {
      count: 1,
      next: Math.floor(submitter.completedAt.getTime() / 1000),
      prev: Math.floor(submitter.completedAt.getTime() / 1000),
    },
  });
  expect(submitterQuery.where).toHaveBeenCalledWith(
    'submitter.account_id = :accountId',
    { accountId: 'tenant' },
  );
  expect(submitterQuery.andWhere).toHaveBeenCalledWith(
    'submitter.completed_at < :afterCompletedAt',
    { afterCompletedAt: new Date(1767312000000) },
  );
  expect(submitterQuery.andWhere).toHaveBeenCalledWith(
    'submitter.completed_at > :beforeCompletedAt',
    { beforeCompletedAt: new Date(1767225600000) },
  );
  expect(submitterQuery.limit).toHaveBeenCalledWith(100);
  submitterQuery.getMany.mockResolvedValue([]);
  expect(
    (
      await service.listFormEvents(user, 'completed', {
        after: 'invalid',
        before: 'invalid',
        limit: 'invalid',
      })
    ).pagination,
  ).toEqual({ count: 0, next: null, prev: null });
  expect(submitterQuery.limit).toHaveBeenLastCalledWith(10);
});
it('returns completed-submission feeds with raw SQL completion timestamps and timestamp fallback', async () => {
  const { service, user, submission, submissionQuery } =
    createSubmissionsServiceFixture();
  const completed = new Date('2026-01-03');
  submissionQuery.getRawAndEntities.mockResolvedValue({
    entities: [submission, submission, submission, submission],
    raw: [
      { completed_at_cursor: completed },
      { completed_at_cursor: completed.toISOString() },
      { completed_at_cursor: 'invalid-date' },
      { completed_at_cursor: null },
    ],
  });
  const result = await service.listSubmissionEvents(user, 'completed', {
    after: '1767312000',
    before: '1767225600',
  });
  expect(result.data.map((event) => event.timestamp)).toEqual([
    completed,
    completed,
    submission.updatedAt,
    submission.updatedAt,
  ]);
  expect(result.data[0]).toMatchObject({
    event_type: 'submission.completed',
    data: { id: 'submission' },
  });
  expect(result.pagination).toEqual({
    count: 4,
    next: Math.floor(completed.getTime() / 1000),
    prev: Math.floor(completed.getTime() / 1000),
  });
  expect(submissionQuery.addSelect).toHaveBeenCalledWith(
    expect.stringContaining('MAX(event_submitter.completed_at)'),
    'completed_at_cursor',
  );
  submissionQuery.getRawAndEntities.mockResolvedValue({
    entities: [],
    raw: [],
  });
  expect(
    (await service.listSubmissionEvents(user, 'completed', {})).pagination,
  ).toEqual({ count: 0, next: null, prev: null });
});
it('serializes internal webhook payloads and archived records, while returning missing records explicitly', async () => {
  const { service, submitter, submission, submitters, submissions } =
    createSubmissionsServiceFixture();
  expect(await service.getSubmitterWebhookPayload('1')).toMatchObject({
    id: '1',
    submission_id: 'submission',
    role: 'Signer',
    status: 'awaiting',
    metadata: {},
  });
  expect(await service.getSubmissionWebhookPayload('submission')).toMatchObject(
    { id: 'submission', submitters: [{ id: '1' }] },
  );
  submission.archivedAt = new Date();
  expect(
    await service.getSubmissionArchiveWebhookPayload('submission'),
  ).toEqual({ id: 'submission', archived_at: submission.archivedAt });
  expect(submissions.findOne).toHaveBeenLastCalledWith({
    where: { id: 'submission' },
    withDeleted: true,
  });
  submitters.findOne.mockResolvedValue(null);
  submissions.findOne.mockResolvedValue(null);
  await expect(
    service.getSubmitterWebhookPayload(submitter.id),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service.getSubmissionWebhookPayload('missing'),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service.getSubmissionArchiveWebhookPayload('missing'),
  ).rejects.toMatchObject({ status: 404 });
});
it('finds the latest tenant-completed signer and emits expiration events for selected pending submissions', async () => {
  const {
    service,
    submitter,
    submission,
    submitterQuery,
    submissionQuery,
    events,
  } = createSubmissionsServiceFixture();
  submitterQuery.getOne.mockResolvedValue(submitter);
  expect(await service.findLatestCompletedSubmitter('tenant')).toBe(submitter);
  expect(submitterQuery.where).toHaveBeenCalledWith(
    'submitter.account_id = :accountId',
    { accountId: 'tenant' },
  );
  expect(submitterQuery.andWhere).toHaveBeenCalledWith(
    'submitter.completed_at IS NOT NULL',
  );
  submissionQuery.getMany.mockResolvedValue([submission]);
  expect(await service.emitExpiredSubmissionEvents()).toBe(1);
  expect(submissionQuery.limit).toHaveBeenCalledWith(100);
  expect(events.emit).toHaveBeenCalledWith('submission.expired', {
    accountId: 'tenant',
    submissionId: 'submission',
    templateId: 'template',
  });
  submissionQuery.getMany.mockResolvedValue([]);
  expect(await service.emitExpiredSubmissionEvents(5)).toBe(0);
});
it('resends only pending non-archived email recipients and reports zero-candidate requests clearly', async () => {
  const { service, user, submitter, submission, events } =
    createSubmissionsServiceFixture();
  submission.submitters.push(
    { ...submitter, id: 'completed', completedAt: new Date() },
    { ...submitter, id: 'declined', declinedAt: new Date() },
    { ...submitter, id: 'no-email', email: null },
    { ...submitter, id: 'disabled', preferences: { send_email: false } },
  );
  expect(await service.resendSubmissionEmail(user, 'submission')).toEqual({
    count: 1,
    message: 'Email queued',
  });
  expect(events.emit).toHaveBeenCalledTimes(1);
  expect(events.emit).toHaveBeenCalledWith('submitter.invitation.requested', {
    accountId: 'tenant',
    submitterId: '1',
  });
  submission.archivedAt = new Date();
  expect(await service.resendSubmissionEmail(user, 'submission')).toEqual({
    count: 0,
    message: 'Email has been sent already',
  });
  submission.submitters = undefined as unknown as Submitter[];
  expect((await service.resendSubmissionEmail(user, 'submission')).count).toBe(
    0,
  );
});
it('resends a single account-scoped signer and refuses missing or archived candidates', async () => {
  const { service, user, submitter, submitters, template } =
    createSubmissionsServiceFixture();
  expect(await service.sendSubmitterEmail(user, '1')).toEqual({
    count: 1,
    message: 'Email queued',
  });
  expect(submitters.findOne).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: '1', accountId: 'tenant' } }),
  );
  template.archivedAt = new Date();
  expect((await service.sendSubmitterEmail(user, '1')).count).toBe(0);
  submitters.findOne.mockResolvedValue(null);
  await expect(
    service.sendSubmitterEmail(user, submitter.id),
  ).rejects.toMatchObject({ status: 422 });
});
it.each([
  [
    { submitterSlug: 'signer-slug' },
    'submitter.slug = :submitterSlug',
    { submitterSlug: 'signer-slug' },
  ],
  [
    { submissionSlug: 'submission-slug', email: ' SIGNER@EXAMPLE.TEST ' },
    'submission.slug = :submissionSlug',
    { submissionSlug: 'submission-slug' },
  ],
  [
    { templateSlug: 'template-slug', email: ' SIGNER@EXAMPLE.TEST ' },
    'template.slug = :templateSlug',
    { templateSlug: 'template-slug' },
  ],
])(
  'queues completed document copies using a validated completed-signer lookup (%s)',
  async (input, condition, parameters) => {
    const { service, submitter, submitterQuery, events } =
      createSubmissionsServiceFixture();
    submitterQuery.getOne.mockResolvedValue(submitter);
    expect(await service.sendCompletedSubmissionEmail(input)).toEqual({
      count: 1,
      message: 'Email queued',
    });
    expect(submitterQuery.where).toHaveBeenCalledWith(
      'submitter.completed_at IS NOT NULL',
    );
    expect(submitterQuery.andWhere).toHaveBeenCalledWith(condition, parameters);
    if ('email' in input)
      expect(submitterQuery.andWhere).toHaveBeenCalledWith(
        'LOWER(submitter.email) = :email',
        { email: 'signer@example.test' },
      );
    expect(events.emit).toHaveBeenCalledWith(
      'submitter.documents-copy.requested',
      { accountId: 'tenant', submitterId: '1' },
    );
  },
);
it('rejects completed-copy requests without valid recipient selectors or a completed signer', async () => {
  const { service } = createSubmissionsServiceFixture();
  await expect(service.sendCompletedSubmissionEmail({})).rejects.toMatchObject({
    status: 422,
  });
  await expect(
    service.sendCompletedSubmissionEmail({ submitterSlug: 'unknown' }),
  ).rejects.toMatchObject({ status: 422 });
});
it('returns bounded tenant-scoped email delivery history with provider errors and retry metadata', async () => {
  const { service, user, emailMessages } = createSubmissionsServiceFixture();
  emailMessages.find.mockResolvedValue([
    Object.assign(new EmailMessage(), {
      id: 'message',
      template: 'submitter-invitation',
      subject: 'Invitation',
      recipients: 'signer@example.test',
      status: 'failed',
      messageId: 'provider',
      submitterId: '1',
      attempt: 2,
      jobId: 'job',
      lastErrorMessage: 'provider unavailable',
      providerResponse: '503',
    }),
  ]);
  expect(
    await service.listSubmissionMailEvents(user, 'submission'),
  ).toMatchObject({
    data: [
      {
        id: 'message',
        template: 'submitter-invitation',
        message_id: 'provider',
        submitter_id: '1',
        attempt: 2,
        job_id: 'job',
        last_error_message: 'provider unavailable',
        provider_response: '503',
      },
    ],
  });
  expect(emailMessages.find).toHaveBeenCalledWith({
    where: { accountId: 'tenant', submissionId: 'submission' },
    order: { createdAt: 'DESC', id: 'DESC' },
    take: 100,
  });
});
it('permanently removes submissions only when requested and propagates archive/remove failures', async () => {
  const { service, user, submission, submissions, events } =
    createSubmissionsServiceFixture();
  expect(
    await service.deleteSubmission(user, 'submission', { permanently: true }),
  ).toEqual({ id: 'submission', archived_at: null });
  expect(submissions.remove).toHaveBeenCalledWith(submission);
  expect(events.emit).not.toHaveBeenCalled();
  submissions.remove.mockRejectedValue(new Error('delete failed'));
  await expect(
    service.deleteSubmission(user, 'submission', { permanently: true }),
  ).rejects.toThrow('delete failed');
  submissions.save.mockRejectedValue(new Error('archive failed'));
  await expect(
    service.deleteSubmission(user, 'submission', {}),
  ).rejects.toThrow('archive failed');
});
