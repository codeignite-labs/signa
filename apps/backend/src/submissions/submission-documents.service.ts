import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service';
import { AccountConfig } from '../accounts/entities/account-config.entity';
import {
  PdfSignatureResult,
  PdfSignatureService,
} from '../pdf-signatures/pdf-signature.service';
import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageService } from '../storage/storage.service';
import { Submitter } from '../submitters/entities/submitter.entity';
import {
  TemplateField,
  TemplateSchemaItem,
} from '../templates/types/template-json';
import { CompletedDocument } from './entities/completed-document.entity';
import { CompletedSubmitter } from './entities/completed-submitter.entity';
import { DocumentGenerationEvent } from './entities/document-generation-event.entity';
import { Submission } from './entities/submission.entity';
import {
  AuditTrailDocument,
  SourceDocument,
  SubmissionPdfGeneratorService,
} from './submission-pdf-generator.service';

type ResultGenerationOptions = {
  documentId: string;
  documentFilenameFormat: string;
  flatten: boolean;
  isTestMode: boolean;
  signingCertificateName: string | null;
  timestampServerUrl: string | null;
  withSignatureId: boolean;
};

@Injectable()
export class SubmissionDocumentsService {
  constructor(
    @InjectRepository(CompletedDocument)
    private readonly completedDocuments: Repository<CompletedDocument>,
    @InjectRepository(CompletedSubmitter)
    private readonly completedSubmitters: Repository<CompletedSubmitter>,
    @InjectRepository(DocumentGenerationEvent)
    private readonly generationEvents: Repository<DocumentGenerationEvent>,
    @InjectRepository(AccountConfig)
    private readonly accountConfigs: Repository<AccountConfig>,
    private readonly storageService: StorageService,
    private readonly pdfGenerator: SubmissionPdfGeneratorService,
    private readonly pdfSignatureService: PdfSignatureService,
    private readonly accountsService: AccountsService,
  ) {}

  async getSubmissionDocuments(
    submission: Submission,
    options: { merge?: boolean } = {},
  ): Promise<StorageAttachment[]> {
    if (this.isSubmissionCompleted(submission)) {
      const lastSubmitter = this.getLastCompletedSubmitter(submission);

      if (!lastSubmitter) {
        return [];
      }

      return options.merge
        ? [
            await this.ensureMergedDocument(lastSubmitter, {
              submission,
              withAudit: false,
            }),
          ]
        : this.ensureResultDocuments(lastSubmitter, submission);
    }

    return options.merge
      ? [await this.ensurePreviewMergedDocument(submission)]
      : this.ensurePreviewDocuments(submission);
  }

  async getAuditTrailUrl(submission: Submission): Promise<string | null> {
    if (!this.isSubmissionCompleted(submission)) {
      return null;
    }

    const auditTrail = await this.ensureAuditTrail(submission);

    return this.storageService.createBlobProxyUrl(auditTrail.blob, 3600);
  }

  async getCombinedDocumentAttachment(
    submission: Submission,
  ): Promise<StorageAttachment | null> {
    if (!this.isSubmissionCompleted(submission)) {
      return null;
    }

    const lastSubmitter = this.getLastCompletedSubmitter(submission);

    if (!lastSubmitter) {
      return null;
    }

    return this.ensureMergedDocument(lastSubmitter, {
      submission,
      withAudit: true,
    });
  }

  async getCombinedDocumentUrl(submission: Submission): Promise<string | null> {
    const combined = await this.getCombinedDocumentAttachment(submission);

    return combined
      ? this.storageService.createBlobProxyUrl(combined.blob, 3600)
      : null;
  }

  async processSubmitterCompletion(submitter: Submitter): Promise<void> {
    await this.recordGenerationEvent(submitter.id, 'start');
    const resultDocuments = await this.ensureResultDocuments(
      submitter,
      submitter.submission,
    );

    await this.recordCompletedDocumentChecksums(submitter, resultDocuments);

    if (this.isSubmissionCompleted(submitter.submission)) {
      await this.ensureAuditTrail(submitter.submission);
    }

    await this.ensureCompletedSubmitter(submitter);
    await this.recordGenerationEvent(submitter.id, 'complete');
  }

  async ensureResultDocuments(
    submitter: Submitter,
    submission = submitter.submission,
  ): Promise<StorageAttachment[]> {
    const generationOptions = await this.getResultGenerationOptions(submission);
    const valuesHash = this.buildValuesHash(submission, generationOptions);
    const existing = await this.storageService.findRecordAttachments({
      recordType: 'Submitter',
      recordId: submitter.id,
      name: 'documents',
    });

    if (
      existing.length > 0 &&
      existing.every(
        (attachment) => attachment.blob.metadata?.values_hash === valuesHash,
      )
    ) {
      return existing;
    }

    if (existing.length > 0) {
      await this.storageService.deleteRecordAttachments({
        recordType: 'Submitter',
        recordId: submitter.id,
        name: 'documents',
      });
      await this.deleteSubmissionMergedDocuments(submission);
    }

    const documents = await this.getSourceDocuments(submission);
    const fields = this.getSubmissionFields(submission);
    const values = this.buildSubmissionValues(submission);
    const attachmentContext = await this.getSubmitterAttachmentsContext(
      submission.submitters ?? [submitter],
    );

    const generated: StorageAttachment[] = [];

    for (const document of documents) {
      const filename = this.buildResultFilename(
        submission,
        document.filename,
        generationOptions.documentFilenameFormat,
      );
      const pdf = await this.pdfGenerator.stampPdfDocument({
        document,
        fields,
        values,
        attachmentsByUuid: attachmentContext.attachmentsByUuid,
        signatureMetadataByUuid: attachmentContext.signatureMetadataByUuid,
        options: generationOptions,
      });
      const signed = await this.signArtifactPdf({
        accountId: submission.accountId,
        buffer: pdf,
        contactInfo: submitter.email,
        reason: 'Signed document',
        signerName: submitter.name ?? submitter.email ?? 'Signa',
        signingTime: submitter.completedAt ?? new Date(),
      });

      generated.push(
        await this.storageService.createPdfAttachment({
          buffer: signed.buffer,
          filename,
          name: 'documents',
          recordType: 'Submitter',
          recordId: submitter.id,
          metadata: {
            ...this.buildCryptographicSignatureMetadata(signed),
            original_sha256: getAttachmentChecksum(document.attachment),
            original_uuid: document.uuid,
            values_hash: valuesHash,
          },
        }),
      );
    }

    return generated;
  }

  async ensurePreviewDocuments(
    submission: Submission,
  ): Promise<StorageAttachment[]> {
    const generationOptions = await this.getResultGenerationOptions(submission);
    const valuesHash = this.buildValuesHash(submission, generationOptions);
    const existing = await this.storageService.findRecordAttachments({
      recordType: 'Submission',
      recordId: submission.id,
      name: 'preview_documents',
    });

    if (
      existing.length > 0 &&
      existing.every(
        (attachment) => attachment.blob.metadata?.values_hash === valuesHash,
      )
    ) {
      return existing;
    }

    await this.storageService.deleteRecordAttachments({
      recordType: 'Submission',
      recordId: submission.id,
      name: 'preview_documents',
    });

    const documents = await this.getSourceDocuments(submission);
    const fields = this.getSubmissionFields(submission);
    const values = this.buildSubmissionValues(submission);
    const attachmentContext = await this.getSubmitterAttachmentsContext(
      submission.submitters ?? [],
    );

    const generated: StorageAttachment[] = [];

    for (const document of documents) {
      const pdf = await this.pdfGenerator.stampPdfDocument({
        document,
        fields,
        values,
        attachmentsByUuid: attachmentContext.attachmentsByUuid,
        signatureMetadataByUuid: attachmentContext.signatureMetadataByUuid,
        options: generationOptions,
      });

      generated.push(
        await this.storageService.createPdfAttachment({
          buffer: pdf,
          filename: document.filename,
          name: 'preview_documents',
          recordType: 'Submission',
          recordId: submission.id,
          metadata: { values_hash: valuesHash },
        }),
      );
    }

    return generated;
  }

  async ensurePreviewMergedDocument(
    submission: Submission,
  ): Promise<StorageAttachment> {
    const generationOptions = await this.getResultGenerationOptions(submission);
    const valuesHash = this.buildValuesHash(submission, generationOptions);
    const [existing] = await this.storageService.findRecordAttachments({
      recordType: 'Submission',
      recordId: submission.id,
      name: 'preview_merged_document',
    });

    if (existing?.blob.metadata?.values_hash === valuesHash) {
      return existing;
    }

    await this.storageService.deleteRecordAttachments({
      recordType: 'Submission',
      recordId: submission.id,
      name: 'preview_merged_document',
    });

    const documents = await this.ensurePreviewDocuments(submission);
    const merged = await this.pdfGenerator.mergePdfAttachments(documents);

    return this.storageService.createPdfAttachment({
      buffer: merged,
      filename: ensurePdfFilename(this.getSubmissionBaseName(submission)),
      name: 'preview_merged_document',
      recordType: 'Submission',
      recordId: submission.id,
      metadata: { values_hash: valuesHash },
    });
  }

  async ensureMergedDocument(
    submitter: Submitter,
    options: { submission?: Submission; withAudit: boolean },
  ): Promise<StorageAttachment> {
    const submission = options.submission ?? submitter.submission;
    const withAudit = options.withAudit;
    const attachmentName = withAudit ? 'combined_document' : 'merged_document';
    const generationOptions = await this.getResultGenerationOptions(submission);
    const valuesHash = this.buildValuesHash(submission, {
      ...generationOptions,
      withAudit,
    });
    const [existing] = await this.storageService.findRecordAttachments({
      recordType: 'Submission',
      recordId: submitter.submissionId,
      name: attachmentName,
    });

    if (existing?.blob.metadata?.values_hash === valuesHash) {
      if (submitter.completedAt) {
        await this.recordCompletedDocumentChecksum(submitter, existing);
      }

      return existing;
    }

    if (existing) {
      await this.storageService.deleteRecordAttachments({
        recordType: 'Submission',
        recordId: submitter.submissionId,
        name: attachmentName,
      });
    }

    const documents = await this.ensureResultDocuments(submitter, submission);
    const attachments = withAudit
      ? [...documents, await this.ensureAuditTrail(submission)]
      : documents;
    const merged = await this.pdfGenerator.mergePdfAttachments(attachments);
    const signed = await this.signArtifactPdf({
      accountId: submission.accountId,
      buffer: merged,
      contactInfo: submitter.email,
      reason: withAudit
        ? 'Combined signed document and audit trail'
        : 'Merged signed document',
      signerName: submitter.name ?? submitter.email ?? 'Signa',
      signingTime: submitter.completedAt ?? new Date(),
    });

    const attachment = await this.storageService.createPdfAttachment({
      buffer: signed.buffer,
      filename: this.buildResultFilename(
        submission,
        this.getSubmissionBaseName(submission),
        generationOptions.documentFilenameFormat,
      ),
      name: attachmentName,
      recordType: 'Submission',
      recordId: submitter.submissionId,
      metadata: {
        ...this.buildCryptographicSignatureMetadata(signed),
        values_hash: valuesHash,
      },
    });

    if (submitter.completedAt) {
      await this.recordCompletedDocumentChecksum(submitter, attachment);
    }

    return attachment;
  }

  async ensureAuditTrail(submission: Submission): Promise<StorageAttachment> {
    const [existing] = await this.storageService.findRecordAttachments({
      recordType: 'Submission',
      recordId: submission.id,
      name: 'audit_trail',
    });

    if (existing) {
      return existing;
    }

    const lastSubmitter = this.getLastCompletedSubmitter(submission);
    const documents = lastSubmitter
      ? await this.ensureResultDocuments(lastSubmitter, submission)
      : [];
    const sourceDocuments = await this.getSourceDocuments(submission);
    const auditDocuments = buildAuditTrailDocuments(documents, sourceDocuments);
    const buffer = await this.pdfGenerator.buildAuditTrail(
      submission,
      auditDocuments,
      {
        isTestMode: (
          await this.accountsService.getTestingAccountContext(
            submission.accountId,
          )
        ).isTestMode,
      },
    );
    const signed = await this.signArtifactPdf({
      accountId: submission.accountId,
      buffer,
      contactInfo: lastSubmitter?.email,
      reason: 'Audit trail',
      signerName: lastSubmitter?.name ?? lastSubmitter?.email ?? 'Signa',
      signingTime: lastSubmitter?.completedAt ?? new Date(),
    });

    return this.storageService.createPdfAttachment({
      buffer: signed.buffer,
      filename: ensurePdfFilename(
        `${this.getSubmissionBaseName(submission)}-audit-log`,
      ),
      name: 'audit_trail',
      recordType: 'Submission',
      recordId: submission.id,
      metadata: {
        ...this.buildCryptographicSignatureMetadata(signed),
      },
    });
  }

  private async ensureCompletedSubmitter(submitter: Submitter): Promise<void> {
    const existing = await this.completedSubmitters.findOne({
      where: { submitterId: submitter.id },
    });

    if (existing || !submitter.completedAt) {
      return;
    }

    const hasFirst = await this.completedSubmitters.exists({
      where: { submissionId: submitter.submissionId, isFirst: true },
    });

    await this.completedSubmitters.save(
      this.completedSubmitters.create({
        accountId: submitter.accountId,
        submissionId: submitter.submissionId,
        submitterId: submitter.id,
        templateId: submitter.submission.templateId,
        completedAt: submitter.completedAt,
        isFirst: !hasFirst,
        smsCount: 0,
        source: submitter.submission.source,
        verificationMethod: null,
      }),
    );
  }

  private async recordCompletedDocumentChecksums(
    submitter: Submitter,
    documents: StorageAttachment[],
  ): Promise<void> {
    for (const document of documents) {
      await this.recordCompletedDocumentChecksum(submitter, document);
    }
  }

  private async recordCompletedDocumentChecksum(
    submitter: Submitter,
    document: StorageAttachment,
  ): Promise<void> {
    const sha256 =
      typeof document.blob.metadata?.sha256 === 'string'
        ? document.blob.metadata.sha256
        : null;

    if (!sha256) {
      return;
    }

    const exists = await this.completedDocuments.exists({
      where: { sha256, submitterId: submitter.id },
    });

    if (!exists) {
      await this.completedDocuments.save(
        this.completedDocuments.create({ sha256, submitterId: submitter.id }),
      );
    }
  }

  private async recordGenerationEvent(
    submitterId: string,
    eventName: DocumentGenerationEvent['eventName'],
  ): Promise<void> {
    const exists = await this.generationEvents.exists({
      where: { submitterId, eventName },
    });

    if (!exists) {
      await this.generationEvents.save(
        this.generationEvents.create({ submitterId, eventName }),
      );
    }
  }

  private async deleteSubmissionMergedDocuments(
    submission: Submission,
  ): Promise<void> {
    await Promise.all(
      ['merged_document', 'combined_document'].map((name) =>
        this.storageService.deleteRecordAttachments({
          recordType: 'Submission',
          recordId: submission.id,
          name,
        }),
      ),
    );
  }

  private async getSourceDocuments(
    submission: Submission,
  ): Promise<SourceDocument[]> {
    const templateId = submission.templateId ?? submission.template?.id;

    if (!templateId) {
      return [];
    }

    const attachments = await this.storageService.findRecordAttachments({
      recordType: 'Template',
      recordId: templateId,
      name: 'documents',
    });
    const schema =
      submission.templateSchema ?? submission.template?.schema ?? [];

    return getSchemaOrderedAttachments(schema, attachments).map(
      (attachment) => ({
        attachment,
        blob: attachment.blob,
        filename:
          getSchemaDocumentName(schema, attachment.uuid) ??
          attachment.blob.filename,
        uuid: attachment.uuid,
      }),
    );
  }

  private async getSubmitterAttachmentsContext(
    submitters: Submitter[],
  ): Promise<{
    attachmentsByUuid: Map<string, StorageAttachment>;
    signatureMetadataByUuid: Map<
      string,
      {
        signedAt: Date;
        signerEmail: string | null;
        signerName: string | null;
      }
    >;
  }> {
    const attachments = await Promise.all(
      submitters.map((submitter) =>
        this.storageService.findRecordAttachments({
          recordType: 'Submitter',
          recordId: submitter.id,
          name: 'attachments',
        }),
      ),
    );
    const attachmentsByUuid = new Map<string, StorageAttachment>();
    const signatureMetadataByUuid = new Map<
      string,
      {
        signedAt: Date;
        signerEmail: string | null;
        signerName: string | null;
      }
    >();

    attachments.forEach((submitterAttachments, index) => {
      const submitter = submitters[index];

      for (const attachment of submitterAttachments) {
        attachmentsByUuid.set(attachment.uuid, attachment);
        signatureMetadataByUuid.set(attachment.uuid, {
          signedAt: attachment.createdAt ?? submitter.completedAt ?? new Date(),
          signerEmail: submitter.email,
          signerName: submitter.name,
        });
      }
    });

    return { attachmentsByUuid, signatureMetadataByUuid };
  }

  private buildSubmissionValues(
    submission: Submission,
  ): Record<string, unknown> {
    const fields = this.getSubmissionFields(submission);
    const values: Record<string, unknown> = {};

    for (const field of fields) {
      if (field.uuid && field.default_value !== undefined) {
        values[field.uuid] = field.default_value;
      }
    }

    for (const submitter of submission.submitters ?? []) {
      Object.assign(values, submitter.values ?? {});
    }

    return values;
  }

  private async getResultGenerationOptions(
    submission: Submission,
  ): Promise<ResultGenerationOptions> {
    const configs = await this.accountConfigs.find({
      where: {
        accountId: submission.accountId,
        key: In([
          'document_filename_format',
          'flatten_result_pdf',
          'with_signature_id',
        ]),
      },
    });
    const configByKey = new Map(configs.map((config) => [config.key, config]));
    const [signingCertificateName, timestampServerUrl] = await Promise.all([
      this.pdfSignatureService.getActiveCertificateName(submission.accountId),
      this.pdfSignatureService.getTimestampServerUrl(submission.accountId),
    ]);
    const accountContext = await this.accountsService.getTestingAccountContext(
      submission.accountId,
    );

    return {
      documentId: createHash('sha256')
        .update(submission.slug)
        .digest('hex')
        .toUpperCase(),
      documentFilenameFormat: this.getDocumentFilenameFormat(configByKey),
      flatten: configByKey.get('flatten_result_pdf')?.value !== false,
      isTestMode: accountContext.isTestMode,
      signingCertificateName,
      timestampServerUrl,
      withSignatureId: configByKey.get('with_signature_id')?.value === true,
    };
  }

  private signArtifactPdf(input: {
    accountId: string;
    buffer: Buffer;
    contactInfo?: string | null;
    reason: string;
    signerName: string;
    signingTime: Date;
  }) {
    return this.pdfSignatureService.signPdf(input);
  }

  private buildCryptographicSignatureMetadata(signed: PdfSignatureResult) {
    const timestamp = signed.timestamp ?? {
      embedded: false,
      required: false,
      status: signed.timestampServerUrl ? 'failed' : 'disabled',
      tokenSha256: null,
      url: signed.timestampServerUrl,
    };
    const ltv = signed.ltv ?? {
      evidenceStatus: 'missing',
      ltvRequired: false,
    };

    return {
      cryptographic_signature_certificate: signed.certificateName ?? undefined,
      cryptographic_signature_certificate_sha256: signed.certificateFingerprint,
      cryptographic_signature_sub_filter: signed.signatureSubFilter,
      cryptographic_signature_timestamp_embedded: timestamp.embedded,
      cryptographic_signature_timestamp_required: timestamp.required,
      cryptographic_signature_timestamp_server:
        timestamp.url ?? signed.timestampServerUrl ?? undefined,
      cryptographic_signature_timestamp_status: timestamp.status,
      cryptographic_signature_timestamp_token_sha256:
        timestamp.tokenSha256 ?? undefined,
      cryptographic_signature_ltv_required: ltv.ltvRequired,
      cryptographic_signature_ltv_status:
        ltv.evidenceStatus === 'good' ? 'valid' : 'missing',
      cryptographic_signature_pdfa_conversion_status:
        signed.pdfA.conversionStatus,
      cryptographic_signature_pdfa_enabled: signed.pdfA.enabled,
      cryptographic_signature_pdfa_error: signed.pdfA.error ?? undefined,
      cryptographic_signature_pdfa_level: signed.pdfA.level,
      cryptographic_signature_pdfa_required: signed.pdfA.required,
      cryptographic_signature_pdfa_validation_status:
        signed.pdfA.validationStatus,
      cryptographic_signature_revocation_status: ltv.evidenceStatus,
      cryptographic_signed: signed.signed,
    };
  }

  private buildValuesHash(
    submission: Submission,
    generationOptions: Record<string, unknown>,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          generationOptions,
          values: this.buildSubmissionValues(submission),
        }),
      )
      .digest('base64url');
  }

  private getSubmissionFields(submission: Submission): TemplateField[] {
    return submission.templateFields ?? submission.template?.fields ?? [];
  }

  private isSubmissionCompleted(submission: Submission): boolean {
    const submitters = submission.submitters ?? [];

    return (
      submitters.length > 0 && submitters.every((item) => item.completedAt)
    );
  }

  private getLastCompletedSubmitter(submission: Submission): Submitter | null {
    return (
      [...(submission.submitters ?? [])]
        .filter((submitter) => submitter.completedAt)
        .sort((a, b) => Number(a.completedAt) - Number(b.completedAt))
        .at(-1) ?? null
    );
  }

  private getSubmissionBaseName(submission: Submission): string {
    return sanitizeFilename(
      submission.name ?? submission.template?.name ?? 'document',
    );
  }

  private getDocumentFilenameFormat(
    configByKey: Map<string, AccountConfig>,
  ): string {
    const value = configByKey.get('document_filename_format')?.value;

    return typeof value === 'string' && value.trim()
      ? value
      : '{document.name}';
  }

  private buildResultFilename(
    submission: Submission,
    documentName: string,
    format: string,
  ): string {
    const completedAt =
      submission.submitters
        ?.map((submitter) => submitter.completedAt)
        .filter((date): date is Date => date instanceof Date)
        .sort((a, b) => Number(a) - Number(b))
        .at(-1) ?? null;
    const submitters =
      submission.submitters
        ?.map((submitter) => submitter.email ?? submitter.name)
        .filter((value): value is string => Boolean(value?.trim()))
        .join(', ') || 'submitters';
    const replacements: Record<string, string> = {
      '{document.name}': removePdfExtension(documentName),
      '{submission.completed_at}': completedAt
        ? formatDateForFilename(completedAt)
        : formatDateForFilename(new Date()),
      '{submission.status}': this.isSubmissionCompleted(submission)
        ? 'completed'
        : 'pending',
      '{submission.submitters}': submitters,
    };
    const filename = Object.entries(replacements).reduce(
      (next, [token, replacement]) => next.replaceAll(token, replacement),
      format,
    );

    return ensurePdfFilename(sanitizeFilename(filename));
  }
}

function buildAuditTrailDocuments(
  resultDocuments: StorageAttachment[],
  sourceDocuments: SourceDocument[],
): AuditTrailDocument[] {
  const sourceByUuid = new Map(
    sourceDocuments.map((document) => [document.uuid, document]),
  );

  return resultDocuments.map((document) => {
    const originalUuid =
      typeof document.blob.metadata?.original_uuid === 'string'
        ? document.blob.metadata.original_uuid
        : null;
    const source = originalUuid ? sourceByUuid.get(originalUuid) : undefined;

    return {
      filename: document.blob.filename,
      originalSha256:
        (typeof document.blob.metadata?.original_sha256 === 'string'
          ? document.blob.metadata.original_sha256
          : null) ?? (source ? getAttachmentChecksum(source.attachment) : null),
      resultSha256:
        typeof document.blob.metadata?.sha256 === 'string'
          ? document.blob.metadata.sha256
          : null,
    };
  });
}

function getAttachmentChecksum(attachment: StorageAttachment): string | null {
  return (
    (typeof attachment.blob.metadata?.sha256 === 'string'
      ? attachment.blob.metadata.sha256
      : null) ?? attachment.blob.checksum
  );
}

function getSchemaDocumentName(
  schema: TemplateSchemaItem[],
  attachmentUuid: string,
): string | null {
  const name = schema.find(
    (item) => item.attachment_uuid === attachmentUuid,
  )?.name;

  return typeof name === 'string' ? name : null;
}

function getSchemaOrderedAttachments(
  schema: TemplateSchemaItem[],
  attachments: StorageAttachment[],
): StorageAttachment[] {
  const attachmentsByUuid = new Map(
    attachments.map((attachment) => [attachment.uuid, attachment]),
  );
  const ordered = schema
    .map((item) => item.attachment_uuid)
    .filter((uuid): uuid is string => typeof uuid === 'string')
    .map((uuid) => attachmentsByUuid.get(uuid))
    .filter((attachment) => attachment !== undefined);

  return ordered.length ? ordered : attachments;
}

function sanitizeFilename(value: string): string {
  return (
    value
      .replace(/[^\w.@-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '') || 'document'
  );
}

function ensurePdfFilename(filename: string): string {
  return filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
}

function removePdfExtension(filename: string): string {
  return filename.replace(/\.pdf$/i, '');
}

function formatDateForFilename(date: Date): string {
  return date.toISOString().slice(0, 10);
}
