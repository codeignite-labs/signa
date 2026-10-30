import { ConfigService } from '@nestjs/config';
import twilio from 'twilio';
import { PhoneVerificationService } from './phone-verification.service';

jest.mock('twilio', () => jest.fn());
const createVerification = jest.fn();
const createCheck = jest.fn();
const services = jest.fn(() => ({
  verifications: { create: createVerification },
  verificationChecks: { create: createCheck },
}));
function createService(config: Record<string, string | undefined> = {}) {
  return new PhoneVerificationService(new ConfigService(config));
}
const configured = {
  TWILIO_ACCOUNT_SID: 'AC-test',
  TWILIO_AUTH_TOKEN: 'private-test-token',
  TWILIO_VERIFY_SERVICE_SID: 'VA-test',
};
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(twilio)
    .mockReturnValue({ verify: { v2: { services } } } as unknown as ReturnType<
      typeof twilio
    >);
  createVerification.mockResolvedValue({ status: 'pending' });
  createCheck.mockResolvedValue({ status: 'approved' });
});
it.each([
  ['(415) 555-2671', ' us ', '+14155552671'],
  ['+14155552671', undefined, '+14155552671'],
  ['+442079460018', null, '+442079460018'],
  ['+14155552671', 'invalid', '+14155552671'],
  ['+14155552671', '', '+14155552671'],
])(
  'normalizes %s with country %s to international format',
  (input, country, expected) => {
    expect(createService().normalizePhone(input, country)).toBe(expected);
  },
);
it.each(['nonsense', '+1', ''])(
  'rejects invalid phone %s before any provider call',
  async (input) => {
    const service = createService(configured);
    await expect(service.sendCode(input, 'US')).rejects.toMatchObject({
      response: { error: `${input} phone is invalid` },
    });
    expect(services).not.toHaveBeenCalled();
  },
);
it('rejects a valid number from a different selected country', async () => {
  await expect(
    createService().sendCode('+442079460018', 'US'),
  ).rejects.toMatchObject({
    response: { error: '+442079460018 must be a valid US phone number' },
  });
});
it.each([
  {},
  { TWILIO_ACCOUNT_SID: 'AC-test' },
  { TWILIO_ACCOUNT_SID: 'AC-test', TWILIO_AUTH_TOKEN: 'test' },
])(
  'fails clearly when the provider configuration is incomplete %j',
  async (config) => {
    const service = createService(config);
    await expect(service.sendCode('+14155552671')).rejects.toMatchObject({
      response: { error: 'Phone verification is not configured' },
    });
    await expect(
      service.checkCode('+14155552671', '123456'),
    ).rejects.toMatchObject({ status: 503 });
    expect(twilio).not.toHaveBeenCalled();
  },
);
it('sends an SMS through the configured verification service using normalized phone', async () => {
  const service = createService(configured);
  await expect(service.sendCode('4155552671', 'US')).resolves.toEqual({
    status: 'pending',
    to: '+14155552671',
  });
  expect(twilio).toHaveBeenCalledWith(
    configured.TWILIO_ACCOUNT_SID,
    configured.TWILIO_AUTH_TOKEN,
  );
  expect(services).toHaveBeenCalledWith(configured.TWILIO_VERIFY_SERVICE_SID);
  expect(createVerification).toHaveBeenCalledWith({
    channel: 'sms',
    to: '+14155552671',
  });
});
it.each(['approved', 'pending', 'canceled'])(
  'accepts only an approved verification check (%s)',
  async (status) => {
    createCheck.mockResolvedValue({ status });
    await expect(
      createService(configured).checkCode('4155552671', '654321', 'US'),
    ).resolves.toEqual({ status, valid: status === 'approved' });
    expect(createCheck).toHaveBeenCalledWith({
      code: '654321',
      to: '+14155552671',
    });
  },
);
it.each(['send', 'check'])(
  'propagates provider failures without a false successful %s result',
  async (operation) => {
    const failure = new Error('Provider rejected request');
    const service = createService(configured);
    createVerification.mockRejectedValue(failure);
    createCheck.mockRejectedValue(failure);
    await expect(
      operation === 'send'
        ? service.sendCode('+14155552671')
        : service.checkCode('+14155552671', '123456'),
    ).rejects.toBe(failure);
  },
);
