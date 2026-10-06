import { DataSource, Repository } from 'typeorm';
import { EmailVerificationCodeService } from '../mail/email-verification-code.service';
import { MailService } from '../mail/mail.service';
import { SubmissionEvent } from '../submissions/entities/submission-event.entity';
import { Submission } from '../submissions/entities/submission.entity';
import { Submitter } from '../submitters/entities/submitter.entity';
import { Template } from '../templates/entities/template.entity';
import { StartFormService } from './start-form.service';

jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'JBSWY3DPEHPK3PXP'),
  generateSync: jest.fn(() => '123456'),
  generateURI: jest.fn(() => 'otpauth://totp/Signa:ada@example.com'),
  verifySync: jest.fn(() => ({ valid: true })),
}));

describe('StartFormService', () => {
  let dataSource: jest.Mocked<Pick<DataSource, 'transaction'>>;
  let emailCodes: jest.Mocked<
    Pick<
      EmailVerificationCodeService,
      'generateTemplateCode' | 'verifyTemplateCode'
    >
  >;
  let mailService: jest.Mocked<Pick<MailService, 'sendTemplateVerification'>>;
  let service: StartFormService;
  let templates: jest.Mocked<Pick<Repository<Template>, 'findOne'>>;

  beforeEach(() => {
    templates = {
      findOne: jest.fn(),
    };
    dataSource = {
      transaction: jest.fn(),
    };
    emailCodes = {
      generateTemplateCode: jest.fn().mockReturnValue('123456'),
      verifyTemplateCode: jest.fn().mockReturnValue(true),
    };
    mailService = {
      sendTemplateVerification: jest.fn().mockResolvedValue({ status: 'sent' }),
    };
    service = new StartFormService(
      templates as never,
      dataSource as never,
      emailCodes as never,
      mailService as never,
      {
        get: jest.fn().mockResolvedValue({ account_name: 'Ada Labs' }),
      } as never,
    );
  });

  it('returns shared-link form metadata', async () => {
    templates.findOne.mockResolvedValue(buildTemplate());

    await expect(service.getStartForm('template-slug')).resolves.toMatchObject({
      account_name: 'Ada Labs',
      link_form_fields: ['email'],
      require_email_2fa: true,
      shared_link: true,
      template_name: 'NDA',
    });
  });

  it('sends template email verification codes', async () => {
    const template = buildTemplate();
    templates.findOne.mockResolvedValue(template);

    await service.sendEmailVerification('template-slug', {
      email: 'ADA@example.com',
    });

    expect(emailCodes.generateTemplateCode).toHaveBeenCalledWith(
      template,
      'ada@example.com',
    );
    expect(mailService.sendTemplateVerification).toHaveBeenCalledWith({
      accountId: '1',
      email: 'ada@example.com',
      otpCode: '123456',
      templateName: 'NDA',
    });
  });

  it('creates a link submission after email verification', async () => {
    templates.findOne.mockResolvedValue(buildTemplate());
    dataSource.transaction.mockImplementation((callback) =>
      Promise.resolve(
        (
          callback as unknown as (
            manager: StartFormTestManager,
          ) => Promise<unknown>
        )(buildManager()),
      ),
    );

    await expect(
      service.verifyEmailAndSubmitStartForm(
        'template-slug',
        {
          email: 'ada@example.com',
          one_time_code: '123456',
        },
        { ip: '127.0.0.1', ua: 'jest' },
      ),
    ).resolves.toEqual({
      signing_slug: 'submitter-slug',
      signing_url: '/s/submitter-slug',
    });

    expect(emailCodes.verifyTemplateCode).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'template-slug' }),
      'ada@example.com',
      '123456',
    );
  });
});

function buildTemplate(): Template {
  return {
    account: { name: 'Ada Labs' },
    accountId: '1',
    fields: [],
    id: '10',
    name: 'NDA',
    preferences: {
      link_form_fields: ['email'],
      shared_link_2fa: true,
    },
    schema: [],
    sharedLink: true,
    slug: 'template-slug',
    submitters: [{ name: 'First Party', uuid: 'role-1' }],
    variablesSchema: null,
  } as unknown as Template;
}

type StartFormTestManager = ReturnType<typeof buildManager>;

function buildManager() {
  const queryBuilder = {
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(null),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };
  const submissionRepository = {
    create: jest.fn((input: Partial<Submission>) => input),
    save: jest
      .fn()
      .mockImplementation((input: Partial<Submission>) =>
        Promise.resolve({ ...input, id: '20' }),
      ),
  };
  const submitterRepository = {
    create: jest.fn((input: Partial<Submitter>) => input),
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    save: jest
      .fn()
      .mockImplementation((input: Partial<Submitter>) =>
        Promise.resolve({ ...input, id: '30', slug: 'submitter-slug' }),
      ),
  };
  const eventRepository = {
    create: jest.fn((input: Partial<SubmissionEvent>) => input),
    save: jest.fn((input: Partial<SubmissionEvent>) => Promise.resolve(input)),
  };

  return {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Submission) {
        return submissionRepository;
      }

      if (entity === Submitter) {
        return submitterRepository;
      }

      return eventRepository;
    }),
  };
}
