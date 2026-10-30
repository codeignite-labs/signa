import { BullRootModuleOptions } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

export const queueNames = {
  documentGeneration: 'document-generation',
  mail: 'mail',
  maintenance: 'maintenance',
  sms: 'sms',
  webhooks: 'webhooks',
} as const;

export type QueueName = (typeof queueNames)[keyof typeof queueNames];

export function createQueueOptions(
  config: ConfigService,
): BullRootModuleOptions {
  return {
    connection: getQueueConnection(config),
    prefix: config.get<string>('QUEUE_PREFIX', 'signa'),
    defaultJobOptions: {
      attempts: config.get<number>('QUEUE_DEFAULT_ATTEMPTS', 3),
      backoff: {
        type: 'exponential',
        delay: config.get<number>('QUEUE_BACKOFF_MS', 5000),
      },
      removeOnComplete: config.get<number>('QUEUE_REMOVE_ON_COMPLETE', 1000),
      removeOnFail: config.get<number>('QUEUE_REMOVE_ON_FAIL', 5000),
    },
  };
}

function getQueueConnection(config: ConfigService) {
  const queueRedisUrl =
    config.get<string>('QUEUE_REDIS_URL') ||
    config.get<string>('REDIS_URL') ||
    'redis://localhost:6379';

  return { url: queueRedisUrl };
}
