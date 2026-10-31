import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AccountsService } from '../../src/accounts/accounts.service';
import { EmailMessage } from '../../src/mail/entities/email-message.entity';
import { StorageAttachment } from '../../src/storage/entities/storage-attachment.entity';
import { StorageBlob } from '../../src/storage/entities/storage-blob.entity';
import { StorageService } from '../../src/storage/storage.service';
import { CreateSubmissionDto } from '../../src/submissions/dto/create-submission.dto';
import { DocumentGenerationQueueService } from '../../src/submissions/document-generation-queue.service';
import { SubmissionEvent } from '../../src/submissions/entities/submission-event.entity';
import { Submission } from '../../src/submissions/entities/submission.entity';
import { OwnerAutoSignService } from '../../src/submissions/owner-auto-sign.service';
import { SubmissionDocumentsService } from '../../src/submissions/submission-documents.service';
import { SubmissionsService } from '../../src/submissions/submissions.service';
import { SubmitterValueNormalizer } from '../../src/submissions/submitter-value-normalizer.service';
import { Submitter } from '../../src/submitters/entities/submitter.entity';
import { TemplateFolder } from '../../src/templates/entities/template-folder.entity';
import { Template } from '../../src/templates/entities/template.entity';
import { TemplatesService } from '../../src/templates/templates.service';
import { User } from '../../src/users/entities/user.entity';
import { createQueryBuilderFixture } from './query-builder.fixture';
export function createSubmissionsServiceFixture() {
  const user: User = Object.assign(new User(), {
    id: 'owner',
    accountId: 'tenant',
    email: 'owner@example.test',
    firstName: 'First',
    lastName: 'Last',
    role: 'admin',
  });
  const template: Template = Object.assign(new Template(), {
    id: 'template',
    name: 'Agreement',
    slug: 'template-slug',
    accountId: 'tenant',
    authorId: 'owner',
    fields: [
      {
        uuid: 'field',
        name: 'Full name',
        type: 'text',
        submitter_uuid: 'party',
      },
    ],
    preferences: {},
    submitters: [{ uuid: 'party', name: 'Signer' }],
    schema: [],
    folder: Object.assign(new TemplateFolder(), {
      name: 'Contracts',
      parentFolder: null,
    }),
    archivedAt: null,
    variablesSchema: null,
  });
  const submission: Submission = Object.assign(new Submission(), {
    id: 'submission',
    name: 'Agreement',
    slug: 'submission-slug',
    source: 'api',
    accountId: 'tenant',
    templateId: 'template',
    template,
    templateFields: null,
    templateSubmitters: null,
    templateSchema: null,
    variables: {},
    preferences: {},
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    expireAt: null,
    archivedAt: null,
    submittersOrder: 'preserved',
    createdByUser: user,
    submissionEvents: [],
  });
  const submitter: Submitter = Object.assign(new Submitter(), {
    id: '1',
    accountId: 'tenant',
    submissionId: 'submission',
    uuid: 'party',
    slug: 'signer-slug',
    email: 'signer@example.test',
    name: 'Signer',
    phone: null,
    externalId: null,
    preferences: {},
    values: {},
    metadata: {},
    sentAt: null,
    openedAt: null,
    completedAt: null,
    declinedAt: null,
    submission,
  });
  submission.submitters = [submitter];
  const submissionQuery = createQueryBuilderFixture<Submission>();
  const submitterQuery = createQueryBuilderFixture<Submitter>();
  const submissions = {
    createQueryBuilder: jest.fn().mockReturnValue(submissionQuery),
    findOneOrFail: jest
      .fn<Promise<Submission>, [unknown]>()
      .mockResolvedValue(submission),
    findOne: jest
      .fn<Promise<Submission | null>, [unknown]>()
      .mockResolvedValue(submission),
    create: jest.fn((input: Partial<Submission>) =>
      Object.assign(new Submission(), submission, input),
    ),
    save: jest.fn((value: Submission) => Promise.resolve(value)),
    remove: jest.fn((value: Submission) => Promise.resolve(value)),
  };
  const submitters = {
    createQueryBuilder: jest.fn().mockReturnValue(submitterQuery),
    findOne: jest
      .fn<Promise<Submitter | null>, [unknown]>()
      .mockResolvedValue(submitter),
    create: jest.fn((input: Partial<Submitter>) =>
      Object.assign(new Submitter(), submitter, input),
    ),
    save: jest.fn((value: Submitter) => Promise.resolve(value)),
  };
  const templates = {
    find: jest.fn<Promise<Template[]>, [unknown]>().mockResolvedValue([]),
    save: jest.fn((value: Template) => Promise.resolve(value)),
    findOne: jest
      .fn<Promise<Template | null>, [unknown]>()
      .mockResolvedValue(template),
  };
  const emailMessages = {
    find: jest.fn<Promise<EmailMessage[]>, [unknown]>().mockResolvedValue([]),
  };
  const eventRecords = {
    create: jest.fn((input: Partial<SubmissionEvent>) =>
      Object.assign(new SubmissionEvent(), input),
    ),
    save: jest.fn((value: SubmissionEvent) => Promise.resolve(value)),
  };
  const repositories = new Map<unknown, unknown>([
    [Submission, submissions],
    [Submitter, submitters],
    [SubmissionEvent, eventRecords],
  ]);
  const manager = {
    getRepository: jest.fn((entity: unknown) => repositories.get(entity)),
  };
  const source = {
    transaction: jest.fn(
      (callback: (manager: EntityManager) => Promise<unknown>) =>
        callback(manager as unknown as EntityManager),
    ),
  };
  const storage = {
    createBlobProxyUrl: jest.fn(
      (blob: StorageBlob) => `https://files.example.test/${blob.filename}`,
    ),
    findRecordAttachments: jest
      .fn<
        Promise<StorageAttachment[]>,
        [Parameters<StorageService['findRecordAttachments']>[0]]
      >()
      .mockResolvedValue([]),
    findPreviewAttachments: jest.fn().mockResolvedValue([]),
    findPreviewAttachmentsByRecordIds: jest
      .fn<Promise<Map<string, StorageAttachment[]>>, [string[]]>()
      .mockResolvedValue(new Map()),
    cloneAttachment: jest.fn(
      (input: Parameters<StorageService['cloneAttachment']>[0]) =>
        Promise.resolve(
          Object.assign(new StorageAttachment(), input.sourceAttachment, {
            id: 'cloned',
            uuid: input.uuid ?? 'preview-cloned',
          }),
        ),
    ),
  };
  const accounts = {
    getTestingAccountContext: jest.fn().mockResolvedValue({
      isTestMode: false,
      productionAccountId: 'tenant',
      testingAccountId: null,
    }),
  };
  const documents = {
    getAuditTrailUrl: jest
      .fn()
      .mockResolvedValue('https://files.example.test/audit.pdf'),
    getCombinedDocumentUrl: jest
      .fn()
      .mockResolvedValue('https://files.example.test/combined.pdf'),
    getSubmissionDocuments: jest
      .fn<Promise<StorageAttachment[]>, [Submission, { merge?: boolean }]>()
      .mockResolvedValue([]),
    processSubmitterCompletion: jest.fn().mockResolvedValue(undefined),
  };
  const queue = {
    enqueueSubmissionArtifacts: jest.fn().mockResolvedValue(undefined),
    enqueueSubmitterCompletion: jest.fn().mockResolvedValue(undefined),
  };
  const events = { emit: jest.fn() };
  const templateService = {
    createBackingTemplateFromPdf: jest.fn().mockResolvedValue(template),
    createBackingTemplateFromHtml: jest.fn().mockResolvedValue(template),
    createBackingTemplateFromDocx: jest.fn().mockResolvedValue(template),
  };
  const ownerSign = {
    prepareSubmittersInput: jest.fn(
      (_user: User, _template: Template, input: CreateSubmissionDto) =>
        Promise.resolve(input),
    ),
    completeSavedSignatureSubmitters: jest.fn().mockResolvedValue(undefined),
  };
  const config = new ConfigService({
    API_PUBLIC_URL: 'https://sign.example.test/api',
  });
  const normalizer = new SubmitterValueNormalizer(
    storage as unknown as StorageService,
    config,
  );
  const service = new SubmissionsService(
    submissions as unknown as Repository<Submission>,
    submitters as unknown as Repository<Submitter>,
    templates as unknown as Repository<Template>,
    emailMessages as unknown as Repository<EmailMessage>,
    source as unknown as DataSource,
    templateService as unknown as TemplatesService,
    storage as unknown as StorageService,
    accounts as unknown as AccountsService,
    config,
    documents as unknown as SubmissionDocumentsService,
    queue as unknown as DocumentGenerationQueueService,
    events as unknown as EventEmitter2,
    normalizer,
    ownerSign as unknown as OwnerAutoSignService,
  );
  return {
    service,
    user,
    template,
    submission,
    submitter,
    submissionQuery,
    submitterQuery,
    submissions,
    submitters,
    templates,
    emailMessages,
    eventRecords,
    source,
    storage,
    accounts,
    documents,
    queue,
    events,
    templateService,
    ownerSign,
  };
}
