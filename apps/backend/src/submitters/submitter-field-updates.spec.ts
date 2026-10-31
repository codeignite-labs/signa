import { createSubmittersServiceFixture } from '../../test/support/submitters-service.fixture';
import { TemplateField } from '../templates/types/template-json';
it('updates role-scoped field snapshots and clears defaults while preserving source templates and other roles', async () => {
  const { service, user, submitter, template, submission } =
    createSubmittersServiceFixture();
  template.fields = [
    {
      uuid: 'first',
      name: 'Full Name',
      submitter_uuid: 'party',
      default_value: 'old',
      preferences: { keep: true },
    },
    {
      uuid: 'second',
      name: 'Approval',
      submitter_uuid: 'party',
      default_value: 'old',
    },
    {
      uuid: 'other',
      name: 'Full Name',
      submitter_uuid: 'other',
      default_value: 'untouched',
    },
  ];
  submission.templateFields = null;
  await service.updateSubmitter(
    user,
    submitter.id,
    {
      readonly_fields: ['full name'],
      fields: [
        {
          name: 'full name',
          title: 'New title',
          description: 'Description',
          required: false,
          preferences: { added: true },
          default_value: '',
        },
        { uuid: 'second', default_value: null },
      ],
    },
    'fields',
  );
  expect(submission.templateFields).toEqual([
    expect.objectContaining({
      uuid: 'first',
      title: 'New title',
      description: 'Description',
      readonly: true,
      required: false,
      preferences: { keep: true, added: true },
    }),
    expect.objectContaining({ uuid: 'second' }),
    expect.objectContaining({ uuid: 'other', default_value: 'untouched' }),
  ]);
  expect(submission.templateFields?.[0]).not.toHaveProperty('default_value');
  expect(submission.templateFields?.[1]).not.toHaveProperty('default_value');
  expect(template.fields[0].default_value).toBe('old');
});
it('normalizes contact fields and preferences and gives external_id precedence over its alias', async () => {
  const { service, user, submitter, template, events } =
    createSubmittersServiceFixture();
  template.fields = [
    { uuid: 'phone', name: 'Phone', type: 'phone', submitter_uuid: 'party' },
  ];
  const result = await service.updateSubmitter(user, submitter.id, {
    email: ' NAME@EXAMPLE.TEST ',
    name: 'New name',
    values: { phone: '+254 (700) 123-456' },
    application_key: 'alias',
    external_id: 'external',
    send_sms: true,
    send_email: true,
    require_phone_2fa: true,
    require_email_2fa: false,
    reply_to: 'reply@example.test',
    go_to_last: true,
    completed_redirect_url: 'https://example.test/done',
    metadata: { source: 'crm' },
  });
  expect(submitter).toMatchObject({
    email: 'name@example.test',
    phone: '+254700123456',
    name: 'New name',
    externalId: 'external',
    metadata: { source: 'crm' },
    values: {},
  });
  expect(submitter.preferences).toMatchObject({
    require_phone_2fa: true,
    require_email_2fa: false,
    send_sms: true,
    send_email: true,
  });
  expect(result.embed_src).toContain('/s/');
  expect(events.emit).toHaveBeenCalledTimes(1);
});
it.each(['not_equals', 'contains', 'not_contains', 'equals'])(
  'removes hidden conditional values at API completion using %s',
  async (operation) => {
    const { service, user, submitter, template, documents, eventRecords } =
      createSubmittersServiceFixture();
    template.fields = [
      {
        uuid: 'source',
        type: 'text',
        submitter_uuid: 'party',
        default_value: 'matching-value',
      },
      {
        uuid: 'hidden',
        type: 'text',
        submitter_uuid: 'party',
        default_value: 'secret',
        conditions: [
          {
            action: 'hide',
            field_uuid: 'source',
            operation,
            value:
              operation === 'equals'
                ? 'matching-value'
                : operation === 'contains'
                  ? 'value'
                  : 'absent',
          },
        ],
      },
      {
        uuid: 'date',
        type: 'date',
        submitter_uuid: 'party',
        default_value: '{{current_date}}',
      },
      { uuid: 'other', submitter_uuid: 'other', default_value: 'not ours' },
    ];
    await service.updateSubmitter(user, submitter.id, { completed: true });
    expect(submitter.values).toEqual({
      source: 'matching-value',
      date: new Date().toISOString().slice(0, 10),
    });
    expect(documents.processSubmitterCompletion).toHaveBeenCalledWith(
      submitter,
    );
    expect(eventRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'api_complete_form',
        accountId: 'tenant',
      }),
    );
  },
);
it('keeps visible values when conditions lack references or do not match, including object/boolean values', async () => {
  const { service, user, submitter, template } =
    createSubmittersServiceFixture();
  template.fields = [
    {
      uuid: 'object',
      submitter_uuid: 'party',
      default_value: { accepted: true },
    },
    { uuid: 'boolean', submitter_uuid: 'party', default_value: false },
    {
      uuid: 'no-reference',
      submitter_uuid: 'party',
      default_value: 'keep',
      conditions: [{ action: 'hide' }, null, 'invalid'],
    },
    {
      uuid: 'keep',
      submitter_uuid: 'party',
      default_value: 'keep',
      conditions: [{ action: 'hide', field_uuid: 'boolean', value: true }],
    },
  ] as TemplateField[];
  await service.updateSubmitter(user, submitter.id, { completed: true });
  expect(submitter.values).toEqual({
    object: { accepted: true },
    boolean: false,
    'no-reference': 'keep',
    keep: 'keep',
  });
});
it('propagates transaction failures and does not schedule completion artifacts', async () => {
  const { service, user, submitter, source, queue } =
    createSubmittersServiceFixture();
  source.transaction.mockRejectedValue(new Error('database unavailable'));
  await expect(
    service.updateSubmitter(user, submitter.id, { completed: true }),
  ).rejects.toThrow('database unavailable');
  expect(queue.enqueueSubmitterCompletion).not.toHaveBeenCalled();
});
it('clears optional contacts/defaults and leaves unmatched field configuration untouched', async () => {
  const { service, user, submitter, template } =
    createSubmittersServiceFixture();
  template.fields = [
    {
      uuid: 'clear',
      name: 'Clear',
      submitter_uuid: 'party',
      default_value: 'existing',
    },
    {
      uuid: 'keep',
      name: 'Keep',
      submitter_uuid: 'party',
      default_value: 'retained',
    },
    { uuid: 'phone', name: 'Phone', type: 'phone', submitter_uuid: 'party' },
    {
      uuid: 'hidden',
      submitter_uuid: 'party',
      default_value: 'hidden',
      conditions: [{ action: 'hide', field_uuid: 'missing' }],
    },
  ];
  await service.updateSubmitter(user, submitter.id, {
    email: undefined,
    name: undefined,
    phone: undefined,
    values: { clear: '' },
    fields: [{ uuid: 'missing', title: 'No match' }],
    completed: true,
  });
  expect(submitter.email).toBeNull();
  expect(submitter.name).toBeNull();
  expect(submitter.phone).toBeNull();
  expect(submitter.values).toEqual({ clear: null, keep: 'retained' });
});
it('treats an invalid phone field value as an absent phone rather than persisting non-contact data', async () => {
  const { service, user, submitter, template } =
    createSubmittersServiceFixture();
  template.fields = [
    { uuid: 'phone', name: 'Phone', type: 'phone', submitter_uuid: 'party' },
  ];
  await service.updateSubmitter(user, submitter.id, {
    values: { phone: true },
  });
  expect(submitter.phone).toBeNull();
  expect(submitter.values).toEqual({});
});
