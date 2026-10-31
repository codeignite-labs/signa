import {
  Body,
  Controller,
  ForbiddenException,
  ServiceUnavailableException,
  Get,
  NotFoundException,
  UseGuards,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { MailgunWebhookService } from './mailgun-webhook.service';
import { JwtGuard } from '../auth/guards/jwt/jwt.guard';
import { AdminGuard } from '../auth/guards/admin/admin.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { User } from '../users/entities/user.entity';
import { EmailEvent } from './entities/email-event.entity';
import { EmailMessage } from './entities/email-message.entity';

@Controller('email-events')
@ApiTags('Email Events')
export class MailProviderEventsController {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(EmailEvent)
    private readonly emailEvents: Repository<EmailEvent>,
    @InjectRepository(EmailMessage)
    private readonly emailMessages: Repository<EmailMessage>,
    private readonly mailgun: MailgunWebhookService,
  ) {}

  @Post('provider')
  @ApiOperation({
    description:
      'Receives normalized provider events such as delivered, opened, clicked, bounced, or failed. Requires a configured callback secret or valid Mailgun authentication.',
    summary: 'Record email provider event',
  })
  @ApiQuery({
    description:
      'Optional callback secret when the provider cannot send the x-signa-callback-secret header.',
    name: 'secret',
    required: false,
  })
  @ApiBody({
    description:
      'Raw provider webhook payload. Arrays and single event objects are accepted.',
    schema: {
      example: {
        email: 'recipient@example.com',
        event: 'delivered',
        message_id: '<mailgun-message-id>',
        timestamp: 1782748800,
      },
      type: 'object',
    },
  })
  async recordProviderEvent(
    @Body() body: unknown,
    @Headers('x-signa-callback-secret') headerSecret?: string,
    @Query('secret') querySecret?: string,
  ): Promise<{ status: 'ok' }> {
    this.assertCallbackSecret(headerSecret ?? querySecret);
    if (this.config.get<string>('MAILGUN_WEBHOOK_SIGNING_KEY')) {
      await this.mailgun.recordOnce(body, (manager) =>
        this.persistEvents(body, manager),
      );
    } else {
      await this.persistEvents(body);
    }
    return { status: 'ok' };
  }

  private async persistEvents(
    body: unknown,
    manager?: EntityManager,
  ): Promise<void> {
    const messages = manager?.getRepository(EmailMessage) ?? this.emailMessages;
    const events = manager?.getRepository(EmailEvent) ?? this.emailEvents;
    for (const event of normalizeProviderEvents(body)) {
      const message = event.messageId
        ? await messages.findOne({ where: { messageId: event.messageId } })
        : null;
      await events.save(
        events.create({
          accountId: message?.accountId ?? null,
          data: event.data,
          email: event.email,
          emailMessageId: message?.id ?? null,
          emailableId: null,
          emailableType: null,
          eventDatetime: event.eventDatetime,
          eventType: event.eventType,
          messageId: event.messageId,
        }),
      );
    }
  }

  @Get('messages')
  @UseGuards(JwtGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    description:
      'Lists recently queued/sent email messages, optionally scoped to one submission or submitter for debugging delivery.',
    summary: 'List email messages',
  })
  @ApiQuery({
    description: 'Optional submission id filter.',
    name: 'submission_id',
    required: false,
  })
  @ApiQuery({
    description: 'Optional submitter id filter.',
    name: 'submitter_id',
    required: false,
  })
  @ApiOkResponse({ type: Object })
  async listMessages(
    @CurrentUser() user: User,
    @Query('submission_id') submissionId?: string,
    @Query('submitter_id') submitterId?: string,
  ): Promise<{ data: EmailMessage[] }> {
    return {
      data: await this.emailMessages.find({
        where: {
          accountId: user.accountId,
          ...(submissionId ? { submissionId } : {}),
          ...(submitterId ? { submitterId } : {}),
        },
        order: { id: 'DESC' },
        take: 100,
      }),
    };
  }

  @Get('messages/:id/events')
  @UseGuards(JwtGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiParam({ description: 'Email message id.', name: 'id' })
  @ApiOperation({
    description:
      'Lists provider events recorded for a queued email message, including delivery and failure provider payloads.',
    summary: 'List email message events',
  })
  @ApiOkResponse({ type: Object })
  async listMessageEvents(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<{ data: EmailEvent[] }> {
    const message = await this.emailMessages.findOneBy({
      id,
      accountId: user.accountId,
    });
    if (!message) {
      throw new NotFoundException({ error: 'Email message not found' });
    }

    return {
      data: await this.emailEvents.find({
        where: {
          accountId: user.accountId,
          emailMessageId: message.id,
        },
        order: { id: 'DESC' },
        take: 100,
      }),
    };
  }

  private assertCallbackSecret(providedSecret: string | undefined): void {
    const configuredSecret = this.config.get<string>('MAIL_CALLBACK_SECRET');

    if (!configuredSecret) {
      if (!this.config.get<string>('MAILGUN_WEBHOOK_SIGNING_KEY')) {
        throw new ServiceUnavailableException({
          error: 'Email callback authentication is not configured',
        });
      }
      return;
    }

    if (providedSecret !== configuredSecret) {
      throw new ForbiddenException({ error: 'Invalid callback secret' });
    }
  }
}

type NormalizedEmailProviderEvent = {
  data: Record<string, unknown>;
  email: string;
  eventDatetime: Date;
  eventType: string;
  messageId: string | null;
};

function normalizeProviderEvents(
  body: unknown,
): NormalizedEmailProviderEvent[] {
  const records = Array.isArray(body) ? body : [body];

  return records.filter(isRecord).map(normalizeProviderEvent);
}

function normalizeProviderEvent(
  record: Record<string, unknown>,
): NormalizedEmailProviderEvent {
  const event = isRecord(record['event-data']) ? record['event-data'] : record;
  const message = isRecord(event.message) ? event.message : null;
  const headers = message && isRecord(message.headers) ? message.headers : null;
  return {
    data: event,
    email:
      stringValue(event.email) ??
      stringValue(event.recipient) ??
      stringValue(event.to) ??
      'unknown@example.invalid',
    eventDatetime: dateValue(event.timestamp) ?? new Date(),
    eventType:
      stringValue(event.event) ??
      stringValue(event.event_type) ??
      stringValue(event.type) ??
      'provider_event',
    messageId:
      stringValue(event.message_id) ??
      stringValue(event.messageId) ??
      stringValue(event['MessageID']) ??
      stringValue(headers?.['message-id']),
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function dateValue(value: unknown): Date | null {
  if (typeof value === 'number') {
    return new Date(value * 1000);
  }

  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
