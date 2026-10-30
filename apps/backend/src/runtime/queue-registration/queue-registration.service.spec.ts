import { BullRegistrar } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { QueueRegistrationService } from './queue-registration.service';
it.each([false, undefined])(
  'never starts workers when queues are disabled or unset: %p',
  (QUEUE_ENABLED) => {
    const register = jest.fn();
    const service = new QueueRegistrationService(
      new ConfigService({ QUEUE_ENABLED }),
      { register } as unknown as BullRegistrar,
    );
    service.onApplicationBootstrap();
    expect(register).not.toHaveBeenCalled();
  },
);
it('registers enabled workers once after configuration is available', () => {
  const register = jest.fn();
  const service = new QueueRegistrationService(
    new ConfigService({ QUEUE_ENABLED: true }),
    { register } as unknown as BullRegistrar,
  );
  service.onApplicationBootstrap();
  service.onApplicationBootstrap();
  expect(register).toHaveBeenCalledTimes(1);
});
