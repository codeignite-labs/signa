import { Submitter } from '../submitters/entities/submitter.entity';
import { createSubmissionDocumentsFixture } from '../../test/support/submission-documents.fixture';
import { AccountConfig } from '../accounts/entities/account-config.entity';
import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageBlob } from '../storage/entities/storage-blob.entity';
it('uses original PDF filenames when legacy template schema lacks matching document names', async () => {
  const fixture = await createSubmissionDocumentsFixture();
  fixture.submission.templateSchema = [];
  fixture.submission.templateFields = [];
  const result = await fixture.service.ensurePreviewDocuments(
    fixture.submission,
  );
  expect(result[0].blob.filename).toBe('Agreement.pdf');
  expect(fixture.pdf.stampPdfDocument).toHaveBeenCalledWith(
    expect.objectContaining({
      document: expect.objectContaining({
        filename: 'Agreement.pdf',
      }) as unknown,
    }),
  );
});
it('uses source-template identifiers when legacy submissions lack their template foreign key', async () => {
  const fixture = await createSubmissionDocumentsFixture();
  fixture.submission.templateId = null;
  expect(
    await fixture.service.ensurePreviewDocuments(fixture.submission),
  ).toHaveLength(1);
  expect(fixture.storage.findRecordAttachments).toHaveBeenCalledWith({
    recordType: 'Template',
    recordId: 'template',
    name: 'documents',
  });
});
it('uses safe default filenames for punctuation-only submission names', async () => {
  const fixture = await createSubmissionDocumentsFixture();
  fixture.submission.name = '!!!';
  const merged = await fixture.service.ensurePreviewMergedDocument(
    fixture.submission,
  );
  expect(merged.blob.filename).toBe('document.pdf');
});
it('replaces stale merged artifacts when filename configuration changes', async () => {
  const fixture = await createSubmissionDocumentsFixture();
  fixture.submitter.completedAt = new Date('2026-10-31');
  await fixture.service.ensureMergedDocument(fixture.submitter, {
    withAudit: false,
  });
  fixture.config.find.mockResolvedValue([
    Object.assign(new AccountConfig(), {
      key: 'document_filename_format',
      value: 'Updated-{document.name}',
    }),
  ]);
  const updated = await fixture.service.ensureMergedDocument(
    fixture.submitter,
    { withAudit: false },
  );
  expect(updated.blob.filename).toBe('Updated-Agreement.pdf');
  expect(fixture.storage.deleteRecordAttachments).toHaveBeenCalledWith({
    recordType: 'Submission',
    recordId: 'submission',
    name: 'merged_document',
  });
});
it('can cache an explicitly generated partial merged artifact without recording signer completion', async () => {
  const fixture = await createSubmissionDocumentsFixture();
  const result = await fixture.service.ensureMergedDocument(fixture.submitter, {
    withAudit: false,
  });
  expect(
    await fixture.service.ensureMergedDocument(fixture.submitter, {
      withAudit: false,
    }),
  ).toBe(result);
  expect(fixture.completed.save).not.toHaveBeenCalled();
  expect(fixture.signatures.signPdf).toHaveBeenCalledWith(
    expect.objectContaining({
      reason: 'Merged signed document',
      signingTime: expect.any(Date) as unknown,
    }),
  );
});
it('does not invent checksum records for legacy cached artifacts lacking SHA-256 metadata', async () => {
  const fixture = await createSubmissionDocumentsFixture();
  fixture.submitter.completedAt = new Date('2026-10-31');
  const [result] = await fixture.service.ensureResultDocuments(
    fixture.submitter,
  );
  delete result.blob.metadata!.sha256;
  await fixture.service.processSubmitterCompletion(fixture.submitter);
  expect(fixture.completed.create).not.toHaveBeenCalled();
  expect(fixture.submitterCompletions.create).toHaveBeenCalled();
});
it.each(['source-checksum', 'missing-source', 'missing-original-and-result'])(
  'builds an audit entry for legacy artifact metadata (%s)',
  async (kind) => {
    const fixture = await createSubmissionDocumentsFixture();
    fixture.submitter.completedAt = new Date('2026-10-31');
    const [result] = await fixture.service.ensureResultDocuments(
      fixture.submitter,
    );
    delete result.blob.metadata!.original_sha256;
    if (kind !== 'source-checksum') result.blob.metadata!.original_uuid = null;
    if (kind === 'missing-original-and-result')
      delete result.blob.metadata!.sha256;
    await fixture.service.ensureAuditTrail(fixture.submission);
    expect(fixture.pdf.buildAuditTrail).toHaveBeenCalledWith(
      fixture.submission,
      [
        {
          filename: 'Agreement.pdf',
          originalSha256: kind === 'source-checksum' ? 'original-md5' : null,
          resultSha256:
            kind === 'missing-original-and-result' ? null : 'result-sha',
        },
      ],
      { isTestMode: false },
    );
  },
);
it('handles nullable legacy signer values when generating current document previews', async () => {
  const fixture = await createSubmissionDocumentsFixture();
  fixture.submitter.values = null as never;
  await fixture.service.ensurePreviewDocuments(fixture.submission);
  expect(fixture.pdf.stampPdfDocument).toHaveBeenCalledWith(
    expect.objectContaining({ values: { field: 'Default text' } }),
  );
});
it('orders valid schema documents first and ignores stale schema references', async () => {
  const fixture = await createSubmissionDocumentsFixture();
  fixture.submission.templateSchema = [
    { attachment_uuid: 'missing', name: 'Deleted document' },
    { attachment_uuid: 'second', name: 'Second PDF' },
    { attachment_uuid: 'source', name: 'First PDF' },
  ];
  fixture.rows.push(
    Object.assign(new StorageAttachment(), {
      uuid: 'second',
      recordType: 'Template',
      recordId: 'template',
      name: 'documents',
      blob: Object.assign(new StorageBlob(), {
        filename: 'Second.pdf',
        metadata: {},
        checksum: null,
      }),
    }),
  );
  const result = await fixture.service.ensurePreviewDocuments(
    fixture.submission,
  );
  expect(result.map((attachment) => attachment.blob.filename)).toEqual([
    'Second PDF',
    'First PDF',
  ]);
});
it.each([
  ['signer@example.test', 'signer@example.test'],
  [null, 'Signa'],
])(
  'uses available contact identity for anonymous merged signing (%s)',
  async (email, signerName) => {
    const fixture = await createSubmissionDocumentsFixture();
    fixture.submitter.name = null;
    fixture.submitter.email = email;
    await fixture.service.ensureMergedDocument(fixture.submitter, {
      withAudit: false,
    });
    expect(fixture.signatures.signPdf).toHaveBeenLastCalledWith(
      expect.objectContaining({ signerName }),
    );
  },
);
it('keeps an existing PDF suffix and records a source SHA-256 ahead of its older checksum', async () => {
  const fixture = await createSubmissionDocumentsFixture();
  fixture.submission.name = 'Signed.PDF';
  fixture.original.blob.metadata = { sha256: 'original-sha256' };
  expect(
    (await fixture.service.ensurePreviewMergedDocument(fixture.submission)).blob
      .filename,
  ).toBe('Signed.PDF');
  const result = await fixture.service.ensureResultDocuments(fixture.submitter);
  expect(result[0].blob.metadata?.original_sha256).toBe('original-sha256');
});
it('can generate from a template ID without preloaded template fields or schema relations', async () => {
  const fixture = await createSubmissionDocumentsFixture();
  fixture.submission.template = null;
  fixture.submission.templateFields = null;
  fixture.submission.templateSchema = null;
  await fixture.service.ensurePreviewDocuments(fixture.submission);
  expect(fixture.pdf.stampPdfDocument).toHaveBeenCalledWith(
    expect.objectContaining({
      fields: [],
      document: expect.objectContaining({
        filename: 'Agreement.pdf',
      }) as unknown,
    }),
  );
});
it('uses the latest completed signer and completion date when signer relations arrive out of chronological order', async () => {
  const fixture = await createSubmissionDocumentsFixture();
  fixture.submitter.completedAt = new Date('2026-10-31T12:00:00Z');
  const earlier = Object.assign(new Submitter(), fixture.submitter, {
    id: 'earlier-signer',
    email: 'earlier@example.test',
    completedAt: new Date('2026-10-30T12:00:00Z'),
  });
  fixture.submission.submitters = [fixture.submitter, earlier];
  fixture.config.find.mockResolvedValue([
    Object.assign(new AccountConfig(), {
      key: 'document_filename_format',
      value: '{document.name}-{submission.completed_at}',
    }),
  ]);
  const documents = await fixture.service.getSubmissionDocuments(
    fixture.submission,
  );
  expect(documents[0]).toMatchObject({
    recordId: 'signer',
    blob: { filename: 'Agreement-2026-10-31.pdf' },
  });
  expect(fixture.signatures.signPdf).toHaveBeenCalledWith(
    expect.objectContaining({
      contactInfo: 'signer@example.test',
      signingTime: new Date('2026-10-31T12:00:00Z'),
    }),
  );
});
