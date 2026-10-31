import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { createHmac } from 'node:crypto';
import { SmsProviderEventsController } from './sms-provider-events.controller';

const body = { MessageSid: 'SM123', MessageStatus: 'delivered' };
function request(
  signature?: string,
  originalUrl = '/api/sms-events/twilio/status',
): Request {
  return {
    originalUrl,
    protocol: 'http',
    header: () => signature,
    get: () => 'internal.example',
  } as unknown as Request;
}
function signed(url: string, payload: Record<string, string> = body): string {
  const input = Object.keys(payload)
    .sort()
    .reduce((value, key) => value + key + payload[key], url);
  return createHmac('sha1', 'token').update(input).digest('base64');
}
function setup(
  values: Record<string, string> = { SMS_CALLBACK_SECRET: 'secret' },
) {
  const query = {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue({
      accountId: 'organization',
      submissionId: 'document',
      submitterId: 'recipient',
    }),
  };
  const events = {
    createQueryBuilder: jest.fn().mockReturnValue(query),
    create: jest.fn((value: unknown) => value),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new SmsProviderEventsController(
    new ConfigService(values),
    events as never,
  );
  return { controller, events, query };
}

describe('SmsProviderEventsController', () => {
  it.each([null, [], {}])(
    'requires complete Twilio authentication when token configured %#',
    async (payload) => {
      const { controller, events } = setup({ TWILIO_AUTH_TOKEN: 'token' });
      await expect(
        controller.recordTwilioStatus(payload, request(), 'secret'),
      ).rejects.toMatchObject({
        response: { error: 'Invalid Twilio signature' },
      });
      expect(events.save).not.toHaveBeenCalled();
    },
  );

  it('rejects tampered callbacks before querying submission data', async () => {
    const { controller, events } = setup({ TWILIO_AUTH_TOKEN: 'token' });
    await expect(
      controller.recordTwilioStatus(body, request('wrong')),
    ).rejects.toMatchObject({
      response: { error: 'Invalid Twilio signature' },
    });
    expect(events.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('validates reverse proxy public URL using the same API_PUBLIC_URL as invitation sending', async () => {
    const { controller, events } = setup({
      TWILIO_AUTH_TOKEN: 'token',
      API_PUBLIC_URL: 'https://api.example/api/',
    });
    await controller.recordTwilioStatus(
      body,
      request(signed('https://api.example/api/sms-events/twilio/status')),
    );
    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'organization',
        submissionId: 'document',
        submitterId: 'recipient',
        eventType: 'sms_delivered',
        data: body,
      }),
    );
  });

  it('preserves callback query parameters in the signed URL', async () => {
    const { controller, events } = setup({
      TWILIO_AUTH_TOKEN: 'token',
      API_PUBLIC_URL: 'https://api.example/api',
      SMS_CALLBACK_SECRET: 'secret',
    });
    await controller.recordTwilioStatus(
      body,
      request(
        signed(
          'https://api.example/api/sms-events/twilio/status?secret=secret',
        ),
        '/api/sms-events/twilio/status?secret=secret',
      ),
      undefined,
      'secret',
    );
    expect(events.save).toHaveBeenCalledTimes(1);
  });

  it('validates direct request origin when public URL is unconfigured', async () => {
    const { controller, events } = setup({ TWILIO_AUTH_TOKEN: 'token' });
    await controller.recordTwilioStatus(
      body,
      request(signed('http://internal.example/api/sms-events/twilio/status')),
    );
    expect(events.save).toHaveBeenCalledTimes(1);
  });

  it('retains legacy public URL configuration compatibility', async () => {
    const { controller, events } = setup({
      TWILIO_AUTH_TOKEN: 'token',
      PUBLIC_API_URL: 'https://legacy.example',
    });
    await controller.recordTwilioStatus(
      body,
      request(signed('https://legacy.example/api/sms-events/twilio/status')),
    );
    expect(events.save).toHaveBeenCalledTimes(1);
  });

  it('enforces callback secret and header precedence', async () => {
    const { controller, events } = setup({ SMS_CALLBACK_SECRET: 'secret' });
    await expect(
      controller.recordTwilioStatus(body, request(), 'wrong', 'secret'),
    ).rejects.toMatchObject({ response: { error: 'Invalid callback secret' } });
    await controller.recordTwilioStatus(body, request(), 'secret');
    await controller.recordTwilioStatus(body, request(), undefined, 'secret');
    expect(events.save).toHaveBeenCalledTimes(2);
  });

  it('supports legacy Twilio field names and anchors records to originating event', async () => {
    const { controller, query, events } = setup();
    await controller.recordTwilioStatus(
      { SmsSid: 'SM456', SmsStatus: 'failed' },
      request(),
      'secret',
    );
    expect(query.where).toHaveBeenCalledWith(
      "event.data ->> 'message_id' = :messageSid",
      { messageSid: 'SM456' },
    );
    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'sms_failed',
        eventTimestamp: expect.any(Date) as unknown,
      }),
    );
  });

  it.each([null, [], {}, { MessageSid: ' ' }, { MessageStatus: 'delivered' }])(
    'ignores incomplete unsigned status updates %#',
    async (payload) => {
      const { controller, events } = setup();
      await expect(
        controller.recordTwilioStatus(payload, request(), 'secret'),
      ).resolves.toEqual({ status: 'ok' });
      expect(events.createQueryBuilder).not.toHaveBeenCalled();
    },
  );

  it('ignores callbacks with no matching invitation', async () => {
    const { controller, query, events } = setup();
    query.getOne.mockResolvedValue(null);
    await controller.recordTwilioStatus(body, request(), 'secret');
    expect(events.save).not.toHaveBeenCalled();
  });
});

it('rejects SMS callbacks when no authentication method is configured', async () => {
  const { controller, events } = setup({});
  await expect(
    controller.recordTwilioStatus(body, request()),
  ).rejects.toMatchObject({ status: 503 });
  expect(events.createQueryBuilder).not.toHaveBeenCalled();
  expect(events.save).not.toHaveBeenCalled();
});
