import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { EncryptedConfig } from '../../src/accounts/entities/encrypted-config.entity';
import { SignaI18nService } from '../../src/internationalization/signa-i18n.service';
import { EmailEvent } from '../../src/mail/entities/email-event.entity';
import { EmailMessage } from '../../src/mail/entities/email-message.entity';
import { MailBrandingService } from '../../src/mail/mail-branding.service';
import { MailTemplateResolver } from '../../src/mail/mail-template-resolver.service';
import { MailService } from '../../src/mail/mail.service';
export function createMailServiceFixture(values: Record<string, unknown> = {}) {
  const config = new ConfigService({
    MAIL_ENABLED: true,
    MAIL_FROM_NAME: 'Signa',
    MAIL_FROM_ADDRESS: 'mail@example.test',
    GMAIL_OAUTH_CLIENT_ID: 'client-id',
    GMAIL_OAUTH_CLIENT_SECRET: 'client-secret',
    ...values,
  });
  const connection: EncryptedConfig = Object.assign(new EncryptedConfig(), {
    accountId: 'tenant',
    key: 'email_integration:gmail',
    value: JSON.stringify({
      provider: 'gmail',
      access_token: 'access',
      refresh_token: 'refresh',
      expires_at: '2020-01-01T00:00:00Z',
      email: 'sender@example.test',
    }),
  });
  const encryptedConfigs = {
    findOne: jest
      .fn<Promise<EncryptedConfig | null>, [unknown]>()
      .mockResolvedValue(connection),
    save: jest.fn((value: EncryptedConfig) => Promise.resolve(value)),
  };
  const emailMessages = {
    create: jest.fn((input: Partial<EmailMessage>) =>
      Object.assign(new EmailMessage(), { id: 'message' }, input),
    ),
    save: jest.fn((input: EmailMessage) => Promise.resolve(input)),
  };
  const emailEvents = {
    create: jest.fn((input: Partial<EmailEvent>) =>
      Object.assign(new EmailEvent(), input),
    ),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const branding = {
    getFrontendUrl: jest.fn(
      (path: string) => `https://sign.example.test${path}`,
    ),
    getBaseContext: jest.fn().mockReturnValue({ productName: 'Signa' }),
    getAccountContext: jest.fn().mockResolvedValue({ productName: 'Acme' }),
  };
  const i18n = {
    snapshotLocale: jest.fn((locale?: string | null) => locale ?? 'en'),
    translate: jest.fn(
      (_key: string, options?: { defaultValue?: string }) =>
        options?.defaultValue ?? _key,
    ),
  };
  const mailer = {
    sendMail: jest
      .fn<
        Promise<{ accepted: string[]; rejected: string[]; messageId: string }>,
        [Parameters<MailerService['sendMail']>[0]]
      >()
      .mockResolvedValue({
        accepted: ['recipient@example.test'],
        rejected: [],
        messageId: 'smtp-id',
      }),
  };
  const templates = {
    assertTemplateExists: jest.fn(),
    renderHtml: jest.fn().mockReturnValue('<p>Welcome – signing</p>'),
  };
  const service = new MailService(
    config,
    encryptedConfigs as unknown as Repository<EncryptedConfig>,
    emailMessages as unknown as Repository<EmailMessage>,
    emailEvents as unknown as Repository<EmailEvent>,
    branding as unknown as MailBrandingService,
    i18n as unknown as SignaI18nService,
    mailer as unknown as MailerService,
    templates as unknown as MailTemplateResolver,
  );
  return {
    service,
    config,
    connection,
    encryptedConfigs,
    emailMessages,
    emailEvents,
    branding,
    i18n,
    mailer,
    templates,
  };
}
