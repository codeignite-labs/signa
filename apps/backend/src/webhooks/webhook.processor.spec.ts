import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { WebhookProcessor } from './webhook.processor';
import { WebhooksService } from './webhooks.service';
import { WebhookQueuePayload } from './webhook.types';
const data: WebhookQueuePayload = {
  eventType: 'form.completed',
  eventUuid: 'uuid',
  recordId: 'record',
  webhookUrlId: 'hook',
};
function setup(config: Record<string, number> = {}) {
  const deliverWebhook = jest.fn().mockResolvedValue(false);
  const add = jest.fn().mockResolvedValue({});
  const processor = new WebhookProcessor(
    { deliverWebhook } as unknown as WebhooksService,
    { add } as unknown as Queue,
    new ConfigService(config),
  );
  return { deliverWebhook, add, processor };
}
it('ignores unknown queue jobs and does not schedule retries for successful delivery', async () => {
  const test = setup();
  await test.processor.process({
    name: 'unknown',
    data,
  } as Job<WebhookQueuePayload>);
  expect(test.deliverWebhook).not.toHaveBeenCalled();
  test.deliverWebhook.mockResolvedValue(true);
  await test.processor.process({
    name: 'deliver-webhook',
    data,
  } as Job<WebhookQueuePayload>);
  expect(test.deliverWebhook).toHaveBeenCalledWith({ ...data, attempt: 0 });
  expect(test.add).not.toHaveBeenCalled();
});
it.each([0, 1, 6])(
  'schedules exponential retry for failed attempt %i',
  async (attempt) => {
    const test = setup();
    await test.processor.process({
      name: 'deliver-webhook',
      data: { ...data, attempt },
    } as Job<WebhookQueuePayload>);
    expect(test.add).toHaveBeenCalledWith(
      'deliver-webhook',
      { ...data, attempt: attempt + 1 },
      { delay: 2 ** attempt * 30000, attempts: 1, removeOnComplete: true },
    );
  },
);
it('respects configured backoff and attempt bounds without retrying manual deliveries', async () => {
  const test = setup({ WEBHOOK_BACKOFF_MS: 10, WEBHOOK_MAX_ATTEMPTS: 2 });
  await test.processor.process({
    name: 'deliver-webhook',
    data,
  } as Job<WebhookQueuePayload>);
  expect(test.add).toHaveBeenCalledWith(
    'deliver-webhook',
    { ...data, attempt: 1 },
    expect.objectContaining({ delay: 10 }),
  );
  test.add.mockClear();
  for (const attempt of [1, 99999])
    await test.processor.process({
      name: 'deliver-webhook',
      data: { ...data, attempt },
    } as Job<WebhookQueuePayload>);
  expect(test.add).not.toHaveBeenCalled();
});
