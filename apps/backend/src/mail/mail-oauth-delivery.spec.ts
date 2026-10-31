import { createMailServiceFixture } from '../../test/support/mail-service.fixture';
import { SendTemplateMailInput } from './mail.types';
const input: SendTemplateMailInput = {
  accountId: 'tenant',
  to: { email: 'recipient@example.test', name: 'Ada' },
  subject: 'Sign – Agreement',
  template: 'submitter-invitation',
  replyTo: { email: 'reply@example.test', name: 'Support' },
  delivery: {
    submitterId: 'submitter',
    submissionId: 'submission',
    jobId: 12,
    attempt: 2,
  },
};
let fetchSpy: jest.SpiedFunction<typeof global.fetch>;
beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch');
});
afterEach(() => jest.restoreAllMocks());
it('refreshes expired Google tokens, persists rotation and sends independently decoded MIME content/attachments', async () => {
  const {
    service,
    connection,
    encryptedConfigs,
    mailer,
    emailMessages,
    emailEvents,
  } = createMailServiceFixture();
  fetchSpy
    .mockResolvedValueOnce(
      Response.json({
        access_token: 'new-access',
        expires_in: 3600,
        refresh_token: 'new-refresh',
        token_type: 'Bearer',
      }),
    )
    .mockResolvedValueOnce(Response.json({ id: 'gmail-message' }));
  const result = await service.sendTemplate({
    ...input,
    attachments: [
      {
        filename: 'Agreement "Final".pdf',
        contentType: 'application/pdf',
        content: Buffer.from('pdf bytes'),
      },
      { content: 'text bytes' },
      {},
    ],
  });
  const tokenRequest = fetchSpy.mock.calls[0][1];
  expect(fetchSpy.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token');
  if (!(tokenRequest?.body instanceof URLSearchParams))
    throw new Error('Expected form-encoded OAuth request');
  expect(tokenRequest.body.toString()).toBe(
    'client_id=client-id&client_secret=client-secret&grant_type=refresh_token&refresh_token=refresh',
  );
  expect(encryptedConfigs.save).toHaveBeenCalledWith(connection);
  expect(JSON.parse(connection.value)).toMatchObject({
    access_token: 'new-access',
    refresh_token: 'new-refresh',
    token_type: 'Bearer',
  });
  const body = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string) as {
    raw: string;
  };
  const mime = Buffer.from(body.raw, 'base64url').toString('utf8');
  expect(mime).toContain('To: "Ada" <recipient@example.test>');
  expect(mime).toContain('Reply-To: "Support" <reply@example.test>');
  expect(mime).toContain(Buffer.from('pdf bytes').toString('base64'));
  expect(mime).toContain(Buffer.from('text bytes').toString('base64'));
  expect(mime).toContain('Content-Transfer-Encoding: quoted-printable');
  expect(fetchSpy.mock.calls[1][1]?.headers).toMatchObject({
    Authorization: 'Bearer new-access',
  });
  expect(result).toMatchObject({ status: 'sent', response: 'sent-via-gmail' });
  expect(mailer.sendMail).not.toHaveBeenCalled();
  expect(emailMessages.create).toHaveBeenCalledWith(
    expect.objectContaining({
      accountId: 'tenant',
      submitterId: 'submitter',
      submissionId: 'submission',
      jobId: '12',
      attempt: 2,
      status: 'sent',
    }),
  );
  expect(emailEvents.create).toHaveBeenCalledWith(
    expect.objectContaining({
      emailMessageId: 'message',
      emailableType: 'Submitter',
      emailableId: 'submitter',
    }),
  );
});
it('retains prior refresh credentials when Google returns only a fresh access token', async () => {
  const { service, connection } = createMailServiceFixture();
  fetchSpy
    .mockResolvedValueOnce(Response.json({ access_token: 'new-access' }))
    .mockResolvedValueOnce(new Response());
  await service.sendTemplate(input);
  expect(JSON.parse(connection.value)).toMatchObject({
    access_token: 'new-access',
    refresh_token: 'refresh',
    expires_at: '2020-01-01T00:00:00Z',
  });
});
it.each([
  'malformed',
  '[]',
  '{}',
  '{"provider":"gmail"}',
  '{"provider":"gmail","access_token":"expired"}',
])(
  'falls back to SMTP when the stored integration is unusable (%s)',
  async (value) => {
    const { service, connection, mailer } = createMailServiceFixture();
    connection.value = value;
    expect(await service.sendTemplate(input)).toMatchObject({
      status: 'sent',
      messageId: 'smtp-id',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
  },
);
it.each(['http-error', 'invalid-json', 'non-object', 'missing-token'])(
  'falls back to SMTP when token refresh returns %s',
  async (failure) => {
    const { service, mailer, encryptedConfigs } = createMailServiceFixture();
    fetchSpy.mockResolvedValue(
      failure === 'http-error'
        ? new Response('denied', { status: 401 })
        : failure === 'invalid-json'
          ? new Response('not json')
          : Response.json(
              failure === 'non-object'
                ? []
                : {
                    access_token: 42,
                    expires_in: 'invalid',
                    token_type: 4,
                    refresh_token: false,
                  },
            ),
    );
    expect(await service.sendTemplate(input)).toMatchObject({ status: 'sent' });
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    expect(encryptedConfigs.save).not.toHaveBeenCalled();
  },
);
it('records provider/network failures and preserves the original error rather than claiming delivery', async () => {
  const { service, emailMessages, mailer, connection } =
    createMailServiceFixture();
  connection.value = JSON.stringify({
    provider: 'gmail',
    access_token: 'valid',
    expires_at: '2099-01-01T00:00:00Z',
  });
  fetchSpy.mockResolvedValue(new Response('quota exceeded', { status: 429 }));
  await expect(service.sendTemplate(input)).rejects.toMatchObject({
    status: 500,
  });
  expect(emailMessages.create).toHaveBeenCalledWith(
    expect.objectContaining({
      status: 'failed',
      lastErrorMessage: 'Internal Server Error Exception',
    }),
  );
  expect(mailer.sendMail).not.toHaveBeenCalled();
  const error = new Error('network unavailable');
  fetchSpy.mockRejectedValue(error);
  await expect(service.sendTemplate(input)).rejects.toBe(error);
});
it('returns successful transport results even when delivery-history persistence fails', async () => {
  const { service, encryptedConfigs, emailMessages } =
    createMailServiceFixture();
  encryptedConfigs.findOne.mockResolvedValue(null);
  emailMessages.save.mockRejectedValue(new Error('history down'));
  expect(await service.sendTemplate(input)).toMatchObject({ status: 'sent' });
});
it.each([
  { MAIL_ENABLED: false },
  { MAIL_HOST: 'smtp.example.test', MAIL_PORT: 'invalid' },
])(
  'exposes mail configuration health without connecting to the server (%j)',
  (values) => {
    const { service } = createMailServiceFixture(values);
    service.onModuleInit();
    const health = service.getHealthSnapshot();
    expect(health.status).toBe(
      values.MAIL_ENABLED === false ? 'up' : 'degraded',
    );
    if (values.MAIL_ENABLED === false)
      expect(health.message).toContain('disabled');
    expect(fetchSpy).not.toHaveBeenCalled();
  },
);
