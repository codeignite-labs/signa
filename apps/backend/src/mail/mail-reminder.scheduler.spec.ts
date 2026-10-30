import { runtimeJobNames } from '../runtime/runtime-jobs';
import { MailReminderScheduler } from './mail-reminder.scheduler';

describe('MailReminderScheduler', () => {
  it('queues the next due reminder email once', async () => {
    const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const submitter = {
      id: 'submitter-1',
      accountId: 'account-1',
      sentAt,
      preferences: { send_email: true },
    };
    const queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([submitter]),
    };
    const accountConfigs = {
      find: jest.fn().mockResolvedValue([
        {
          accountId: 'account-1',
          value: {
            first_duration: 'one_hour',
            second_duration: null,
            third_duration: null,
          },
        },
      ]),
    };
    const submissionEvents = {
      count: jest.fn().mockResolvedValue(0),
    };
    const submitters = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const mailQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    };
    const scheduler = new MailReminderScheduler(
      accountConfigs as never,
      submissionEvents as never,
      submitters as never,
      mailQueue as never,
    );

    await scheduler.enqueueDueReminders();

    expect(mailQueue.add).toHaveBeenCalledWith(
      runtimeJobNames.deliverReminderEmail,
      { reminderIndex: 1, submitterId: 'submitter-1' },
      expect.objectContaining({
        jobId: 'submitter-reminder:submitter-1:1',
      }),
    );
  });

  it('queues the second configured reminder after the first reminder event', async () => {
    const sentAt = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const submitter = {
      id: 'submitter-1',
      accountId: 'account-1',
      sentAt,
      preferences: { send_email: true },
    };
    const queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([submitter]),
    };
    const accountConfigs = {
      find: jest.fn().mockResolvedValue([
        {
          accountId: 'account-1',
          value: {
            first_duration: 'one_hour',
            second_duration: 'two_hours',
            third_duration: null,
          },
        },
      ]),
    };
    const submissionEvents = {
      count: jest.fn().mockResolvedValue(1),
    };
    const submitters = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const mailQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    };
    const scheduler = new MailReminderScheduler(
      accountConfigs as never,
      submissionEvents as never,
      submitters as never,
      mailQueue as never,
    );

    await scheduler.enqueueDueReminders();

    expect(mailQueue.add).toHaveBeenCalledWith(
      runtimeJobNames.deliverReminderEmail,
      { reminderIndex: 2, submitterId: 'submitter-1' },
      expect.objectContaining({
        jobId: 'submitter-reminder:submitter-1:2',
      }),
    );
  });

  it('does not queue reminders for submitters that disabled email delivery', async () => {
    const submitter = {
      id: 'submitter-1',
      accountId: 'account-1',
      sentAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      preferences: { send_email: false },
    };
    const queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([submitter]),
    };
    const mailQueue = { add: jest.fn() };
    const scheduler = new MailReminderScheduler(
      { find: jest.fn() } as never,
      { count: jest.fn() } as never,
      { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) } as never,
      mailQueue as never,
    );

    await scheduler.enqueueDueReminders();

    expect(mailQueue.add).not.toHaveBeenCalled();
  });
});

describe('reminder scheduling boundaries', () => {
  function setup(value: unknown = { first_duration: 'one_hour' }, count = 0) {
    const candidate = {
      id: 'recipient',
      accountId: 'organization',
      sentAt: new Date(Date.now() - 7200000),
      preferences: { send_email: true },
    };
    const query = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([candidate]),
    };
    const configs = {
      find: jest.fn().mockResolvedValue([{ accountId: 'organization', value }]),
    };
    const events = { count: jest.fn().mockResolvedValue(count) };
    const queue = { add: jest.fn() };
    const scheduler = new MailReminderScheduler(
      configs as never,
      events as never,
      { createQueryBuilder: () => query } as never,
      queue as never,
    );
    return { scheduler, candidate, configs, events, queue };
  }
  it.each([
    null,
    [],
    { first_duration: null },
    { first_duration: 'unknown_duration' },
  ])(
    'does not queue malformed or disabled reminder configurations %#',
    async (value) => {
      const { scheduler, queue } = setup(value);
      await scheduler.enqueueDueReminders();
      expect(queue.add).not.toHaveBeenCalled();
    },
  );
  it('does not enqueue a reminder before its due time', async () => {
    const { scheduler, candidate, queue } = setup();
    candidate.sentAt = new Date();
    await scheduler.enqueueDueReminders();
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('stops after all configured reminder slots have been used', async () => {
    const { scheduler, queue } = setup({ first_duration: 'one_hour' }, 3);
    await scheduler.enqueueDueReminders();
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('skips accounts with no reminder configuration', async () => {
    const { scheduler, configs, events, queue } = setup();
    configs.find.mockResolvedValue([]);
    await scheduler.enqueueDueReminders();
    expect(events.count).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
