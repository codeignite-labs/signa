import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  getDefaultMailSenderName,
  getMailRuntimeConfig,
} from './mail-runtime-config';
import { createMailerOptions } from './mailer-options';
jest.mock('node:fs', () => ({
  ...jest.requireActual<typeof import('node:fs')>('node:fs'),
  existsSync: jest.fn(
    jest.requireActual<typeof import('node:fs')>('node:fs').existsSync,
  ),
}));
beforeEach(() => jest.mocked(existsSync).mockReturnValue(true));

it('normalizes string SMTP booleans, port and timeouts from environment variables', () => {
  const options = getMailRuntimeConfig(
    new ConfigService({
      SMTP_ADDRESS: 'smtp.example.test',
      SMTP_PORT: '465',
      SMTP_ENABLE_SSL: 'true',
      SMTP_ENABLE_TLS: 'false',
      SMTP_ENABLE_STARTTLS: 'true',
      SMTP_SSL_VERIFY: 'false',
      SMTP_OPEN_TIMEOUT: '5',
      SMTP_READ_TIMEOUT: '9',
      SMTP_FROM: 'sender@example.test',
      MAIL_FROM_NAME: 'Example "Team"',
    }),
  );
  expect(options).toMatchObject({
    port: 465,
    secure: true,
    requireTls: false,
    rejectUnauthorized: false,
    connectionTimeout: 5000,
    readTimeout: 9000,
    from: '"Example \\"Team\\"" <sender@example.test>',
  });
});
it('accepts explicit boolean and numeric configuration values and empty optional values', () => {
  const options = getMailRuntimeConfig(
    new ConfigService({
      SMTP_ADDRESS: 'smtp.example.test',
      SMTP_PORT: 2525,
      SMTP_ENABLE_SSL: false,
      SMTP_ENABLE_TLS: true,
      SMTP_SSL_VERIFY: true,
      SMTP_OPEN_TIMEOUT: 7,
      SMTP_READ_TIMEOUT: '',
      SMTP_ENABLE_STARTTLS: '',
    }),
  );
  expect(options).toMatchObject({
    port: 2525,
    secure: false,
    requireTls: true,
    rejectUnauthorized: true,
    connectionTimeout: 7000,
    readTimeout: 25000,
  });
});
it('uses TLS fallback only when SSL is unspecified and honors explicit disabled STARTTLS', () => {
  const options = getMailRuntimeConfig(
    new ConfigService({
      SMTP_ADDRESS: 'smtp.example.test',
      SMTP_ENABLE_SSL: '',
      SMTP_ENABLE_TLS: 'true',
      SMTP_ENABLE_STARTTLS: false,
    }),
  );
  expect(options).toMatchObject({ secure: true, requireTls: false });
  expect(
    getMailRuntimeConfig(
      new ConfigService({
        SMTP_ADDRESS: 'smtp.example.test',
        SMTP_ENABLE_STARTTLS: false,
      }),
    ).requireTls,
  ).toBe(false);
});
it('includes configured SMTP identity, authentication method and template directory in mailer options', () => {
  const config = new ConfigService({
    SMTP_ADDRESS: 'smtp.example.test',
    SMTP_DOMAIN: 'mail.example.test',
    SMTP_AUTHENTICATION: 'plain',
    SMTP_USERNAME: 'user',
    SMTP_PASSWORD: 'secret',
    MAIL_TEMPLATE_DIR: '/custom/mail/templates',
    SMTP_FROM: '"Legal Team" <legal@example.test>',
  });
  const options = createMailerOptions(config);
  expect(options.transport).toMatchObject({
    name: 'mail.example.test',
    authMethod: 'PLAIN',
  });
  expect(options.template?.dir).toBe('/custom/mail/templates');
  expect(getDefaultMailSenderName(config)).toBe('Legal Team');
  expect(
    getDefaultMailSenderName(
      new ConfigService({
        SMTP_FROM: 'sender@example.test',
        MAIL_FROM_NAME: 'Organization',
      }),
    ),
  ).toBe('Organization');
});
it('retains the source template fallback when packaged template directories do not exist yet', () => {
  jest.mocked(existsSync).mockReturnValue(false);
  const options = createMailerOptions(new ConfigService());
  expect(options.template?.dir).toBe(
    join(process.cwd(), 'apps', 'backend', 'src', 'mail', 'templates'),
  );
});
