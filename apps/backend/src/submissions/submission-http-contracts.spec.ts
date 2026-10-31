import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import {
  SubmissionsController,
  TemplateSubmissionsController,
  EventsController,
  SubmissionMailController,
} from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { SubmissionExportService } from './submission-export.service';
import {
  controllerUser as user,
  createControllerFixture,
  serviceSpies,
} from '../test/controller-fixture';
const service = serviceSpies([
  'listSubmissions',
  'getSubmission',
  'getSubmissionEvents',
  'getSubmissionDocuments',
  'createSubmission',
  'createSubmissionFromAlias',
  'createSubmissionInit',
  'createSubmissionFromPdf',
  'createSubmissionFromHtml',
  'createSubmissionFromDocx',
  'deleteSubmission',
  'listFormEvents',
  'listSubmissionEvents',
  'resendSubmissionEmail',
  'sendSubmitterEmail',
  'listSubmissionMailEvents',
  'sendCompletedSubmissionEmail',
]);
const exportsService = serviceSpies(['exportTemplateSubmissions']);
let app: INestApplication<Server>;
beforeAll(async () => {
  app = await createControllerFixture(
    [
      SubmissionsController,
      TemplateSubmissionsController,
      EventsController,
      SubmissionMailController,
    ],
    [
      { provide: SubmissionsService, useValue: service },
      { provide: SubmissionExportService, useValue: exportsService },
    ],
  );
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => jest.clearAllMocks());
it('binds submission list filters and included field selection', async () => {
  const query = { status: 'pending', account_id: 'spoofed' };
  await request(app.getHttpServer())
    .get('/api/submissions')
    .query(query)
    .expect(200);
  expect(service.listSubmissions).toHaveBeenCalledWith(user, query);
  await request(app.getHttpServer())
    .get('/api/submissions/submission-2')
    .query({ include: 'fields' })
    .expect(200);
  expect(service.getSubmission).toHaveBeenCalledWith(
    user,
    'submission-2',
    'fields',
  );
  await request(app.getHttpServer())
    .get('/api/submissions/submission-2/events')
    .expect(200);
  expect(service.getSubmissionEvents).toHaveBeenCalledWith(
    user,
    'submission-2',
  );
});
it.each([undefined, 'false', 'true'])(
  'normalizes the merge query %s without treating false as true',
  async (merge) => {
    const query = merge === undefined ? {} : { merge };
    await request(app.getHttpServer())
      .get('/api/submissions/submission-2/documents')
      .query(query)
      .expect(200);
    expect(service.getSubmissionDocuments).toHaveBeenCalledWith(
      user,
      'submission-2',
      { merge: merge === 'true' },
    );
  },
);
it('validates create payloads and records request provenance from the actual HTTP request', async () => {
  const body = {
    template_id: '12',
    submitters: [{ email: 'signer@example.test' }],
  };
  await request(app.getHttpServer())
    .post('/api/submissions')
    .set('User-Agent', 'Signa-Test')
    .send(body)
    .expect(201);
  expect(service.createSubmission).toHaveBeenCalledWith(
    user,
    body,
    expect.objectContaining({
      ip: expect.any(String) as unknown,
      ua: 'Signa-Test',
    }),
  );
  service.createSubmission.mockClear();
  await request(app.getHttpServer())
    .post('/api/submissions')
    .send({ template_id: '12', submitters: [{ email: 123 }] })
    .expect(400);
  expect(service.createSubmission).not.toHaveBeenCalled();
});
it.each([
  ['emails', 'createSubmissionFromAlias'],
  ['init', 'createSubmissionInit'],
  ['html', 'createSubmissionFromHtml'],
  ['docx', 'createSubmissionFromDocx'],
] as const)(
  'preserves %s input and records request provenance',
  async (path, method) => {
    const body = {
      template_id: '12',
      emails: 'signer@example.test',
      account_id: 'spoofed',
    };
    await request(app.getHttpServer())
      .post(`/api/submissions/${path}`)
      .set('User-Agent', 'Signa-Test')
      .send(body)
      .expect(201);
    expect(service[method]).toHaveBeenCalledWith(
      user,
      body,
      expect.objectContaining({
        ip: expect.any(String) as unknown,
        ua: 'Signa-Test',
      }),
    );
  },
);
it('accepts PDF uploads through the documented multipart field', async () => {
  const buffer = Buffer.from('synthetic-pdf');
  await request(app.getHttpServer())
    .post('/api/submissions/pdf')
    .set('User-Agent', 'Signa-Test')
    .field('name', 'Uploaded')
    .attach('file', buffer, 'agreement.pdf')
    .expect(201);
  expect(service.createSubmissionFromPdf).toHaveBeenCalledWith(
    user,
    { name: 'Uploaded' },
    expect.objectContaining({ file: [expect.objectContaining({ buffer })] }),
    expect.objectContaining({ ua: 'Signa-Test' }),
  );
});
it('passes deletion options with the authenticated actor and target submission', async () => {
  await request(app.getHttpServer())
    .delete('/api/submissions/submission-2')
    .query({ permanently: 'true' })
    .expect(200);
  expect(service.deleteSubmission).toHaveBeenCalledWith(user, 'submission-2', {
    permanently: 'true',
  });
});
it('gives the template path precedence over a conflicting list or creation payload', async () => {
  await request(app.getHttpServer())
    .get('/api/templates/template-2/submissions')
    .query({ template_id: 'spoofed', status: 'pending' })
    .expect(200);
  expect(service.listSubmissions).toHaveBeenCalledWith(user, {
    template_id: 'template-2',
    status: 'pending',
  });
  await request(app.getHttpServer())
    .post('/api/templates/template-2/submissions')
    .send({ template_id: 'spoofed', emails: 'signer@example.test' })
    .expect(201);
  expect(service.createSubmissionFromAlias).toHaveBeenCalledWith(
    user,
    { template_id: 'template-2', emails: 'signer@example.test' },
    expect.objectContaining({ ip: expect.any(String) as unknown }),
  );
});
it('exports the active account template with download headers and exact bytes', async () => {
  const content = Buffer.from('email,status\nsigner@example.test,completed');
  exportsService.exportTemplateSubmissions.mockResolvedValueOnce({
    content,
    contentType: 'text/csv',
    filename: 'submissions.csv',
  });
  const result = await request(app.getHttpServer())
    .get('/api/templates/template-2/submissions/export')
    .query({ format: 'csv' })
    .expect(200);
  expect(exportsService.exportTemplateSubmissions).toHaveBeenCalledWith(
    user.accountId,
    'template-2',
    { format: 'csv' },
  );
  expect(result.headers['content-type']).toContain('text/csv');
  expect(result.headers['content-disposition']).toBe(
    'attachment; filename="submissions.csv"',
  );
  expect(result.text).toBe(content.toString());
});
it.each([
  ['form', 'listFormEvents'],
  ['submission', 'listSubmissionEvents'],
] as const)(
  'binds %s event cursors and type to the active account actor',
  async (kind, method) => {
    await request(app.getHttpServer())
      .get(`/api/events/${kind}/completed`)
      .query({ limit: '10', after: 'previous', before: 'next' })
      .expect(200);
    expect(service[method]).toHaveBeenCalledWith(user, 'completed', {
      limit: '10',
      after: 'previous',
      before: 'next',
    });
  },
);
it('scopes request/resend mail and event history to the hydrated actor', async () => {
  await request(app.getHttpServer())
    .post('/api/submissions/submission-2/resend_email')
    .expect(201);
  expect(service.resendSubmissionEmail).toHaveBeenCalledWith(
    user,
    'submission-2',
  );
  await request(app.getHttpServer())
    .post('/api/submitters/submitter-3/send_email')
    .expect(201);
  expect(service.sendSubmitterEmail).toHaveBeenCalledWith(user, 'submitter-3');
  await request(app.getHttpServer())
    .get('/api/submissions/submission-2/mail-events')
    .expect(200);
  expect(service.listSubmissionMailEvents).toHaveBeenCalledWith(
    user,
    'submission-2',
  );
});
it('binds public completion-copy identifiers without inventing an authenticated account', async () => {
  await request(app.getHttpServer())
    .post('/api/send_submission_email')
    .send({
      submitter_slug: 'signer',
      submission_slug: 'submission',
      template_slug: 'template',
      email: 'copy@example.test',
    })
    .expect(201);
  expect(service.sendCompletedSubmissionEmail).toHaveBeenCalledWith({
    submitterSlug: 'signer',
    submissionSlug: 'submission',
    templateSlug: 'template',
    email: 'copy@example.test',
  });
});
