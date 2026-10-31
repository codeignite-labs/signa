import { createMailServiceFixture } from '../../test/support/mail-service.fixture';
it('emails an encoded reset link with a fallback greeting and account branding', async () => {
  const { service, mailer, encryptedConfigs } = createMailServiceFixture();
  encryptedConfigs.findOne.mockResolvedValue(null);
  await service.sendPasswordReset({
    accountId: 'tenant',
    email: 'person@example.test',
    token: 'token/?&',
  });
  expect(mailer.sendMail.mock.calls[0][0]).toMatchObject({
    template: 'password-reset',
    subject: 'Reset your password',
    context: {
      firstName: 'there',
      actionUrl:
        'https://sign.example.test/auth/reset-password?token=token%2F%3F%26',
      productName: 'Acme',
    },
  });
});
it('routes new-user invitations to password setup and existing-account invitations to account switching', async () => {
  const { service, mailer, encryptedConfigs } = createMailServiceFixture();
  encryptedConfigs.findOne.mockResolvedValue(null);
  const recipient = {
    accountId: 'tenant',
    accountName: 'Acme',
    email: 'person@example.test',
  };
  await service.sendUserInvitation({
    ...recipient,
    firstName: 'Ada',
    token: 'new/token',
  });
  expect(mailer.sendMail.mock.calls[0][0]).toMatchObject({
    template: 'user-invitation',
    context: {
      firstName: 'Ada',
      invitationUrl:
        'https://sign.example.test/auth/reset-password?token=new%2Ftoken',
    },
  });
  await service.sendAccountInvitation(recipient);
  expect(mailer.sendMail.mock.calls[1][0]).toMatchObject({
    template: 'user-invitation',
    context: {
      existingIdentity: true,
      firstName: 'there',
      invitationUrl: 'https://sign.example.test/settings/accounts',
    },
  });
});
it('sends an expiring team invitation with an encoded token and readable UTC expiration', async () => {
  const { service, mailer, encryptedConfigs } = createMailServiceFixture();
  encryptedConfigs.findOne.mockResolvedValue(null);
  await service.sendTeamInvitation({
    accountId: 'tenant',
    accountName: 'Acme',
    email: 'person@example.test',
    teamName: 'Legal',
    role: 'member',
    inviterName: 'Owner',
    expiresAt: new Date('2026-01-15T12:00:00Z'),
    token: 'team/token',
  });
  expect(mailer.sendMail.mock.calls[0][0]).toMatchObject({
    template: 'team-invitation',
    subject: 'You are invited to Legal',
    context: {
      invitationUrl:
        'https://sign.example.test/team-invitations/team%2Ftoken/accept',
      expiresAt: '2026-01-15T12:00:00.000Z',
      expiresAtLabel: 'Jan 15, 2026, 12:00 PM',
      inviterName: 'Owner',
      role: 'member',
    },
  });
});
it('sends SMTP confirmation and template OTP notices through the configured delivery transport', async () => {
  const { service, mailer, encryptedConfigs } = createMailServiceFixture();
  encryptedConfigs.findOne.mockResolvedValue(null);
  await service.sendSmtpSuccessfulSetup({ email: 'admin@example.test' });
  expect(mailer.sendMail.mock.calls[0][0]).toMatchObject({
    template: 'smtp-successful-setup',
    subject: 'SMTP has been configured',
  });
  await service.sendTemplateVerification({
    accountId: 'tenant',
    email: 'recipient@example.test',
    otpCode: '123456',
    templateName: 'Agreement',
  });
  expect(mailer.sendMail.mock.calls[1][0]).toMatchObject({
    template: 'template-otp-verification',
    context: { otpCode: '123456', templateName: 'Agreement' },
  });
});
it.each(['provider failure', { code: 'SMTP_UNAVAILABLE' }])(
  'records non-Error transport failures without changing the rejected value (%j)',
  async (error) => {
    const { service, mailer, encryptedConfigs, emailMessages } =
      createMailServiceFixture();
    encryptedConfigs.findOne.mockResolvedValue(null);
    mailer.sendMail.mockRejectedValue(error);
    await expect(
      service.sendTemplate({
        to: { email: 'person@example.test' },
        subject: 'Hello',
        template: 'submitter-invitation',
      }),
    ).rejects.toEqual(error);
    expect(emailMessages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        lastErrorMessage:
          typeof error === 'string' ? error : JSON.stringify(error),
      }),
    );
  },
);
it('preserves explicitly formatted sender and reply-to strings for SMTP delivery', async () => {
  const { service, mailer, encryptedConfigs } = createMailServiceFixture();
  encryptedConfigs.findOne.mockResolvedValue(null);
  await service.sendTemplate({
    to: { email: 'recipient@example.test' },
    from: 'Organization <sender@example.test>',
    replyTo: 'reply@example.test',
    subject: 'Hello',
    template: 'submitter-invitation',
  });
  expect(mailer.sendMail.mock.calls[0][0]).toMatchObject({
    from: 'Organization <sender@example.test>',
    replyTo: 'reply@example.test',
  });
});
