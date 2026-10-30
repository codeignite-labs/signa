import { createMailServiceFixture } from '../../test/support/mail-service.fixture';
import { SendTemplateMailInput } from './mail.types';
const input: SendTemplateMailInput = {
  accountId: 'tenant',
  to: { email: 'recipient@example.test' },
  subject: 'Agreement',
  template: 'submitter-invitation',
};
afterEach(() => jest.restoreAllMocks());
it('formats multiple recipients without dropping names or plain email addresses', async () => {
  const { service, encryptedConfigs, mailer } = createMailServiceFixture();
  encryptedConfigs.findOne.mockResolvedValue(null);
  await service.sendTemplate({
    ...input,
    to: [
      { email: 'first@example.test', name: 'Ada' },
      { email: 'second@example.test' },
    ],
  });
  expect(mailer.sendMail).toHaveBeenCalledWith(
    expect.objectContaining({
      to: ['"Ada" <first@example.test>', 'second@example.test'],
    }),
  );
});
it.each(['42', ''])(
  'records only nonempty delivery identifiers from public context %s',
  async (id) => {
    const { service, encryptedConfigs, emailMessages } =
      createMailServiceFixture();
    encryptedConfigs.findOne.mockResolvedValue(null);
    await service.sendTemplate({
      ...input,
      context: { submissionId: id, submitterId: id },
    });
    expect(emailMessages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: id || null,
        submitterId: id || null,
      }),
    );
  },
);
it('uses a cached Gmail access token with a stored token type without unnecessary refresh', async () => {
  const { service, connection, encryptedConfigs } = createMailServiceFixture();
  connection.value = JSON.stringify({
    provider: 'gmail',
    access_token: 'valid-access',
    token_type: 'Bearer',
    expires_at: '2126-01-01T00:00:00Z',
    email: 'sender@example.test',
  });
  const fetch = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(Response.json({ id: 'gmail-message' }));
  expect(await service.sendTemplate(input)).toMatchObject({
    status: 'sent',
    response: 'sent-via-gmail',
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
  );
  expect(encryptedConfigs.save).not.toHaveBeenCalled();
});
