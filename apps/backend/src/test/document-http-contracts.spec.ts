import { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { StartFormController } from '../start-form/start-form.controller';
import { StartFormService } from '../start-form/start-form.service';
import { SubmittersController } from '../submitters/submitters.controller';
import { SubmittersService } from '../submitters/submitters.service';
import { AttachmentsController } from '../signing/attachments.controller';
import { SigningService } from '../signing/signing.service';
import { ToolsController } from '../tools/tools.controller';
import { ToolsService } from '../tools/tools.service';
import { AuthenticatedRequest } from '../auth/authenticated-request';
import {
  controllerUser as user,
  createControllerFixture,
  serviceSpies,
} from './controller-fixture';
const start = serviceSpies([
  'getStartForm',
  'submitStartForm',
  'sendEmailVerification',
  'verifyEmailAndSubmitStartForm',
]);
const submitters = serviceSpies([
  'listSubmitters',
  'getSubmitter',
  'updateSubmitter',
]);
const signing = serviceSpies(['uploadApiAttachment']);
const tools = serviceSpies(['merge', 'verify']);
let app: INestApplication<Server>;
beforeAll(async () => {
  app = await createControllerFixture(
    [
      StartFormController,
      SubmittersController,
      AttachmentsController,
      ToolsController,
    ],
    [
      { provide: StartFormService, useValue: start },
      { provide: SubmittersService, useValue: submitters },
      { provide: SigningService, useValue: signing },
      { provide: ToolsService, useValue: tools },
    ],
  );
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => jest.clearAllMocks());
it('binds public start-form view and verification email to the public template slug', async () => {
  await request(app.getHttpServer())
    .get('/api/start-form/public-template')
    .expect(200);
  expect(start.getStartForm).toHaveBeenCalledWith('public-template');
  const body = { email: 'signer@example.test' };
  await request(app.getHttpServer())
    .post('/api/start-form/public-template/email-verification/send')
    .send(body)
    .expect(201);
  expect(start.sendEmailVerification).toHaveBeenCalledWith(
    'public-template',
    body,
  );
});
it.each([
  ['', 'submitStartForm'],
  ['/email-verification/check', 'verifyEmailAndSubmitStartForm'],
] as const)(
  'records actual request provenance on public start-form action %s',
  async (path, method) => {
    const body = { email: 'signer@example.test', code: '123456' };
    await request(app.getHttpServer())
      .post(`/api/start-form/public-template${path}`)
      .set('User-Agent', 'Signa-Test')
      .send(body)
      .expect(201);
    expect(start[method]).toHaveBeenCalledWith(
      'public-template',
      body,
      expect.objectContaining({
        ua: 'Signa-Test',
        ip: expect.any(String) as unknown,
      }),
    );
  },
);
it('binds submitter list/read/update to the active account actor and included fields', async () => {
  await request(app.getHttpServer())
    .get('/api/submitters')
    .query({ template_id: 'template-2' })
    .expect(200);
  expect(submitters.listSubmitters).toHaveBeenCalledWith(user, {
    template_id: 'template-2',
  });
  await request(app.getHttpServer())
    .get('/api/submitters/submitter-2')
    .query({ include: 'fields' })
    .expect(200);
  expect(submitters.getSubmitter).toHaveBeenCalledWith(
    user,
    'submitter-2',
    'fields',
  );
  const body = { name: 'Updated', account_id: 'spoofed' };
  await request(app.getHttpServer())
    .put('/api/submitters/submitter-2')
    .query({ include: 'fields' })
    .set('User-Agent', 'Signa-Test')
    .send(body)
    .expect(200);
  expect(submitters.updateSubmitter).toHaveBeenCalledWith(
    user,
    'submitter-2',
    body,
    'fields',
    expect.objectContaining({
      ua: 'Signa-Test',
      ip: expect.any(String) as unknown,
    }),
  );
});
it('binds API attachment bytes to the requested submitter slug', async () => {
  const buffer = Buffer.from('synthetic-attachment');
  await request(app.getHttpServer())
    .post('/api/attachments')
    .field('submitter_slug', 'signer')
    .field('type', 'image')
    .attach('file', buffer, 'image.png')
    .expect(201);
  expect(signing.uploadApiAttachment).toHaveBeenCalledWith(
    'signer',
    expect.objectContaining({ buffer }),
    'image',
  );
});
it('preserves JSON merge inputs and scopes PDF verification to the active account', async () => {
  const body = { files: ['pdf-one', 'pdf-two'] };
  await request(app.getHttpServer())
    .post('/api/tools/merge')
    .send(body)
    .expect(201);
  expect(tools.merge).toHaveBeenCalledWith(body);
  await request(app.getHttpServer())
    .post('/api/tools/verify')
    .send({ file: 'base64-pdf' })
    .expect(201);
  expect(tools.verify).toHaveBeenCalledWith({
    accountId: user.accountId,
    file: { file: 'base64-pdf' },
  });
  const buffer = Buffer.from('uploaded-pdf');
  await request(app.getHttpServer())
    .post('/api/tools/verify')
    .attach('file', buffer, 'document.pdf')
    .expect(201);
  expect(tools.verify).toHaveBeenLastCalledWith({
    accountId: user.accountId,
    file: buffer,
  });
});
it('uses API-token tenant context for verification when there is no JWT session', async () => {
  const controller = new ToolsController(tools as unknown as ToolsService);
  const tokenRequest = {
    tenant: { accountId: 'api-account' },
  } as AuthenticatedRequest;
  await controller.verify({ file: 'base64-pdf' }, tokenRequest);
  expect(tools.verify).toHaveBeenCalledWith({
    accountId: 'api-account',
    file: { file: 'base64-pdf' },
  });
});
