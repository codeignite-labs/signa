import { INestApplication, NotFoundException } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import {
  controllerAccount,
  controllerUser,
  createControllerFixture,
  serviceSpies,
} from '../test/controller-fixture';
const service = serviceSpies([
  'toAccountResponse',
  'getAccountPreferences',
  'updateAccount',
  'updateAccountPreferences',
  'getAccountLogo',
  'uploadAccountLogo',
  'deleteAccountLogo',
  'listSigningCertificates',
  'uploadSigningCertificate',
  'makeDefaultSigningCertificate',
  'deleteSigningCertificate',
  'updateTimestampServerUrl',
  'listSigningTrustRoots',
  'uploadSigningTrustRoot',
  'deleteSigningTrustRoot',
  'listEmailIntegrations',
  'startEmailIntegrationConnect',
  'completeEmailIntegrationConnect',
  'disconnectEmailIntegration',
  'sendMailTransportTest',
  'archiveAccount',
]);
let app: INestApplication<Server>;
beforeAll(async () => {
  app = await createControllerFixture(
    [AccountsController],
    [{ provide: AccountsService, useValue: service }],
  );
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => jest.clearAllMocks());
it.each([
  ['/account', 'toAccountResponse', controllerAccount],
  ['/account/preferences', 'getAccountPreferences', controllerAccount.id],
  ['/account/logo', 'getAccountLogo', controllerAccount.id],
  [
    '/account/signing-certificates',
    'listSigningCertificates',
    controllerAccount.id,
  ],
  [
    '/account/signing-trust-roots',
    'listSigningTrustRoots',
    controllerAccount.id,
  ],
  ['/account/integrations', 'listEmailIntegrations', controllerAccount.id],
] as const)(
  'reads %s using the hydrated active account',
  async (path, method, account) => {
    await request(app.getHttpServer())
      .get(`/api${path}`)
      .query({ account_id: 'spoofed' })
      .expect(200, { ok: true });
    expect(service[method]).toHaveBeenCalledWith(account);
  },
);
it.each([
  ['', 'updateAccount', { name: 'Renamed', account_id: 'spoofed' }],
  [
    '/preferences',
    'updateAccountPreferences',
    { primary_color: '#336699', account_id: 'spoofed' },
  ],
] as const)(
  'updates account%s without deriving tenant scope from the body',
  async (path, method, body) => {
    await request(app.getHttpServer())
      .patch(`/api/account${path}`)
      .send(body)
      .expect(200);
    expect(service[method]).toHaveBeenCalledWith(controllerAccount.id, body);
  },
);
it.each(['active', 'default'])(
  'activates a named signing identity through the %s alias',
  async (alias) => {
    await request(app.getHttpServer())
      .patch(`/api/account/signing-certificates/${alias}`)
      .send({ name: 'Production CA', account_id: 'spoofed' })
      .expect(200);
    expect(service.makeDefaultSigningCertificate).toHaveBeenCalledWith(
      controllerAccount.id,
      'Production CA',
    );
  },
);
it('preserves a cleared timestamp setting and the selected trust-root identifier', async () => {
  await request(app.getHttpServer())
    .patch('/api/account/signing-certificates/timestamp-server')
    .send({ timestamp_server_url: null })
    .expect(200);
  expect(service.updateTimestampServerUrl).toHaveBeenCalledWith(
    controllerAccount.id,
    null,
  );
  await request(app.getHttpServer())
    .delete('/api/account/signing-trust-roots/root-2')
    .expect(200);
  expect(service.deleteSigningTrustRoot).toHaveBeenCalledWith(
    controllerAccount.id,
    'root-2',
  );
});
it('removes the named inactive identity and logo within the active tenant', async () => {
  await request(app.getHttpServer())
    .delete('/api/account/signing-certificates')
    .send({ name: 'Retired CA' })
    .expect(200);
  expect(service.deleteSigningCertificate).toHaveBeenCalledWith(
    controllerAccount.id,
    'Retired CA',
  );
  await request(app.getHttpServer()).delete('/api/account/logo').expect(200);
  expect(service.deleteAccountLogo).toHaveBeenCalledWith(controllerAccount.id);
});
it('binds multipart logo and certificate uploads to their documented field names', async () => {
  const buffer = Buffer.from('synthetic-upload');
  await request(app.getHttpServer())
    .post('/api/account/logo')
    .attach('file', buffer, 'logo.png')
    .expect(201);
  expect(service.uploadAccountLogo).toHaveBeenCalledWith(
    controllerAccount.id,
    expect.objectContaining({ originalname: 'logo.png', buffer }),
  );
  await request(app.getHttpServer())
    .post('/api/account/signing-certificates')
    .field('name', 'Production CA')
    .field('password', 'fixture-password')
    .attach('file', buffer, 'identity.p12')
    .expect(201);
  expect(service.uploadSigningCertificate).toHaveBeenCalledWith(
    controllerAccount.id,
    'Production CA',
    expect.objectContaining({ originalname: 'identity.p12', buffer }),
    'fixture-password',
  );
  await request(app.getHttpServer())
    .post('/api/account/signing-trust-roots')
    .field('name', 'Partner CA')
    .attach('file', buffer, 'root.pem')
    .expect(201);
  expect(service.uploadSigningTrustRoot).toHaveBeenCalledWith(
    controllerAccount.id,
    'Partner CA',
    expect.objectContaining({ originalname: 'root.pem', buffer }),
  );
});
it('keeps provider connection, callback and removal scoped to the active organization', async () => {
  await request(app.getHttpServer())
    .post('/api/account/integrations/gmail/connect')
    .expect(201);
  expect(service.startEmailIntegrationConnect).toHaveBeenCalledWith(
    controllerAccount.id,
    'gmail',
  );
  await request(app.getHttpServer())
    .post('/api/account/integrations/gmail/callback')
    .send({ code: 'oauth-code' })
    .expect(201);
  expect(service.completeEmailIntegrationConnect).toHaveBeenCalledWith(
    controllerAccount.id,
    'gmail',
    'oauth-code',
  );
  await request(app.getHttpServer())
    .delete('/api/account/integrations/gmail')
    .expect(200);
  expect(service.disconnectEmailIntegration).toHaveBeenCalledWith(
    controllerAccount.id,
    'gmail',
  );
});
it('uses the session actor for test email and account archive', async () => {
  await request(app.getHttpServer())
    .post('/api/account/mail/test')
    .send({ user_id: 'spoofed' })
    .expect(201);
  await request(app.getHttpServer())
    .delete('/api/account')
    .send({ user_id: 'spoofed' })
    .expect(200);
  for (const method of ['sendMailTransportTest', 'archiveAccount'])
    expect(service[method]).toHaveBeenCalledWith({
      accountId: controllerAccount.id,
      userId: controllerUser.id,
    });
});
it('preserves a scoped service rejection as an HTTP error', async () => {
  service.deleteSigningTrustRoot.mockRejectedValueOnce(
    new NotFoundException('Trust root not found'),
  );
  await request(app.getHttpServer())
    .delete('/api/account/signing-trust-roots/other-tenant-root')
    .expect(404);
});
