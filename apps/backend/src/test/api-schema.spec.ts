import 'reflect-metadata';
import { INestApplication, Type } from '@nestjs/common';
import { GUARDS_METADATA, PARAMTYPES_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule, OpenAPIObject } from '@nestjs/swagger';
import { AccountCustomFieldsController } from '../accounts/account-custom-fields.controller';
import { AccountMembershipsController } from '../accounts/account-memberships.controller';
import { AccountsController } from '../accounts/accounts.controller';
import { BrandingController } from '../accounts/branding.controller';
import { TestingAccountsController } from '../accounts/testing-accounts.controller';
import { AppController } from '../app.controller';
import { AuthController } from '../auth/auth.controller';
import { HealthController } from '../health/health.controller';
import { MailProviderEventsController } from '../mail/mail-provider-events.controller';
import { RealtimeController } from '../realtime/realtime.controller';
import { AttachmentsController } from '../signing/attachments.controller';
import { SigningController } from '../signing/signing.controller';
import { SubmitterTrackingController } from '../signing/submitter-tracking.controller';
import { SmsProviderEventsController } from '../sms/sms-provider-events.controller';
import { StartFormController } from '../start-form/start-form.controller';
import { StorageController } from '../storage/storage.controller';
import { SubmissionsController } from '../submissions/submissions.controller';
import { TemplateSubmissionsController } from '../submissions/submissions.controller';
import { EventsController } from '../submissions/submissions.controller';
import { SubmissionMailController } from '../submissions/submissions.controller';
import { SubmittersController } from '../submitters/submitters.controller';
import { TeamsController } from '../teams/teams.controller';
import { TemplatesController } from '../templates/templates.controller';
import { ToolsController } from '../tools/tools.controller';
import { UsersController } from '../users/users.controller';
import { WebhooksController } from '../webhooks/webhooks.controller';
import { WebhookEventsController } from '../webhooks/webhooks.controller';
// Schema generation must not connect to storage, mail, queues or a real database.
// Service behavior is verified in feature suites; this contract covers the actual
// controllers and DTO composition presented to generated SDK consumers.
const controllers: Type[] = [
  AccountCustomFieldsController,
  AccountMembershipsController,
  AccountsController,
  BrandingController,
  TestingAccountsController,
  AppController,
  AuthController,
  HealthController,
  MailProviderEventsController,
  RealtimeController,
  AttachmentsController,
  SigningController,
  SubmitterTrackingController,
  SmsProviderEventsController,
  StartFormController,
  StorageController,
  SubmissionsController,
  TemplateSubmissionsController,
  EventsController,
  SubmissionMailController,
  SubmittersController,
  TeamsController,
  TemplatesController,
  ToolsController,
  UsersController,
  WebhooksController,
  WebhookEventsController,
];
function collectGuards(controller: Type): Type[] {
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
let app: INestApplication;
let schema: OpenAPIObject;
beforeAll(async () => {
  const dependencies = new Set(
    controllers.flatMap(
      (controller) =>
        (Reflect.getMetadata(PARAMTYPES_METADATA, controller) as
          | Type[]
          | undefined) ?? [],
    ),
  );
  const builder = Test.createTestingModule({
    controllers,
    providers: [...dependencies].map((provide) => ({ provide, useValue: {} })),
  }).useMocker(() => ({}));
  for (const guard of new Set(controllers.flatMap(collectGuards)))
    builder.overrideGuard(guard).useValue({ canActivate: () => true });
  const module = await builder.compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  const config = new DocumentBuilder()
    .setTitle('Signa API')
    .setVersion('contract-test')
    .addBearerAuth()
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'X-Auth-Token' },
      'X-Auth-Token',
    )
    .build();
  schema = SwaggerModule.createDocument(app, config);
});
afterAll(async () => {
  await app?.close();
});
it.each([
  '/api/templates',
  '/api/submissions',
  '/api/users',
  '/api/teams',
  '/api/webhooks',
])(
  'documents authenticated collection %s and its request/response shapes',
  (path) => {
    const endpoint = schema.paths[path];
    expect(endpoint?.get).toBeDefined();
    expect(endpoint?.post).toBeDefined();
    expect(endpoint?.get?.security).toContainEqual({ bearer: [] });
    expect(endpoint?.post?.requestBody).toBeDefined();
    expect(endpoint?.get?.responses['200']).toBeDefined();
  },
);
it('keeps public signing and account APIs represented in the document', () => {
  for (const path of [
    '/api/signing/{slug}',
    '/api/signing/{slug}/complete',
    '/api/auth/login',
    '/api/account',
    '/api/health/live',
    '/api/health/ready',
    '/api/realtime/stream',
  ])
    expect(schema.paths[path]).toBeDefined();
  expect(Object.keys(schema.components?.schemas ?? {}).length).toBeGreaterThan(
    60,
  );
});
it('preserves credential validation and webhook query schema types', () => {
  expect(schema.components?.schemas?.CreateUserDto).toMatchObject({
    type: 'object',
    required: ['email'],
    properties: {
      email: { type: 'string' },
      role: {
        enum: expect.arrayContaining(['admin', 'member', 'viewer']) as unknown,
      },
    },
  });
  expect(schema.components?.schemas?.LoginDto).toMatchObject({
    required: ['email', 'password'],
    properties: { password: { minLength: 8 } },
  });
  expect(schema.paths['/api/webhooks/{id}/events']?.get?.parameters).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
      expect.objectContaining({ name: 'status', in: 'query' }),
    ]),
  );
});

it('documents every supported single/batch/array submission creation payload', () => {
  expect(schema.paths['/api/submissions']?.post?.requestBody).toMatchObject({
    content: {
      'application/json': {
        schema: {
          oneOf: [
            { $ref: '#/components/schemas/CreateSubmissionDto' },
            { $ref: '#/components/schemas/CreateSubmissionBatchDto' },
            {
              type: 'array',
              items: { $ref: '#/components/schemas/CreateSubmissionDto' },
            },
          ],
        },
      },
    },
  });
  expect(
    schema.components?.schemas?.CreateSubmissionSubmitterDto,
  ).toBeDefined();
});
