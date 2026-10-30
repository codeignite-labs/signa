import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { RealtimeService } from '../realtime/realtime.service';
import { throwDatabaseErrors, throwIfNotFound } from '../common/utils/error';
import { SubmissionsService } from '../submissions/submissions.service';
import { TemplatesService } from '../templates/templates.service';
import { User } from '../users/entities/user.entity';
import { queueNames } from '../runtime/queue-options';
import { runtimeJobNames } from '../runtime/runtime-jobs';
import {
  CreateWebhookUrlDto,
  ListWebhookEventsQueryDto,
  UpdateWebhookUrlDto,
  WebhookEventResponseDto,
  WebhookEventsListResponseDto,
  WebhookUrlResponseDto,
  WebhookUrlsListResponseDto,
} from './dto/webhook-url.dto';
import { WebhookAttempt } from './entities/webhook-attempt.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { WebhookUrl } from './entities/webhook-url.entity';
import {
  getWebhookRecordKind,
  isWebhookEventType,
  type WebhookEventType,
  webhookEventTypes,
} from './webhook-events';
import { signWebhookPayload } from './webhook-signatures';
import type { WebhookQueuePayload } from './webhook.types';

const manualAttempt = 99_999;

@Injectable()
export class WebhooksService {
  constructor(
    @InjectRepository(WebhookUrl)
    private readonly webhookUrls: Repository<WebhookUrl>,
    @InjectRepository(WebhookEvent)
    private readonly webhookEvents: Repository<WebhookEvent>,
    @InjectRepository(WebhookAttempt)
    private readonly webhookAttempts: Repository<WebhookAttempt>,
    @InjectQueue(queueNames.webhooks) private readonly webhookQueue: Queue,
    private readonly submissionsService: SubmissionsService,
    private readonly templatesService: TemplatesService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeService,
  ) {}

  async listWebhooks(user: User): Promise<WebhookUrlsListResponseDto> {
    const urls = await this.webhookUrls.find({
      where: { accountId: user.accountId },
      order: { id: 'DESC' },
    });

    return { data: urls.map((url) => this.toWebhookUrlResponse(url)) };
  }

  async createWebhook(
    user: User,
    input: CreateWebhookUrlDto,
  ): Promise<WebhookUrlResponseDto> {
    const webhookUrl = this.webhookUrls.create({
      accountId: user.accountId,
      events: input.events?.length ? input.events : [...webhookEventTypes],
      secret: input.secret ?? {},
      url: input.url,
    });

    try {
      return this.toWebhookUrlResponse(await this.webhookUrls.save(webhookUrl));
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async getWebhook(user: User, id: string): Promise<WebhookUrlResponseDto> {
    return this.toWebhookUrlResponse(await this.findWebhookOrFail(user, id));
  }

  async updateWebhook(
    user: User,
    id: string,
    input: UpdateWebhookUrlDto,
  ): Promise<WebhookUrlResponseDto> {
    const webhookUrl = await this.findWebhookOrFail(user, id);

    webhookUrl.url = input.url ?? webhookUrl.url;
    webhookUrl.events = input.events ?? webhookUrl.events;
    webhookUrl.secret = input.secret ?? webhookUrl.secret;

    try {
      return this.toWebhookUrlResponse(await this.webhookUrls.save(webhookUrl));
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async deleteWebhook(user: User, id: string): Promise<WebhookUrlResponseDto> {
    const webhookUrl = await this.findWebhookOrFail(user, id);
    const response = this.toWebhookUrlResponse(webhookUrl);

    try {
      await this.webhookUrls.remove(webhookUrl);
      return response;
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async listWebhookEvents(
    user: User,
    id: string,
    query: ListWebhookEventsQueryDto,
  ): Promise<WebhookEventsListResponseDto> {
    const webhookUrl = await this.findWebhookOrFail(user, id);
    const builder = this.webhookEvents
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.attempts', 'attempt')
      .where('event.webhook_url_id = :webhookUrlId', {
        webhookUrlId: webhookUrl.id,
      })
      .orderBy('event.id', 'DESC')
      .addOrderBy('attempt.id', 'DESC')
      .limit(Math.min(query.limit ?? 20, 100));

    if (query.status) {
      builder.andWhere('event.status = :status', { status: query.status });
    }

    const events = await builder.getMany();

    return { data: events.map((event) => this.toWebhookEventResponse(event)) };
  }

  async testWebhook(user: User, id: string): Promise<void> {
    const webhookUrl = await this.findWebhookOrFail(user, id);
    const completed =
      await this.submissionsService.findLatestCompletedSubmitter(
        user.accountId,
      );

    if (!completed) {
      throw new UnprocessableEntityException({
        error: 'Completed submitter not found',
      });
    }

    await this.enqueueWebhookEvent({
      accountId: user.accountId,
      eventType: 'form.completed',
      recordId: completed.id,
      webhookUrl,
    });
  }

  async enqueueAccountEvent(options: {
    accountId: string;
    eventType: WebhookEventType;
    recordId: string;
  }): Promise<WebhookQueuePayload[]> {
    const urls = await this.webhookUrls.find({
      where: { accountId: options.accountId },
    });

    const jobs: WebhookQueuePayload[] = [];

    for (const webhookUrl of urls) {
      if (!webhookUrl.events.includes(options.eventType)) {
        continue;
      }

      jobs.push(await this.enqueueWebhookEvent({ ...options, webhookUrl }));
    }

    return jobs;
  }

  async resendWebhookEvent(user: User, eventId: string): Promise<void> {
    const event = await this.webhookEvents.findOne({
      where: { id: eventId, accountId: user.accountId },
      relations: { webhookUrl: true },
    });

    if (!event || !isWebhookEventType(event.eventType)) {
      throw new NotFoundException({ error: 'Webhook event not found' });
    }

    await this.deliverWebhook({
      attempt: manualAttempt,
      eventType: event.eventType,
      eventUuid: event.uuid,
      recordId: event.recordId,
      webhookUrlId: event.webhookUrlId,
    });
  }

  async deliverWebhook(job: WebhookQueuePayload): Promise<boolean> {
    const webhookUrl = await this.webhookUrls.findOne({
      where: { id: job.webhookUrlId },
    });

    if (!webhookUrl || !webhookUrl.events.includes(job.eventType)) {
      return true;
    }

    const event = await this.findOrCreateWebhookEvent(job, webhookUrl);

    if (event.status === 'success' && (job.attempt ?? 0) < manualAttempt) {
      return true;
    }

    const payload = {
      event_type: job.eventType,
      timestamp: event.createdAt,
      data: await this.buildPayload(job.eventType, job.recordId),
    };
    const body = JSON.stringify(payload);

    event.payload = payload;
    await this.webhookEvents.save(event);

    const response = await this.postWebhook(webhookUrl, body);

    await this.recordAttempt(event, {
      attempt: job.attempt ?? 0,
      body: response.body,
      statusCode: response.statusCode,
    });

    event.status =
      response.statusCode === 0 || response.statusCode >= 400
        ? 'error'
        : 'success';
    await this.webhookEvents.save(event);
    this.realtime.publish({
      account_id: event.accountId,
      data: {
        event_type: job.eventType,
        response_status_code: response.statusCode,
        status: event.status,
        webhook_event_id: event.id,
      },
      id: `webhook:${event.webhookUrlId}:event:${event.id}:${job.attempt ?? 0}`,
      record_id: event.id,
      type: 'webhook.delivery.updated',
      webhook_url_id: event.webhookUrlId,
    });

    return event.status === 'success';
  }

  private async enqueueWebhookEvent(options: {
    accountId: string;
    eventType: WebhookEventType;
    recordId: string;
    webhookUrl: WebhookUrl;
  }): Promise<WebhookQueuePayload> {
    const payload = {
      eventType: options.eventType,
      eventUuid: randomUUID(),
      recordId: options.recordId,
      webhookUrlId: options.webhookUrl.id,
    };

    await this.webhookQueue.add(runtimeJobNames.deliverWebhook, payload, {
      attempts: 1,
      removeOnComplete: true,
    });

    return payload;
  }

  private async findOrCreateWebhookEvent(
    job: WebhookQueuePayload,
    webhookUrl: WebhookUrl,
  ): Promise<WebhookEvent> {
    const existing = await this.webhookEvents.findOne({
      where: { uuid: job.eventUuid, webhookUrlId: webhookUrl.id },
    });

    if (existing) {
      return existing;
    }

    return this.webhookEvents.save(
      this.webhookEvents.create({
        accountId: webhookUrl.accountId,
        eventType: job.eventType,
        recordId: job.recordId,
        recordType: getWebhookRecordKind(job.eventType),
        status: 'pending',
        uuid: job.eventUuid,
        webhookUrlId: webhookUrl.id,
      }),
    );
  }

  private async buildPayload(
    eventType: WebhookEventType,
    recordId: string,
  ): Promise<Record<string, unknown>> {
    const kind = getWebhookRecordKind(eventType);

    if (kind === 'form') {
      return this.submissionsService.getSubmitterWebhookPayload(recordId);
    }

    if (kind === 'submission') {
      if (eventType === 'submission.archived') {
        return this.submissionsService.getSubmissionArchiveWebhookPayload(
          recordId,
        );
      }

      return this.submissionsService.getSubmissionWebhookPayload(recordId);
    }

    if (eventType === 'template.archived') {
      return this.templatesService.getTemplateArchiveWebhookPayload(recordId);
    }

    return this.templatesService.getTemplateWebhookPayload(recordId);
  }

  private async postWebhook(
    webhookUrl: WebhookUrl,
    body: string,
  ): Promise<{ body: string | null; statusCode: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.get<number>('WEBHOOK_TIMEOUT_MS', 10_000),
    );

    try {
      const response = await fetch(webhookUrl.url, {
        body,
        headers: this.buildHeaders(webhookUrl, body),
        method: 'POST',
        signal: controller.signal,
      });

      return {
        body: truncate(await response.text()),
        statusCode: response.status,
      };
    } catch (error) {
      return {
        body: truncate(
          error instanceof Error ? error.message : 'Webhook error',
        ),
        statusCode: 0,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildHeaders(webhookUrl: WebhookUrl, body: string): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'User-Agent': 'DocuSeal.com Webhook',
      ...webhookUrl.secret,
      'X-Docuseal-Signature': signWebhookPayload({
        body,
        secret: webhookUrl.hmacSecret,
      }),
    };
  }

  private async recordAttempt(
    event: WebhookEvent,
    input: { attempt: number; body: string | null; statusCode: number },
  ): Promise<void> {
    await this.webhookAttempts.save(
      this.webhookAttempts.create({
        attempt: input.attempt,
        responseBody:
          input.statusCode === 0 || input.statusCode >= 400 ? input.body : null,
        responseStatusCode: input.statusCode,
        webhookEventId: event.id,
      }),
    );
  }

  private async findWebhookOrFail(user: User, id: string): Promise<WebhookUrl> {
    try {
      return await this.webhookUrls.findOneByOrFail({
        id,
        accountId: user.accountId,
      });
    } catch (error) {
      throwIfNotFound(error, 'Webhook not found');
    }
  }

  private toWebhookUrlResponse(webhookUrl: WebhookUrl): WebhookUrlResponseDto {
    return {
      id: webhookUrl.id,
      created_at: webhookUrl.createdAt,
      events: webhookUrl.events,
      hmac_secret: webhookUrl.hmacSecret,
      secret: webhookUrl.secret,
      updated_at: webhookUrl.updatedAt,
      url: webhookUrl.url,
    };
  }

  private toWebhookEventResponse(event: WebhookEvent): WebhookEventResponseDto {
    return {
      id: event.id,
      attempts: (event.attempts ?? []).map((attempt) => ({
        id: attempt.id,
        attempt: attempt.attempt,
        created_at: attempt.createdAt,
        response_body: attempt.responseBody,
        response_status_code: attempt.responseStatusCode,
      })),
      created_at: event.createdAt,
      event_type: event.eventType,
      payload: event.payload,
      record_id: event.recordId,
      record_type: event.recordType,
      status: event.status,
      uuid: event.uuid,
    };
  }
}

function truncate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.length > 100 ? value.slice(0, 100) : value;
}
