import { ConfigService } from '@nestjs/config';
import { EntityNotFoundError, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { RealtimeService } from '../realtime/realtime.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { TemplatesService } from '../templates/templates.service';
import { User } from '../users/entities/user.entity';
import { WebhookUrl } from './entities/webhook-url.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { WebhookAttempt } from './entities/webhook-attempt.entity';
import { webhookEventTypes, WebhookEventType } from './webhook-events';
import { verifyWebhookSignature } from './webhook-signatures';
import { WebhooksService } from './webhooks.service';
const user = Object.assign(new User(), { id: '1', accountId: 'tenant-1' });
function repository<T extends object>() {
  return {
    create: jest.fn((value: Partial<T>) => value as T),
    save: jest.fn((value: T) => Promise.resolve(value)),
    remove: jest.fn((value: T) => Promise.resolve(value)),
    find: jest.fn<Promise<T[]>, [unknown]>().mockResolvedValue([]),
    findOne: jest.fn<Promise<T | null>, [unknown]>().mockResolvedValue(null),
    findOneByOrFail: jest.fn<Promise<T>, [unknown]>(),
  };
}
function setup() {
  const urls = repository<WebhookUrl>();
  const events = repository<WebhookEvent>();
  const attempts = repository<WebhookAttempt>();
  const queue = { add: jest.fn().mockResolvedValue({}) };
  const submissions = {
    findLatestCompletedSubmitter: jest.fn().mockResolvedValue({ id: 'record' }),
    getSubmitterWebhookPayload: jest.fn().mockResolvedValue({ kind: 'form' }),
    getSubmissionArchiveWebhookPayload: jest
      .fn()
      .mockResolvedValue({ kind: 'submission archive' }),
    getSubmissionWebhookPayload: jest
      .fn()
      .mockResolvedValue({ kind: 'submission' }),
  };
  const templates = {
    getTemplateArchiveWebhookPayload: jest
      .fn()
      .mockResolvedValue({ kind: 'template archive' }),
    getTemplateWebhookPayload: jest
      .fn()
      .mockResolvedValue({ kind: 'template' }),
  };
  const realtime = { publish: jest.fn() };
  const service = new WebhooksService(
    urls as unknown as Repository<WebhookUrl>,
    events as unknown as Repository<WebhookEvent>,
    attempts as unknown as Repository<WebhookAttempt>,
    queue as unknown as Queue,
    submissions as unknown as SubmissionsService,
    templates as unknown as TemplatesService,
    new ConfigService({ WEBHOOK_TIMEOUT_MS: 10 }),
    realtime as unknown as RealtimeService,
  );
  const url = Object.assign(new WebhookUrl(), {
    id: 'hook',
    accountId: user.accountId,
    url: 'https://hooks.example.test',
    events: [...webhookEventTypes],
    secret: { 'X-Custom': 'custom' },
    hmacSecret: 'test-secret',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  });
  urls.findOneByOrFail.mockResolvedValue(url);
  urls.findOne.mockResolvedValue(url);
  return {
    service,
    urls,
    events,
    attempts,
    queue,
    submissions,
    templates,
    realtime,
    url,
  };
}
let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest
    .fn()
    .mockResolvedValue(new Response('accepted', { status: 200 }));
  jest.spyOn(global, 'fetch').mockImplementation(fetchMock);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
it('lists, creates and updates only tenant-owned webhook settings', async () => {
  const { service, urls, url } = setup();
  urls.find.mockResolvedValue([url]);
  expect((await service.listWebhooks(user)).data[0]).toMatchObject({
    id: 'hook',
    hmac_secret: 'test-secret',
  });
  expect(urls.find).toHaveBeenCalledWith({
    where: { accountId: user.accountId },
    order: { id: 'DESC' },
  });
  await service.createWebhook(user, { url: url.url });
  expect(urls.create).toHaveBeenLastCalledWith({
    accountId: user.accountId,
    url: url.url,
    events: webhookEventTypes,
    secret: {},
  });
  await service.createWebhook(user, {
    url: url.url,
    events: ['form.completed'],
    secret: { Authorization: 'custom' },
  });
  expect(urls.create).toHaveBeenLastCalledWith(
    expect.objectContaining({
      events: ['form.completed'],
      secret: { Authorization: 'custom' },
    }),
  );
  await service.updateWebhook(user, 'hook', {});
  expect(url.events).toEqual(webhookEventTypes);
  await service.updateWebhook(user, 'hook', {
    url: 'https://new.example.test',
    events: [],
    secret: {},
  });
  expect(await service.getWebhook(user, 'hook')).toMatchObject({
    url: 'https://new.example.test',
    events: [],
    secret: {},
  });
  expect(urls.findOneByOrFail).toHaveBeenCalledWith({
    id: 'hook',
    accountId: user.accountId,
  });
  expect(await service.deleteWebhook(user, 'hook')).toMatchObject({
    id: 'hook',
  });
  expect(urls.remove).toHaveBeenCalledWith(url);
});
it('preserves database failures and returns not found for a foreign tenant webhook', async () => {
  const { service, urls } = setup();
  const failure = new Error('database offline');
  urls.save.mockRejectedValue(failure);
  await expect(
    service.createWebhook(user, { url: 'https://example.test' }),
  ).rejects.toThrow(failure);
  await expect(service.updateWebhook(user, 'hook', {})).rejects.toThrow(
    failure,
  );
  urls.remove.mockRejectedValue(failure);
  await expect(service.deleteWebhook(user, 'hook')).rejects.toThrow(failure);
  urls.findOneByOrFail.mockRejectedValue(
    new EntityNotFoundError(WebhookUrl, {}),
  );
  await expect(service.getWebhook(user, 'foreign')).rejects.toMatchObject({
    status: 404,
  });
});
it('queues only subscribed tenant events and validates that test delivery has a completed submitter', async () => {
  const { service, urls, url, queue, submissions } = setup();
  urls.find.mockResolvedValue([
    url,
    Object.assign(new WebhookUrl(), url, { id: 'other', events: [] }),
  ]);
  const jobs = await service.enqueueAccountEvent({
    accountId: user.accountId,
    eventType: 'form.completed',
    recordId: 'record',
  });
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    webhookUrlId: 'hook',
    recordId: 'record',
    eventType: 'form.completed',
  });
  expect(jobs[0].eventUuid).toMatch(/^[\da-f-]{36}$/);
  expect(queue.add).toHaveBeenCalledWith('deliver-webhook', jobs[0], {
    attempts: 1,
    removeOnComplete: true,
  });
  await service.testWebhook(user, 'hook');
  expect(submissions.findLatestCompletedSubmitter).toHaveBeenCalledWith(
    user.accountId,
  );
  submissions.findLatestCompletedSubmitter.mockResolvedValue(null);
  await expect(service.testWebhook(user, 'hook')).rejects.toMatchObject({
    status: 422,
  });
});
it.each<[WebhookEventType, string]>([
  ['form.completed', 'form'],
  ['submission.completed', 'submission'],
  ['submission.archived', 'submission archive'],
  ['template.created', 'template'],
  ['template.archived', 'template archive'],
])(
  'delivers a signed %s payload and records a successful attempt',
  async (eventType, kind) => {
    const { service, events, attempts, realtime, url } = setup();
    expect(
      await service.deliverWebhook({
        eventType,
        eventUuid: 'uuid',
        recordId: 'record',
        webhookUrlId: 'hook',
      }),
    ).toBe(true);
    const [endpoint, request] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(endpoint).toBe(url.url);
    const payload = JSON.parse(request.body as string) as {
      event_type: string;
      data: { kind: string };
    };
    expect(payload).toMatchObject({ event_type: eventType, data: { kind } });
    const headers = request.headers as Record<string, string>;
    expect(headers['X-Custom']).toBe('custom');
    expect(
      verifyWebhookSignature({
        body: request.body as string,
        secret: url.hmacSecret,
        header: headers['X-Docuseal-Signature'],
      }),
    ).toBe(true);
    expect(events.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'success', payload }),
    );
    expect(attempts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 0,
        responseBody: null,
        responseStatusCode: 200,
      }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: user.accountId,
        type: 'webhook.delivery.updated',
      }),
    );
  },
);
it('skips deleted/unsubscribed endpoints and duplicate successes while allowing manual resend', async () => {
  const { service, urls, events, url } = setup();
  const job = {
    eventType: 'form.completed' as const,
    eventUuid: 'uuid',
    recordId: 'record',
    webhookUrlId: 'hook',
  };
  urls.findOne
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(
      Object.assign(new WebhookUrl(), url, { events: [] }),
    );
  expect(await service.deliverWebhook(job)).toBe(true);
  expect(await service.deliverWebhook(job)).toBe(true);
  const completed = Object.assign(new WebhookEvent(), {
    id: 'event',
    accountId: user.accountId,
    status: 'success',
    eventType: job.eventType,
    uuid: job.eventUuid,
    recordId: job.recordId,
    webhookUrlId: job.webhookUrlId,
  });
  events.findOne.mockResolvedValue(completed);
  expect(await service.deliverWebhook(job)).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
  await service.resendWebhookEvent(user, 'event');
  expect(events.findOne).toHaveBeenCalledWith({
    where: { id: 'event', accountId: user.accountId },
    relations: { webhookUrl: true },
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  events.findOne.mockResolvedValue(null);
  await expect(
    service.resendWebhookEvent(user, 'foreign'),
  ).rejects.toMatchObject({ status: 404 });
  events.findOne.mockResolvedValue({ ...completed, eventType: 'unknown' });
  await expect(service.resendWebhookEvent(user, 'event')).rejects.toMatchObject(
    { status: 404 },
  );
});
it.each([400, 500])(
  'records HTTP %i as an unsuccessful attempt with a truncated response',
  async (status) => {
    const { service, attempts, events } = setup();
    fetchMock.mockResolvedValue(new Response('x'.repeat(150), { status }));
    expect(
      await service.deliverWebhook({
        eventType: 'form.completed',
        eventUuid: 'uuid',
        recordId: 'record',
        webhookUrlId: 'hook',
        attempt: 2,
      }),
    ).toBe(false);
    expect(attempts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 2,
        responseStatusCode: status,
        responseBody: 'x'.repeat(100),
      }),
    );
    expect(events.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'error' }),
    );
  },
);
it.each([new Error('network unavailable'), 'non-error failure'])(
  'does not mark a transport failure as successfully delivered',
  async (failure) => {
    const { service, attempts, events } = setup();
    fetchMock.mockRejectedValue(failure);
    expect(
      await service.deliverWebhook({
        eventType: 'form.completed',
        eventUuid: 'uuid',
        recordId: 'record',
        webhookUrlId: 'hook',
      }),
    ).toBe(false);
    expect(attempts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        responseStatusCode: 0,
        responseBody:
          failure instanceof Error ? failure.message : 'Webhook error',
      }),
    );
    expect(events.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'error' }),
    );
  },
);
it('aborts a timed-out delivery and keeps it eligible for retries', async () => {
  const { service, events } = setup();
  jest.useFakeTimers();
  fetchMock.mockImplementation(
    (_url: string, request: RequestInit) =>
      new Promise((_resolve, reject) =>
        request.signal?.addEventListener('abort', () =>
          reject(new Error('timed out')),
        ),
      ),
  );
  const pending = service.deliverWebhook({
    eventType: 'form.completed',
    eventUuid: 'uuid',
    recordId: 'record',
    webhookUrlId: 'hook',
  });
  await jest.runAllTimersAsync();
  expect(await pending).toBe(false);
  expect(events.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: 'error' }),
  );
});
it('lists tenant-owned delivery history with status filtering and bounded pagination', async () => {
  const { service, events, urls } = setup();
  const event = Object.assign(new WebhookEvent(), {
    id: 'event-1',
    status: 'error',
    attempts: [
      Object.assign(new WebhookAttempt(), {
        id: 'attempt-1',
        attempt: 1,
        responseStatusCode: 503,
        responseBody: 'unavailable',
      }),
    ],
  });
  const builder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([event]),
  };
  Object.assign(events, {
    createQueryBuilder: jest.fn().mockReturnValue(builder),
  });
  expect(
    (
      await service.listWebhookEvents(user, 'hook', {
        limit: 999,
        status: 'error',
      })
    ).data,
  ).toEqual([
    expect.objectContaining({
      id: 'event-1',
      attempts: [
        expect.objectContaining({ id: 'attempt-1', response_status_code: 503 }),
      ],
    }),
  ]);
  expect(urls.findOneByOrFail).toHaveBeenCalledWith({
    id: 'hook',
    accountId: user.accountId,
  });
  expect(builder.limit).toHaveBeenCalledWith(100);
  expect(builder.andWhere).toHaveBeenCalledWith('event.status = :status', {
    status: 'error',
  });
  builder.andWhere.mockClear();
  await service.listWebhookEvents(user, 'hook', {});
  expect(builder.limit).toHaveBeenLastCalledWith(20);
  expect(builder.andWhere).not.toHaveBeenCalled();
});
it('records an empty HTTP error body as absent while preserving the failure status', async () => {
  const { service, attempts } = setup();
  fetchMock.mockResolvedValue(new Response('', { status: 503 }));
  expect(
    await service.deliverWebhook({
      eventType: 'form.completed',
      eventUuid: 'uuid',
      recordId: 'record',
      webhookUrlId: 'hook',
      attempt: 1,
    }),
  ).toBe(false);
  expect(attempts.create).toHaveBeenCalledWith(
    expect.objectContaining({ responseStatusCode: 503, responseBody: null }),
  );
});
