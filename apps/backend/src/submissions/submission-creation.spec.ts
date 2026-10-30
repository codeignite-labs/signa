import { createSubmissionsServiceFixture } from '../../test/support/submissions-service.fixture';
import { CreateSubmissionAliasDto } from './dto/create-submission.dto';
it('creates batch/array submissions with public embed links and first-role invitation events', async () => {
  const { service, user, submitters, events, templates } =
    createSubmissionsServiceFixture();
  const input = {
    template_id: 'template',
    submitters: [{ email: 'SIGNER@EXAMPLE.TEST' }],
  };
  const result = await service.createSubmission(user, {
    submissions: [input, input],
  });
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({
    role: 'Signer',
    email: 'signer@example.test',
    embed_src: expect.stringMatching(
      /^https:\/\/sign.example.test\/s\//,
    ) as unknown,
  });
  expect(submitters.create).toHaveBeenCalledWith(
    expect.objectContaining({
      accountId: 'tenant',
      submissionId: 'submission',
      preferences: { send_email: true, send_sms: false },
    }),
  );
  expect(templates.findOne).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'template', accountId: 'tenant' } }),
  );
  expect(events.emit).toHaveBeenCalledWith('submission.created', {
    accountId: 'tenant',
    submissionId: 'submission',
    templateId: 'template',
  });
  expect(await service.createSubmission(user, [input])).toHaveLength(1);
  await expect(service.createSubmission(user, [])).rejects.toMatchObject({
    status: 422,
  });
});
it('creates one submission per normalized unique email alias and shapes initialization responses by count', async () => {
  const { service, user } = createSubmissionsServiceFixture();
  const input: CreateSubmissionAliasDto = {
    template_id: 'template',
    emails: 'ONE@EXAMPLE.TEST; one@example.test, two@example.test',
  };
  expect(
    (await service.createSubmissionFromAlias(user, input)).map(
      (submitter) => submitter.email,
    ),
  ).toEqual(['one@example.test', 'two@example.test']);
  expect(
    await service.createSubmissionInit(user, {
      template_id: 'template',
      email: 'single@example.test',
    }),
  ).toMatchObject({
    id: 'submission',
    submitters: [{ email: 'single@example.test' }],
  });
  expect(
    await service.createSubmissionInit(user, {
      ...input,
      emails: ['one@example.test', 'two@example.test'],
    }),
  ).not.toHaveProperty('id');
  await expect(
    service.createSubmissionFromAlias(user, {}),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.createSubmissionFromAlias(user, { template_id: 'template' }),
  ).rejects.toMatchObject({ status: 422 });
});
it('uses explicit alias recipients rather than email expansion when submitters are supplied', async () => {
  const { service, user } = createSubmissionsServiceFixture();
  expect(
    await service.createSubmissionFromAlias(user, {
      template_id: 'template',
      email: 'unused@example.test',
      submitters: [{ name: 'Named signer', send_email: false }],
    }),
  ).toMatchObject([{ name: 'Named signer', email: null }]);
});
it('rejects missing, archived and empty templates before persisting submission data', async () => {
  const { service, user, template, templates, source } =
    createSubmissionsServiceFixture();
  const input = {
    template_id: 'template',
    submitters: [{ email: 'signer@example.test' }],
  };
  templates.findOne.mockResolvedValueOnce(null);
  await expect(service.createSubmission(user, input)).rejects.toMatchObject({
    status: 422,
  });
  template.archivedAt = new Date();
  await expect(service.createSubmission(user, input)).rejects.toMatchObject({
    status: 422,
  });
  template.archivedAt = null;
  template.fields = [];
  await expect(service.createSubmission(user, input)).rejects.toMatchObject({
    status: 422,
  });
  expect(source.transaction).not.toHaveBeenCalled();
});
it('rejects empty/unresolvable recipients, too many signing parties and non-existent merged roles', async () => {
  const { service, user } = createSubmissionsServiceFixture();
  await expect(
    service.createSubmission(user, {
      template_id: 'template',
      submitters: [{}],
    }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.createSubmission(user, {
      template_id: 'template',
      submitters: [{ email: 'signer@example.test', index: 99 }],
    }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.createSubmission(user, {
      template_id: 'template',
      submitters: [
        { email: 'one@example.test', role: 'Signer' },
        { email: 'two@example.test', role: 'Signer' },
      ],
    }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.createSubmission(user, {
      template_id: 'template',
      submitters: [
        { email: 'signer@example.test', roles: ['Signer', 'Unknown'] },
      ],
    }),
  ).rejects.toMatchObject({ status: 422 });
});
it('snapshots field configuration with UUID/name value overrides, readonly options and recipient message precedence', async () => {
  const { service, user, template, submissions, submitters } =
    createSubmissionsServiceFixture();
  template.fields = [
    {
      uuid: 'field',
      name: 'Full name',
      type: 'text',
      submitter_uuid: 'party',
      default_value: 'Old',
      title: 'Old title',
      description: 'Old description',
      preferences: { old: true },
    },
    {
      uuid: 'clear',
      name: 'Clear field',
      type: 'text',
      submitter_uuid: 'party',
      default_value: 'Clear me',
    },
    { uuid: 'unmodified', type: 'text', submitter_uuid: 'party' },
    { uuid: 'other', submitter_uuid: 'other' },
  ];
  await service.createSubmission(user, {
    template_id: 'template',
    name: 'Custom',
    variables: { tenant: 'variable' },
    expire_at: '2026-12-01',
    order: 'random',
    send_email: false,
    send_sms: true,
    bcc_completed: 'copy@example.test',
    completed_redirect_url: 'https://example.test/done',
    reply_to: 'reply@example.test',
    message: { subject: 'Global subject', body: 'Global body' },
    submitters: [
      {
        uuid: 'party',
        name: 'Name',
        phone: '+1 (555) 123-4567',
        application_key: 'external-alias',
        readonly_fields: ['full NAME'],
        values: { field: 'New value', clear: '' },
        fields: [
          {
            name: 'Full name',
            title: 'Updated title',
            description: 'Updated description',
            required: false,
            readonly: true,
            preferences: { next: true },
          },
          { uuid: 'clear', default_value: '' },
        ],
        metadata: { external: true },
        preferences: { custom: true },
        completed_redirect_url: 'https://recipient.example.test/done',
        reply_to: 'recipient@example.test',
        message: { subject: 'Recipient subject' },
        use_saved_signature: true,
        completed_by_user_id: 'owner',
      },
    ],
  });
  expect(submissions.create).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Custom',
      submittersOrder: 'random',
      variables: { tenant: 'variable' },
      expireAt: new Date('2026-12-01'),
      preferences: {
        send_email: false,
        send_sms: true,
        bcc_completed: 'copy@example.test',
        completed_redirect_url: 'https://example.test/done',
        reply_to: 'reply@example.test',
      },
      templateFields: expect.arrayContaining([
        expect.objectContaining({
          uuid: 'field',
          default_value: 'New value',
          title: 'Updated title',
          description: 'Updated description',
          required: false,
          readonly: true,
          preferences: { old: true, next: true },
        }),
      ]) as unknown,
    }),
  );
  const created = submissions.create.mock.calls[0][0];
  expect(
    created.templateFields?.find((field) => field.uuid === 'clear'),
  ).not.toHaveProperty('default_value');
  expect(submitters.create).toHaveBeenCalledWith(
    expect.objectContaining({
      phone: '+15551234567',
      externalId: 'external-alias',
      metadata: { external: true },
      preferences: expect.objectContaining({
        request_email_subject: 'Recipient subject',
        custom: true,
        use_saved_signature: true,
        completed_by_user_id: 'owner',
        reply_to: 'recipient@example.test',
        send_email: false,
        send_sms: true,
      }) as unknown,
    }),
  );
});
it('processes initially completed signers and emits form/submission completion without sending invitations', async () => {
  const { service, user, documents, queue, eventRecords, events } =
    createSubmissionsServiceFixture();
  await service.createSubmission(user, {
    template_id: 'template',
    submitters: [
      {
        email: 'signer@example.test',
        completed: true,
        values: { field: 'Completed' },
      },
    ],
  });
  expect(documents.processSubmitterCompletion).toHaveBeenCalledTimes(1);
  expect(queue.enqueueSubmitterCompletion).toHaveBeenCalledWith('1');
  expect(eventRecords.create).toHaveBeenCalledWith(
    expect.objectContaining({ eventType: 'api_complete_form' }),
  );
  expect(events.emit).toHaveBeenCalledWith(
    'form.completed',
    expect.any(Object),
  );
  expect(events.emit).toHaveBeenCalledWith(
    'submission.completed',
    expect.any(Object),
  );
  expect(events.emit).not.toHaveBeenCalledWith(
    'submitter.invitation.requested',
    expect.any(Object),
  );
});
it('merges role fields deterministically, combining duplicate names and rewriting role links while preserving unrelated fields', async () => {
  const { service, user, template, submissions } =
    createSubmissionsServiceFixture();
  template.submitters = [
    { uuid: 'first', name: 'First', linked_to_uuid: 'second' },
    { uuid: 'second', name: 'Second' },
    {
      uuid: 'third',
      name: 'Third',
      invite_by_uuid: 'first',
      optional_invite_by_uuid: 'second',
      linked_to_uuid: 'first',
      invite_via_field_uuid: 'field',
    },
  ];
  template.fields = [
    {
      uuid: 'one',
      name: 'Shared',
      submitter_uuid: 'first',
      areas: [{ page: 0 }],
    },
    {
      uuid: 'two',
      name: 'Shared',
      submitter_uuid: 'second',
      areas: [{ page: 1 }],
    },
    { uuid: 'unnamed', submitter_uuid: 'second' },
    { uuid: 'third', submitter_uuid: 'third' },
    { uuid: 'global' },
  ];
  const result = await service.createSubmission(user, {
    template_id: 'template',
    submitters: [
      {
        email: 'merged@example.test',
        role: 'Merged signer',
        roles: ['First', 'Second'],
      },
      { email: 'third@example.test', role: 'Third' },
    ],
  });
  expect(result.map((submitter) => submitter.role)).toEqual([
    'Merged signer',
    'Third',
  ]);
  const created = submissions.create.mock.calls[0][0];
  expect(created.templateFields).toHaveLength(4);
  expect(
    created.templateFields?.find((field) => field.name === 'Shared')?.areas,
  ).toHaveLength(2);
  const merged = created.templateSubmitters?.[0];
  expect(merged?.uuid).toMatch(
    /^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
  );
  expect(merged).not.toHaveProperty('linked_to_uuid');
  expect(created.templateSubmitters?.[1]).toMatchObject({
    linked_to_uuid: merged?.uuid,
  });
  expect(created.templateSubmitters?.[1]).not.toHaveProperty('invite_by_uuid');
});
it('generates missing template role UUIDs and respects recipient/default field overrides without mutating the template', async () => {
  const { service, user, template, submissions } =
    createSubmissionsServiceFixture();
  template.submitters = [{ name: 'Signer' }];
  const result = await service.createSubmission(user, {
    template_id: 'template',
    variables: {},
    submitters: [{ email: 'signer@example.test', roles: ['Signer'] }],
  });
  expect(result[0].uuid).toMatch(/^[\da-f-]{36}$/);
  expect(template.submitters[0].uuid).toBeUndefined();
  expect(submissions.create.mock.calls[0][0].templateFields).toBeTruthy();
});
