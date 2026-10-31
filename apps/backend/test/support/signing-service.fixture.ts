import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AccountConfig } from '../../src/accounts/entities/account-config.entity';
import { BrandingService } from '../../src/branding/branding.service';
import { EmailVerificationCodeService } from '../../src/mail/email-verification-code.service';
import { PhoneVerificationService } from '../../src/signing/phone-verification/phone-verification.service';
import { SigningService } from '../../src/signing/signing.service';
import { StorageAttachment } from '../../src/storage/entities/storage-attachment.entity';
import { StorageBlob } from '../../src/storage/entities/storage-blob.entity';
import { StorageService } from '../../src/storage/storage.service';
import { DocumentGenerationQueueService } from '../../src/submissions/document-generation-queue.service';
import { IdentityVerification } from '../../src/submissions/entities/identity-verification.entity';
import { PaymentAttempt } from '../../src/submissions/entities/payment-attempt.entity';
import { SubmissionEvent } from '../../src/submissions/entities/submission-event.entity';
import { Submission } from '../../src/submissions/entities/submission.entity';
import { SubmissionDocumentsService } from '../../src/submissions/submission-documents.service';
import { Submitter } from '../../src/submitters/entities/submitter.entity';
import { Template } from '../../src/templates/entities/template.entity';
function providerRepository<T extends object>(
  create: (input: Partial<T>) => T,
) {
  return {
    existsBy: jest.fn().mockResolvedValue(false),
    create: jest.fn(create),
    save: jest.fn((value: T) => Promise.resolve(value)),
  };
}
export function createSigningServiceFixture() {
  const template: Template = Object.assign(new Template(), {
    id: 'template',
    name: 'Agreement',
    archivedAt: null,
    preferences: {},
    fields: [],
    schema: [],
    submitters: [{ uuid: 'party', name: 'Signer' }],
  });
  const submission: Submission = Object.assign(new Submission(), {
    id: 'submission',
    accountId: 'tenant',
    templateId: 'template',
    name: 'My Agreement',
    preferences: {},
    template,
    templateFields: null,
    templateSchema: null,
    templateSubmitters: null,
    submittersOrder: 'preserved',
    submitters: [],
    archivedAt: null,
    expireAt: null,
  });
  const submitter: Submitter = Object.assign(new Submitter(), {
    id: '1',
    accountId: 'tenant',
    submissionId: 'submission',
    uuid: 'party',
    slug: 'slug',
    email: 'signer@example.test',
    name: 'Signer Person',
    phone: '+15551234567',
    preferences: {},
    metadata: {},
    values: {},
    completedAt: null,
    declinedAt: null,
    sentAt: null,
    openedAt: null,
    submission,
    timezone: null,
    ip: null,
    ua: null,
  });
  submission.submitters = [submitter];
  const submitters = {
    findOne: jest
      .fn<Promise<Submitter | null>, [unknown]>()
      .mockResolvedValue(submitter),
    create: jest.fn((input: Partial<Submitter>) =>
      Object.assign(new Submitter(), { id: 'next', submission }, input),
    ),
    save: jest.fn((value: Submitter) => Promise.resolve(value)),
  };
  const configValues = new Map<string, unknown>();
  const accountConfigs = {
    find: jest.fn(() =>
      Promise.resolve(
        [...configValues].map(([key, value]) =>
          Object.assign(new AccountConfig(), { key, value }),
        ),
      ),
    ),
    findOne: jest.fn(({ where }: { where: { key: string } }) =>
      Promise.resolve(
        configValues.has(where.key)
          ? Object.assign(new AccountConfig(), {
              key: where.key,
              value: configValues.get(where.key),
            })
          : null,
      ),
    ),
  };
  const paymentAttempts = providerRepository<PaymentAttempt>((input) =>
    Object.assign(new PaymentAttempt(), { id: 'payment' }, input),
  );
  const identityVerifications = providerRepository<IdentityVerification>(
    (input) =>
      Object.assign(new IdentityVerification(), { id: 'verification' }, input),
  );
  const recordedEvents = {
    create: jest.fn((input: Partial<SubmissionEvent>) =>
      Object.assign(new SubmissionEvent(), { id: 'event' }, input),
    ),
    save: jest.fn((value: SubmissionEvent) => Promise.resolve(value)),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    exists: jest.fn().mockResolvedValue(false),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) =>
      entity === Submitter ? submitters : recordedEvents,
    ),
  };
  const source = {
    getRepository: jest.fn(() => recordedEvents),
    transaction: jest.fn(
      (callback: (manager: EntityManager) => Promise<unknown>) =>
        callback(manager as unknown as EntityManager),
    ),
  };
  const attachment: StorageAttachment = Object.assign(new StorageAttachment(), {
    id: 'attachment',
    uuid: 'asset',
    recordId: '1',
    createdAt: new Date('2026-01-01'),
    blob: Object.assign(new StorageBlob(), {
      filename: 'signature.png',
      contentType: 'image/png',
      metadata: {},
    }),
  });
  const storage = {
    createAttachment: jest.fn().mockResolvedValue(attachment),
    createBlobProxyUrl: jest.fn(
      (blob: StorageBlob) => `https://files.example.test/${blob.filename}`,
    ),
    findRecordAttachments: jest
      .fn<
        Promise<StorageAttachment[]>,
        [Parameters<StorageService['findRecordAttachments']>[0]]
      >()
      .mockResolvedValue([]),
    findPreviewAttachments: jest
      .fn<Promise<StorageAttachment[]>, [string]>()
      .mockResolvedValue([]),
  };
  const documents = {
    processSubmitterCompletion: jest.fn().mockResolvedValue(undefined),
    getCombinedDocumentAttachment: jest
      .fn<Promise<StorageAttachment | null>, [Submission]>()
      .mockResolvedValue(null),
    getSubmissionDocuments: jest.fn().mockResolvedValue([]),
  };
  const queue = {
    enqueueSubmitterCompletion: jest.fn().mockResolvedValue(undefined),
  };
  const events = { emit: jest.fn() };
  const emailCodes = { verifySubmitterCode: jest.fn().mockReturnValue(true) };
  const phone = {
    normalizePhone: jest.fn((value: string, country?: string | null) => {
      void country;
      return value.startsWith('+') ? value : '+' + value;
    }),
    sendCode: jest
      .fn()
      .mockResolvedValue({ to: '+15551234567', status: 'pending' }),
    checkCode: jest.fn().mockResolvedValue({ valid: true, status: 'approved' }),
  };
  const branding = {
    get: jest.fn().mockResolvedValue({
      account_name: 'Example Org',
      primary_color: '#336699',
    }),
  };
  const service = new SigningService(
    submitters as unknown as Repository<Submitter>,
    accountConfigs as unknown as Repository<AccountConfig>,
    paymentAttempts as unknown as Repository<PaymentAttempt>,
    identityVerifications as unknown as Repository<IdentityVerification>,
    source as unknown as DataSource,
    storage as unknown as StorageService,
    documents as unknown as SubmissionDocumentsService,
    queue as unknown as DocumentGenerationQueueService,
    events as unknown as EventEmitter2,
    new ConfigService({ JWT_SECRET: 'test-secret' }),
    emailCodes as unknown as EmailVerificationCodeService,
    phone as unknown as PhoneVerificationService,
    branding as unknown as BrandingService,
  );
  return {
    service,
    submitter,
    submission,
    template,
    submitters,
    configValues,
    accountConfigs,
    paymentAttempts,
    identityVerifications,
    recordedEvents,
    source,
    attachment,
    storage,
    documents,
    queue,
    events,
    emailCodes,
    phone,
    branding,
  };
}
