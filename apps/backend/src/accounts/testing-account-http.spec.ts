import { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { TestingAccountsController } from './testing-accounts.controller';
import { AccountsService } from './accounts.service';
import { AuthService } from '../auth/auth.service';
import { Account } from './entities/account.entity';
import { User } from '../users/entities/user.entity';
import {
  controllerUser,
  createControllerFixture,
  serviceSpies,
} from '../test/controller-fixture';
const service = serviceSpies([
  'findOrCreateTestingUser',
  'findProductionUserForTestingSession',
  'getTestingAccountContext',
]);
const auth = serviceSpies(['createAuthResponse']);
const testingAccount = Object.assign(new Account(), { id: 'testing-account' });
const productionAccount = Object.assign(new Account(), {
  id: 'production-account',
});
const testingUser = Object.assign(new User(), {
  id: 'testing-user',
  account: testingAccount,
});
const productionUser = Object.assign(new User(), {
  id: 'production-user',
  account: productionAccount,
});
beforeEach(() => jest.clearAllMocks());
it.each([false, true])(
  'enters test mode using the original account context when already impersonating=%s',
  async (impersonating) => {
    const overrides = impersonating
      ? { trueAccountId: productionAccount.id, trueUserId: productionUser.id }
      : {};
    let app: INestApplication<Server> | undefined;
    service.findOrCreateTestingUser.mockResolvedValue({
      account: testingAccount,
      user: testingUser,
      trueAccount: productionAccount,
      trueUser: productionUser,
    });
    try {
      app = await createControllerFixture(
        [TestingAccountsController],
        [
          { provide: AccountsService, useValue: service },
          { provide: AuthService, useValue: auth },
        ],
        overrides,
      );
      await request(app.getHttpServer())
        .post('/api/testing-account')
        .expect(201);
      expect(service.findOrCreateTestingUser).toHaveBeenCalledWith({
        accountId: impersonating
          ? productionAccount.id
          : controllerUser.accountId,
        userId: impersonating ? productionUser.id : controllerUser.id,
      });
      expect(auth.createAuthResponse).toHaveBeenCalledWith(
        testingUser,
        testingAccount,
        {
          isTestMode: true,
          productionAccountId: productionAccount.id,
          testingAccountId: testingAccount.id,
          trueAccountId: productionAccount.id,
          trueUserId: productionUser.id,
        },
      );
    } finally {
      await app?.close();
    }
  },
);
it('restores the production identity when exiting test mode', async () => {
  service.findProductionUserForTestingSession.mockResolvedValue({
    account: productionAccount,
    user: productionUser,
  });
  service.getTestingAccountContext.mockResolvedValue({
    testingAccountId: testingAccount.id,
  });
  const app = await createControllerFixture(
    [TestingAccountsController],
    [
      { provide: AccountsService, useValue: service },
      { provide: AuthService, useValue: auth },
    ],
    { trueAccountId: productionAccount.id, trueUserId: productionUser.id },
  );
  try {
    await request(app.getHttpServer())
      .delete('/api/testing-account')
      .expect(200);
    expect(service.findProductionUserForTestingSession).toHaveBeenCalledWith({
      accountId: controllerUser.accountId,
      trueAccountId: productionAccount.id,
      trueUserId: productionUser.id,
    });
    expect(auth.createAuthResponse).toHaveBeenCalledWith(
      productionUser,
      productionAccount,
      {
        isTestMode: false,
        productionAccountId: productionAccount.id,
        testingAccountId: testingAccount.id,
      },
    );
  } finally {
    await app.close();
  }
});
