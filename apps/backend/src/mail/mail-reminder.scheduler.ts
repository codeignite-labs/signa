import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';
import { AccountConfig } from '../accounts/entities/account-config.entity';
import { runtimeJobNames } from '../runtime/runtime-jobs';
import { queueNames } from '../runtime/queue-options';
import { SubmissionEvent } from '../submissions/entities/submission-event.entity';
import { Submitter } from '../submitters/entities/submitter.entity';
import type { MailJobMap } from './mail.types';

const reminderKeys = [
  'first_duration',
  'second_duration',
  'third_duration',
] as const;

type ReminderKey = (typeof reminderKeys)[number];

@Injectable()
export class MailReminderScheduler {
  private readonly logger = new Logger(MailReminderScheduler.name);

  constructor(
    @InjectRepository(AccountConfig)
    private readonly accountConfigs: Repository<AccountConfig>,
    @InjectRepository(SubmissionEvent)
    private readonly submissionEvents: Repository<SubmissionEvent>,
    @InjectRepository(Submitter)
    private readonly submitters: Repository<Submitter>,
    @InjectQueue(queueNames.mail)
    private readonly mailQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async enqueueDueReminders(): Promise<void> {
    const submitters = await this.findReminderCandidates();

    if (submitters.length === 0) {
      return;
    }

    const configs = await this.loadReminderConfigs(
      submitters.map((submitter) => submitter.accountId),
    );
    let queued = 0;

    for (const submitter of submitters) {
      const reminder = await this.getDueReminder(submitter, configs);

      if (!reminder) {
        continue;
      }

      await this.enqueueReminder({
        submitterId: submitter.id,
        reminderIndex: reminder.index,
      });
      queued += 1;
    }

    if (queued > 0) {
      this.logger.log(`Queued ${queued} signature request reminder email(s)`);
    }
  }

  private async findReminderCandidates(): Promise<Submitter[]> {
    return this.submitters
      .createQueryBuilder('submitter')
      .leftJoinAndSelect('submitter.submission', 'submission')
      .leftJoinAndSelect('submission.template', 'template')
      .where('submitter.sent_at IS NOT NULL')
      .andWhere('submitter.completed_at IS NULL')
      .andWhere('submitter.declined_at IS NULL')
      .andWhere('submitter.email IS NOT NULL')
      .andWhere('submission.archived_at IS NULL')
      .andWhere(
        '(submission.expire_at IS NULL OR submission.expire_at >= NOW())',
      )
      .andWhere('(template.id IS NULL OR template.archived_at IS NULL)')
      .orderBy('submitter.sent_at', 'ASC')
      .limit(250)
      .getMany()
      .then((submitters) =>
        submitters.filter(
          (submitter) => submitter.preferences?.send_email !== false,
        ),
      );
  }

  private async loadReminderConfigs(
    accountIds: string[],
  ): Promise<Map<string, Record<ReminderKey, string | null>>> {
    const configs = await this.accountConfigs.find({
      where: {
        accountId: In([...new Set(accountIds)]),
        key: 'submitter_reminders',
      },
    });
    const result = new Map<string, Record<ReminderKey, string | null>>();

    for (const config of configs) {
      result.set(config.accountId, normalizeReminderConfig(config.value));
    }

    return result;
  }

  private async getDueReminder(
    submitter: Submitter,
    configs: Map<string, Record<ReminderKey, string | null>>,
  ): Promise<{ index: number } | null> {
    const config = configs.get(submitter.accountId);

    if (!config || !submitter.sentAt) {
      return null;
    }

    const sentReminderCount = await this.submissionEvents.count({
      where: {
        submitterId: submitter.id,
        eventType: In(['send_reminder_email', 'email_reminder_sent']),
      },
    });
    const nextKey = reminderKeys[sentReminderCount];
    const duration = nextKey ? config[nextKey] : null;
    const dueAt = duration ? addDuration(submitter.sentAt, duration) : null;

    if (!dueAt || dueAt > new Date()) {
      return null;
    }

    return { index: sentReminderCount + 1 };
  }

  private async enqueueReminder(
    data: MailJobMap[typeof runtimeJobNames.deliverReminderEmail],
  ): Promise<void> {
    await this.mailQueue.add(runtimeJobNames.deliverReminderEmail, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      jobId: `submitter-reminder:${data.submitterId}:${data.reminderIndex}`,
      removeOnComplete: true,
    });
  }
}

function normalizeReminderConfig(
  value: unknown,
): Record<ReminderKey, string | null> {
  const record = isRecord(value) ? value : {};

  return {
    first_duration: stringOrNull(record.first_duration),
    second_duration: stringOrNull(record.second_duration),
    third_duration: stringOrNull(record.third_duration),
  };
}

function addDuration(date: Date, duration: string): Date | null {
  const hours = durationToHours[duration];

  return hours ? new Date(date.getTime() + hours * 60 * 60 * 1000) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

const durationToHours: Record<string, number> = {
  one_hour: 1,
  two_hours: 2,
  four_hours: 4,
  eight_hours: 8,
  twelve_hours: 12,
  twenty_four_hours: 24,
  two_days: 48,
  three_days: 72,
  four_days: 96,
  five_days: 120,
  six_days: 144,
  seven_days: 168,
  eight_days: 192,
  fifteen_days: 360,
  twenty_one_days: 504,
  thirty_days: 720,
};
