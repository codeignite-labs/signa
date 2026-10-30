import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { runtimeEvents } from '../runtime/runtime-events';
import type { WebhookLifecycleEvent } from '../webhooks/webhook.types';
import { RealtimeEventListener } from './realtime-event.listener';
import { RealtimeService } from './realtime.service';

it('registers every lifecycle event and publishes its original tenant and identifiers', async () => {
  const publish = jest.fn();
  const module = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot()],
    providers: [
      RealtimeEventListener,
      { provide: RealtimeService, useValue: { publish } },
    ],
  }).compile();
  await module.init();
  const emitter = module.get(EventEmitter2);
  const event: WebhookLifecycleEvent = {
    accountId: 'tenant-1',
    recordId: 'record',
    submitterId: 'signer',
    submissionId: 'submission',
    templateId: 'template',
  };
  for (const type of Object.values(runtimeEvents).filter(
    (type) => !type.startsWith('submitter.'),
  )) {
    await emitter.emitAsync(type, event);
    expect(publish).toHaveBeenLastCalledWith({
      account_id: 'tenant-1',
      data: { record_id: 'record' },
      record_id: 'record',
      submission_id: 'submission',
      submitter_id: 'signer',
      template_id: 'template',
      type,
    });
  }
  expect(publish).toHaveBeenCalledTimes(11);
  await module.close();
});
it.each([
  [
    {
      submitterId: 'signer',
      submissionId: 'submission',
      templateId: 'template',
    },
    'signer',
  ],
  [{ submissionId: 'submission', templateId: 'template' }, 'submission'],
  [{ templateId: 'template' }, 'template'],
  [{}, null],
])('uses the most specific available record scope %j', (scope, recordId) => {
  const publish = jest.fn();
  const listener = new RealtimeEventListener({
    publish,
  } as unknown as RealtimeService);
  listener.handleFormViewed({ accountId: 'tenant-2', ...scope });
  expect(publish).toHaveBeenCalledWith(
    expect.objectContaining({
      account_id: 'tenant-2',
      data: { record_id: recordId },
      record_id: recordId ?? undefined,
    }),
  );
});
