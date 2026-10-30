import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { runtimeJobNames } from '../runtime/runtime-jobs';
import { Submitter } from '../submitters/entities/submitter.entity';
import { SmsEventListener } from './sms-event.listener';
import { SmsProcessor } from './sms.processor';

const job = {
  id: 'job',
  name: runtimeJobNames.deliverSubmitterSms,
  data: { submitterId: 'recipient' },
} as Job<{ submitterId: string }>;
function setup() {
  const recipient = Object.assign(new Submitter(), {
    id: 'recipient',
    accountId: 'organization',
    submissionId: 'document',
    phone: '+14155552671',
    preferences: { send_sms: true },
    submission: { template: {} },
  });
  const submitters = {
    findOne: jest.fn().mockResolvedValue(recipient),
    save: jest.fn(),
  };
  const events = {
    create: jest.fn((value: unknown) => value),
    save: jest.fn(),
  };
  const sms = {
    sendSubmitterInvitation: jest.fn().mockResolvedValue({
      messageSid: 'SM123',
      to: '+14155552671',
      segments: 2,
    }),
  };
  const processor = new SmsProcessor(
    sms as never,
    submitters as never,
    events as never,
  );
  return { processor, recipient, submitters, events, sms };
}

describe('SMS queued delivery', () => {
  afterEach(() => jest.restoreAllMocks());

  it('records first send time and delivery metadata for original tenant and submitter', async () => {
    const { processor, submitters, events, sms, recipient } = setup();
    await processor.process(job);
    expect(submitters.findOne).toHaveBeenCalledWith({
      where: { id: 'recipient' },
      relations: { account: true, submission: { template: true } },
    });
    expect(sms.sendSubmitterInvitation).toHaveBeenCalledWith(recipient);
    expect(submitters.save).toHaveBeenCalledWith(recipient);
    expect(recipient.sentAt).toBeInstanceOf(Date);
    expect(events.create).toHaveBeenCalledWith({
      accountId: 'organization',
      submissionId: 'document',
      submitterId: 'recipient',
      eventType: 'send_sms',
      eventTimestamp: recipient.sentAt,
      data: { message_id: 'SM123', phone: '+14155552671', segments: 2 },
    });
    expect(events.save).toHaveBeenCalledTimes(1);
  });

  it('preserves original first-send timestamp on subsequent invitations', async () => {
    const { processor, recipient, submitters, events } = setup();
    recipient.sentAt = new Date('2025-01-01');
    await processor.process(job);
    expect(recipient.sentAt).toEqual(new Date('2025-01-01'));
    expect(submitters.save).not.toHaveBeenCalled();
    expect(events.save).toHaveBeenCalledTimes(1);
  });

  it('ignores unknown queue job types', async () => {
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { processor, submitters } = setup();
    await processor.process({ ...job, name: 'unknown' } as typeof job);
    expect(submitters.findOne).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith('Skipped unknown SMS job "unknown"');
  });

  it.each([null, { phone: null, submission: {} }])(
    'skips missing or ineligible recipients %#',
    async (recipient) => {
      const { processor, submitters, sms, events } = setup();
      submitters.findOne.mockResolvedValue(recipient);
      await processor.process(job);
      expect(sms.sendSubmitterInvitation).not.toHaveBeenCalled();
      expect(events.save).not.toHaveBeenCalled();
    },
  );

  it('propagates provider failures without marking the invitation sent', async () => {
    const { processor, sms, submitters, events } = setup();
    sms.sendSubmitterInvitation.mockRejectedValue(
      new Error('delivery unavailable'),
    );
    await expect(processor.process(job)).rejects.toThrow(
      'delivery unavailable',
    );
    expect(submitters.save).not.toHaveBeenCalled();
    expect(events.save).not.toHaveBeenCalled();
  });

  it('logs both identified and missing failed jobs', () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { processor } = setup();
    const failure = new Error('delivery failed');
    processor.handleFailed(job, failure);
    processor.handleFailed(undefined, failure);
    expect(errorLog).toHaveBeenCalledWith(
      'SMS job job failed: delivery failed',
      failure.stack,
    );
    expect(errorLog).toHaveBeenCalledWith(
      'SMS job unknown failed: delivery failed',
      failure.stack,
    );
  });

  it('queues invitation requests with retry policy', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const listener = new SmsEventListener({ add } as never);
    await listener.handleSubmitterInvitationRequested({
      submitterId: 'recipient',
      accountId: 'organization',
    });
    expect(add).toHaveBeenCalledWith(
      runtimeJobNames.deliverSubmitterSms,
      { submitterId: 'recipient' },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: true,
      },
    );
  });

  it('logs queue failures without rejecting the source event', async () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const failure = new Error('queue unavailable');
    const listener = new SmsEventListener({
      add: jest.fn().mockRejectedValue(failure),
    } as never);
    await expect(
      listener.handleSubmitterInvitationRequested({ submitterId: 'recipient' }),
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(
      'Failed to queue SMS job for submitter recipient: queue unavailable',
      failure.stack,
    );
  });
});
