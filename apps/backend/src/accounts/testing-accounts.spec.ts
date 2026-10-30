import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { PdfSignatureService } from '../pdf-signatures/pdf-signature.service';
import { PdfTrustRootService } from '../pdf-signatures/pdf-trust-root.service';
import { StorageService } from '../storage/storage.service';
import { TeamMember } from '../teams/entities/team-member.entity';
import { Team } from '../teams/entities/team.entity';
import { User } from '../users/entities/user.entity';
import { AccountsService } from './accounts.service';
import { AccountConfig } from './entities/account-config.entity';
import { AccountLinkedAccount } from './entities/account-linked-account.entity';
import { Account } from './entities/account.entity';
import { EncryptedConfig } from './entities/encrypted-config.entity';
function repository<T extends object>(create: (input: Partial<T>) => T) {
  return {
    findOne: jest.fn<Promise<T | null>, [unknown]>().mockResolvedValue(null),
    create: jest.fn(create),
    save: jest.fn((value: T) => Promise.resolve(value)),
  };
}
function setup() {
  const production: Account = Object.assign(new Account(), {
    id: 'production',
    name: 'Example Org',
    locale: 'fr',
    timezone: 'Europe/Paris',
  });
  const owner: User = Object.assign(new User(), {
    id: 'owner',
    accountId: production.id,
    email: 'OWNER@example.test',
    encryptedPassword: 'hash',
    firstName: 'First',
    lastName: 'Last',
  });
  const accounts = repository<Account>((input) =>
    Object.assign(new Account(), { id: 'testing' }, input),
  );
  accounts.findOne.mockResolvedValue(production);
  const users = repository<User>((input) =>
    Object.assign(new User(), { id: 'test-owner' }, input),
  );
  users.findOne.mockResolvedValueOnce(owner);
  const links = repository<AccountLinkedAccount>((input) =>
    Object.assign(new AccountLinkedAccount(), input),
  );
  const teams = repository<Team>((input) =>
    Object.assign(new Team(), { id: 'team' }, input),
  );
  const members = repository<TeamMember>((input) =>
    Object.assign(new TeamMember(), input),
  );
  const repositories = new Map<unknown, unknown>([
    [Account, accounts],
    [User, users],
    [AccountLinkedAccount, links],
    [Team, teams],
    [TeamMember, members],
  ]);
  const manager = {
    getRepository: jest.fn((entity: unknown) => repositories.get(entity)),
  };
  const transaction = jest.fn(
    (callback: (manager: EntityManager) => Promise<unknown>) =>
      callback(manager as unknown as EntityManager),
  );
  const service = new AccountsService(
    accounts as unknown as Repository<Account>,
    {} as Repository<AccountConfig>,
    links as unknown as Repository<AccountLinkedAccount>,
    users as unknown as Repository<User>,
    {} as Repository<EncryptedConfig>,
    { transaction } as unknown as DataSource,
    {} as StorageService,
    new ConfigService(),
    {} as MailService,
    {} as PdfSignatureService,
    {} as PdfTrustRootService,
  );
  return {
    service,
    accounts,
    production,
    users,
    owner,
    links,
    teams,
    members,
    transaction,
  };
}
it('creates a linked testing account, isolated owner and manager team in a single transaction', async () => {
  const {
    service,
    production,
    owner,
    accounts,
    users,
    links,
    teams,
    members,
    transaction,
  } = setup();
  const result = await service.findOrCreateTestingUser({
    accountId: production.id,
    userId: owner.id,
  });
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({
    trueAccount: production,
    trueUser: owner,
    account: {
      id: 'testing',
      name: 'Testing - Example Org',
      locale: 'fr',
      timezone: 'Europe/Paris',
    },
    user: {
      id: 'test-owner',
      accountId: 'testing',
      role: 'admin',
      encryptedPassword: 'hash',
      firstName: 'First',
      lastName: 'Last',
    },
  });
  expect(result.user.email).toMatch(
    /^owner\+testing-testing-[a-f0-9]{12}@example.test$/,
  );
  expect(accounts.save).toHaveBeenCalledTimes(1);
  expect(users.save).toHaveBeenCalledTimes(1);
  expect(links.create).toHaveBeenCalledWith({
    accountId: 'production',
    accountType: 'testing',
    linkedAccountId: 'testing',
  });
  expect(teams.create).toHaveBeenCalledWith(
    expect.objectContaining({
      accountId: 'testing',
      createdByUserId: 'test-owner',
      name: 'Testing - Example Org',
      slug: 'testing-example-org',
    }),
  );
  expect(members.create).toHaveBeenCalledWith({
    accountId: 'testing',
    teamId: 'team',
    userId: 'test-owner',
    role: 'manager',
  });
});
it('uses testing identity defaults when the owner lacks optional names or an email domain', async () => {
  const { service, owner } = setup();
  owner.firstName = null;
  owner.lastName = null;
  owner.email = 'NoDomain';
  const { user } = await service.findOrCreateTestingUser({
    accountId: 'production',
    userId: 'owner',
  });
  expect(user.email).toMatch(
    /^nodomain\+testing-testing-[a-f0-9]{12}@signa.local$/,
  );
  expect(user).toMatchObject({ firstName: 'Testing', lastName: 'Environment' });
});
it.each([true, false])(
  'reuses a linked testing owner and synchronizes passwords only when changed (%s)',
  async (changed) => {
    const { service, users, links, owner, accounts, teams } = setup();
    const testing = Object.assign(new Account(), { id: 'testing' });
    const testUser: User = Object.assign(new User(), {
      id: 'existing',
      encryptedPassword: changed ? 'old-hash' : owner.encryptedPassword,
    });
    links.findOne.mockResolvedValue(
      Object.assign(new AccountLinkedAccount(), {
        accountId: 'production',
        linkedAccountId: 'testing',
        linkedAccount: testing,
      }),
    );
    users.findOne.mockResolvedValueOnce(testUser);
    const result = await service.findOrCreateTestingUser({
      accountId: 'production',
      userId: 'owner',
    });
    expect(result.user).toBe(testUser);
    expect(result.account).toBe(testing);
    expect(testUser.encryptedPassword).toBe(owner.encryptedPassword);
    expect(users.save).toHaveBeenCalledTimes(changed ? 1 : 0);
    expect(accounts.save).not.toHaveBeenCalled();
    expect(teams.save).not.toHaveBeenCalled();
  },
);
it('creates a missing testing owner in the existing linked account without replacing the link', async () => {
  const { service, links, users, accounts } = setup();
  const testing = Object.assign(new Account(), {
    id: 'testing',
    name: 'Testing',
  });
  links.findOne.mockResolvedValue(
    Object.assign(new AccountLinkedAccount(), {
      accountId: 'production',
      linkedAccountId: 'testing',
      linkedAccount: testing,
    }),
  );
  users.findOne.mockResolvedValue(null);
  const result = await service.findOrCreateTestingUser({
    accountId: 'production',
    userId: 'owner',
  });
  expect(result.account).toBe(testing);
  expect(accounts.save).not.toHaveBeenCalled();
  expect(links.save).not.toHaveBeenCalled();
  expect(users.save).toHaveBeenCalledTimes(1);
});
it.each(['account', 'user'])(
  'rejects a missing production %s before creating testing records',
  async (missing) => {
    const { service, accounts, users, links } = setup();
    if (missing === 'account') accounts.findOne.mockResolvedValueOnce(null);
    else users.findOne.mockReset().mockResolvedValue(null);
    await expect(
      service.findOrCreateTestingUser({
        accountId: 'production',
        userId: 'owner',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(links.save).not.toHaveBeenCalled();
  },
);
it('reports testing vs production account context with and without a linked sandbox', async () => {
  const { service, links } = setup();
  links.findOne.mockResolvedValueOnce(
    Object.assign(new AccountLinkedAccount(), {
      accountId: 'production',
      linkedAccountId: 'testing',
    }),
  );
  expect(await service.getTestingAccountContext('testing')).toEqual({
    isTestMode: true,
    productionAccountId: 'production',
    testingAccountId: 'testing',
  });
  links.findOne
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(
      Object.assign(new AccountLinkedAccount(), { linkedAccountId: 'testing' }),
    );
  expect(await service.getTestingAccountContext('production')).toEqual({
    isTestMode: false,
    productionAccountId: 'production',
    testingAccountId: 'testing',
  });
  links.findOne.mockResolvedValue(null);
  expect(await service.getTestingAccountContext('unlinked')).toEqual({
    isTestMode: false,
    productionAccountId: 'unlinked',
    testingAccountId: null,
  });
});
it('returns the production identity from explicit session provenance and rejects incomplete or expired provenance', async () => {
  const { service, users, owner, production, links, accounts } = setup();
  expect(
    await service.findProductionUserForTestingSession({
      accountId: 'testing',
      trueAccountId: 'production',
      trueUserId: 'owner',
    }),
  ).toEqual({ account: production, user: owner });
  expect(links.findOne).not.toHaveBeenCalled();
  expect(users.findOne).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        accountId: 'production',
        id: 'owner',
      }) as unknown,
    }),
  );
  links.findOne.mockResolvedValue(
    Object.assign(new AccountLinkedAccount(), { accountId: 'production' }),
  );
  users.findOne.mockResolvedValue(owner);
  expect(
    (
      await service.findProductionUserForTestingSession({
        accountId: 'testing',
        trueUserId: 'owner',
      })
    ).user,
  ).toBe(owner);
  await expect(
    service.findProductionUserForTestingSession({ accountId: 'testing' }),
  ).rejects.toMatchObject({ status: 404 });
  links.findOne.mockResolvedValue(null);
  await expect(
    service.findProductionUserForTestingSession({
      accountId: 'testing',
      trueUserId: 'owner',
    }),
  ).rejects.toMatchObject({ status: 404 });
  accounts.findOne.mockResolvedValue(null);
  await expect(
    service.findProductionUserForTestingSession({
      accountId: 'testing',
      trueAccountId: 'production',
      trueUserId: 'owner',
    }),
  ).rejects.toMatchObject({ status: 404 });
  accounts.findOne.mockResolvedValue(production);
  users.findOne.mockResolvedValue(null);
  await expect(
    service.findProductionUserForTestingSession({
      accountId: 'testing',
      trueAccountId: 'production',
      trueUserId: 'owner',
    }),
  ).rejects.toMatchObject({ status: 404 });
});
