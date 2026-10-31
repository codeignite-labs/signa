import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import {
  controllerUser as user,
  createControllerFixture,
  serviceSpies,
} from '../test/controller-fixture';
const service = serviceSpies([
  'listTemplates',
  'listFolders',
  'createFolder',
  'createTemplate',
  'updateFolder',
  'deleteFolder',
  'getTemplate',
  'listTemplateEvents',
  'listTemplateVersions',
  'createTemplateFromPdf',
  'createTemplateFromHtml',
  'createTemplateFromDocx',
  'mergeTemplates',
  'cloneTemplate',
  'updateTemplate',
  'updateTestingSharing',
  'getTemplateDocumentDownloadUrls',
  'updateTemplateDocuments',
  'importGoogleDriveDocuments',
  'deleteTemplate',
]);
let app: INestApplication<Server>;
beforeAll(async () => {
  app = await createControllerFixture(
    [TemplatesController],
    [{ provide: TemplatesService, useValue: service }],
  );
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => jest.clearAllMocks());
it.each([
  ['', 'listTemplates'],
  ['/folders', 'listFolders'],
] as const)(
  'binds template%s list query parameters without replacing the hydrated actor',
  async (path, method) => {
    const query = { q: 'Agreement', account_id: 'spoofed' };
    await request(app.getHttpServer())
      .get(`/api/templates${path}`)
      .query(query)
      .expect(200);
    expect(service[method]).toHaveBeenCalledWith(user, query);
  },
);
it.each([
  ['', 'createTemplate'],
  ['/folders', 'createFolder'],
  ['/html', 'createTemplateFromHtml'],
  ['/merge', 'mergeTemplates'],
] as const)(
  'binds template creation action %s to the authenticated user',
  async (path, method) => {
    const body = { name: 'Agreement', account_id: 'spoofed' };
    await request(app.getHttpServer())
      .post(`/api/templates${path}`)
      .send(body)
      .expect(201);
    expect(service[method]).toHaveBeenCalledWith(user, body);
  },
);
it.each([
  ['', 'getTemplate'],
  ['/events', 'listTemplateEvents'],
  ['/versions', 'listTemplateVersions'],
  ['/documents', 'getTemplateDocumentDownloadUrls'],
] as const)(
  'resolves template%s by path identifier and authenticated context',
  async (suffix, method) => {
    await request(app.getHttpServer())
      .get(`/api/templates/template-2${suffix}`)
      .query({ account_id: 'spoofed' })
      .expect(200);
    expect(service[method]).toHaveBeenCalledWith(user, 'template-2');
  },
);
it('binds folder edits and deletion filters separately from the tenant actor', async () => {
  const body = { name: 'Updated', account_id: 'spoofed' };
  await request(app.getHttpServer())
    .put('/api/templates/folders/folder-2')
    .send(body)
    .expect(200);
  expect(service.updateFolder).toHaveBeenCalledWith(user, 'folder-2', body);
  await request(app.getHttpServer())
    .delete('/api/templates/folders/folder-2')
    .query({ permanently: 'true' })
    .expect(200);
  expect(service.deleteFolder).toHaveBeenCalledWith(user, 'folder-2', {
    permanently: 'true',
  });
});
it('preserves clone options, edits and delete filters on the selected template', async () => {
  await request(app.getHttpServer())
    .post('/api/templates/template-2/clone')
    .send({ name: 'Copy' })
    .expect(201);
  expect(service.cloneTemplate).toHaveBeenCalledWith(user, 'template-2', {
    name: 'Copy',
  });
  await request(app.getHttpServer())
    .put('/api/templates/template-2')
    .send({ name: 'Updated' })
    .expect(200);
  expect(service.updateTemplate).toHaveBeenCalledWith(user, 'template-2', {
    name: 'Updated',
  });
  await request(app.getHttpServer())
    .delete('/api/templates/template-2')
    .query({ permanently: 'true' })
    .expect(200);
  expect(service.deleteTemplate).toHaveBeenCalledWith(user, 'template-2', {
    permanently: 'true',
  });
});
it.each([true, false])(
  'keeps testing sharing a boolean (%s)',
  async (value) => {
    await request(app.getHttpServer())
      .post('/api/templates/template-2/testing-sharing')
      .send({ value })
      .expect(201);
    expect(service.updateTestingSharing).toHaveBeenCalledWith(
      user,
      'template-2',
      value,
    );
  },
);
it.each(['pdf', 'docx'])(
  'accepts the documented %s multipart file field',
  async (format) => {
    const buffer = Buffer.from('synthetic-document');
    await request(app.getHttpServer())
      .post(`/api/templates/${format}`)
      .field('name', 'Uploaded')
      .attach('file', buffer, `agreement.${format}`)
      .expect(201);
    expect(
      service[
        format === 'pdf' ? 'createTemplateFromPdf' : 'createTemplateFromDocx'
      ],
    ).toHaveBeenCalledWith(
      user,
      { name: 'Uploaded' },
      expect.objectContaining({
        file: [
          expect.objectContaining({
            buffer,
            originalname: `agreement.${format}`,
          }),
        ],
      }),
    );
  },
);
it('passes uploaded replacements and Google Drive credentials to their scoped actions', async () => {
  const buffer = Buffer.from('replacement');
  await request(app.getHttpServer())
    .put('/api/templates/template-2/documents')
    .attach('file', buffer, 'replacement.pdf')
    .expect(200);
  expect(service.updateTemplateDocuments).toHaveBeenCalledWith(
    user,
    'template-2',
    {},
    expect.objectContaining({ file: [expect.objectContaining({ buffer })] }),
  );
  const body = {
    access_token: 'fixture-only',
    files: [{ id: 'drive-1', name: 'Agreement' }],
  };
  await request(app.getHttpServer())
    .put('/api/templates/template-2/google-drive-documents')
    .send(body)
    .expect(200);
  expect(service.importGoogleDriveDocuments).toHaveBeenCalledWith(
    user,
    'template-2',
    body,
  );
});
