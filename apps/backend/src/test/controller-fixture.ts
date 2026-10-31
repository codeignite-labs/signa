import type { Server } from 'node:http';
import {
  ExecutionContext,
  INestApplication,
  Provider,
  Type,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { Account } from '../accounts/entities/account.entity';
import { User } from '../users/entities/user.entity';

export const controllerAccount = Object.assign(new Account(), {
  id: 'active-account',
});
export const controllerUser = Object.assign(new User(), {
  id: 'actor',
  accountId: controllerAccount.id,
  account: controllerAccount,
  email: 'actor@example.test',
  firstName: 'Ada',
  lastName: 'Signer',
  role: 'admin',
});
export function serviceSpies(names: string[]) {
  return Object.fromEntries(
    names.map((name) => [name, jest.fn().mockResolvedValue({ ok: true })]),
  );
}
function controllerGuards(controller: Type): Type[] {
  const read = (target: object): Type[] =>
    (Reflect.getMetadata(GUARDS_METADATA, target) as Type[] | undefined) ?? [];
  const prototype = controller.prototype as Record<string, unknown>;
  return [
    ...read(controller),
    ...Object.getOwnPropertyNames(prototype).flatMap((name) =>
      typeof prototype[name] === 'function'
        ? read(prototype[name] as object)
        : [],
    ),
  ];
}
// These tests exercise HTTP routing/parameter binding with controlled services.
// Actual JWT/permission guards and database isolation have separate integration tests.
export async function createControllerFixture(
  controllers: Type[],
  providers: Provider[],
  sessionOverrides: Record<string, unknown> = {},
) {
  const builder = Test.createTestingModule({
    controllers,
    providers,
  }).useMocker(() => ({}));
  for (const guard of new Set(controllers.flatMap(controllerGuards))) {
    builder.overrideGuard(guard).useValue({
      canActivate(context: ExecutionContext) {
        Object.assign(context.switchToHttp().getRequest<object>(), {
          account: controllerAccount,
          user: controllerUser,
          session: {
            accountId: controllerAccount.id,
            userId: controllerUser.id,
            role: 'admin',
            ...sessionOverrides,
          },
        });
        return true;
      },
    });
  }
  const module = await builder.compile();
  const app = module.createNestApplication<INestApplication<Server>>();
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}
