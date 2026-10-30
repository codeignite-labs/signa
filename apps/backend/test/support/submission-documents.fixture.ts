import { PDFDocument } from 'pdf-lib';
import { Repository } from 'typeorm';
import { AccountsService } from '../../src/accounts/accounts.service';
import { AccountConfig } from '../../src/accounts/entities/account-config.entity';
import { PdfSignatureService } from '../../src/pdf-signatures/pdf-signature.service';
import { StorageAttachment } from '../../src/storage/entities/storage-attachment.entity';
import { StorageBlob } from '../../src/storage/entities/storage-blob.entity';
import { StorageService } from '../../src/storage/storage.service';
import { Submitter } from '../../src/submitters/entities/submitter.entity';
import { Template } from '../../src/templates/entities/template.entity';
import { CompletedDocument } from '../../src/submissions/entities/completed-document.entity';
import { CompletedSubmitter } from '../../src/submissions/entities/completed-submitter.entity';
import { DocumentGenerationEvent } from '../../src/submissions/entities/document-generation-event.entity';
import { Submission } from '../../src/submissions/entities/submission.entity';
import { SubmissionDocumentsService } from '../../src/submissions/submission-documents.service';
import { SubmissionPdfGeneratorService } from '../../src/submissions/submission-pdf-generator.service';
function repository<T>(create: (input: Partial<T>) => T) {
  return {
    create: jest.fn(create),
    save: jest.fn((value: T) => Promise.resolve(value)),
    findOne: jest.fn<Promise<T | null>, [unknown]>().mockResolvedValue(null),
    exists: jest.fn().mockResolvedValue(false),
  };
}
export async function createSubmissionDocumentsFixture() {
  const sourcePdf = await PDFDocument.create();
  sourcePdf.addPage();
  const buffer = Buffer.from(await sourcePdf.save());
  const completed = repository<CompletedDocument>((input) =>
    Object.assign(new CompletedDocument(), input),
  );
  const submitterCompletions = repository<CompletedSubmitter>((input) =>
    Object.assign(new CompletedSubmitter(), input),
  );
  const generation = repository<DocumentGenerationEvent>((input) =>
    Object.assign(new DocumentGenerationEvent(), input),
  );
  const config = {
    find: jest.fn<Promise<AccountConfig[]>, [unknown]>().mockResolvedValue([]),
  };
  const template: Template = Object.assign(new Template(), {
    id: 'template',
    name: 'Agreement',
    fields: [{ uuid: 'field', default_value: 'Default text' }],
    schema: [{ attachment_uuid: 'source', name: 'Agreement' }],
  });
  const submission: Submission = Object.assign(new Submission(), {
    id: 'submission',
    accountId: 'tenant',
    slug: 'slug',
    name: 'Agreement',
    source: 'api',
    templateId: 'template',
    template,
    templateFields: null,
    templateSchema: null,
    submitters: [],
  });
  const submitter: Submitter = Object.assign(new Submitter(), {
    id: 'signer',
    accountId: 'tenant',
    submissionId: 'submission',
    submission,
    name: 'Signer',
    email: 'signer@example.test',
    values: {},
    completedAt: null,
  });
  submission.submitters = [submitter];
  const original = Object.assign(new StorageAttachment(), {
    id: 'original',
    uuid: 'source',
    recordType: 'Template',
    recordId: 'template',
    name: 'documents',
    blob: Object.assign(new StorageBlob(), {
      filename: 'Agreement.pdf',
      metadata: {},
      checksum: 'original-md5',
    }),
  });
  const rows: StorageAttachment[] = [original];
  const storage = {
    findRecordAttachments: jest.fn(
      (query: Parameters<StorageService['findRecordAttachments']>[0]) =>
        Promise.resolve(
          rows.filter(
            (row) =>
              row.recordType === query.recordType &&
              row.recordId === query.recordId &&
              row.name === query.name,
          ),
        ),
    ),
    deleteRecordAttachments: jest.fn(
      (query: Parameters<StorageService['deleteRecordAttachments']>[0]) => {
        for (let index = rows.length - 1; index >= 0; index--)
          if (
            rows[index].recordType === query.recordType &&
            rows[index].recordId === query.recordId &&
            rows[index].name === query.name
          )
            rows.splice(index, 1);
        return Promise.resolve();
      },
    ),
    createPdfAttachment: jest.fn(
      (input: Parameters<StorageService['createPdfAttachment']>[0]) => {
        const row = Object.assign(new StorageAttachment(), {
          id: `stored-${rows.length}`,
          uuid: `generated-${rows.length}`,
          recordType: input.recordType,
          recordId: input.recordId,
          name: input.name,
          blob: Object.assign(new StorageBlob(), {
            filename: input.filename,
            metadata: { ...input.metadata, sha256: 'result-sha' },
          }),
        });
        rows.push(row);
        return Promise.resolve(row);
      },
    ),
    createBlobProxyUrl: jest.fn(
      (blob: StorageBlob) => `https://files.example.test/${blob.filename}`,
    ),
  };
  const pdf = {
    stampPdfDocument: jest.fn().mockResolvedValue(buffer),
    mergePdfAttachments: jest.fn().mockResolvedValue(buffer),
    buildAuditTrail: jest.fn().mockResolvedValue(buffer),
  };
  const signatures = {
    getActiveCertificateName: jest.fn().mockResolvedValue('Identity'),
    getTimestampServerUrl: jest.fn().mockResolvedValue(null),
    signPdf: jest.fn((input: { buffer: Buffer }) =>
      Promise.resolve({
        buffer: input.buffer,
        signed: true,
        certificateName: null,
        signatureSubFilter: 'ETSI.CAdES.detached',
        timestampServerUrl: null,
        timestamp: {
          attempts: [],
          embedded: false,
          required: false,
          status: 'disabled',
          tokenSha256: null,
          url: null,
        },
        ltv: { evidenceStatus: 'missing', ltvRequired: false },
        pdfA: {
          conversionStatus: 'disabled',
          enabled: false,
          error: null,
          level: '2b',
          required: false,
          validationStatus: 'disabled',
        },
      }),
    ),
  };
  const accounts = {
    getTestingAccountContext: jest
      .fn()
      .mockResolvedValue({ isTestMode: false }),
  };
  const service = new SubmissionDocumentsService(
    completed as unknown as Repository<CompletedDocument>,
    submitterCompletions as unknown as Repository<CompletedSubmitter>,
    generation as unknown as Repository<DocumentGenerationEvent>,
    config as unknown as Repository<AccountConfig>,
    storage as unknown as StorageService,
    pdf as unknown as SubmissionPdfGeneratorService,
    signatures as unknown as PdfSignatureService,
    accounts as unknown as AccountsService,
  );
  return {
    service,
    submission,
    submitter,
    original,
    rows,
    storage,
    pdf,
    signatures,
    accounts,
    config,
    completed,
    submitterCompletions,
    generation,
  };
}
