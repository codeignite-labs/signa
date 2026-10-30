import type { MessageEvent } from '@nestjs/common';
import { RealtimeService } from './realtime.service';
import { RealtimeEventInput, RealtimeStreamFilters } from './realtime.types';
it.each([
  [{ templateId: 'template-1' }, { template_id: 'template-2' }],
  [{ submissionId: 'submission-1' }, { submission_id: 'submission-2' }],
  [{ webhookUrlId: 'webhook-1' }, { webhook_url_id: 'webhook-2' }],
] satisfies [RealtimeStreamFilters, Partial<RealtimeEventInput>][])(
  'filters scoped updates while preserving matching events (%j)',
  (filters, mismatch) => {
    const service = new RealtimeService();
    const events: MessageEvent[] = [];
    const subscription = service
      .stream('account-1', filters)
      .subscribe((event) => events.push(event));
    try {
      const event = {
        account_id: 'account-1',
        type: 'template.updated',
        data: {},
        template_id: 'template-1',
        submission_id: 'submission-1',
        webhook_url_id: 'webhook-1',
      };
      service.publish({ ...event, ...mismatch });
      service.publish({ ...event, account_id: 'account-2' });
      expect(events).toHaveLength(0);
      service.publish({
        ...event,
        id: 'matching',
        occurred_at: '2026-10-31T00:00:00Z',
        data: { changed: true },
      });
      expect(events).toEqual([
        {
          id: 'matching',
          type: event.type,
          data: {
            ...event,
            id: 'matching',
            occurred_at: '2026-10-31T00:00:00Z',
            data: { changed: true },
          },
        },
      ]);
    } finally {
      subscription.unsubscribe();
    }
  },
);
it('emits generated metadata and account-bound keepalive messages without leaking events', () => {
  jest.useFakeTimers();
  const service = new RealtimeService();
  const events: MessageEvent[] = [];
  const subscription = service
    .stream('account-1')
    .subscribe((event) => events.push(event));
  try {
    service.publish({
      account_id: 'account-1',
      type: 'template.updated',
      data: {},
    });
    expect(events[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^template.updated:/) as unknown,
        data: expect.objectContaining({
          account_id: 'account-1',
          data: {},
        }) as unknown,
      }),
    );
    jest.advanceTimersByTime(25_000);
    expect(events[1]).toEqual(
      expect.objectContaining({
        type: 'realtime.keepalive',
        data: expect.objectContaining({
          account_id: 'account-1',
          type: 'realtime.keepalive',
        }) as unknown,
      }),
    );
  } finally {
    subscription.unsubscribe();
    jest.useRealTimers();
  }
});
