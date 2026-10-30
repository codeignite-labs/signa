import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '../database/database-options';
import { AddMailgunWebhookReceipts1793399754916 } from '../database/migrations/1793399754916-AddMailgunWebhookReceipts';
import { createPostgresFixture } from '../test/postgres-fixture';
import { EmailEvent } from './entities/email-event.entity';
import { EmailMessage } from './entities/email-message.entity';
import { MailgunWebhookReceipt } from './entities/mailgun-webhook-receipt.entity';
import { MailProviderEventsController } from './mail-provider-events.controller';
import { MailgunWebhookService } from './mailgun-webhook.service';

const key = 'synthetic-mailgun-webhook-key';
const config = new ConfigService({ MAILGUN_WEBHOOK_SIGNING_KEY: key });
let fixture: Awaited<ReturnType<typeof createPostgresFixture>>;
let source: DataSource;
let service: MailgunWebhookService;
let controller: MailProviderEventsController;

function signed(
  event: Record<string, unknown> = {},
  timestamp = String(Math.floor(Date.now() / 1000)),
) {
  const token = randomUUID();
  return {
    signature: {
      timestamp,
      token,
      signature: createHmac('sha256', key)
        .update(timestamp + token)
        .digest('hex'),
    },
    'event-data': {
      event: 'delivered',
      recipient: 'recipient@example.test',
      timestamp: Number(timestamp),
      ...event,
    },
  };
}

beforeAll(async () => {
  fixture = await createPostgresFixture();
  source = await new DataSource(
    createTypeOrmOptions(
      new ConfigService({
        DATABASE_TYPE: 'postgres',
        DATABASE_URL: fixture.url,
      }),
    ),
  ).initialize();
  await source.runMigrations();
  service = new MailgunWebhookService(config, source);
  controller = new MailProviderEventsController(
    config,
    source.getRepository(EmailEvent),
    source.getRepository(EmailMessage),
    service,
  );
}, 60000);
afterAll(async () => {
  if (source?.isInitialized) await source.destroy();
  await fixture?.close();
});
beforeEach(async () => {
  await source.getRepository(EmailEvent).clear();
  await source.getRepository(MailgunWebhookReceipt).clear();
});

it('applies and rolls back the receipt migration without touching delivery history', async () => {
  const runner = source.createQueryRunner();
  await runner.connect();
  const migration = new AddMailgunWebhookReceipts1793399754916();
  try {
    expect(await runner.hasTable('mailgun_webhook_receipts')).toBe(true);
    await migration.down(runner);
    expect(await runner.hasTable('mailgun_webhook_receipts')).toBe(false);
    expect(await runner.hasTable('email_events')).toBe(true);
    await migration.up(runner);
    const table = await runner.getTable('mailgun_webhook_receipts');
    expect(table?.columns.map((column) => column.name)).toEqual([
      'token_hash',
      'payload_hash',
      'expires_at',
    ]);
    expect(table?.primaryColumns.map((column) => column.name)).toEqual([
      'token_hash',
    ]);
    expect(
      table?.indices.some((index) => index.columnNames.includes('expires_at')),
    ).toBe(true);
  } finally {
    await runner.release();
  }
});

it('records a valid signed delivery and associates it with the original account', async () => {
  const message = await source.getRepository(EmailMessage).save({
    accountId: '7',
    messageId: 'provider-message',
    template: 'fixture',
    subject: 'Fixture message',
    recipients: 'recipient@example.test',
    sha1: 'fixture-digest',
    status: 'sent',
    data: {},
  });
  await controller.recordProviderEvent(
    signed({ message: { headers: { 'message-id': message.messageId } } }),
  );
  expect(await source.getRepository(EmailEvent).find()).toMatchObject([
    {
      accountId: '7',
      emailMessageId: String(message.id),
      eventType: 'delivered',
    },
  ]);
  const [receipt] = await source.getRepository(MailgunWebhookReceipt).find();
  expect(receipt.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  expect(receipt.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  expect(Object.keys(receipt).sort()).toEqual([
    'expiresAt',
    'payloadHash',
    'tokenHash',
  ]);
});

it('acknowledges identical concurrent retries once across independent service instances', async () => {
  const secondController = new MailProviderEventsController(
    config,
    source.getRepository(EmailEvent),
    source.getRepository(EmailMessage),
    new MailgunWebhookService(config, source),
  );
  const body = signed();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      (index % 2 ? controller : secondController).recordProviderEvent(body),
    ),
  );
  expect(results).toEqual(Array.from({ length: 8 }, () => ({ status: 'ok' })));
  expect(await source.getRepository(EmailEvent).count()).toBe(1);
  expect(await source.getRepository(MailgunWebhookReceipt).count()).toBe(1);
});

it('accepts reordered identical JSON but rejects changed-payload replays', async () => {
  const body = signed({ 'user-variables': ['fixture', { nested: true }] });
  await controller.recordProviderEvent(body);
  await expect(
    controller.recordProviderEvent({
      'event-data': { ...body['event-data'] },
      signature: {
        token: body.signature.token,
        signature: body.signature.signature,
        timestamp: body.signature.timestamp,
      },
    }),
  ).resolves.toEqual({ status: 'ok' });
  await expect(
    controller.recordProviderEvent({
      ...body,
      'event-data': { ...body['event-data'], event: 'failed' },
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(await source.getRepository(EmailEvent).count()).toBe(1);
});

it('rolls receipt and event writes back together and permits a successful retry', async () => {
  const body = signed();
  await expect(
    service.recordOnce(body, async (manager) => {
      await manager.getRepository(EmailEvent).save({
        accountId: null,
        email: 'recipient@example.test',
        eventType: 'delivered',
        eventDatetime: new Date(),
        data: {},
      });
      throw new Error('temporary downstream failure');
    }),
  ).rejects.toThrow('temporary downstream failure');
  expect(await source.getRepository(EmailEvent).count()).toBe(0);
  expect(await source.getRepository(MailgunWebhookReceipt).count()).toBe(0);
  await controller.recordProviderEvent(body);
  expect(await source.getRepository(EmailEvent).count()).toBe(1);
});

it('removes expired receipt hashes during authenticated processing', async () => {
  await source.getRepository(MailgunWebhookReceipt).save({
    tokenHash: 'e'.repeat(64),
    payloadHash: 'f'.repeat(64),
    expiresAt: new Date(Date.now() - 1000),
  });
  await controller.recordProviderEvent(signed());
  expect(await source.getRepository(MailgunWebhookReceipt).count()).toBe(1);
  expect(
    await source
      .getRepository(MailgunWebhookReceipt)
      .findOneBy({ tokenHash: 'e'.repeat(64) }),
  ).toBeNull();
});

it.each([
  () => signed({}, String(Math.floor(Date.now() / 1000) - 86460)),
  () => signed({}, String(Math.floor(Date.now() / 1000) + 360)),
  () => signed({}, 'not-a-number'),
  () => signed({}, '9'.repeat(24)),
  () => ({ ...signed(), signature: null }),
  () => ({ ...signed(), signature: { ...signed().signature, timestamp: 123 } }),
  () => ({ ...signed(), signature: { ...signed().signature, token: 123 } }),
  () => ({ ...signed(), signature: { ...signed().signature, signature: 123 } }),
  () => ({ ...signed(), signature: { ...signed().signature, token: ' ' } }),
  () => ({
    ...signed(),
    signature: { ...signed().signature, signature: '0'.repeat(64) },
  }),
])(
  'rejects stale, future, malformed and tampered signatures before persisting %#',
  async (makeBody) => {
    await expect(
      controller.recordProviderEvent(makeBody()),
    ).rejects.toMatchObject({ status: 403 });
    expect(await source.getRepository(EmailEvent).count()).toBe(0);
    expect(await source.getRepository(MailgunWebhookReceipt).count()).toBe(0);
  },
);

it('fails closed if replay storage is not PostgreSQL', async () => {
  const unsupported = new MailgunWebhookService(config, {
    options: { type: 'sqlite' },
  } as unknown as DataSource);
  const persist = jest.fn();
  await expect(unsupported.recordOnce(signed(), persist)).rejects.toMatchObject(
    { status: 503 },
  );
  expect(persist).not.toHaveBeenCalled();
});

it('rejects direct verifier use without a signing key', async () => {
  const missingKey = new MailgunWebhookService(new ConfigService(), source);
  await expect(
    missingKey.recordOnce(signed(), jest.fn()),
  ).rejects.toMatchObject({ status: 403 });
});
