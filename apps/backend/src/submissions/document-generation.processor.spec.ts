import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { runtimeJobNames } from '../runtime/runtime-jobs';
import { Submitter } from '../submitters/entities/submitter.entity';
import { Submission } from './entities/submission.entity';
import { SubmissionDocumentsService } from './submission-documents.service';
import { DocumentGenerationProcessor } from './document-generation.processor';
function setup() {
  const submission: Submission = Object.assign(new Submission(), {
    id: 'submission',
  });
  const submitter: Submitter = Object.assign(new Submitter(), {
    id: 'submitter',
    submission,
  });
  const submissions = {
    findOneOrFail: jest.fn().mockResolvedValue(submission),
  };
  const submitters = { findOneOrFail: jest.fn().mockResolvedValue(submitter) };
  const documents = {
    ensureAuditTrail: jest.fn().mockResolvedValue({}),
    ensureMergedDocument: jest.fn().mockResolvedValue({}),
    processSubmitterCompletion: jest.fn().mockResolvedValue({}),
    ensurePreviewDocuments: jest.fn().mockResolvedValue({}),
    ensurePreviewMergedDocument: jest.fn().mockResolvedValue({}),
  };
  const processor = new DocumentGenerationProcessor(
    submissions as unknown as Repository<Submission>,
    submitters as unknown as Repository<Submitter>,
    documents as unknown as SubmissionDocumentsService,
  );
  return {
    processor,
    submission,
    submitter,
    submissions,
    submitters,
    documents,
  };
}
function job(name: string, data: Record<string, unknown> = {}) {
  return { id: 'job', name, data } as Parameters<
    DocumentGenerationProcessor['process']
  >[0];
}
afterEach(() => jest.restoreAllMocks());
it('generates audit and preview documents from submissions loaded with ordered events and signers', async () => {
  const { processor, submission, submissions, documents } = setup();
  await processor.process(
    job(runtimeJobNames.generateAuditTrailPdf, { submissionId: 'submission' }),
  );
  expect(documents.ensureAuditTrail).toHaveBeenCalledWith(submission);
  expect(submissions.findOneOrFail).toHaveBeenCalledWith({
    where: { id: 'submission' },
    relations: { submissionEvents: true, submitters: true, template: true },
    order: { submissionEvents: { id: 'ASC' }, submitters: { id: 'ASC' } },
  });
  await processor.process(
    job(runtimeJobNames.generatePreviewImages, { submissionId: 'submission' }),
  );
  expect(documents.ensurePreviewDocuments).toHaveBeenCalledWith(submission);
  expect(documents.ensurePreviewMergedDocument).toHaveBeenCalledWith(
    submission,
  );
  expect(
    documents.ensurePreviewDocuments.mock.invocationCallOrder[0],
  ).toBeLessThan(
    documents.ensurePreviewMergedDocument.mock.invocationCallOrder[0],
  );
});
it.each([undefined, true, false])(
  'generates combined documents with explicit/default audit inclusion %s',
  async (withAudit) => {
    const { processor, submitter, submitters, documents } = setup();
    await processor.process(
      job(runtimeJobNames.generateCombinedPdf, {
        submitterId: 'submitter',
        withAudit,
      }),
    );
    expect(documents.ensureMergedDocument).toHaveBeenCalledWith(submitter, {
      submission: submitter.submission,
      withAudit: withAudit ?? true,
    });
    expect(submitters.findOneOrFail).toHaveBeenCalledWith({
      where: { id: 'submitter' },
      relations: {
        submission: {
          submissionEvents: true,
          submitters: true,
          template: true,
        },
      },
      order: {
        submission: {
          submissionEvents: { id: 'ASC' },
          submitters: { id: 'ASC' },
        },
      },
    });
  },
);
it('processes a completed signer and propagates failures to queue retry handling', async () => {
  const { processor, submitter, documents } = setup();
  await processor.process(
    job(runtimeJobNames.generateCompletedPdf, { submitterId: 'submitter' }),
  );
  expect(documents.processSubmitterCompletion).toHaveBeenCalledWith(submitter);
  documents.processSubmitterCompletion.mockRejectedValue(
    new Error('conversion failed'),
  );
  await expect(
    processor.process(
      job(runtimeJobNames.generateCompletedPdf, { submitterId: 'submitter' }),
    ),
  ).rejects.toThrow('conversion failed');
});
it.each([
  [runtimeJobNames.generateAuditTrailPdf, 'submissionId'],
  [runtimeJobNames.generatePreviewImages, 'submissionId'],
  [runtimeJobNames.generateCombinedPdf, 'submitterId'],
  [runtimeJobNames.generateCompletedPdf, 'submitterId'],
])('rejects %s jobs missing %s before document work', async (name, field) => {
  const { processor, submissions, submitters } = setup();
  await expect(processor.process(job(name))).rejects.toThrow(
    `${field} is required`,
  );
  expect(submissions.findOneOrFail).not.toHaveBeenCalled();
  expect(submitters.findOneOrFail).not.toHaveBeenCalled();
});
it('reports unknown jobs and includes the job id in worker failure logs', async () => {
  const { processor, documents } = setup();
  const warning = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  const errorLog = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  await processor.process(job('unknown'));
  expect(warning).toHaveBeenCalledWith(
    'Skipped unknown document job "unknown"',
  );
  expect(documents.ensureAuditTrail).not.toHaveBeenCalled();
  const error = new Error('render failure');
  processor.handleFailed(undefined, error);
  processor.handleFailed(job('generate'), error);
  expect(errorLog).toHaveBeenCalledWith(
    'Document generation job unknown failed: render failure',
    error.stack,
  );
  expect(errorLog).toHaveBeenCalledWith(
    'Document generation job job failed: render failure',
    error.stack,
  );
});
