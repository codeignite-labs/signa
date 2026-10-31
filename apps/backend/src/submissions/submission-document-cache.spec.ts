import { PDFDocument } from 'pdf-lib';
import { Repository } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service';
import { AccountConfig } from '../accounts/entities/account-config.entity';
import { PdfSignatureService } from '../pdf-signatures/pdf-signature.service';
import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageBlob } from '../storage/entities/storage-blob.entity';
import { StorageService } from '../storage/storage.service';
import { Submitter } from '../submitters/entities/submitter.entity';
import { Template } from '../templates/entities/template.entity';
import { CompletedDocument } from './entities/completed-document.entity';
import { CompletedSubmitter } from './entities/completed-submitter.entity';
import { DocumentGenerationEvent } from './entities/document-generation-event.entity';
import { Submission } from './entities/submission.entity';
import { SubmissionDocumentsService } from './submission-documents.service';
import { SubmissionPdfGeneratorService } from './submission-pdf-generator.service';
function repository<T>(create: (input: Partial<T>) => T) {
  return {
    create: jest.fn(create),
    save: jest.fn((value: T) => Promise.resolve(value)),
    findOne: jest.fn<Promise<T | null>, [unknown]>().mockResolvedValue(null),
    exists: jest.fn().mockResolvedValue(false),
  };
}
async function setup() {
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
it('reuses value-hash previews and merged previews and invalidates only changed signing values', async () => {
  const { service, submission, submitter, storage, pdf, signatures } =
    await setup();
  const first = await service.ensurePreviewDocuments(submission);
  expect(await service.ensurePreviewDocuments(submission)).toEqual(first);
  expect(pdf.stampPdfDocument).toHaveBeenCalledTimes(1);
  const merged = await service.ensurePreviewMergedDocument(submission);
  expect(await service.ensurePreviewMergedDocument(submission)).toBe(merged);
  expect(pdf.mergePdfAttachments).toHaveBeenCalledTimes(1);
  submitter.values = { field: 'Changed' };
  expect(
    (await service.ensurePreviewDocuments(submission))[0].blob.metadata
      ?.values_hash,
  ).not.toBe(first[0].blob.metadata?.values_hash);
  await service.ensurePreviewMergedDocument(submission);
  expect(pdf.stampPdfDocument).toHaveBeenCalledTimes(2);
  expect(pdf.mergePdfAttachments).toHaveBeenCalledTimes(2);
  expect(storage.deleteRecordAttachments).toHaveBeenCalledWith({
    recordType: 'Submission',
    recordId: 'submission',
    name: 'preview_merged_document',
  });
  expect(signatures.signPdf).not.toHaveBeenCalled();
});
it('reuses signed/combined artifacts, records checksums once and invalidates merged artifacts when result values change', async () => {
  const {
    service,
    submission,
    submitter,
    completed,
    submitterCompletions,
    generation,
    storage,
    pdf,
  } = await setup();
  submitter.completedAt = new Date('2026-01-01');
  const combined = await service.getCombinedDocumentAttachment(submission);
  expect(combined).toBeTruthy();
  expect(await service.getCombinedDocumentUrl(submission)).toContain('.pdf');
  expect(pdf.mergePdfAttachments).toHaveBeenCalledTimes(1);
  await service.processSubmitterCompletion(submitter);
  completed.exists.mockResolvedValue(true);
  submitterCompletions.findOne.mockResolvedValue(
    Object.assign(new CompletedSubmitter(), { submitterId: 'signer' }),
  );
  generation.exists.mockResolvedValue(true);
  completed.save.mockClear();
  submitterCompletions.save.mockClear();
  generation.save.mockClear();
  await service.processSubmitterCompletion(submitter);
  expect(completed.save).not.toHaveBeenCalled();
  expect(submitterCompletions.save).not.toHaveBeenCalled();
  expect(generation.save).not.toHaveBeenCalled();
  submitter.values = { field: 'Updated after test cache creation' };
  await service.ensureResultDocuments(submitter);
  expect(storage.deleteRecordAttachments).toHaveBeenCalledWith({
    recordType: 'Submitter',
    recordId: 'signer',
    name: 'documents',
  });
  expect(storage.deleteRecordAttachments).toHaveBeenCalledWith({
    recordType: 'Submission',
    recordId: 'submission',
    name: 'combined_document',
  });
  expect(storage.deleteRecordAttachments).toHaveBeenCalledWith({
    recordType: 'Submission',
    recordId: 'submission',
    name: 'merged_document',
  });
});
it('returns no completion URLs for pending/empty submissions and safely creates standalone audit metadata without signers', async () => {
  const { service, submission, submitterCompletions, submitter, pdf } =
    await setup();
  expect(await service.getAuditTrailUrl(submission)).toBeNull();
  expect(await service.getCombinedDocumentAttachment(submission)).toBeNull();
  expect(await service.getCombinedDocumentUrl(submission)).toBeNull();
  await service.processSubmitterCompletion(submitter);
  expect(submitterCompletions.save).not.toHaveBeenCalled();
  submission.submitters = [];
  submission.template = null;
  submission.templateId = null;
  submission.name = null;
  expect(await service.getSubmissionDocuments(submission)).toEqual([]);
  expect((await service.ensureAuditTrail(submission)).blob.filename).toBe(
    'document-audit-log.pdf',
  );
  expect(pdf.buildAuditTrail).toHaveBeenCalledWith(submission, [], {
    isTestMode: false,
  });
});
it('applies account filename/security options and passes signature attachment metadata into the PDF generator', async () => {
  const {
    service,
    submitter,
    rows,
    config,
    storage,
    pdf,
    accounts,
    signatures,
  } = await setup();
  config.find.mockResolvedValue(
    ['document_filename_format', 'flatten_result_pdf', 'with_signature_id'].map(
      (key, index) =>
        Object.assign(new AccountConfig(), {
          key,
          value:
            index === 0
              ? '{submission.status}-{submission.submitters}-{submission.completed_at}'
              : index === 1
                ? false
                : true,
        }),
    ),
  );
  submitter.completedAt = new Date('2026-01-02');
  submitter.name = null;
  submitter.email = null;
  accounts.getTestingAccountContext.mockResolvedValue({ isTestMode: true });
  const signature = Object.assign(new StorageAttachment(), {
    id: 'signature',
    uuid: 'signature',
    recordType: 'Submitter',
    recordId: 'signer',
    name: 'attachments',
    createdAt: new Date('2026-01-01'),
    blob: new StorageBlob(),
  });
  rows.push(signature);
  await service.ensureResultDocuments(submitter);
  expect(storage.createPdfAttachment).toHaveBeenCalledWith(
    expect.objectContaining({
      filename: 'completed-submitters-2026-01-02.pdf',
    }),
  );
  expect(pdf.stampPdfDocument).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        flatten: false,
        withSignatureId: true,
        isTestMode: true,
      }) as unknown,
      signatureMetadataByUuid: new Map([
        [
          'signature',
          {
            signedAt: signature.createdAt,
            signerEmail: null,
            signerName: null,
          },
        ],
      ]),
    }),
  );
  expect(signatures.signPdf).toHaveBeenCalledWith(
    expect.objectContaining({ signerName: 'Signa' }),
  );
});
