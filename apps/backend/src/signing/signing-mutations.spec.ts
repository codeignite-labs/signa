import { createSigningServiceFixture } from '../../test/support/signing-service.fixture';
import { Submitter } from '../submitters/entities/submitter.entity';
it('merges values and records the first nonempty start once, preserving latest request metadata', async () => {
  const { service, submitter, recordedEvents, events } =
    createSigningServiceFixture();
  submitter.values = { previous: 'retained' };
  expect(
    (await service.updateValues('slug', { values: {} }, {})).values,
  ).toEqual({ previous: 'retained' });
  expect(recordedEvents.exists).not.toHaveBeenCalled();
  await service.updateValues(
    'slug',
    { values: { field: 'value' } },
    { ip: '127.0.0.1', timezone: 'UTC' },
  );
  expect(recordedEvents.create).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'start_form',
      data: { ip: '127.0.0.1', timezone: 'UTC' },
    }),
  );
  expect(events.emit).toHaveBeenCalledWith(
    'form.started',
    expect.objectContaining({ submitterId: '1' }),
  );
  expect(submitter.values).toEqual({ previous: 'retained', field: 'value' });
  recordedEvents.exists.mockResolvedValue(true);
  recordedEvents.create.mockClear();
  events.emit.mockClear();
  await service.updateValues('slug', { values: { field: 'updated' } });
  expect(recordedEvents.create).not.toHaveBeenCalled();
  expect(events.emit).not.toHaveBeenCalled();
});
it('requires prior sequential signers to complete or decline and also honors account-enforced order', async () => {
  const { service, submitter, submission, configValues } =
    createSigningServiceFixture();
  submitter.id = '2';
  const earlier: Submitter = Object.assign(new Submitter(), submitter, {
    id: '1',
    uuid: 'earlier',
  });
  submission.submitters = [submitter, earlier];
  await expect(
    service.updateValues('slug', { values: {} }),
  ).rejects.toMatchObject({ status: 422 });
  earlier.declinedAt = new Date();
  await expect(
    service.updateValues('slug', { values: {} }),
  ).resolves.toBeTruthy();
  earlier.declinedAt = null;
  submission.submittersOrder = 'random';
  await expect(
    service.updateValues('slug', { values: {} }),
  ).resolves.toBeTruthy();
  configValues.set('enforce_signing_order', true);
  await expect(
    service.updateValues('slug', { values: {} }),
  ).rejects.toMatchObject({ status: 422 });
  earlier.completedAt = new Date();
  await expect(
    service.updateValues('slug', { values: {} }),
  ).resolves.toBeTruthy();
});
it.each([undefined, null, '', []])(
  'blocks completion when a required field value is blank (%s)',
  async (value) => {
    const { service, template, submitter, documents } =
      createSigningServiceFixture();
    template.fields = [
      { uuid: 'required', type: 'text', submitter_uuid: 'party' },
    ];
    await expect(
      service.updateValues('slug', {
        values: { required: value },
        completed: true,
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: { field_uuid: 'required' },
    });
    expect(submitter.completedAt).toBeNull();
    expect(documents.processSubmitterCompletion).not.toHaveBeenCalled();
  },
);
it('completes validated fields, exempts optional/readonly/other-role fields and queues artifacts before emitting completion', async () => {
  const {
    service,
    template,
    submitter,
    documents,
    queue,
    recordedEvents,
    events,
  } = createSigningServiceFixture();
  template.fields = [
    { uuid: 'required', type: 'text', submitter_uuid: 'party' },
    {
      uuid: 'optional',
      required: false,
      type: 'text',
      submitter_uuid: 'party',
    },
    { uuid: 'readonly', readonly: true, type: 'text', submitter_uuid: 'party' },
    { type: 'text', submitter_uuid: 'party' },
    { uuid: 'other', submitter_uuid: 'other' },
  ];
  const result = await service.updateValues('slug', {
    values: { required: false },
    completed: true,
  });
  expect(result.submitter.completed_at).toBeInstanceOf(Date);
  expect(documents.processSubmitterCompletion).toHaveBeenCalledWith(submitter);
  expect(queue.enqueueSubmitterCompletion).toHaveBeenCalledWith('1');
  expect(
    documents.processSubmitterCompletion.mock.invocationCallOrder[0],
  ).toBeLessThan(queue.enqueueSubmitterCompletion.mock.invocationCallOrder[0]);
  expect(recordedEvents.create).toHaveBeenCalledWith(
    expect.objectContaining({ eventType: 'complete_form' }),
  );
  expect(events.emit).toHaveBeenCalledWith(
    'form.completed',
    expect.objectContaining({
      accountId: 'tenant',
      submissionId: 'submission',
    }),
  );
  expect(events.emit).toHaveBeenCalledWith(
    'submission.completed',
    expect.objectContaining({ submissionId: 'submission' }),
  );
});
it('does not announce whole-submission completion while another signer remains incomplete', async () => {
  const { service, submitter, submission, events } =
    createSigningServiceFixture();
  submission.submitters.push({ ...submitter, id: '2', uuid: 'next' });
  await service.updateValues('slug', { values: {}, completed: true });
  expect(events.emit).toHaveBeenCalledWith(
    'form.completed',
    expect.any(Object),
  );
  expect(events.emit).not.toHaveBeenCalledWith(
    'submission.completed',
    expect.any(Object),
  );
});
it('requires signing reasons only for filled signature/initial fields when account policy enables them', async () => {
  const { service, template, configValues, submitter } =
    createSigningServiceFixture();
  configValues.set('require_signing_reason', true);
  template.fields = [
    { uuid: 'signature', type: 'signature', submitter_uuid: 'party' },
    {
      uuid: 'optional',
      type: 'initials',
      required: false,
      submitter_uuid: 'party',
    },
    {
      uuid: 'readonly',
      type: 'signature',
      readonly: true,
      submitter_uuid: 'party',
    },
    { type: 'signature', submitter_uuid: 'party' },
  ];
  await expect(
    service.updateValues('slug', {
      values: { signature: 'asset' },
      completed: true,
    }),
  ).rejects.toMatchObject({
    status: 422,
    response: { field_uuid: 'signature' },
  });
  expect(submitter.completedAt).toBeNull();
  await expect(
    service.updateValues('slug', {
      values: { signature: 'asset', signature_reason: 'Approved' },
      completed: true,
    }),
  ).resolves.toBeTruthy();
});
it.each(['submitter', 'submission', 'template', 'account'])(
  'resolves delegation policy from %s and resets the delegated signing session',
  async (level) => {
    const {
      service,
      submitter,
      submission,
      template,
      configValues,
      recordedEvents,
      events,
      phone,
    } = createSigningServiceFixture();
    if (level === 'submitter') submitter.preferences.allow_to_delegate = true;
    if (level === 'submission') submission.preferences.allow_to_delegate = true;
    if (level === 'template') template.preferences.allow_to_delegate = true;
    if (level === 'account') configValues.set('allow_to_delegate', true);
    submitter.values = { private: 'old signer input' };
    submitter.openedAt = new Date();
    submitter.sentAt = new Date();
    const result = await service.delegate('slug', {
      email: 'delegate@example.test',
      name: 'Delegate',
      phone: '15550001111',
    });
    expect(result.submitter).toMatchObject({
      email: 'delegate@example.test',
      name: 'Delegate',
    });
    expect(result.submitter.slug).not.toBe('slug');
    expect(submitter).toMatchObject({
      phone: '+15550001111',
      values: {},
      openedAt: null,
      sentAt: null,
    });
    expect(phone.normalizePhone).toHaveBeenCalledWith('15550001111');
    expect(recordedEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'delegate_form',
        data: {
          email: 'delegate@example.test',
          name: 'Delegate',
          phone: '+15550001111',
          previous_email: 'signer@example.test',
        },
      }),
    );
    expect(events.emit).toHaveBeenCalledWith('submitter.invitation.requested', {
      accountId: 'tenant',
      submitterId: '1',
    });
  },
);
it('blocks delegation by default and lets a specific preference deny broader account permission', async () => {
  const { service, submitter, configValues } = createSigningServiceFixture();
  await expect(
    service.delegate('slug', { email: 'delegate@example.test' }),
  ).rejects.toMatchObject({ status: 422 });
  configValues.set('allow_to_delegate', true);
  submitter.preferences.allow_to_delegate = false;
  await expect(
    service.delegate('slug', { email: 'delegate@example.test' }),
  ).rejects.toMatchObject({ status: 422 });
  submitter.preferences.allow_to_delegate = true;
  await service.delegate('slug', { email: 'delegate@example.test' });
  expect(submitter).toMatchObject({
    email: 'delegate@example.test',
    name: null,
    phone: null,
  });
});
it('declines pending forms with optional reasons and records both audit and runtime events', async () => {
  const { service, submitter, recordedEvents, events } =
    createSigningServiceFixture();
  expect(
    (await service.decline('slug', { reason: 'Please revise' })).submitter
      .declined_at,
  ).toBeInstanceOf(Date);
  expect(recordedEvents.create).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'decline_form',
      data: { reason: 'Please revise' },
    }),
  );
  expect(events.emit).toHaveBeenCalledWith(
    'form.declined',
    expect.objectContaining({ reason: 'Please revise' }),
  );
  submitter.declinedAt = null;
  await service.decline('slug', {});
  expect(recordedEvents.create).toHaveBeenLastCalledWith(
    expect.objectContaining({
      eventType: 'decline_form',
      data: { reason: '' },
    }),
  );
  submitter.declinedAt = null;
  submitter.preferences.allow_to_decline = false;
  await expect(service.decline('slug', {})).rejects.toMatchObject({
    status: 422,
  });
});
it('resubmits using new slug/default values while preserving role and account scope', async () => {
  const { service, submitter, submitters, recordedEvents } =
    createSigningServiceFixture();
  submitter.preferences.default_values = { name: 'Prefilled' };
  submitter.values = { name: 'Old completed' };
  submitters.findOne
    .mockResolvedValueOnce(submitter)
    .mockImplementation(() =>
      Promise.resolve(
        Object.assign(
          new Submitter(),
          submitter,
          submitters.create.mock.calls[0]?.[0],
          { id: 'next' },
        ),
      ),
    );
  const result = await service.resubmit('slug');
  expect(result.values).toEqual({ name: 'Prefilled' });
  expect(result.submitter.slug).not.toBe('slug');
  expect(submitters.create).toHaveBeenCalledWith(
    expect.objectContaining({
      accountId: 'tenant',
      submissionId: 'submission',
      uuid: 'party',
      values: { name: 'Prefilled' },
    }),
  );
  expect(recordedEvents.create).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'resubmit_form',
      data: { previous_submitter_id: '1' },
    }),
  );
});
it('honors resubmission denial and uses empty metadata/preferences/default values for legacy submitters', async () => {
  const { service, submitter, submitters, configValues } =
    createSigningServiceFixture();
  configValues.set('allow_to_resubmit', false);
  await expect(service.resubmit('slug')).rejects.toMatchObject({ status: 422 });
  configValues.set('allow_to_resubmit', true);
  submitter.preferences = undefined as unknown as Submitter['preferences'];
  submitter.metadata = undefined as unknown as Submitter['metadata'];
  await service.resubmit('slug');
  expect(submitters.create).toHaveBeenCalledWith(
    expect.objectContaining({ metadata: {}, preferences: {}, values: {} }),
  );
});
