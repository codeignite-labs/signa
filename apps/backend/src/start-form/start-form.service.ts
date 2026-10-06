import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { BrandingService } from '../branding/branding.service';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { EmailVerificationCodeService } from '../mail/email-verification-code.service';
import { MailService } from '../mail/mail.service';
import { SubmissionEvent } from '../submissions/entities/submission-event.entity';
import { Submission } from '../submissions/entities/submission.entity';
import { Submitter } from '../submitters/entities/submitter.entity';
import { Template } from '../templates/entities/template.entity';
import type { TemplateSubmitter } from '../templates/types/template-json';
import {
  SendStartFormEmailVerificationDto,
  StartFormResponseDto,
  StartFormSubmitResponseDto,
  StartFormVerificationResponseDto,
  SubmitStartFormDto,
  VerifyStartFormEmailVerificationDto,
} from './dto/start-form.dto';

type StartFormRequestMetadata = {
  ip?: string;
  ua?: string;
};

@Injectable()
export class StartFormService {
  constructor(
    @InjectRepository(Template)
    private readonly templates: Repository<Template>,
    private readonly dataSource: DataSource,
    private readonly emailVerificationCodes: EmailVerificationCodeService,
    private readonly mailService: MailService,
    private readonly branding: BrandingService,
  ) {}

  async getStartForm(slug: string): Promise<StartFormResponseDto> {
    const template = await this.findSharedTemplateOrFail(slug);

    return this.toStartFormResponse(template);
  }

  async sendEmailVerification(
    slug: string,
    input: SendStartFormEmailVerificationDto,
  ): Promise<StartFormVerificationResponseDto> {
    const template = await this.findSharedTemplateOrFail(slug);
    const email = normalizeEmail(input.email);
    const otpCode = this.emailVerificationCodes.generateTemplateCode(
      template,
      email,
    );

    await this.mailService.sendTemplateVerification({
      accountId: template.accountId,
      email,
      otpCode,
      templateName: template.name,
    });

    return { email, status: 'sent' };
  }

  async submitStartForm(
    slug: string,
    input: SubmitStartFormDto,
    metadata?: StartFormRequestMetadata,
  ): Promise<StartFormSubmitResponseDto> {
    const template = await this.findSharedTemplateOrFail(slug);
    const normalizedInput = this.normalizeSubmitterInput(input);

    if (template.preferences?.shared_link_2fa === true) {
      if (!normalizedInput.email || !input.one_time_code) {
        throw new UnprocessableEntityException({
          error: 'Email verification is required',
        });
      }

      this.assertValidTemplateCode(
        template,
        normalizedInput.email,
        input.one_time_code,
      );
    }

    return this.createOrFindSigningLink(template, normalizedInput, metadata, {
      emailVerified: template.preferences?.shared_link_2fa === true,
    });
  }

  async verifyEmailAndSubmitStartForm(
    slug: string,
    input: VerifyStartFormEmailVerificationDto,
    metadata?: StartFormRequestMetadata,
  ): Promise<StartFormSubmitResponseDto> {
    const template = await this.findSharedTemplateOrFail(slug);
    const normalizedInput = this.normalizeSubmitterInput(input);

    if (!normalizedInput.email) {
      throw new UnprocessableEntityException({
        error: 'Email is required',
      });
    }

    this.assertValidTemplateCode(
      template,
      normalizedInput.email,
      input.one_time_code,
    );

    return this.createOrFindSigningLink(template, normalizedInput, metadata, {
      emailVerified: true,
    });
  }

  private async createOrFindSigningLink(
    template: Template,
    input: NormalizedStartFormSubmitter,
    metadata: StartFormRequestMetadata | undefined,
    options: { emailVerified: boolean },
  ): Promise<StartFormSubmitResponseDto> {
    const templateSubmitter = this.resolveTemplateSubmitter(template);
    const requiredFields = getLinkFormFields(template);

    this.assertRequiredFields(requiredFields, input);

    const submitter = await this.dataSource.transaction(async (manager) => {
      const existingSubmitter = await this.findExistingSubmitter(
        manager,
        template,
        input,
      );

      if (existingSubmitter) {
        existingSubmitter.ip = metadata?.ip ?? existingSubmitter.ip;
        existingSubmitter.ua = metadata?.ua ?? existingSubmitter.ua;

        return manager.getRepository(Submitter).save(existingSubmitter);
      }

      const submission = await manager.getRepository(Submission).save(
        manager.getRepository(Submission).create({
          accountId: template.accountId,
          createdByUserId: null,
          expireAt: buildDefaultExpireAt(template),
          name: null,
          preferences: {},
          source: 'link',
          submittersOrder: 'preserved',
          template,
          templateFields: template.fields,
          templateId: template.id,
          templateSchema: template.schema,
          templateSubmitters: template.submitters,
          variables: {},
          variablesSchema: template.variablesSchema,
        }),
      );
      const savedSubmitter = await manager.getRepository(Submitter).save(
        manager.getRepository(Submitter).create({
          accountId: template.accountId,
          email: input.email,
          ip: metadata?.ip ?? null,
          metadata: {},
          name: input.name,
          phone: input.phone,
          preferences: { send_email: true },
          submissionId: submission.id,
          ua: metadata?.ua ?? null,
          uuid: templateSubmitter.uuid,
          values: {},
        }),
      );

      await manager.getRepository(SubmissionEvent).save(
        manager.getRepository(SubmissionEvent).create({
          accountId: template.accountId,
          data: {
            ip: metadata?.ip,
            ua: metadata?.ua,
          },
          eventTimestamp: new Date(),
          eventType: 'start_form',
          submissionId: submission.id,
          submitterId: savedSubmitter.id,
        }),
      );

      if (options.emailVerified && input.email) {
        await manager.getRepository(SubmissionEvent).save(
          manager.getRepository(SubmissionEvent).create({
            accountId: template.accountId,
            data: {
              email: input.email,
              ip: metadata?.ip,
              ua: metadata?.ua,
            },
            eventTimestamp: new Date(),
            eventType: 'email_verified',
            submissionId: submission.id,
            submitterId: savedSubmitter.id,
          }),
        );
      }

      return savedSubmitter;
    });

    return {
      signing_slug: submitter.slug,
      signing_url: `/s/${submitter.slug}`,
    };
  }

  private async findExistingSubmitter(
    manager: EntityManager,
    template: Template,
    input: NormalizedStartFormSubmitter,
  ): Promise<Submitter | null> {
    const builder = manager
      .getRepository(Submitter)
      .createQueryBuilder('submitter')
      .innerJoinAndSelect('submitter.submission', 'submission')
      .where('submission.template_id = :templateId', {
        templateId: template.id,
      })
      .andWhere('submission.source = :source', { source: 'link' })
      .andWhere('submission.archived_at IS NULL')
      .andWhere(
        '(submission.expire_at IS NULL OR submission.expire_at >= :now)',
        {
          now: new Date(),
        },
      )
      .andWhere('submitter.declined_at IS NULL')
      .andWhere('submitter.completed_at IS NULL')
      .orderBy('submitter.id', 'DESC');

    if (input.email) {
      builder.andWhere('submitter.email = :email', { email: input.email });
    } else if (input.phone) {
      builder.andWhere('submitter.phone = :phone', { phone: input.phone });
    } else {
      return null;
    }

    return builder.getOne();
  }

  private async findSharedTemplateOrFail(slug: string): Promise<Template> {
    const template = await this.templates.findOne({
      relations: { account: true },
      where: {
        archivedAt: IsNull(),
        sharedLink: true,
        slug,
      },
    });

    if (!template) {
      throw new NotFoundException({ error: 'Start form not found' });
    }

    if (
      template.preferences?.require_email_2fa === true ||
      template.preferences?.require_phone_2fa === true
    ) {
      throw new NotFoundException({ error: 'Start form not found' });
    }

    return template;
  }

  private resolveTemplateSubmitter(template: Template): TemplateSubmitter {
    const undefinedSubmitters = template.submitters.filter(
      (submitter) =>
        !submitter.email &&
        !submitter.invite_by_uuid &&
        !submitter.invite_via_field_uuid &&
        !submitter.optional_invite_by_uuid,
    );

    if (undefinedSubmitters.length > 1) {
      throw new UnprocessableEntityException({
        error:
          'This shared link has multiple undefined recipients. Send recipients from the template instead.',
      });
    }

    const submitter = undefinedSubmitters[0] ?? template.submitters[0];

    if (!submitter?.uuid) {
      throw new UnprocessableEntityException({
        error: 'Template recipient is not configured',
      });
    }

    return submitter;
  }

  private normalizeSubmitterInput(
    input: SubmitStartFormDto,
  ): NormalizedStartFormSubmitter {
    return {
      email: input.email ? normalizeEmail(input.email) : null,
      name: input.name?.trim() || null,
      phone: input.phone?.trim() || null,
    };
  }

  private assertRequiredFields(
    requiredFields: string[],
    input: NormalizedStartFormSubmitter,
  ): void {
    const missing = requiredFields.filter(
      (field) => !input[field as keyof NormalizedStartFormSubmitter],
    );

    if (missing.length > 0) {
      throw new UnprocessableEntityException({
        error: `Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
      });
    }

    if (!input.email && !input.phone) {
      throw new UnprocessableEntityException({
        error: 'Email or phone is required',
      });
    }
  }

  private assertValidTemplateCode(
    template: Template,
    email: string,
    code: string,
  ): void {
    if (
      !this.emailVerificationCodes.verifyTemplateCode(template, email, code)
    ) {
      throw new UnprocessableEntityException({
        error: 'Email verification code is invalid',
      });
    }
  }

  private async toStartFormResponse(
    template: Template,
  ): Promise<StartFormResponseDto> {
    return {
      branding: await this.branding.get(template.accountId),
      account_name: template.account?.name ?? 'Signa',
      link_form_fields: getLinkFormFields(template),
      require_email_2fa: template.preferences?.shared_link_2fa === true,
      shared_link: template.sharedLink,
      template_name: template.name,
    };
  }
}

type NormalizedStartFormSubmitter = {
  email: string | null;
  name: string | null;
  phone: string | null;
};

function getLinkFormFields(template: Template): string[] {
  const fields = template.preferences?.link_form_fields;

  if (!Array.isArray(fields)) {
    return ['email'];
  }

  return fields.filter((field): field is string =>
    ['email', 'name', 'phone'].includes(String(field)),
  );
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function buildDefaultExpireAt(template: Template): Date | null {
  const duration = template.preferences?.default_expire_at_duration;

  if (typeof duration !== 'string') {
    return null;
  }

  const days = duration.match(/^(?<days>\d+)_days?$/)?.groups?.days;

  if (!days) {
    return null;
  }

  const expireAt = new Date();
  expireAt.setDate(expireAt.getDate() + Number(days));

  return expireAt;
}
