import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import twilio, { Twilio } from 'twilio';
import { Submitter } from '../submitters/entities/submitter.entity';
import { canInviteSubmitterBySms, SmsService } from './sms.service';

jest.mock('twilio', () => ({ __esModule: true, default: jest.fn() }));

function recipient(overrides: Partial<Submitter> = {}): Submitter {
  return Object.assign(
    new Submitter(),
    {
      id: 'recipient',
      accountId: 'organization',
      submissionId: 'document',
      slug: 'sign-me',
      phone: '+1 (415) 555-2671',
      preferences: { send_sms: true },
      account: { name: 'Example Org' },
      submission: { template: { name: 'Agreement' } },
    },
    overrides,
  );
}

function setup(config: Record<string, string> = {}) {
  const create = jest
    .fn()
    .mockResolvedValue({ sid: 'SM123', numSegments: '2' });
  jest
    .mocked(twilio)
    .mockReturnValue({ messages: { create } } as unknown as Twilio);
  const service = new SmsService(
    new ConfigService({
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: 'token',
      TWILIO_FROM_PHONE: '+14155552672',
      ...config,
    }),
  );
  return { service, create };
}

describe('SmsService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends a tracked invitation with normalized E164 phone and public callback URL', async () => {
    const { service, create } = setup({
      FRONTEND_ORIGIN: 'https://sign.example',
      JWT_SECRET: 'signing-secret',
      API_PUBLIC_URL: 'https://api.example/api/',
      SMS_CALLBACK_SECRET: 'a+b&c',
    });
    const result = await service.sendSubmitterInvitation(recipient());
    const tracking = createHash('sha1')
      .update('sign-me:click_sms:signing-secret')
      .digest('base64url')
      .slice(0, 6);
    expect(create).toHaveBeenCalledWith({
      from: '+14155552672',
      to: '+14155552671',
      body: `Example Org has invited you to sign Agreement: https://sign.example/s/sign-me?c=${tracking}`,
      statusCallback:
        'https://api.example/api/sms-events/twilio/status?secret=a%2Bb%26c',
    });
    expect(result).toEqual({
      messageSid: 'SM123',
      segments: 2,
      to: '+14155552671',
    });
    expect(service.isConfigured()).toBe(true);
  });

  it('prefers messaging service sender and supports provider defaults', async () => {
    const { service, create } = setup({
      TWILIO_MESSAGING_SERVICE_SID: 'MG123',
    });
    create.mockResolvedValue({ numSegments: '0' });
    expect(
      await service.sendSubmitterInvitation(recipient({ phone: '123-abc-45' })),
    ).toEqual({ messageSid: null, segments: 1, to: '12345' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        messagingServiceSid: 'MG123',
        statusCallback: undefined,
      }),
    );
    expect(create).not.toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.any(String) as unknown }),
    );
    create.mockResolvedValue({ sid: 'SM456' });
    expect((await service.sendSubmitterInvitation(recipient())).segments).toBe(
      1,
    );
  });

  it('uses safe invitation name and origin defaults', () => {
    const { service } = setup();
    const submitter = recipient({
      account: undefined,
      submission: { template: undefined } as unknown as Submitter['submission'],
    });
    expect(service.buildInvitationBody(submitter)).toMatch(
      /^Signa has invited you to sign document: http:\/\/localhost:3000\/s\/sign-me\?c=/,
    );
  });

  it.each(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_PHONE'])(
    'requires %s to configure delivery',
    async (key) => {
      const { service, create } = setup({ [key]: '' });
      expect(service.isConfigured()).toBe(false);
      await expect(
        service.sendSubmitterInvitation(recipient()),
      ).rejects.toMatchObject({
        response: {
          error: expect.stringContaining(
            'SMS delivery is not configured',
          ) as unknown,
        },
      });
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('creates an unsigned callback URL when no additional secret is configured', async () => {
    const { service, create } = setup({
      API_PUBLIC_URL: 'https://api.example/api',
    });
    await service.sendSubmitterInvitation(recipient());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCallback: 'https://api.example/api/sms-events/twilio/status',
      }),
    );
  });

  it.each([
    { phone: null },
    { completedAt: new Date() },
    { declinedAt: new Date() },
    { preferences: {} },
    { preferences: { send_sms: false } },
    { submission: { archivedAt: new Date() } },
    { submission: { template: { archivedAt: new Date() } } },
  ])(
    'rejects ineligible invitations before calling provider %#',
    async (overrides) => {
      const { service, create } = setup();
      const submitter = recipient(overrides as Partial<Submitter>);
      expect(canInviteSubmitterBySms(submitter)).toBe(false);
      await expect(
        service.sendSubmitterInvitation(submitter),
      ).rejects.toMatchObject({
        response: { error: 'Submitter cannot receive SMS invitations' },
      });
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('propagates provider failures for queue retry', async () => {
    const { service, create } = setup();
    create.mockRejectedValue(new Error('Provider unavailable'));
    await expect(service.sendSubmitterInvitation(recipient())).rejects.toThrow(
      'Provider unavailable',
    );
  });
});
