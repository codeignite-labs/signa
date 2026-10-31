import { ConfigService } from '@nestjs/config';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { DataSource, EntityManager } from 'typeorm';
import { MailgunWebhookService } from './mailgun-webhook.service';
import { EmailEvent } from './entities/email-event.entity';
import { EmailMessage } from './entities/email-message.entity';
import { createHmac } from 'node:crypto';
import { AdminGuard } from '../auth/guards/admin/admin.guard';
import { JwtGuard } from '../auth/guards/jwt/jwt.guard';
import { User } from '../users/entities/user.entity';
import { MailProviderEventsController } from './mail-provider-events.controller';

function setup(
  values: Record<string, string> = { MAIL_CALLBACK_SECRET: 'secret' },
) {
  const messages = {
    find: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn(),
    findOne: jest.fn(),
  };
  const events = {
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((value: unknown) => value),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const receiptQuery = {
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ raw: [{}] }),
  };
  const receiptRepository = {
    delete: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: () => receiptQuery,
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === EmailEvent
        ? events
        : entity === EmailMessage
          ? messages
          : receiptRepository,
  } as unknown as EntityManager;
  const source = {
    options: { type: 'postgres' },
    transaction: jest.fn((run: (manager: EntityManager) => Promise<void>) =>
      run(manager),
    ),
  } as unknown as DataSource;
  const controller = new MailProviderEventsController(
    new ConfigService(values),
    events as never,
    messages as never,
    new MailgunWebhookService(new ConfigService(values), source),
  );
  return { controller, events, messages };
}

const administrator = Object.assign(new User(), {
  accountId: 'organization',
  role: 'admin',
});

describe('MailProviderEventsController', () => {
  it.each(['listMessages', 'listMessageEvents'] as const)(
    'requires a web session administrator for %s',
    (method) => {
      expect(
        Reflect.getMetadata(
          GUARDS_METADATA,
          MailProviderEventsController.prototype[method],
        ),
      ).toEqual([JwtGuard, AdminGuard]);
    },
  );

  it.each([
    null,
    [],
    {},
    { signature: {} },
    { signature: { timestamp: '1', token: 't' } },
  ])(
    'rejects missing Mailgun signature when signing key configured %#',
    async (body) => {
      const { controller, events } = setup({
        MAILGUN_WEBHOOK_SIGNING_KEY: 'key',
      });
      await expect(controller.recordProviderEvent(body)).rejects.toMatchObject({
        response: { error: 'Invalid Mailgun signature' },
      });
      expect(events.save).not.toHaveBeenCalled();
    },
  );

  it('verifies Mailgun HMAC and refuses tampering or wrong lengths', async () => {
    const { controller, events } = setup({
      MAILGUN_WEBHOOK_SIGNING_KEY: 'key',
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = {
      timestamp,
      token: 'token',
      signature: createHmac('sha256', 'key')
        .update(timestamp + 'token')
        .digest('hex'),
    };
    await expect(
      controller.recordProviderEvent({ signature, event: 'delivered' }),
    ).resolves.toEqual({ status: 'ok' });
    expect(events.save).toHaveBeenCalledTimes(1);
    for (const invalid of ['x', '0'.repeat(64)]) {
      await expect(
        controller.recordProviderEvent({
          signature: { ...signature, signature: invalid },
        }),
      ).rejects.toMatchObject({
        response: { error: 'Invalid Mailgun signature' },
      });
    }
    expect(events.save).toHaveBeenCalledTimes(1);
  });

  it('enforces configured callback secret with header precedence', async () => {
    const { controller, events } = setup({ MAIL_CALLBACK_SECRET: 'secret' });
    await expect(
      controller.recordProviderEvent({}, undefined, 'wrong'),
    ).rejects.toMatchObject({ response: { error: 'Invalid callback secret' } });
    await expect(
      controller.recordProviderEvent({}, 'wrong', 'secret'),
    ).rejects.toMatchObject({ response: { error: 'Invalid callback secret' } });
    await controller.recordProviderEvent({}, undefined, 'secret');
    await controller.recordProviderEvent({}, 'secret');
    expect(events.save).toHaveBeenCalledTimes(2);
  });

  it('normalizes provider aliases and associates events with original account', async () => {
    const { controller, messages, events } = setup();
    messages.findOne.mockResolvedValue({
      id: 'email',
      accountId: 'organization',
    });
    const payload = [
      {
        email: 'one@example.com',
        event: 'delivered',
        message_id: 'one',
        timestamp: 1782748800,
      },
      {
        recipient: 'two@example.com',
        event_type: 'opened',
        messageId: 'two',
        timestamp: '2026-06-29T16:00:00Z',
      },
      {
        to: 'three@example.com',
        type: 'clicked',
        MessageID: 'three',
        timestamp: 'invalid',
      },
      { email: '', event: ' ', timestamp: {} },
      null,
      [],
      'invalid',
    ];
    await controller.recordProviderEvent(payload, 'secret');
    expect(events.save).toHaveBeenCalledTimes(4);
    expect(events.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        accountId: 'organization',
        emailMessageId: 'email',
        email: 'one@example.com',
        eventType: 'delivered',
        messageId: 'one',
        eventDatetime: new Date(1782748800000),
      }),
    );
    expect(events.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        email: 'two@example.com',
        eventType: 'opened',
        messageId: 'two',
        eventDatetime: new Date('2026-06-29T16:00:00Z'),
      }),
    );
    expect(events.create).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        email: 'three@example.com',
        eventType: 'clicked',
        messageId: 'three',
        eventDatetime: expect.any(Date) as unknown,
      }),
    );
    expect(events.create).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        accountId: null,
        emailMessageId: null,
        email: 'unknown@example.invalid',
        eventType: 'provider_event',
        messageId: null,
      }),
    );
    expect(messages.findOne).toHaveBeenCalledTimes(3);
  });

  it('accepts malformed unsigned payloads without recording events', async () => {
    const { controller, events } = setup();
    await controller.recordProviderEvent(null, 'secret');
    expect(events.save).not.toHaveBeenCalled();
  });

  it('scopes message list to active organization and optional document filters', async () => {
    const { controller, messages } = setup();
    await controller.listMessages(administrator);
    expect(messages.find).toHaveBeenLastCalledWith({
      where: { accountId: 'organization' },
      order: { id: 'DESC' },
      take: 100,
    });
    await controller.listMessages(administrator, 'submission', 'submitter');
    expect(messages.find).toHaveBeenLastCalledWith({
      where: {
        accountId: 'organization',
        submissionId: 'submission',
        submitterId: 'submitter',
      },
      order: { id: 'DESC' },
      take: 100,
    });
  });

  it('scopes event history to the same account as its message', async () => {
    const { controller, messages, events } = setup();
    messages.findOneBy.mockResolvedValue({
      id: 'email',
      accountId: 'organization',
    });
    await controller.listMessageEvents(administrator, 'email');
    expect(messages.findOneBy).toHaveBeenCalledWith({
      id: 'email',
      accountId: 'organization',
    });
    expect(events.find).toHaveBeenCalledWith({
      where: { accountId: 'organization', emailMessageId: 'email' },
      order: { id: 'DESC' },
      take: 100,
    });
  });

  it('does not disclose events of absent or foreign messages', async () => {
    const { controller, messages, events } = setup();
    messages.findOneBy.mockResolvedValue(null);
    await expect(
      controller.listMessageEvents(administrator, 'foreign'),
    ).rejects.toMatchObject({ response: { error: 'Email message not found' } });
    expect(events.find).not.toHaveBeenCalled();
  });
});

it('records signed Mailgun event-data envelope with nested message headers', async () => {
  const { controller, messages, events } = setup({
    MAILGUN_WEBHOOK_SIGNING_KEY: 'key',
  });
  messages.findOne.mockResolvedValue({ id: 'mail', accountId: 'organization' });
  const event = {
    event: 'delivered',
    recipient: 'recipient@example.com',
    timestamp: 1782748800,
    message: { headers: { 'message-id': 'provider-id' } },
  };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = {
    timestamp,
    token: 'token',
    signature: createHmac('sha256', 'key')
      .update(timestamp + 'token')
      .digest('hex'),
  };
  await controller.recordProviderEvent({ signature, 'event-data': event });
  expect(messages.findOne).toHaveBeenCalledWith({
    where: { messageId: 'provider-id' },
  });
  expect(events.create).toHaveBeenCalledWith(
    expect.objectContaining({
      accountId: 'organization',
      emailMessageId: 'mail',
      email: 'recipient@example.com',
      eventType: 'delivered',
      messageId: 'provider-id',
      data: event,
    }),
  );
});

it.each([
  { message: {} },
  { message: { headers: 'invalid' } },
  { message: null },
])('tolerates missing Mailgun message headers %#', async (payload) => {
  const { controller, events } = setup();
  await controller.recordProviderEvent(payload, 'secret');
  expect(events.create).toHaveBeenCalledWith(
    expect.objectContaining({ messageId: null }),
  );
});

it('rejects email callbacks when no authentication method is configured', async () => {
  const { controller, events, messages } = setup({});
  await expect(
    controller.recordProviderEvent({
      event: 'delivered',
      message_id: 'known-message',
    }),
  ).rejects.toMatchObject({ status: 503 });
  expect(messages.findOne).not.toHaveBeenCalled();
  expect(events.save).not.toHaveBeenCalled();
});
