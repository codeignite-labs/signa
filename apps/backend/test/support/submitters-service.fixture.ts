import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, Repository } from 'typeorm';
import { StorageService } from '../../src/storage/storage.service';
import { DocumentGenerationQueueService } from '../../src/submissions/document-generation-queue.service';
import { SubmissionDocumentsService } from '../../src/submissions/submission-documents.service';
import { SubmitterValueNormalizer } from '../../src/submissions/submitter-value-normalizer.service';
import { Submitter } from '../../src/submitters/entities/submitter.entity';
import { SubmittersService } from '../../src/submitters/submitters.service';
import { createSubmissionsServiceFixture } from './submissions-service.fixture';
export function createSubmittersServiceFixture() {
  const fixture = createSubmissionsServiceFixture();
  const repository = {
    ...fixture.submitters,
    findOneOrFail: jest
      .fn<Promise<Submitter>, [unknown]>()
      .mockResolvedValue(fixture.submitter),
  };
  const config = new ConfigService({
    API_PUBLIC_URL: 'https://sign.example.test/api',
  });
  const normalizer = new SubmitterValueNormalizer(
    fixture.storage as unknown as StorageService,
    config,
  );
  const service = new SubmittersService(
    repository as unknown as Repository<Submitter>,
    fixture.source as unknown as DataSource,
    fixture.storage as unknown as StorageService,
    config,
    fixture.events as unknown as EventEmitter2,
    fixture.documents as unknown as SubmissionDocumentsService,
    fixture.queue as unknown as DocumentGenerationQueueService,
    normalizer,
  );
  return { ...fixture, service, repository, config };
}
