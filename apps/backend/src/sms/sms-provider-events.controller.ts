import {
  Body,
  Controller,
  ForbiddenException,
  ServiceUnavailableException,
  Headers,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import twilio from 'twilio';
import { SubmissionEvent } from '../submissions/entities/submission-event.entity';

@Controller('sms-events')
@ApiTags('SMS Events')
export class SmsProviderEventsController {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(SubmissionEvent)
    private readonly submissionEvents: Repository<SubmissionEvent>,
  ) {}

  @Post('twilio/status')
  @ApiOperation({
    description:
      'Receives Twilio status callbacks for SMS delivery and records provider status events against the originating submission.',
    summary: 'Record Twilio SMS status',
  })
  @ApiQuery({
    description:
      'Optional callback secret when Twilio cannot send x-signa-callback-secret.',
    name: 'secret',
    required: false,
  })
  @ApiBody({
    description: 'Raw Twilio status callback body.',
    schema: {
      example: {
        MessageSid: 'SMXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        MessageStatus: 'delivered',
        To: '+14155552671',
      },
      type: 'object',
    },
  })
  @ApiOkResponse({
    schema: {
      example: { status: 'ok' },
      properties: { status: { example: 'ok', type: 'string' } },
      type: 'object',
    },
  })
  async recordTwilioStatus(
    @Body() body: unknown,
    @Req() request: Request,
    @Headers('x-signa-callback-secret') headerSecret?: string,
    @Query('secret') querySecret?: string,
  ): Promise<{ status: 'ok' }> {
    this.assertCallbackSecret(headerSecret ?? querySecret);
    this.assertTwilioSignature(request, body);

    if (!isRecord(body)) {
      return { status: 'ok' };
    }

    const messageSid = stringValue(body.MessageSid) ?? stringValue(body.SmsSid);
    const status =
      stringValue(body.MessageStatus) ?? stringValue(body.SmsStatus);

    if (!messageSid || !status) {
      return { status: 'ok' };
    }

    const sendEvent = await this.submissionEvents
      .createQueryBuilder('event')
      .where("event.data ->> 'message_id' = :messageSid", { messageSid })
      .orderBy('event.id', 'DESC')
      .getOne();

    if (!sendEvent) {
      return { status: 'ok' };
    }

    await this.submissionEvents.save(
      this.submissionEvents.create({
        accountId: sendEvent.accountId,
        data: body,
        eventTimestamp: new Date(),
        eventType: `sms_${status}`,
        submissionId: sendEvent.submissionId,
        submitterId: sendEvent.submitterId,
      }),
    );

    return { status: 'ok' };
  }

  private assertCallbackSecret(providedSecret: string | undefined): void {
    const configuredSecret = this.config.get<string>('SMS_CALLBACK_SECRET');

    if (!configuredSecret) {
      if (!this.config.get<string>('TWILIO_AUTH_TOKEN')) {
        throw new ServiceUnavailableException({
          error: 'SMS callback authentication is not configured',
        });
      }
      return;
    }

    if (providedSecret !== configuredSecret) {
      throw new ForbiddenException({ error: 'Invalid callback secret' });
    }
  }

  private assertTwilioSignature(request: Request, body: unknown): void {
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const signature = request.header('x-twilio-signature');

    if (!authToken) return;
    if (!signature || !isRecord(body)) {
      throw new ForbiddenException({ error: 'Invalid Twilio signature' });
    }

    const apiBase = this.config.get<string>('API_PUBLIC_URL');
    const legacyOrigin = this.config.get<string>('PUBLIC_API_URL');
    const callbackPath = request.originalUrl.slice(
      request.originalUrl.indexOf('/sms-events/'),
    );
    const url = apiBase
      ? `${apiBase.replace(/\/$/, '')}${callbackPath}`
      : `${legacyOrigin ?? `${request.protocol}://${request.get('host')}`}${request.originalUrl}`;

    if (!twilio.validateRequest(authToken, signature, url, body)) {
      throw new ForbiddenException({ error: 'Invalid Twilio signature' });
    }
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
