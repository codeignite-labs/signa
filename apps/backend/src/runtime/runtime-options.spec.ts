import { ConfigService } from '@nestjs/config';
import { createBullBoardOptions } from './bull-board-options';
import { getMailRuntimeConfig } from './mail-runtime-config';
import { createMailerOptions } from './mailer-options';
import { createQueueOptions, queueNames } from './queue-options';
import { runtimeEvents } from './runtime-events';
import { runtimeJobNames } from './runtime-jobs';

describe('runtime options', () => {
  it('creates queue options with DocuSeal-parity queue defaults', () => {
    const options = createQueueOptions(
      createConfig({
        QUEUE_ENABLED: true,
        QUEUE_REDIS_URL: 'redis://queue:6379',
        QUEUE_PREFIX: 'signa-test',
      }),
    );

    expect(options.connection).toEqual({ url: 'redis://queue:6379' });
    expect(options.prefix).toBe('signa-test');
    expect(options.extraOptions).toBeUndefined();
    expect(options.defaultJobOptions).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
    expect(queueNames).toMatchObject({
      documentGeneration: 'document-generation',
      mail: 'mail',
      maintenance: 'maintenance',
      sms: 'sms',
      webhooks: 'webhooks',
    });
  });

  it('uses the local Redis default without passing module extras to the async factory', () => {
    const options = createQueueOptions(createConfig({ REDIS_URL: '' }));

    expect(options.connection).toEqual({ url: 'redis://localhost:6379' });
    expect(options.extraOptions).toBeUndefined();
  });

  it('hides Bull Board when the dashboard is disabled', () => {
    const options = createBullBoardOptions(createConfig({}));
    const response = { sendStatus: jest.fn() };
    const middleware = options.middleware as BullBoardMiddleware;

    middleware({}, response, jest.fn());

    expect(response.sendStatus).toHaveBeenCalledWith(404);
  });

  it('creates mailer options with Signa defaults and resilient template paths', () => {
    const options = createMailerOptions(
      createConfig({
        MAIL_FROM_ADDRESS: 'hello@signa.test',
        MAIL_FROM_NAME: 'Signa Test',
        MAIL_HOST: 'smtp.signa.test',
        MAIL_PORT: 2525,
      }),
    );

    expect(options.defaults).toMatchObject({
      from: '"Signa Test" <hello@signa.test>',
    });
    expect(options.transport).toMatchObject({
      host: 'smtp.signa.test',
      port: 2525,
      secure: false,
    });
    expect(options.template?.dir).toContain('mail/templates');
  });

  it('enables authenticated STARTTLS mail from SMTP variables alone', () => {
    const config = createConfig({
      MAIL_ENABLED: false,
      SMTP_ADDRESS: 'email-smtp.eu-west-1.amazonaws.com',
      SMTP_FROM: 'Signa <signing@example.com>',
      SMTP_PASSWORD: 'smtp-password',
      SMTP_USERNAME: 'smtp-username',
    });
    const runtime = getMailRuntimeConfig(config);
    const options = createMailerOptions(config);

    expect(runtime).toMatchObject({
      enabled: true,
      from: 'Signa <signing@example.com>',
      host: 'email-smtp.eu-west-1.amazonaws.com',
      port: 587,
      requireTls: true,
      secure: false,
    });
    expect(options.transport).toMatchObject({
      auth: {
        pass: 'smtp-password',
        user: 'smtp-username',
      },
      host: 'email-smtp.eu-west-1.amazonaws.com',
      port: 587,
      requireTLS: true,
      secure: false,
      tls: {
        rejectUnauthorized: true,
      },
    });
  });

  it('rejects incomplete SMTP authentication', () => {
    expect(() =>
      getMailRuntimeConfig(
        createConfig({
          SMTP_ADDRESS: 'smtp.example.com',
          SMTP_USERNAME: 'missing-password',
        }),
      ),
    ).toThrow(
      'SMTP authentication requires both SMTP_USERNAME and SMTP_PASSWORD.',
    );
  });

  it('tracks event and job names used by future processors', () => {
    expect(runtimeEvents.submissionCreated).toBe('submission.created');
    expect(runtimeEvents.submitterInvitationRequested).toBe(
      'submitter.invitation.requested',
    );
    expect(runtimeJobNames.deliverWebhook).toBe('deliver-webhook');
    expect(runtimeJobNames.generateCompletedPdf).toBe('generate-completed-pdf');
  });
});

function createConfig(values: Record<string, unknown>): ConfigService {
  const configValues = { ...runtimeConfigDefaults, ...values };

  return {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      const value = configValues[key];

      return value === undefined ? defaultValue : value;
    }),
    getOrThrow: jest.fn((key: string) => {
      const value = configValues[key];

      if (value === undefined || value === '') {
        throw new Error(`Missing config value ${key}`);
      }

      return value;
    }),
  } as unknown as ConfigService;
}

type BullBoardMiddleware = (
  request: Record<string, never>,
  response: { sendStatus: jest.Mock },
  next: jest.Mock,
) => void;

const runtimeConfigDefaults: Record<string, unknown> = {
  BULL_BOARD_ENABLED: false,
  BULL_BOARD_PASS: 'change-me-please',
  BULL_BOARD_ROUTE: '/queues',
  BULL_BOARD_USER: 'admin',
  MAIL_AUTH_ENABLED: false,
  MAIL_FROM_ADDRESS: 'no-reply@signa.com',
  MAIL_FROM_NAME: 'Signa',
  MAIL_HOST: 'localhost',
  MAIL_PORT: 1025,
  MAIL_REPLY_TO: '',
  MAIL_SECURE: false,
  MAIL_TEMPLATE_DIR: '',
  MAIL_TLS_REJECT_UNAUTHORIZED: true,
  QUEUE_BACKOFF_MS: 5000,
  QUEUE_DEFAULT_ATTEMPTS: 3,
  QUEUE_ENABLED: false,
  QUEUE_PREFIX: 'signa',
  QUEUE_REDIS_URL: '',
  QUEUE_REMOVE_ON_COMPLETE: 1000,
  QUEUE_REMOVE_ON_FAIL: 5000,
  REDIS_URL: '',
};
