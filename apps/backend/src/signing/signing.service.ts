import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BrandingService } from '../branding/branding.service';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { DataSource, In, Repository } from 'typeorm';
import { AccountConfig } from '../accounts/entities/account-config.entity';
import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageService } from '../storage/storage.service';
import { UploadedBufferFile } from '../storage/storage.types';
import { EmailVerificationCodeService } from '../mail/email-verification-code.service';
import { runtimeEvents } from '../runtime/runtime-events';
import { SubmissionDocumentsService } from '../submissions/submission-documents.service';
import { DocumentGenerationQueueService } from '../submissions/document-generation-queue.service';
import { IdentityVerification } from '../submissions/entities/identity-verification.entity';
import { PaymentAttempt } from '../submissions/entities/payment-attempt.entity';
import { SubmissionEvent } from '../submissions/entities/submission-event.entity';
import { Submission } from '../submissions/entities/submission.entity';
import { isValidSubmitterEventTrackingParam } from '../submissions/submission-event-tracking';
import {
  TemplateField,
  TemplateSchemaItem,
} from '../templates/types/template-json';
import { Submitter } from '../submitters/entities/submitter.entity';
import {
  CreateIdentityVerificationDto,
  CreatePaymentAttemptDto,
  DeclineSigningDto,
  DelegateSigningDto,
  SendEmailVerificationDto,
  SendPhoneVerificationDto,
  UpdateSigningValuesDto,
  VerifyEmailCodeDto,
  VerifyPhoneCodeDto,
} from './dto/signing-request.dto';
import {
  SigningAttachmentDto,
  SigningDocumentDto,
  SigningDownloadResponseDto,
  SigningFieldValueResponseDto,
  SigningResponseDto,
} from './dto/signing-response.dto';
import {
  buildEventData,
  parseSignerMetadata,
  SigningRequestMetadata,
} from './signing-request-metadata';
import { PhoneVerificationService } from './phone-verification/phone-verification.service';

@Injectable()
export class SigningService {
  constructor(
    @InjectRepository(Submitter)
    private readonly submitters: Repository<Submitter>,
    @InjectRepository(AccountConfig)
    private readonly accountConfigs: Repository<AccountConfig>,
    @InjectRepository(PaymentAttempt)
    private readonly paymentAttempts: Repository<PaymentAttempt>,
    @InjectRepository(IdentityVerification)
    private readonly identityVerifications: Repository<IdentityVerification>,
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly submissionDocumentsService: SubmissionDocumentsService,
    private readonly documentGenerationQueue: DocumentGenerationQueueService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
    private readonly emailVerificationCodes: EmailVerificationCodeService,
    private readonly phoneVerification: PhoneVerificationService,
    private readonly branding: BrandingService,
  ) {}

  async getSigningForm(
    slug: string,
    metadata?: SigningRequestMetadata,
  ): Promise<SigningResponseDto> {
    const submitter = await this.findSubmitterBySlugOrFail(slug);

    await this.markOpened(submitter, metadata);

    return this.toSigningResponse(submitter);
  }

  async uploadAttachment(
    slug: string,
    file: UploadedBufferFile,
    type: string | undefined,
  ): Promise<SigningAttachmentDto> {
    return this.toAttachmentResponse(
      await this.createSubmitterAttachment(slug, file, type),
    );
  }

  async uploadApiAttachment(
    slug: string,
    file: UploadedBufferFile,
    type: string | undefined,
  ): Promise<{
    content_type: string | null;
    created_at: Date;
    filename: string;
    url: string;
    uuid: string;
  }> {
    const attachment = await this.createSubmitterAttachment(slug, file, type);
    const response = this.toAttachmentResponse(attachment);

    return {
      content_type: response.content_type,
      created_at: attachment.createdAt,
      filename: response.filename,
      url: response.url,
      uuid: response.uuid,
    };
  }

  private async createSubmitterAttachment(
    slug: string,
    file: UploadedBufferFile,
    type: string | undefined,
  ): Promise<StorageAttachment> {
    const submitter = await this.findSubmitterBySlugOrFail(slug);
    this.assertCanUpdate(submitter);
    await this.assertSigningOrderAvailable(submitter);

    if (!file?.buffer?.length) {
      throw new UnprocessableEntityException({
        error: 'Attachment file is required',
      });
    }

    if (type === 'signature' || type === 'initials') {
      await this.assertSignatureImage(file.buffer, type);
    }

    const attachment = await this.storageService.createAttachment({
      buffer: file.buffer,
      filename: file.originalname || `${type || 'attachment'}.png`,
      contentType: file.mimetype ?? 'application/octet-stream',
      name: 'attachments',
      recordType: 'Submitter',
      recordId: submitter.id,
      metadata: {
        analyzed: true,
        identified: true,
        signing_type: type ?? 'attachment',
      },
    });

    return attachment;
  }

  async getFieldValue(
    slug: string,
    fieldUuid: string,
    after?: string,
  ): Promise<SigningFieldValueResponseDto> {
    const submitter = await this.findSubmitterBySlugOrFail(slug);
    const value = submitter.values?.[fieldUuid] ?? null;
    const attachments = await this.serializeSubmitterAttachments(submitter);
    const afterDate = parseDate(after);
    const attachment =
      typeof value === 'string'
        ? await this.findSubmitterAttachmentByUuid(submitter, value, afterDate)
        : null;

    return {
      value,
      attachment:
        attachment ??
        attachments.find((candidate) => candidate.uuid === value) ??
        null,
    };
  }

  async updateValues(
    slug: string,
    input: UpdateSigningValuesDto,
    metadata?: SigningRequestMetadata,
  ): Promise<SigningResponseDto> {
    const submitter = await this.findSubmitterBySlugOrFail(slug);
    this.assertCanUpdate(submitter);
    await this.assertSigningOrderAvailable(submitter);
    const shouldRecordStart = await this.shouldRecordStartFormEvent(
      submitter,
      input,
    );
    let completionEventId: string | null = null;

    submitter.values = {
      ...(submitter.values ?? {}),
      ...input.values,
    };
    this.applyLatestRequestMetadata(submitter, metadata);

    if (input.completed) {
      this.assertRequiredFieldsComplete(submitter);
      await this.assertRequiredPaymentFieldsComplete(submitter);
      await this.assertRequiredIdentityFieldsComplete(submitter);
      await this.assertSigningReasonsComplete(submitter);
      submitter.completedAt = new Date();
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Submitter).save(submitter);

      if (shouldRecordStart) {
        await manager.getRepository(SubmissionEvent).save(
          manager.getRepository(SubmissionEvent).create({
            accountId: submitter.accountId,
            submissionId: submitter.submissionId,
            submitterId: submitter.id,
            eventType: 'start_form',
            eventTimestamp: new Date(),
            data: buildEventData(metadata),
          }),
        );
      }

      if (input.completed) {
        const completionEvent = await manager
          .getRepository(SubmissionEvent)
          .save(
            manager.getRepository(SubmissionEvent).create({
              accountId: submitter.accountId,
              submissionId: submitter.submissionId,
              submitterId: submitter.id,
              eventType: 'complete_form',
              eventTimestamp: new Date(),
              data: buildEventData(metadata),
            }),
          );
        completionEventId = completionEvent.id;
      }
    });

    const templateId =
      submitter.submission?.templateId ?? submitter.submission?.template?.id;

    if (shouldRecordStart) {
      this.events.emit(runtimeEvents.formStarted, {
        submitterId: submitter.id,
        accountId: submitter.accountId,
        submissionId: submitter.submissionId,
        templateId,
      });
    }

    if (input.completed) {
      try {
        await this.submissionDocumentsService.processSubmitterCompletion(
          submitter,
        );
      } catch (error) {
        await this.dataSource.transaction(async (manager) => {
          submitter.completedAt = null;
          await manager.getRepository(Submitter).save(submitter);

          if (completionEventId) {
            await manager
              .getRepository(SubmissionEvent)
              .delete(completionEventId);
          }
        });

        throw error;
      }
      await this.documentGenerationQueue.enqueueSubmitterCompletion(
        submitter.id,
      );
      this.events.emit(runtimeEvents.formCompleted, {
        submitterId: submitter.id,
        accountId: submitter.accountId,
        submissionId: submitter.submissionId,
        templateId,
      });
      if (isSubmissionComplete(submitter)) {
        this.events.emit(runtimeEvents.submissionCompleted, {
          submissionId: submitter.submissionId,
          accountId: submitter.accountId,
          templateId,
        });
      }
    }

    return this.toSigningResponse(submitter);
  }

  async delegate(
    slug: string,
    input: DelegateSigningDto,
    metadata?: SigningRequestMetadata,
  ): Promise<SigningResponseDto> {
    const submitter = await this.findSubmitterBySlugOrFail(slug);
    this.assertCanUpdate(submitter);
    await this.assertSigningOrderAvailable(submitter);
    await this.assertAllowed(submitter, 'allow_to_delegate', {
      error: 'Delegation is not allowed',
    });

    const previousEmail = submitter.email;

    submitter.email = input.email;
    submitter.name = input.name ?? null;
    submitter.phone = input.phone
      ? this.phoneVerification.normalizePhone(input.phone)
      : null;
    submitter.slug = randomUUID();
    submitter.openedAt = null;
    submitter.sentAt = null;
    submitter.values = {};

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Submitter).save(submitter);
      await manager.getRepository(SubmissionEvent).save(
        manager.getRepository(SubmissionEvent).create({
          accountId: submitter.accountId,
          submissionId: submitter.submissionId,
          submitterId: submitter.id,
          eventType: 'delegate_form',
          eventTimestamp: new Date(),
          data: buildEventData(metadata, {
            email: input.email,
            name: input.name ?? null,
            phone: submitter.phone,
            previous_email: previousEmail,
          }),
        }),
      );
    });

    this.events.emit(runtimeEvents.submitterInvitationRequested, {
      submitterId: submitter.id,
      accountId: submitter.accountId,
    });

    return this.toSigningResponse(submitter);
  }

  async resubmit(
    slug: string,
    metadata?: SigningRequestMetadata,
  ): Promise<SigningResponseDto> {
    const submitter = await this.findSubmitterBySlugOrFail(slug);

    await this.assertAllowed(submitter, 'allow_to_resubmit', {
      error: 'Resubmission is not allowed',
    });

    const nextSubmitter = this.submitters.create({
      accountId: submitter.accountId,
      submissionId: submitter.submissionId,
      uuid: submitter.uuid,
      slug: randomUUID(),
      email: submitter.email,
      name: submitter.name,
      phone: submitter.phone,
      externalId: submitter.externalId,
      metadata: submitter.metadata ?? {},
      preferences: submitter.preferences ?? {},
      values: submitter.preferences?.default_values ?? {},
      timezone: submitter.timezone,
    });

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Submitter).save(nextSubmitter);
      await manager.getRepository(SubmissionEvent).save(
        manager.getRepository(SubmissionEvent).create({
          accountId: submitter.accountId,
          submissionId: submitter.submissionId,
          submitterId: nextSubmitter.id,
          eventType: 'resubmit_form',
          eventTimestamp: new Date(),
          data: buildEventData(metadata, {
            previous_submitter_id: submitter.id,
          }),
        }),
      );
    });

    return this.toSigningResponse(
      await this.findSubmitterBySlugOrFail(nextSubmitter.slug),
    );
  }

  async sendPhoneVerification(
    slug: string,
    input: SendPhoneVerificationDto,
    metadata?: SigningRequestMetadata,
  ): Promise<{ phone: string; status: string }> {
    const submitter = await this.findSubmitterBySlugOrFail(slug);
    this.assertCanUpdate(submitter);
    await this.assertSigningOrderAvailable(submitter);
    const phone = this.resolvePhoneInput(submitter, input);
    const phoneCountry = this.getPhoneValidationCountry(
      submitter,
      input.field_uuid,
    );
    const result = await this.phoneVerification.sendCode(phone, phoneCountry);

    await this.recordEvent(submitter, 'send_2fa_sms', metadata, {
      field_uuid: input.field_uuid ?? null,
      phone: result.to,
    });

    return { phone: result.to, status: result.status };
  }

  async validatePhoneNumber(
    slug: string,
    input: SendPhoneVerificationDto,
  ): Promise<{ phone: string; valid: boolean }> {
    const submitter = await this.findSubmitterBySlugOrFail(slug);
    this.assertCanUpdate(submitter);
    await this.assertSigningOrderAvailable(submitter);
    const phone = this.resolvePhoneInput(submitter, input);
    const phoneCountry = this.getPhoneValidationCountry(
      submitter,
      input.field_uuid,
    );

    return {
      phone: this.phoneVerification.normalizePhone(phone, phoneCountry),
      valid: true,
    };
  }

  async verifyPhoneCode(
    slug: string,
    input: VerifyPhoneCodeDto,
    metadata?: SigningRequestMetadata,
  ): Promise<SigningResponseDto> {
    const submitter = await this.findSubmitterBySlugOrFail(slug);
    this.assertCanUpdate(submitter);
    await this.assertSigningOrderAvailable(submitter);
    const phone = this.resolvePhoneInput(submitter, input);
    const phoneCountry = this.getPhoneValidationCountry(
      submitter,
      input.field_uuid,
    );
    const result = await this.phoneVerification.checkCode(
      phone,
      input.code,
      phoneCountry,
    );

    if (!result.valid) {
      throw new UnprocessableEntityException({
        error: 'Phone verification code is invalid',
      });
    }

    const normalizedPhone = this.phoneVerification.normalizePhone(
      phone,
      phoneCountry,
    );

    submitter.phone = normalizedPhone;

    if (input.field_uuid) {
      submitter.values = {
        ...(submitter.values ?? {}),
        [input.field_uuid]: normalizedPhone,
      };
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Submitter).save(submitter);
      await manager.getRepository(SubmissionEvent).save(
        manager.getRepository(SubmissionEvent).create({
          accountId: submitter.accountId,
          submissionId: submitter.submissionId,
          submitterId: submitter.id,
          eventType: 'phone_verified',
          eventTimestamp: new Date(),
          data: buildEventData(metadata, {
            field_uuid: input.field_uuid ?? null,
            phone: normalizedPhone,
            status: result.status,
          }),
        }),
      );
    });

    return this.toSigningResponse(submitter);
  }

  async sendEmailVerification(
    slug: string,
    input: SendEmailVerificationDto,
    metadata?: SigningRequestMetadata,
  ): Promise<{ email: string; status: string }> {
    const submitter = await this.findSubmitterBySlugOrFail(slug);
    this.assertCanUpdate(submitter);
    await this.assertSigningOrderAvailable(submitter);

    if (!submitter.email) {
      throw new UnprocessableEntityException({
        error: 'Submitter email is required',
      });
    }

    this.events.emit(runtimeEvents.submitterVerificationRequested, {
      submitterId: submitter.id,
      accountId: submitter.accountId,
      locale: null,
    });

    if (input.field_uuid) {
      await this.recordEvent(submitter, 'start_verification', metadata, {
        email: submitter.email,
        field_uuid: input.field_uuid,
        method: 'email',
      });
    }

    return { email: submitter.email, status: 'sent' };
  }

  async verifyEmailCode(
    slug: string,
    input: VerifyEmailCodeDto,
    metadata?: SigningRequestMetadata,
  ): Promise<SigningResponseDto> {
    const submitter = await this.findSubmitterBySlugOrFail(slug);
    this.assertCanUpdate(submitter);
    await this.assertSigningOrderAvailable(submitter);

    if (
      !submitter.email ||
      !this.emailVerificationCodes.verifySubmitterCode(submitter, input.code)
    ) {
      throw new UnprocessableEntityException({
        error: 'Email verification code is invalid',
      });
    }

    if (input.field_uuid) {
      submitter.values = {
        ...(submitter.values ?? {}),
        [input.field_uuid]: submitter.email,
      };
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Submitter).save(submitter);
      await manager.getRepository(SubmissionEvent).save(
        manager.getRepository(SubmissionEvent).create({
          accountId: submitter.accountId,
          submissionId: submitter.submissionId,
          submitterId: submitter.id,
          eventType: 'email_verified',
          eventTimestamp: new Date(),
          data: buildEventData(metadata, {
            email: submitter.email,
            field_uuid: input.field_uuid ?? null,
          }),
        }),
      );
    });

    return this.toSigningResponse(submitter);
  }

  async createPaymentAttempt(
    slug: string,
    input: CreatePaymentAttemptDto,
    metadata?: SigningRequestMetadata,
  ): Promise<{ id: string; status: string }> {
    const submitter = await this.findSubmitterBySlugOrFail(slug);
    this.assertCanUpdate(submitter);
    await this.assertSigningOrderAvailable(submitter);
    const field = this.findSubmitterFieldOrFail(
      submitter,
      input.field_uuid,
      'payment',
    );
    const status = normalizePaymentStatus(input.status);
    const preferences = toRecord(field.preferences);

    const attempt = await this.paymentAttempts.save(
      this.paymentAttempts.create({
        accountId: submitter.accountId,
        amount: numberValue(preferences.price),
        completedAt: status === 'succeeded' ? new Date() : null,
        currency: stringValue(preferences.currency),
        data: input.data ?? {},
        fieldUuid: field.uuid!,
        provider: input.provider ?? null,
        providerReference: input.provider_reference ?? null,
        status,
        submissionId: submitter.submissionId,
        submitterId: submitter.id,
      }),
    );

    await this.recordEvent(submitter, 'payment_attempt', metadata, {
      field_uuid: field.uuid,
      payment_attempt_id: attempt.id,
      provider: attempt.provider,
      status: attempt.status,
    });

    return { id: attempt.id, status: attempt.status };
  }

  async createIdentityVerification(
    slug: string,
    input: CreateIdentityVerificationDto,
    metadata?: SigningRequestMetadata,
  ): Promise<{ id: string; status: string }> {
    const submitter = await this.findSubmitterBySlugOrFail(slug);
    this.assertCanUpdate(submitter);
    await this.assertSigningOrderAvailable(submitter);
    const field = this.findSubmitterFieldOrFail(
      submitter,
      input.field_uuid,
      'verification',
    );
    const status = normalizeIdentityStatus(input.status);

    const verification = await this.identityVerifications.save(
      this.identityVerifications.create({
        accountId: submitter.accountId,
        data: input.data ?? {},
        fieldUuid: field.uuid!,
        method: input.method ?? 'kba',
        provider: input.provider ?? null,
        providerReference: input.provider_reference ?? null,
        status,
        submissionId: submitter.submissionId,
        submitterId: submitter.id,
        verifiedAt: status === 'verified' ? new Date() : null,
      }),
    );

    await this.recordEvent(submitter, 'complete_verification', metadata, {
      field_uuid: field.uuid,
      identity_verification_id: verification.id,
      method: verification.method,
      provider: verification.provider,
      status: verification.status,
    });

    return { id: verification.id, status: verification.status };
  }

  async decline(
    slug: string,
    input: DeclineSigningDto,
    metadata?: SigningRequestMetadata,
  ): Promise<SigningResponseDto> {
    const submitter = await this.findSubmitterBySlugOrFail(slug);
    this.assertCanUpdate(submitter);
    await this.assertAllowed(submitter, 'allow_to_decline', {
      error: 'Declining documents is not allowed',
    });

    submitter.declinedAt = new Date();

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Submitter).save(submitter);
      await manager.getRepository(SubmissionEvent).save(
        manager.getRepository(SubmissionEvent).create({
          accountId: submitter.accountId,
          submissionId: submitter.submissionId,
          submitterId: submitter.id,
          eventType: 'decline_form',
          eventTimestamp: new Date(),
          data: buildEventData(metadata, { reason: input.reason ?? '' }),
        }),
      );
    });

    this.events.emit(runtimeEvents.formDeclined, {
      submitterId: submitter.id,
      accountId: submitter.accountId,
      submissionId: submitter.submissionId,
      templateId:
        submitter.submission?.templateId ?? submitter.submission?.template?.id,
      reason: input.reason ?? null,
    });

    return this.toSigningResponse(submitter);
  }

  async trackEmailClick(
    slug: string,
    trackingParam: string | undefined,
    metadata?: SigningRequestMetadata,
  ): Promise<void> {
    const submitter = await this.findSubmitterBySlugOrFail(slug);

    if (!this.isValidTrackingParam(submitter, trackingParam)) {
      return;
    }

    await this.dataSource.getRepository(SubmissionEvent).save(
      this.dataSource.getRepository(SubmissionEvent).create({
        accountId: submitter.accountId,
        submissionId: submitter.submissionId,
        submitterId: submitter.id,
        eventType: 'click_email',
        eventTimestamp: new Date(),
        data: buildEventData(metadata),
      }),
    );
  }

  async trackSmsClick(
    slug: string,
    trackingParam: string | undefined,
    metadata?: SigningRequestMetadata,
  ): Promise<void> {
    const submitter = await this.findSubmitterBySlugOrFail(slug);

    if (!this.isValidTrackingParam(submitter, trackingParam, 'click_sms')) {
      return;
    }

    await this.recordEvent(submitter, 'click_sms', metadata, {
      phone: submitter.phone,
    });
  }

  async trackFormView(
    slug: string,
    metadata?: SigningRequestMetadata,
  ): Promise<void> {
    await this.markOpened(await this.findSubmitterBySlugOrFail(slug), metadata);
  }

  async getDownload(slug: string): Promise<SigningDownloadResponseDto> {
    const submitter = await this.findSubmitterBySlugOrFail(slug);
    const configs = await this.getSigningFormConfigs(submitter.accountId);

    if (submitter.completedAt && configs.download_links_auth) {
      throw new ForbiddenException({
        error: 'Authentication is required to download documents',
      });
    }

    const ttlSeconds = configs.download_links_expire ? 3600 : null;
    const documents = submitter.completedAt
      ? await this.getCompletedDownloadDocuments(submitter, configs)
      : [];

    return {
      documents:
        documents.length > 0
          ? documents.map((attachment) => ({
              id: attachment.id,
              uuid: attachment.uuid,
              filename: attachment.blob.filename,
              name: attachment.blob.filename,
              url: this.storageService.createBlobProxyUrl(
                attachment.blob,
                ttlSeconds,
              ),
              preview_images: [],
            }))
          : await this.serializeDocuments(submitter.submission),
    };
  }

  private async findSubmitterBySlugOrFail(slug: string): Promise<Submitter> {
    const submitter = await this.submitters.findOne({
      where: { slug },
      relations: {
        submission: {
          template: true,
          submitters: true,
        },
      },
    });

    if (!submitter) {
      throw new NotFoundException({ error: 'Signing form not found' });
    }

    return submitter;
  }

  private async markOpened(
    submitter: Submitter,
    metadata?: SigningRequestMetadata,
  ): Promise<void> {
    const isFirstOpen = !submitter.openedAt;

    if (isFirstOpen) {
      submitter.openedAt = new Date();
    }
    const hasLatestMetadata = this.applyLatestRequestMetadata(
      submitter,
      metadata,
    );

    await this.dataSource.transaction(async (manager) => {
      if (isFirstOpen || hasLatestMetadata) {
        await manager.getRepository(Submitter).save(submitter);
      }

      if (this.isValidClickEmailTracking(submitter, metadata)) {
        await manager.getRepository(SubmissionEvent).save(
          manager.getRepository(SubmissionEvent).create({
            accountId: submitter.accountId,
            submissionId: submitter.submissionId,
            submitterId: submitter.id,
            eventType: 'click_email',
            eventTimestamp: new Date(),
            data: buildEventData(metadata),
          }),
        );
      }

      if (this.isValidClickSmsTracking(submitter, metadata)) {
        await manager.getRepository(SubmissionEvent).save(
          manager.getRepository(SubmissionEvent).create({
            accountId: submitter.accountId,
            submissionId: submitter.submissionId,
            submitterId: submitter.id,
            eventType: 'click_sms',
            eventTimestamp: new Date(),
            data: buildEventData(metadata, { phone: submitter.phone }),
          }),
        );
      }

      await manager.getRepository(SubmissionEvent).save(
        manager.getRepository(SubmissionEvent).create({
          accountId: submitter.accountId,
          submissionId: submitter.submissionId,
          submitterId: submitter.id,
          eventType: 'view_form',
          eventTimestamp: new Date(),
          data: buildEventData(metadata),
        }),
      );
    });

    this.events.emit(runtimeEvents.formViewed, {
      submitterId: submitter.id,
      accountId: submitter.accountId,
      submissionId: submitter.submissionId,
      templateId:
        submitter.submission?.templateId ?? submitter.submission?.template?.id,
    });
  }

  private isValidClickEmailTracking(
    submitter: Submitter,
    metadata?: SigningRequestMetadata,
  ): boolean {
    return this.isValidTrackingParam(
      submitter,
      metadata?.trackingParam,
      'click_email',
    );
  }

  private isValidClickSmsTracking(
    submitter: Submitter,
    metadata?: SigningRequestMetadata,
  ): boolean {
    return this.isValidTrackingParam(
      submitter,
      metadata?.smsTrackingParam,
      'click_sms',
    );
  }

  private isValidTrackingParam(
    submitter: Submitter,
    trackingParam?: string,
    eventType = 'click_email',
  ): boolean {
    return isValidSubmitterEventTrackingParam({
      eventType,
      secret: this.config.get<string>('JWT_SECRET', 'signa-development-secret'),
      submitterSlug: submitter.slug,
      trackingParam,
    });
  }

  private async shouldRecordStartFormEvent(
    submitter: Submitter,
    input: UpdateSigningValuesDto,
  ): Promise<boolean> {
    if (!Object.keys(input.values ?? {}).length) {
      return false;
    }

    const existingStartEvent = await this.dataSource
      .getRepository(SubmissionEvent)
      .exists({
        where: {
          submitterId: submitter.id,
          eventType: 'start_form',
        },
      });

    return !existingStartEvent;
  }

  private async assertSigningOrderAvailable(
    submitter: Submitter,
  ): Promise<void> {
    if (!(await this.shouldEnforceSigningOrder(submitter))) {
      return;
    }

    const orderedSubmitters = [...(submitter.submission.submitters ?? [])].sort(
      (a, b) => Number(a.id) - Number(b.id),
    );
    const currentIndex = orderedSubmitters.findIndex(
      (item) => item.id === submitter.id,
    );
    const blocker = orderedSubmitters
      .slice(0, currentIndex)
      .find((item) => !item.completedAt && !item.declinedAt);

    if (blocker) {
      throw new UnprocessableEntityException({
        error: 'Waiting for previous submitter to complete the form',
      });
    }
  }

  private async shouldEnforceSigningOrder(
    submitter: Submitter,
  ): Promise<boolean> {
    if (submitter.submission.submittersOrder === 'preserved') {
      return true;
    }

    return this.getAccountBooleanConfig(
      submitter.accountId,
      'enforce_signing_order',
    );
  }

  private async assertAllowed(
    submitter: Submitter,
    key: 'allow_to_decline' | 'allow_to_delegate' | 'allow_to_resubmit',
    error: { error: string },
  ): Promise<void> {
    const value =
      booleanOrNull(submitter.preferences?.[key]) ??
      booleanOrNull(submitter.submission.preferences?.[key]) ??
      booleanOrNull(submitter.submission.template?.preferences?.[key]) ??
      (await this.getAccountBooleanConfig(
        submitter.accountId,
        key,
        key === 'allow_to_delegate' ? false : true,
      ));

    if (!value) {
      throw new UnprocessableEntityException(error);
    }
  }

  private async getAccountBooleanConfig(
    accountId: string,
    key: string,
    defaultValue = false,
  ): Promise<boolean> {
    const config = await this.accountConfigs.findOne({
      where: { accountId, key },
    });

    return typeof config?.value === 'boolean' ? config.value : defaultValue;
  }

  private resolvePhoneInput(
    submitter: Submitter,
    input: SendPhoneVerificationDto,
  ): string {
    const valueFromField = input.field_uuid
      ? submitter.values?.[input.field_uuid]
      : null;
    const phone =
      input.phone ??
      (typeof valueFromField === 'string' ? valueFromField : null) ??
      submitter.phone;

    if (!phone) {
      throw new UnprocessableEntityException({
        error: 'Phone number is required',
      });
    }

    return phone;
  }

  private getPhoneValidationCountry(
    submitter: Submitter,
    fieldUuid: string | undefined,
  ): string | null {
    if (!fieldUuid) {
      return null;
    }

    const fields =
      submitter.submission?.templateFields ??
      submitter.submission?.template?.fields ??
      [];
    const field = fields.find((item) => item.uuid === fieldUuid);
    const validation = field?.validation;

    if (!validation || typeof validation !== 'object') {
      return null;
    }

    const country = (validation as Record<string, unknown>).phone_country;

    return typeof country === 'string' && country.trim()
      ? country.trim().toUpperCase()
      : null;
  }

  private async recordEvent(
    submitter: Submitter,
    eventType: string,
    metadata?: SigningRequestMetadata,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await this.dataSource.getRepository(SubmissionEvent).save(
      this.dataSource.getRepository(SubmissionEvent).create({
        accountId: submitter.accountId,
        submissionId: submitter.submissionId,
        submitterId: submitter.id,
        eventType,
        eventTimestamp: new Date(),
        data: buildEventData(metadata, data),
      }),
    );
  }

  private applyLatestRequestMetadata(
    submitter: Submitter,
    metadata?: SigningRequestMetadata,
  ): boolean {
    if (!metadata) {
      return false;
    }

    const context = removeUndefinedValues({
      ...parseSignerMetadata(metadata),
      ip: metadata.ip,
      locale: metadata.locale,
      timezone: metadata.timezone,
      ua: metadata.ua,
    });

    if (!Object.keys(context).length) {
      return false;
    }

    submitter.ip = metadata.ip ?? submitter.ip;
    submitter.ua = metadata.ua ?? submitter.ua;
    submitter.timezone = metadata.timezone ?? submitter.timezone;
    submitter.metadata = {
      ...(submitter.metadata ?? {}),
      latest_signing_context: context,
    };

    return true;
  }

  private assertCanUpdate(submitter: Submitter): void {
    if (submitter.completedAt) {
      throw new UnprocessableEntityException({
        error: 'Form has been completed already',
      });
    }

    if (submitter.declinedAt) {
      throw new UnprocessableEntityException({
        error: 'Form has been declined',
      });
    }

    if (
      submitter.submission.archivedAt ||
      submitter.submission.template?.archivedAt
    ) {
      throw new UnprocessableEntityException({
        error: 'Form has been archived',
      });
    }

    if (
      submitter.submission.expireAt &&
      submitter.submission.expireAt < new Date()
    ) {
      throw new UnprocessableEntityException({
        error: 'Form has been expired',
      });
    }
  }

  private async assertSignatureImage(
    buffer: Buffer,
    type: string,
  ): Promise<void> {
    const image = sharp(buffer);
    const stats = await image.stats();
    const metadata = await image.metadata();
    const hasInk = stats.channels.some((channel) => channel.stdev > 1);

    if (!metadata.width || !metadata.height || !hasInk) {
      throw new UnprocessableEntityException({
        error: `${type} is empty`,
      });
    }
  }

  private assertRequiredFieldsComplete(submitter: Submitter): void {
    const missingField = this.getSubmitterFields(submitter).find((field) => {
      if (field.required === false || field.readonly === true || !field.uuid) {
        return false;
      }

      return isBlankValue(submitter.values?.[field.uuid]);
    });

    if (missingField?.uuid) {
      throw new UnprocessableEntityException({
        field_uuid: missingField.uuid,
        error: 'Fill all required fields to complete',
      });
    }
  }

  private async assertRequiredPaymentFieldsComplete(
    submitter: Submitter,
  ): Promise<void> {
    const missingField = await this.findMissingProviderBackedField(
      submitter,
      'payment',
      async (fieldUuid) =>
        this.paymentAttempts.existsBy({
          fieldUuid,
          status: 'succeeded',
          submitterId: submitter.id,
        }),
    );

    if (missingField?.uuid) {
      throw new UnprocessableEntityException({
        field_uuid: missingField.uuid,
        error: 'Complete payment to finish signing',
      });
    }
  }

  private async assertRequiredIdentityFieldsComplete(
    submitter: Submitter,
  ): Promise<void> {
    const missingField = await this.findMissingProviderBackedField(
      submitter,
      'verification',
      async (fieldUuid) =>
        this.identityVerifications.existsBy({
          fieldUuid,
          status: 'verified',
          submitterId: submitter.id,
        }),
    );

    if (missingField?.uuid) {
      throw new UnprocessableEntityException({
        field_uuid: missingField.uuid,
        error: 'Complete identity verification to finish signing',
      });
    }
  }

  private async findMissingProviderBackedField(
    submitter: Submitter,
    type: string,
    isComplete: (fieldUuid: string) => Promise<boolean>,
  ): Promise<TemplateField | null> {
    for (const field of this.getSubmitterFields(submitter)) {
      if (
        field.type !== type ||
        field.required === false ||
        field.readonly === true ||
        !field.uuid
      ) {
        continue;
      }

      if (!(await isComplete(field.uuid))) {
        return field;
      }
    }

    return null;
  }

  private async assertSigningReasonsComplete(
    submitter: Submitter,
  ): Promise<void> {
    const isRequired = await this.getAccountBooleanConfig(
      submitter.accountId,
      'require_signing_reason',
      false,
    );

    if (!isRequired) {
      return;
    }

    const missingField = this.getSubmitterFields(submitter).find((field) => {
      if (
        field.readonly === true ||
        (field.type !== 'signature' && field.type !== 'initials') ||
        !field.uuid ||
        isBlankValue(submitter.values?.[field.uuid])
      ) {
        return false;
      }

      return isBlankValue(
        submitter.values?.[getSigningReasonValueKey(field.uuid)],
      );
    });

    if (missingField?.uuid) {
      throw new UnprocessableEntityException({
        field_uuid: missingField.uuid,
        error: 'Signing reason is required',
      });
    }
  }

  private async getCompletedDownloadDocuments(
    submitter: Submitter,
    configs: SigningResponseDto['configs'],
  ): Promise<StorageAttachment[]> {
    if (configs.combine_pdf_result) {
      const combined =
        await this.submissionDocumentsService.getCombinedDocumentAttachment(
          submitter.submission,
        );

      return combined ? [combined] : [];
    }

    return this.submissionDocumentsService.getSubmissionDocuments(
      submitter.submission,
      { merge: false },
    );
  }

  private async toSigningResponse(
    submitter: Submitter,
  ): Promise<SigningResponseDto> {
    const submission = submitter.submission;

    const [branding, documents, attachments, configs] = await Promise.all([
      this.branding.get(submitter.accountId),
      this.serializeDocuments(submission),
      this.serializeSubmitterAttachments(submitter),
      this.getSigningFormConfigs(submitter.accountId),
    ]);

    return {
      branding,
      submission_id: submission.id,
      title: submission.name ?? submission.template?.name ?? 'Document',
      submitter: {
        id: submitter.id,
        slug: submitter.slug,
        uuid: submitter.uuid,
        name: submitter.name,
        email: submitter.email,
        role: this.findSubmitterRole(submitter),
        completed_at: submitter.completedAt,
        declined_at: submitter.declinedAt,
      },
      documents,
      fields: this.getSubmitterFields(submitter),
      values: submitter.values ?? {},
      readonly_values: this.getReadonlyValues(submitter),
      attachments,
      configs,
    };
  }

  private async getSigningFormConfigs(
    accountId: string,
  ): Promise<SigningResponseDto['configs']> {
    const configs = await this.accountConfigs.find({
      where: {
        accountId,
        key: In([
          'form_completed_button',
          'form_completed_message',
          'form_prefill_signature',
          'form_with_confetti',
          'allow_typed_signature',
          'allow_to_decline',
          'allow_to_delegate',
          'require_signing_reason',
          'with_signature_id',
          'download_links_expire',
          'download_links_auth',
          'combine_pdf_result_key',
          'flatten_result_pdf',
          'force_mfa',
          'policy_links',
        ]),
      },
    });
    const configByKey = new Map(configs.map((config) => [config.key, config]));

    return {
      completed_button: toRecord(
        configByKey.get('form_completed_button')?.value,
      ),
      completed_message: toRecord(
        configByKey.get('form_completed_message')?.value,
      ),
      policy_links: toString(configByKey.get('policy_links')?.value),
      with_typed_signature:
        configByKey.get('allow_typed_signature')?.value !== false,
      with_decline: configByKey.get('allow_to_decline')?.value !== false,
      with_delegate: configByKey.get('allow_to_delegate')?.value === true,
      require_signing_reason:
        configByKey.get('require_signing_reason')?.value === true,
      with_signature_id: configByKey.get('with_signature_id')?.value === true,
      prefill_signature:
        configByKey.get('form_prefill_signature')?.value !== false,
      download_links_expire:
        configByKey.get('download_links_expire')?.value !== false,
      download_links_auth:
        configByKey.get('download_links_auth')?.value === true,
      combine_pdf_result:
        configByKey.get('combine_pdf_result_key')?.value === true,
      flatten_result_pdf:
        configByKey.get('flatten_result_pdf')?.value !== false,
      force_mfa: configByKey.get('force_mfa')?.value === true,
      with_confetti: configByKey.get('form_with_confetti')?.value === true,
    };
  }

  private async serializeDocuments(
    submission: Submission,
  ): Promise<SigningDocumentDto[]> {
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
    const orderedAttachments = getSchemaOrderedAttachments(schema, attachments);

    return Promise.all(
      orderedAttachments.map(async (attachment) => ({
        id: attachment.id,
        uuid: attachment.uuid,
        filename: attachment.blob.filename,
        name:
          getSchemaDocumentName(schema, attachment.uuid) ??
          attachment.blob.filename,
        url: this.storageService.createBlobProxyUrl(attachment.blob, 3600),
        preview_images: await this.serializePreviewImages(attachment),
      })),
    );
  }

  private async serializePreviewImages(
    document: StorageAttachment,
  ): Promise<SigningDocumentDto['preview_images']> {
    const previews = await this.storageService.findPreviewAttachments(
      document.id,
    );

    return previews.map((preview) => ({
      id: preview.id,
      url: this.storageService.createBlobProxyUrl(preview.blob, 3600),
      filename: preview.blob.filename,
      metadata: preview.blob.metadata ?? {},
    }));
  }

  private toAttachmentResponse(
    attachment: StorageAttachment,
  ): SigningAttachmentDto {
    return {
      uuid: attachment.uuid,
      filename: attachment.blob.filename,
      content_type: attachment.blob.contentType,
      url: this.storageService.createBlobProxyUrl(attachment.blob, 3600),
    };
  }

  private async serializeSubmitterAttachments(
    submitter: Submitter,
  ): Promise<SigningAttachmentDto[]> {
    const attachments = await this.storageService.findRecordAttachments({
      recordType: 'Submitter',
      recordId: submitter.id,
      name: 'attachments',
    });

    return attachments.map((attachment) =>
      this.toAttachmentResponse(attachment),
    );
  }

  private async findSubmitterAttachmentByUuid(
    submitter: Submitter,
    uuid: string,
    afterDate: Date | null,
  ): Promise<SigningAttachmentDto | null> {
    const attachments = await this.storageService.findRecordAttachments({
      recordType: 'Submitter',
      recordId: submitter.id,
      name: 'attachments',
    });
    const attachment = attachments.find(
      (candidate) =>
        candidate.uuid === uuid &&
        (!afterDate || candidate.createdAt > afterDate),
    );

    return attachment ? this.toAttachmentResponse(attachment) : null;
  }

  private getSubmitterFields(submitter: Submitter): TemplateField[] {
    const fields =
      submitter.submission.templateFields ??
      submitter.submission.template?.fields ??
      [];

    return fields.filter((field) => field.submitter_uuid === submitter.uuid);
  }

  private findSubmitterFieldOrFail(
    submitter: Submitter,
    fieldUuid: string,
    type: string,
  ): TemplateField {
    const field = this.getSubmitterFields(submitter).find(
      (candidate) => candidate.uuid === fieldUuid && candidate.type === type,
    );

    if (!field) {
      throw new UnprocessableEntityException({
        field_uuid: fieldUuid,
        error: `${type} field was not found`,
      });
    }

    return field;
  }

  private getReadonlyValues(submitter: Submitter): Record<string, unknown> {
    return Object.fromEntries(
      (submitter.submission.submitters ?? [])
        .filter((item) => item.uuid !== submitter.uuid)
        .flatMap((item) => Object.entries(item.values ?? {})),
    );
  }

  private findSubmitterRole(submitter: Submitter): string {
    const templateSubmitters =
      submitter.submission.templateSubmitters ??
      submitter.submission.template?.submitters ??
      [];

    return (
      templateSubmitters.find((item) => item.uuid === submitter.uuid)?.name ??
      ''
    );
  }
}

function isSubmissionComplete(submitter: Submitter): boolean {
  return (submitter.submission.submitters ?? []).every((item) =>
    item.id === submitter.id ? true : Boolean(item.completedAt),
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

  return schema
    .map((item) => item.attachment_uuid)
    .filter((uuid): uuid is string => typeof uuid === 'string')
    .map((uuid) => attachmentsByUuid.get(uuid))
    .filter((attachment) => attachment !== undefined);
}

function isBlankValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

function parseDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.valueOf()) ? null : date;
}

function toRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const record: Record<string, string> = {};

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      record[key] = item;
    }
  }

  return record;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizePaymentStatus(value: string | undefined) {
  if (
    value === 'pending' ||
    value === 'processing' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'cancelled'
  ) {
    return value;
  }

  return 'requires_provider';
}

function normalizeIdentityStatus(value: string | undefined) {
  if (
    value === 'pending' ||
    value === 'verified' ||
    value === 'failed' ||
    value === 'expired'
  ) {
    return value;
  }

  return 'pending';
}

function toString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function getSigningReasonValueKey(fieldUuid: string): string {
  return `${fieldUuid}_reason`;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function removeUndefinedValues(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}
