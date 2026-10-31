import { ConfigService } from '@nestjs/config';
import { FindOperator } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { BrandingService } from '../branding/branding.service';
import { runtimeJobNames } from '../runtime/runtime-jobs';
import { SubmissionEvent } from '../submissions/entities/submission-event.entity';
import { Submission } from '../submissions/entities/submission.entity';
import { Submitter } from '../submitters/entities/submitter.entity';
import { Template } from '../templates/entities/template.entity';
import { createMailServiceFixture } from '../../test/support/mail-service.fixture';
import { EmailVerificationCodeService } from './email-verification-code.service';
import { MailBrandingService } from './mail-branding.service';
import { MailDeliveryBuilder } from './mail-delivery.builder';
import { MailProcessor } from './mail.processor';
import { MailReminderScheduler } from './mail-reminder.scheduler';
import { MailTemplateResolver } from './mail-template-resolver.service';

function createRecipient() {
  const template = Object.assign(new Template(), {
    name: 'Agreement',
    preferences: {},
    fields: [],
  });
  const submission = Object.assign(new Submission(), {
    id: '42',
    templateId: '7',
    template,
    preferences: {},
  });
  const recipient = Object.assign(new Submitter(), {
    id: '12',
    accountId: '1',
    email: 'recipient@example.test',
    name: 'Recipient',
    slug: 'recipient',
    uuid: 'party',
    sentAt: new Date(Date.now() - 3 * 3600000),
    preferences: { send_email: true },
    account: Object.assign(new Account(), { name: 'Organization' }),
    submissionId: submission.id,
    submission,
  });
  submission.submitters = [recipient];
  return recipient;
}

type EventFilter = {
  submitterId: string;
  eventType: string | FindOperator<string>;
};
function matchesFilter(
  event: Partial<SubmissionEvent>,
  where: EventFilter,
): boolean {
  const types: unknown =
    typeof where.eventType === 'string'
      ? [where.eventType]
      : where.eventType.value;
  return (
    event.submitterId === where.submitterId &&
    Array.isArray(types) &&
    types.includes(event.eventType)
  );
}
function createEventRepository(legacyHistory: boolean) {
  const recorded: Partial<SubmissionEvent>[] = legacyHistory
    ? [{ submitterId: '12', eventType: 'email_reminder_sent' }]
    : [];
  const events = {
    create: (event: Partial<SubmissionEvent>) => event,
    save: (event: Partial<SubmissionEvent>) => {
      recorded.push(event);
      return Promise.resolve({ ...event, id: String(recorded.length) });
    },
    count: ({ where }: { where: EventFilter }) =>
      Promise.resolve(
        recorded.filter((event) => matchesFilter(event, where)).length,
      ),
  };
  return { recorded, events };
}
function createRecipientRepository(submitter: Submitter) {
  const query = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([submitter]),
  };
  return {
    createQueryBuilder: () => query,
    findOneOrFail: jest.fn().mockResolvedValue(submitter),
  };
}

type Dependencies = {
  recipients: ReturnType<typeof createRecipientRepository>;
  events: ReturnType<typeof createEventRepository>['events'];
  queue: { add: jest.Mock };
};
function createScheduler({ events, recipients, queue }: Dependencies) {
  const configs = {
    find: jest.fn().mockResolvedValue([
      {
        accountId: '1',
        value: {
          first_duration: 'one_hour',
          second_duration: 'two_hours',
          third_duration: 'four_hours',
        },
      },
    ]),
  };
  return new MailReminderScheduler(
    configs as never,
    events as never,
    recipients as never,
    queue as never,
  );
}
function createProcessor({ events, recipients, queue }: Dependencies) {
  const transport = createMailServiceFixture();
  transport.encryptedConfigs.findOne.mockResolvedValue(null);
  const config = new ConfigService({
    FRONTEND_ORIGIN: 'https://sign.example.test',
    JWT_SECRET: 'fixture-secret',
  });
  const builder = new MailDeliveryBuilder(
    { findOne: jest.fn().mockResolvedValue(null) } as never,
    new MailBrandingService(config, {} as BrandingService),
    {} as never,
    new MailTemplateResolver(config),
    config,
  );
  const processor = new MailProcessor(
    recipients as never,
    events as never,
    queue as never,
    builder,
    new EmailVerificationCodeService(config),
    transport.service,
    { publish: jest.fn() } as never,
  );
  return { processor, transport };
}
function fixture(legacyHistory = false) {
  const { recorded, events } = createEventRepository(legacyHistory);
  const recipients = createRecipientRepository(createRecipient());
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const scheduler = createScheduler({ events, recipients, queue });
  const { processor, transport } = createProcessor({
    events,
    recipients,
    queue,
  });
  async function processReminder(index: number) {
    await processor.process({
      id: 'reminder-' + index,
      name: runtimeJobNames.deliverReminderEmail,
      attemptsMade: 0,
      data: { submitterId: '12', reminderIndex: index },
    } as Parameters<MailProcessor['process']>[0]);
  }
  return { scheduler, queue, recorded, processReminder, transport };
}

it('advances reminder slots only after successful delivery and waits until the next configured duration', async () => {
  const { scheduler, queue, recorded, processReminder, transport } = fixture();
  await scheduler.enqueueDueReminders();
  expect(queue.add).toHaveBeenLastCalledWith(
    runtimeJobNames.deliverReminderEmail,
    { submitterId: '12', reminderIndex: 1 },
    expect.any(Object),
  );
  await processReminder(1);
  expect(recorded).toMatchObject([{ eventType: 'send_reminder_email' }]);
  await scheduler.enqueueDueReminders();
  expect(queue.add).toHaveBeenLastCalledWith(
    runtimeJobNames.deliverReminderEmail,
    { submitterId: '12', reminderIndex: 2 },
    expect.any(Object),
  );
  await processReminder(2);
  await scheduler.enqueueDueReminders();
  expect(queue.add).toHaveBeenCalledTimes(2);
  expect(transport.mailer.sendMail).toHaveBeenCalledTimes(2);
});
it('counts legacy successful delivery events when deciding the next reminder slot', async () => {
  const { scheduler, queue } = fixture(true);
  await scheduler.enqueueDueReminders();
  expect(queue.add).toHaveBeenCalledWith(
    runtimeJobNames.deliverReminderEmail,
    { submitterId: '12', reminderIndex: 2 },
    expect.any(Object),
  );
});
