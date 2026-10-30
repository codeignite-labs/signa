import { DataSource, EntityManager, Repository } from 'typeorm';
import { BrandingService } from '../../src/branding/branding.service';
import { EmailVerificationCodeService } from '../../src/mail/email-verification-code.service';
import { MailService } from '../../src/mail/mail.service';
import { SubmissionEvent } from '../../src/submissions/entities/submission-event.entity';
import { Submission } from '../../src/submissions/entities/submission.entity';
import { Submitter } from '../../src/submitters/entities/submitter.entity';
import { Template } from '../../src/templates/entities/template.entity';
import { StartFormService } from '../../src/start-form/start-form.service';
import { createQueryBuilderFixture } from './query-builder.fixture';
function repository<T extends object>(id: string) {
  return {
    create: jest.fn((input: Partial<T>) => input),
    save: jest.fn((input: Partial<T>) =>
      Promise.resolve({ ...input, id } as T),
    ),
  };
}
export function startFormFixture() {
  const query = createQueryBuilderFixture<Submitter>();
  const template = Object.assign(new Template(), {
    accountId: 'tenant',
    id: 'template',
    name: 'Agreement',
    account: { name: 'Example Org' },
    sharedLink: true,
    slug: 'public-link',
    preferences: {},
    fields: [],
    schema: [],
    submitters: [{ uuid: 'signer', name: 'Signer' }],
    variablesSchema: null,
  });
  const templates = {
    findOne: jest
      .fn<Promise<Template | null>, unknown[]>()
      .mockResolvedValue(template),
  };
  const submissions = repository<Submission>('submission');
  const submitters = {
    ...repository<Submitter>('submitter'),
    createQueryBuilder: jest.fn(() => query),
  };
  submitters.save.mockImplementation((input) =>
    Promise.resolve({
      ...input,
      id: 'submitter',
      slug: 'signing-link',
    } as Submitter),
  );
  const events = repository<SubmissionEvent>('event');
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === Submission) return submissions;
      if (entity === Submitter) return submitters;
      return events;
    },
  };
  const transaction = jest.fn(
    (callback: (manager: EntityManager) => Promise<unknown>) =>
      callback(manager as unknown as EntityManager),
  );
  const codes = {
    generateTemplateCode: jest.fn().mockReturnValue('123456'),
    verifyTemplateCode: jest.fn().mockReturnValue(true),
  };
  const mail = {
    sendTemplateVerification: jest.fn().mockResolvedValue(undefined),
  };
  const branding = {
    get: jest.fn().mockResolvedValue({ account_name: 'Example Org' }),
  };
  const service = new StartFormService(
    templates as unknown as Repository<Template>,
    { transaction } as unknown as DataSource,
    codes as unknown as EmailVerificationCodeService,
    mail as unknown as MailService,
    branding as unknown as BrandingService,
  );
  return {
    service,
    template,
    templates,
    submissions,
    submitters,
    events,
    query,
    transaction,
    codes,
    mail,
    branding,
  };
}
