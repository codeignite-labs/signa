import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { firstValueFrom, of } from 'rxjs';
import { UsersService } from '../users/users.service';
import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';
import { User } from '../users/entities/user.entity';
const user = Object.assign(new User(), {
  id: 'actor',
  accountId: 'active-account',
});
function setup() {
  const jwt = {
    verifyAsync: jest
      .fn()
      .mockResolvedValue({ userId: user.id, accountId: user.accountId }),
  };
  const users = { findActiveUser: jest.fn().mockResolvedValue(user) };
  const realtime = {
    stream: jest
      .fn()
      .mockReturnValue(of({ type: 'template.updated', data: { id: 'event' } })),
  };
  const controller = new RealtimeController(
    jwt as unknown as JwtService,
    realtime as unknown as RealtimeService,
    users as unknown as UsersService,
  );
  return { controller, jwt, users, realtime };
}
it('authenticates before subscribing and binds all stream filters to the resolved tenant', async () => {
  const test = setup();
  await expect(
    firstValueFrom(
      test.controller.stream(
        'signed-token',
        'template',
        'submission',
        'webhook',
        'templates',
      ),
    ),
  ).resolves.toEqual({ type: 'template.updated', data: { id: 'event' } });
  expect(test.jwt.verifyAsync).toHaveBeenCalledWith('signed-token');
  expect(test.users.findActiveUser).toHaveBeenCalledWith(
    user.id,
    user.accountId,
  );
  expect(test.realtime.stream).toHaveBeenCalledWith(user.accountId, {
    templateId: 'template',
    submissionId: 'submission',
    webhookUrlId: 'webhook',
    scope: 'templates',
  });
});
it.each([
  'missing-token',
  'invalid-token',
  'missing-user',
  'different-account',
])('rejects %s before creating a subscription', async (failure) => {
  const test = setup();
  if (failure === 'invalid-token')
    test.jwt.verifyAsync.mockRejectedValue(new Error('expired'));
  if (failure === 'missing-user')
    test.users.findActiveUser.mockResolvedValue(null);
  if (failure === 'different-account')
    test.users.findActiveUser.mockResolvedValue(
      Object.assign(new User(), { accountId: 'other' }),
    );
  await expect(
    firstValueFrom(
      test.controller.stream(
        failure === 'missing-token' ? undefined : 'signed-token',
      ),
    ),
  ).rejects.toBeInstanceOf(UnauthorizedException);
  expect(test.realtime.stream).not.toHaveBeenCalled();
});
