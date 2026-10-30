import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { runtimeEvents } from '../runtime/runtime-events';
import { WebhookEventListener } from './webhook-event.listener';
import { WebhooksService } from './webhooks.service';

it('registers every lifecycle event and enqueues delivery for the original account and record', async () => {
  const enqueueAccountEvent = jest.fn().mockResolvedValue(undefined);
  const module = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot()],
    providers: [
      WebhookEventListener,
      { provide: WebhooksService, useValue: { enqueueAccountEvent } },
    ],
  }).compile();
  await module.init();
  const emitter = module.get(EventEmitter2);
  for (const eventType of Object.values(runtimeEvents).filter(
    (type) => !type.startsWith('submitter.'),
  )) {
    await emitter.emitAsync(eventType, {
      accountId: 'tenant',
      recordId: 'record',
      submitterId: 'signer',
      submissionId: 'submission',
      templateId: 'template',
    });
    expect(enqueueAccountEvent).toHaveBeenLastCalledWith({
      accountId: 'tenant',
      recordId: 'record',
      eventType,
    });
  }
  expect(enqueueAccountEvent).toHaveBeenCalledTimes(11);
  await module.close();
});
it.each([
  [{ submitterId: 'signer', submissionId: 'submission' }, 'signer'],
  [{ submissionId: 'submission', templateId: 'template' }, 'submission'],
  [{ templateId: 'template' }, 'template'],
])(
  'resolves lifecycle identifiers without changing the tenant %j',
  async (scope, recordId) => {
    const enqueueAccountEvent = jest.fn().mockResolvedValue(undefined);
    const listener = new WebhookEventListener({
      enqueueAccountEvent,
    } as unknown as WebhooksService);
    await listener.handleFormCompleted({ accountId: 'tenant', ...scope });
    expect(enqueueAccountEvent).toHaveBeenCalledWith({
      accountId: 'tenant',
      recordId,
      eventType: 'form.completed',
    });
  },
);
it('skips malformed lifecycle events with no record instead of queuing an unscoped delivery', async () => {
  const enqueueAccountEvent = jest.fn();
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  await new WebhookEventListener({
    enqueueAccountEvent,
  } as unknown as WebhooksService).handleFormCompleted({ accountId: 'tenant' });
  expect(enqueueAccountEvent).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith(
    'Skipped form.completed webhook without record id',
  );
  warn.mockRestore();
});
it('rejects when delivery enqueueing fails so the runtime subscriber can observe the failure', async () => {
  const failure = new Error('Queue unavailable');
  const enqueueAccountEvent = jest.fn().mockRejectedValue(failure);
  await expect(
    new WebhookEventListener({
      enqueueAccountEvent,
    } as unknown as WebhooksService).handleFormStarted({
      accountId: 'tenant',
      submitterId: 'signer',
    }),
  ).rejects.toBe(failure);
});
