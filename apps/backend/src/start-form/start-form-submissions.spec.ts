import { startFormFixture } from '../../test/support/start-form.fixture';
import { Submitter } from '../submitters/entities/submitter.entity';
let fixture: ReturnType<typeof startFormFixture>;
beforeEach(() => {
  fixture = startFormFixture();
});
afterEach(() => jest.useRealTimers());
it('creates a public signing link with normalized identity and explicit empty metadata', async () => {
  await expect(
    fixture.service.submitStartForm('public-link', {
      email: ' CASEY@example.test ',
      name: ' Casey Example ',
      phone: ' +14155552671 ',
    }),
  ).resolves.toEqual({
    signing_slug: 'signing-link',
    signing_url: '/s/signing-link',
  });
  expect(fixture.submitters.create).toHaveBeenCalledWith(
    expect.objectContaining({
      accountId: 'tenant',
      email: 'casey@example.test',
      name: 'Casey Example',
      phone: '+14155552671',
      uuid: 'signer',
      ip: null,
      ua: null,
      submissionId: 'submission',
    }),
  );
  expect(fixture.submissions.create).toHaveBeenCalledWith(
    expect.objectContaining({
      accountId: 'tenant',
      templateId: 'template',
      source: 'link',
      expireAt: null,
    }),
  );
  expect(fixture.events.create).toHaveBeenCalledTimes(1);
  expect(fixture.events.create).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'start_form',
      data: { ip: undefined, ua: undefined },
    }),
  );
  expect(fixture.query.andWhere).toHaveBeenCalledWith(
    'submitter.email = :email',
    { email: 'casey@example.test' },
  );
});
it('creates a phone-only identity and reuses only matching active link submissions', async () => {
  fixture.template.preferences.link_form_fields = ['phone'];
  await fixture.service.submitStartForm('public-link', {
    phone: '+14155552671',
  });
  expect(fixture.query.andWhere).toHaveBeenCalledWith(
    'submitter.phone = :phone',
    { phone: '+14155552671' },
  );
  for (const condition of [
    'submission.archived_at IS NULL',
    'submitter.declined_at IS NULL',
    'submitter.completed_at IS NULL',
  ])
    expect(fixture.query.andWhere).toHaveBeenCalledWith(condition);
  expect(fixture.query.where).toHaveBeenCalledWith(
    'submission.template_id = :templateId',
    { templateId: 'template' },
  );
});
it.each([undefined, { ip: 'new-ip', ua: 'new-agent' }])(
  'reuses the existing link and preserves or updates request metadata %j',
  async (metadata) => {
    fixture.query.getOne.mockResolvedValue(
      Object.assign(new Submitter(), {
        id: 'existing',
        slug: 'existing-link',
        ip: 'old-ip',
        ua: 'old-agent',
      }),
    );
    await fixture.service.submitStartForm(
      'public-link',
      { email: 'casey@example.test' },
      metadata,
    );
    expect(fixture.submitters.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'existing',
        ip: metadata?.ip ?? 'old-ip',
        ua: metadata?.ua ?? 'old-agent',
      }),
    );
    expect(fixture.submissions.create).not.toHaveBeenCalled();
    expect(fixture.events.create).not.toHaveBeenCalled();
  },
);
it('records verified-email evidence when the submit endpoint validates its code', async () => {
  fixture.template.preferences.shared_link_2fa = true;
  await fixture.service.submitStartForm(
    'public-link',
    { email: 'casey@example.test', one_time_code: '123456' },
    { ip: '127.0.0.1', ua: 'test-browser' },
  );
  expect(fixture.events.create).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'email_verified',
      accountId: 'tenant',
      submitterId: 'submitter',
      submissionId: 'submission',
      data: {
        email: 'casey@example.test',
        ip: '127.0.0.1',
        ua: 'test-browser',
      },
    }),
  );
});
it.each(['3_days', '1_day', 'invalid', undefined])(
  'applies only supported default expiry durations %s',
  async (duration) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T12:00:00Z'));
    fixture.template.preferences.default_expire_at_duration = duration;
    await fixture.service.submitStartForm('public-link', {
      email: 'casey@example.test',
    });
    const expected =
      duration === '3_days'
        ? new Date('2026-11-03T12:00:00Z')
        : duration === '1_day'
          ? new Date('2026-11-01T12:00:00Z')
          : null;
    expect(fixture.submissions.create).toHaveBeenCalledWith(
      expect.objectContaining({ expireAt: expected }),
    );
  },
);
it.each([
  'email',
  'invite_by_uuid',
  'invite_via_field_uuid',
  'optional_invite_by_uuid',
])(
  'uses a configured recipient when all invitation recipients specify %s',
  async (key) => {
    fixture.template.submitters = [
      { uuid: 'configured', name: 'Recipient', [key]: 'configured-value' },
    ];
    await fixture.service.submitStartForm('public-link', {
      email: 'casey@example.test',
    });
    expect(fixture.submitters.create).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'configured' }),
    );
  },
);
