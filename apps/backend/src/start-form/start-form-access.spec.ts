import { IsNull } from 'typeorm';
import { startFormFixture } from '../../test/support/start-form.fixture';
let fixture: ReturnType<typeof startFormFixture>;
beforeEach(() => {
  fixture = startFormFixture();
});
it('looks up only active publicly shared templates and derives tenant branding from ownership', async () => {
  await expect(
    fixture.service.getStartForm('public-link'),
  ).resolves.toMatchObject({
    account_name: 'Example Org',
    link_form_fields: ['email'],
    require_email_2fa: false,
  });
  expect(fixture.templates.findOne).toHaveBeenCalledWith({
    relations: { account: true },
    where: { slug: 'public-link', sharedLink: true, archivedAt: IsNull() },
  });
  expect(fixture.branding.get).toHaveBeenCalledWith('tenant');
});
it('falls back to the platform name for legacy templates without a loaded account', async () => {
  fixture.template.account = undefined as never;
  await expect(
    fixture.service.getStartForm('public-link'),
  ).resolves.toMatchObject({ account_name: 'Signa' });
});
it('filters unsupported link form preferences and exposes only accepted fields', async () => {
  fixture.template.preferences = {
    link_form_fields: ['name', 'email', 'phone', 'account_id', 7, null],
  };
  await expect(
    fixture.service.getStartForm('public-link'),
  ).resolves.toMatchObject({ link_form_fields: ['name', 'email', 'phone'] });
});
it.each(['missing', 'require_email_2fa', 'require_phone_2fa'])(
  'hides unavailable shared templates (%s)',
  async (flag) => {
    if (flag === 'missing') fixture.templates.findOne.mockResolvedValue(null);
    else fixture.template.preferences = { [flag]: true };
    await expect(
      fixture.service.getStartForm('public-link'),
    ).rejects.toMatchObject({
      status: 404,
      response: { error: 'Start form not found' },
    });
    expect(fixture.branding.get).not.toHaveBeenCalled();
  },
);
it('requires an email address for the verified start endpoint', async () => {
  await expect(
    fixture.service.verifyEmailAndSubmitStartForm('public-link', {
      phone: '+14155552671',
      one_time_code: '123456',
    }),
  ).rejects.toMatchObject({ response: { error: 'Email is required' } });
  expect(fixture.transaction).not.toHaveBeenCalled();
});
it.each([{ email: 'casey@example.test' }, { one_time_code: '123456' }])(
  'requires both email and OTP when shared-link verification is enabled %j',
  async (input) => {
    fixture.template.preferences.shared_link_2fa = true;
    await expect(
      fixture.service.submitStartForm('public-link', input),
    ).rejects.toMatchObject({
      response: { error: 'Email verification is required' },
    });
    expect(fixture.transaction).not.toHaveBeenCalled();
  },
);
it.each(['submit', 'verify'])(
  'rejects invalid email codes through %s without creating a link',
  async (mode) => {
    fixture.template.preferences.shared_link_2fa = true;
    fixture.codes.verifyTemplateCode.mockReturnValue(false);
    const input = { email: '  CASEY@example.test ', one_time_code: 'wrong' };
    await expect(
      mode === 'submit'
        ? fixture.service.submitStartForm('public-link', input)
        : fixture.service.verifyEmailAndSubmitStartForm('public-link', input),
    ).rejects.toMatchObject({
      response: { error: 'Email verification code is invalid' },
    });
    expect(fixture.codes.verifyTemplateCode).toHaveBeenCalledWith(
      fixture.template,
      'casey@example.test',
      'wrong',
    );
    expect(fixture.transaction).not.toHaveBeenCalled();
  },
);
it('propagates mail failure instead of returning a sent acknowledgement', async () => {
  fixture.mail.sendTemplateVerification.mockRejectedValue(
    new Error('Mail unavailable'),
  );
  await expect(
    fixture.service.sendEmailVerification('public-link', {
      email: 'casey@example.test',
    }),
  ).rejects.toThrow('Mail unavailable');
});
it.each([
  [['name'], { email: 'casey@example.test' }, 'Missing required field: name'],
  [
    ['name', 'phone'],
    { email: 'casey@example.test' },
    'Missing required fields: name, phone',
  ],
  [[], { name: 'Casey' }, 'Email or phone is required'],
])(
  'rejects incomplete identity requirements %j',
  async (fields, input, error) => {
    fixture.template.preferences.link_form_fields = fields;
    await expect(
      fixture.service.submitStartForm('public-link', input),
    ).rejects.toMatchObject({ response: { error } });
    expect(fixture.transaction).not.toHaveBeenCalled();
  },
);
it.each([
  { recipients: [] },
  { recipients: [{ uuid: 'a' }, { uuid: 'b' }] },
  { recipients: [{ name: 'Missing UUID' }] },
])(
  'rejects absent or ambiguous template recipients %j',
  async ({ recipients }) => {
    fixture.template.submitters =
      recipients as typeof fixture.template.submitters;
    await expect(
      fixture.service.submitStartForm('public-link', {
        email: 'casey@example.test',
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(fixture.transaction).not.toHaveBeenCalled();
  },
);
