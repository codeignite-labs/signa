import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { RealtimeService } from '../realtime/realtime.service';
import { runtimeJobNames } from '../runtime/runtime-jobs';
import { SubmissionEvent } from '../submissions/entities/submission-event.entity';
import { Submission } from '../submissions/entities/submission.entity';
import { Submitter } from '../submitters/entities/submitter.entity';
import { EmailVerificationCodeService } from './email-verification-code.service';
import { MailDeliveryBuilder } from './mail-delivery.builder';
import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';
import { MailJobName, SendTemplateMailInput } from './mail.types';
const mail: SendTemplateMailInput = {
  accountId: 'tenant',
  to: { email: 'signer@example.test', name: 'Signer' },
  subject: 'Agreement',
  template: 'submitter-invitation',
  context: {},
};
function job(name: MailJobName, extra: Record<string, unknown> = {}) {
  return {
    id: 'job',
    name,
    attemptsMade: 1,
    data: {
      submitterId: 'signer',
      reminderIndex: 3,
      reason: 'Please revise',
      ...extra,
    },
  } as unknown as Parameters<MailProcessor['process']>[0];
}
function setup() {
  const submission: Submission = Object.assign(new Submission(), {
    id: 'submission',
    templateId: 'template',
    submittersOrder: 'preserved',
    submitters: [],
  });
  const submitter: Submitter = Object.assign(new Submitter(), {
    id: 'signer',
    accountId: 'tenant',
    submissionId: 'submission',
    email: 'signer@example.test',
    name: 'Signer',
    submission,
    completedAt: null,
    sentAt: null,
    preferences: {},
    account: { locale: 'en' },
  });
  submission.submitters = [submitter];
  const submitters = {
    findOneOrFail: jest.fn().mockResolvedValue(submitter),
    save: jest.fn().mockResolvedValue(submitter),
  };
  const events = {
    create: jest.fn((event: Partial<SubmissionEvent>) =>
      Object.assign(new SubmissionEvent(), { id: 'event' }, event),
    ),
    save: jest.fn((event: SubmissionEvent) => Promise.resolve(event)),
  };
  const queue = { add: jest.fn().mockResolvedValue({}) };
  const builder = {
    buildInvitation: jest.fn().mockResolvedValue(mail),
    buildInvitationReminder: jest.fn().mockResolvedValue(mail),
    buildVerification: jest.fn().mockReturnValue(mail),
    buildCompletedNotifications: jest.fn().mockResolvedValue([mail]),
    buildDocumentsCopy: jest.fn().mockResolvedValue([mail]),
    buildDeclined: jest.fn().mockReturnValue([mail]),
  };
  const codes = { generateSubmitterCode: jest.fn().mockReturnValue('123456') };
  const delivery = {
    sendTemplate: jest.fn().mockResolvedValue({ status: 'sent' }),
  };
  const realtime = { publish: jest.fn() };
  const processor = new MailProcessor(
    submitters as unknown as Repository<Submitter>,
    events as unknown as Repository<SubmissionEvent>,
    queue as unknown as Queue,
    builder as unknown as MailDeliveryBuilder,
    codes as unknown as EmailVerificationCodeService,
    delivery as unknown as MailService,
    realtime as unknown as RealtimeService,
  );
  return {
    processor,
    submitter,
    submission,
    submitters,
    events,
    queue,
    builder,
    codes,
    delivery,
    realtime,
  };
}
let errorLog: jest.SpyInstance;
let warningLog: jest.SpyInstance;
beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  errorLog = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  warningLog = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());
it.each([
  [runtimeJobNames.deliverSignatureRequestEmail, 'email_sent'],
  [runtimeJobNames.deliverReminderEmail, 'send_reminder_email'],
  [runtimeJobNames.deliverSubmitterVerificationEmail, 'email_2fa_sent'],
] as const)(
  'records a successful %s delivery and publishes a realtime event',
  async (name, eventType) => {
    const {
      processor,
      submitter,
      events,
      delivery,
      realtime,
      codes,
      builder,
      submitters,
    } = setup();
    await processor.process(job(name));
    expect(delivery.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'en',
        delivery: {
          attempt: 2,
          jobId: 'job',
          submissionId: 'submission',
          submitterId: 'signer',
        },
      }),
    );
    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'tenant',
        submissionId: 'submission',
        submitterId: 'signer',
        eventType,
      }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'tenant',
        template_id: 'template',
        type: `mail.${eventType}`,
        submission_id: 'submission',
      }),
    );
    expect(submitters.findOneOrFail).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'signer' },
        relations: {
          account: true,
          submission: {
            createdByUser: true,
            submitters: true,
            template: { author: true },
          },
        },
      }),
    );
    if (name === runtimeJobNames.deliverSignatureRequestEmail)
      expect(submitter.sentAt).toBeInstanceOf(Date);
    if (name === runtimeJobNames.deliverReminderEmail)
      expect(events.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reminder_index: 3 }) as unknown,
        }),
      );
    if (name === runtimeJobNames.deliverSubmitterVerificationEmail) {
      expect(codes.generateSubmitterCode).toHaveBeenCalledWith(submitter);
      expect(builder.buildVerification).toHaveBeenCalledWith(
        submitter,
        '123456',
      );
    }
  },
);
it('retains the original invitation sent time on retry', async () => {
  const { processor, submitter } = setup();
  const previous = new Date('2026-01-01');
  submitter.sentAt = previous;
  await processor.process(job(runtimeJobNames.deliverSignatureRequestEmail));
  expect(submitter.sentAt).toBe(previous);
});
it.each([
  runtimeJobNames.deliverSignatureRequestEmail,
  runtimeJobNames.deliverReminderEmail,
  runtimeJobNames.deliverSubmitterVerificationEmail,
] as const)(
  'skips a suppressed %s mail without saving delivery events',
  async (name) => {
    const { processor, builder, delivery, events } = setup();
    builder.buildInvitation.mockResolvedValue(null);
    builder.buildInvitationReminder.mockResolvedValue(null);
    builder.buildVerification.mockReturnValue(null);
    await processor.process(job(name));
    expect(delivery.sendTemplate).not.toHaveBeenCalled();
    expect(events.save).not.toHaveBeenCalled();
  },
);
it.each([
  runtimeJobNames.deliverDocumentsCopyEmail,
  runtimeJobNames.deliverDeclinedEmail,
] as const)(
  'dispatches %s notifications to all configured recipients',
  async (name) => {
    const { processor, builder, delivery, submitter } = setup();
    await processor.process(job(name));
    expect(delivery.sendTemplate).toHaveBeenCalledTimes(1);
    if (name === runtimeJobNames.deliverDeclinedEmail)
      expect(builder.buildDeclined).toHaveBeenCalledWith(
        submitter,
        'Please revise',
      );
    else expect(builder.buildDocumentsCopy).toHaveBeenCalledWith(submitter);
  },
);
it('sends final completed notices once for the latest completed signer', async () => {
  const { processor, submitter, submission, builder, delivery } = setup();
  submitter.completedAt = new Date('2026-01-02');
  const earlier = {
    ...submitter,
    id: 'earlier',
    completedAt: new Date('2026-01-01'),
  };
  submission.submitters = [earlier, submitter];
  await processor.process(job(runtimeJobNames.deliverCompletedEmail));
  expect(builder.buildCompletedNotifications).toHaveBeenCalledWith(submitter);
  expect(builder.buildDocumentsCopy).toHaveBeenCalledWith(submitter);
  expect(delivery.sendTemplate).toHaveBeenCalledTimes(2);
  submitter.completedAt = new Date('2025-12-01');
  delivery.sendTemplate.mockClear();
  await processor.process(job(runtimeJobNames.deliverCompletedEmail));
  expect(delivery.sendTemplate).not.toHaveBeenCalled();
});
it('queues the next eligible signer after a partial sequential completion', async () => {
  const { processor, submitter, submission, queue, delivery } = setup();
  submitter.completedAt = new Date();
  submission.submitters.push(
    { ...submitter, id: 'declined', completedAt: null, declinedAt: new Date() },
    { ...submitter, id: 'sent', completedAt: null, sentAt: new Date() },
    { ...submitter, id: 'next', completedAt: null },
  );
  await processor.process(job(runtimeJobNames.deliverCompletedEmail));
  expect(queue.add).toHaveBeenCalledWith(
    runtimeJobNames.deliverSignatureRequestEmail,
    { submitterId: 'next' },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10000 },
      removeOnComplete: true,
    },
  );
  expect(delivery.sendTemplate).not.toHaveBeenCalled();
});
it.each([
  'random order',
  'missing email',
  'mail disabled',
  'already sent',
  'already declined',
])('does not queue a next invitation with %s', async (mode) => {
  const { processor, submitter, submission, queue } = setup();
  submitter.completedAt = new Date();
  const next = { ...submitter, id: 'next', completedAt: null };
  if (mode === 'random order') submission.submittersOrder = 'random';
  if (mode === 'missing email') next.email = null;
  if (mode === 'mail disabled') next.preferences = { send_email: false };
  if (mode === 'already sent') next.sentAt = new Date();
  if (mode === 'already declined') next.declinedAt = new Date();
  submission.submitters.push(next);
  await processor.process(job(runtimeJobNames.deliverCompletedEmail));
  expect(queue.add).not.toHaveBeenCalled();
});
it('records skipped and failed deliveries with formatted recipients and propagates retryable failures', async () => {
  const { processor, builder, delivery, events } = setup();
  builder.buildInvitation.mockResolvedValue({
    ...mail,
    to: [
      { email: 'first@example.test', name: 'First' },
      { email: 'second@example.test' },
    ],
  });
  delivery.sendTemplate.mockResolvedValueOnce({ status: 'skipped' });
  await processor.process(job(runtimeJobNames.deliverSignatureRequestEmail));
  expect(events.create).toHaveBeenLastCalledWith(
    expect.objectContaining({
      eventType: 'email_skipped',
      data: {
        template: mail.template,
        to: ['First <first@example.test>', 'second@example.test'],
      },
    }),
  );
  delivery.sendTemplate.mockResolvedValueOnce({ status: 'failed' });
  await expect(
    processor.process(job(runtimeJobNames.deliverSignatureRequestEmail)),
  ).rejects.toThrow('Mail delivery failed');
  expect(events.create).toHaveBeenLastCalledWith(
    expect.objectContaining({
      eventType: 'email_failed',
      data: expect.objectContaining({
        attempt: 2,
        error: 'Mail delivery failed',
        job_id: 'job',
      }) as unknown,
    }),
  );
  delivery.sendTemplate.mockRejectedValueOnce('provider unavailable');
  await expect(
    processor.process(job(runtimeJobNames.deliverSignatureRequestEmail)),
  ).rejects.toBe('provider unavailable');
  expect(events.create).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        error: 'provider unavailable',
      }) as unknown,
    }),
  );
});
it('prioritizes explicit mail locale, then job locale, then account locale', async () => {
  const { processor, builder, delivery } = setup();
  builder.buildInvitation.mockResolvedValueOnce({ ...mail, locale: 'fr' });
  await processor.process(
    job(runtimeJobNames.deliverSignatureRequestEmail, { locale: 'de' }),
  );
  expect(delivery.sendTemplate).toHaveBeenLastCalledWith(
    expect.objectContaining({ locale: 'fr' }),
  );
  await processor.process(
    job(runtimeJobNames.deliverSignatureRequestEmail, { locale: 'de' }),
  );
  expect(delivery.sendTemplate).toHaveBeenLastCalledWith(
    expect.objectContaining({ locale: 'de' }),
  );
});
it('logs unknown jobs and worker lifecycle failures without attempting delivery', async () => {
  const { processor, delivery } = setup();
  await processor.process(job('unknown' as MailJobName));
  expect(warningLog).toHaveBeenCalledWith('Unknown mail job');
  const error = new Error('queue failure');
  processor.onFailed(undefined, error);
  processor.onFailed(job(runtimeJobNames.deliverDocumentsCopyEmail), error);
  processor.onError(error);
  processor.onCompleted(job(runtimeJobNames.deliverDocumentsCopyEmail));
  expect(errorLog).toHaveBeenCalledWith(
    'Mail job unknown failed: queue failure',
    error.stack,
  );
  expect(errorLog).toHaveBeenCalledWith(
    'Mail worker error: queue failure',
    error.stack,
  );
  expect(delivery.sendTemplate).not.toHaveBeenCalled();
});
it.each([
  runtimeJobNames.deliverReminderEmail,
  runtimeJobNames.deliverSubmitterVerificationEmail,
] as const)(
  'records a skipped %s delivery without a successful-send event',
  async (name) => {
    const { processor, delivery, events, submitters } = setup();
    delivery.sendTemplate.mockResolvedValue({ status: 'skipped' });
    await processor.process(job(name));
    expect(events.create).toHaveBeenCalledTimes(1);
    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'email_skipped',
        data: { template: mail.template, to: ['Signer <signer@example.test>'] },
      }),
    );
    expect(submitters.save).not.toHaveBeenCalled();
  },
);
