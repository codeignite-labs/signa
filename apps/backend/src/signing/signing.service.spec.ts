import { SubmissionEvent } from '../submissions/entities/submission-event.entity';
import { Submission } from '../submissions/entities/submission.entity';
import { Submitter } from '../submitters/entities/submitter.entity';
import { SigningService } from './signing.service';

describe('SigningService', () => {
  it('restores a retryable state when completed document generation fails', async () => {
    const submitter = createSubmitter();
    const submitterSave = jest.fn((entity: Submitter) =>
      Promise.resolve(entity),
    );
    const eventDelete = jest.fn().mockResolvedValue({ affected: 1 });
    const eventSave = jest.fn((event: Partial<SubmissionEvent>) =>
      Promise.resolve({
        ...event,
        id:
          event.eventType === 'complete_form'
            ? 'complete-event'
            : 'start-event',
      }),
    );
    const eventRepository = {
      create: jest.fn((event: Partial<SubmissionEvent>) => event),
      delete: eventDelete,
      exists: jest.fn().mockResolvedValue(false),
      save: eventSave,
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === Submitter ? { save: submitterSave } : eventRepository,
      ),
    };
    const dataSource = {
      getRepository: jest.fn(() => eventRepository),
      transaction: jest.fn((operation: (value: typeof manager) => unknown) =>
        Promise.resolve(operation(manager)),
      ),
    };
    const processSubmitterCompletion = jest
      .fn()
      .mockRejectedValue(new Error('PDFium failed to load PDF bytes'));
    const enqueueSubmitterCompletion = jest.fn();
    const service = new SigningService(
      { findOne: jest.fn().mockResolvedValue(submitter) } as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      { existsBy: jest.fn().mockResolvedValue(false) } as never,
      { existsBy: jest.fn().mockResolvedValue(false) } as never,
      dataSource as never,
      {} as never,
      { processSubmitterCompletion } as never,
      { enqueueSubmitterCompletion } as never,
      { emit: jest.fn() } as never,
      { get: jest.fn() } as never,
      {} as never,
      {} as never,
      { get: jest.fn() } as never,
    );

    await expect(
      service.updateValues('submitter-slug', {
        completed: true,
        values: { 'field-name': 'Ada Lovelace' },
      }),
    ).rejects.toThrow('PDFium failed to load PDF bytes');

    expect(submitter.completedAt).toBeNull();
    expect(submitterSave).toHaveBeenCalledTimes(2);
    expect(eventDelete).toHaveBeenCalledWith('complete-event');
    expect(enqueueSubmitterCompletion).not.toHaveBeenCalled();
  });
});

function createSubmitter(): Submitter {
  const submission = {
    accountId: 'account-1',
    archivedAt: null,
    id: 'submission-1',
    preferences: {},
    submitters: [],
    submittersOrder: 'preserved',
    template: {
      archivedAt: null,
      fields: [
        {
          name: 'Full name',
          submitter_uuid: 'submitter-role',
          type: 'text',
          uuid: 'field-name',
        },
      ],
      preferences: {},
    },
    templateFields: null,
    templateId: 'template-1',
  } as unknown as Submission;
  const submitter = {
    accountId: 'account-1',
    completedAt: null,
    declinedAt: null,
    id: 'submitter-1',
    metadata: {},
    preferences: {},
    slug: 'submitter-slug',
    submission,
    submissionId: 'submission-1',
    uuid: 'submitter-role',
    values: {},
  } as Submitter;

  submission.submitters = [submitter];

  return submitter;
}
