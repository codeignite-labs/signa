import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { UploadedBufferFile } from '../storage/storage.types';
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
  SigningDownloadResponseDto,
  SigningFieldValueResponseDto,
  SigningResponseDto,
} from './dto/signing-response.dto';
import { SigningRequestMetadata } from './signing-request-metadata';
import { SigningService } from './signing.service';

@Controller('signing')
@ApiTags('Signing')
export class SigningController {
  constructor(private readonly signingService: SigningService) {}

  @Get(':slug')
  @ApiParam({
    description: 'Public submitter signing slug.',
    name: 'slug',
  })
  @ApiQuery({
    description: 'Optional email click tracking token.',
    name: 't',
    required: false,
  })
  @ApiQuery({
    description: 'Optional SMS click tracking token.',
    name: 'c',
    required: false,
  })
  @ApiOperation({
    description:
      'Returns the public signing form payload, including documents, fields, submitter state, preferences, and existing values.',
    summary: 'Get public signing form by submitter slug',
  })
  @ApiOkResponse({ type: SigningResponseDto })
  getSigningForm(
    @Param('slug') slug: string,
    @Query('t') trackingParam: string | undefined,
    @Query('c') smsTrackingParam: string | undefined,
    @Req() request: Request,
  ): Promise<SigningResponseDto> {
    return this.signingService.getSigningForm(
      slug,
      getSigningRequestMetadata(request, trackingParam, smsTrackingParam),
    );
  }

  @Get(':slug/values')
  @ApiParam({
    description: 'Public submitter signing slug.',
    name: 'slug',
  })
  @ApiQuery({
    description: 'Field UUID to poll for a remote signing value.',
    name: 'field_uuid',
    required: true,
  })
  @ApiQuery({
    description:
      'Optional ISO timestamp or cursor. Only values updated after this cursor are returned.',
    name: 'after',
    required: false,
  })
  @ApiOperation({
    description:
      'Polling endpoint used by phone/QR signing flows to retrieve a field value written from another device.',
    summary: 'Get public signing field value for QR polling',
  })
  @ApiOkResponse({ type: SigningFieldValueResponseDto })
  getFieldValue(
    @Param('slug') slug: string,
    @Query('field_uuid') fieldUuid: string,
    @Query('after') after?: string,
  ): Promise<SigningFieldValueResponseDto> {
    return this.signingService.getFieldValue(slug, fieldUuid, after);
  }

  @Post(':slug/attachments')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description:
      'Multipart attachment upload for signature, initials, image, and file fields.',
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        type: { type: 'string', example: 'signature' },
      },
    },
  })
  @ApiParam({
    description: 'Public submitter signing slug.',
    name: 'slug',
  })
  @ApiOperation({
    description:
      'Uploads a file during the public signing flow and returns a signed attachment reference for field values.',
    summary: 'Upload a signing attachment',
  })
  @ApiOkResponse({ type: SigningAttachmentDto })
  uploadAttachment(
    @Param('slug') slug: string,
    @UploadedFile() file: UploadedBufferFile,
    @Body('type') type?: string,
  ): Promise<SigningAttachmentDto> {
    return this.signingService.uploadAttachment(slug, file, type);
  }

  @Put(':slug/values')
  @ApiParam({
    description: 'Public submitter signing slug.',
    name: 'slug',
  })
  @ApiOperation({
    description:
      'Persists in-progress signing values without completing the submitter. Used for autosave and step navigation.',
    summary: 'Save public signing form values',
  })
  @ApiOkResponse({ type: SigningResponseDto })
  updateValues(
    @Param('slug') slug: string,
    @Body() body: UpdateSigningValuesDto,
    @Req() request: Request,
  ): Promise<SigningResponseDto> {
    return this.signingService.updateValues(
      slug,
      body,
      getSigningRequestMetadata(request),
    );
  }

  @Post(':slug/complete')
  @ApiParam({
    description: 'Public submitter signing slug.',
    name: 'slug',
  })
  @ApiOperation({
    description:
      'Validates required fields, finalizes the submitter, generates completed documents, and triggers completion notifications/webhooks.',
    summary: 'Complete public signing form',
  })
  @ApiOkResponse({ type: SigningResponseDto })
  complete(
    @Param('slug') slug: string,
    @Body() body: UpdateSigningValuesDto,
    @Req() request: Request,
  ): Promise<SigningResponseDto> {
    return this.signingService.updateValues(
      slug,
      {
        ...body,
        completed: true,
      },
      getSigningRequestMetadata(request),
    );
  }

  @Post(':slug/decline')
  @ApiParam({
    description: 'Public submitter signing slug.',
    name: 'slug',
  })
  @ApiOperation({
    description:
      'Marks the submitter as declined, stores the decline reason, and emits DocuSeal-compatible decline events.',
    summary: 'Decline public signing form',
  })
  @ApiOkResponse({ type: SigningResponseDto })
  decline(
    @Param('slug') slug: string,
    @Body() body: DeclineSigningDto,
    @Req() request: Request,
  ): Promise<SigningResponseDto> {
    return this.signingService.decline(
      slug,
      body,
      getSigningRequestMetadata(request),
    );
  }

  @Post(':slug/delegate')
  @ApiParam({
    description: 'Public submitter signing slug.',
    name: 'slug',
  })
  @ApiOperation({
    description:
      'Delegates a signing request to another recipient when delegation is enabled for the template/account.',
    summary: 'Delegate public signing form to another recipient',
  })
  @ApiOkResponse({ type: SigningResponseDto })
  delegate(
    @Param('slug') slug: string,
    @Body() body: DelegateSigningDto,
    @Req() request: Request,
  ): Promise<SigningResponseDto> {
    return this.signingService.delegate(
      slug,
      body,
      getSigningRequestMetadata(request),
    );
  }

  @Post(':slug/resubmit')
  @ApiParam({
    description: 'Public submitter signing slug.',
    name: 'slug',
  })
  @ApiOperation({
    description:
      'Creates a fresh submitter revision for a completed form when resubmission is allowed.',
    summary: 'Create a fresh public signing form revision',
  })
  @ApiOkResponse({ type: SigningResponseDto })
  resubmit(
    @Param('slug') slug: string,
    @Req() request: Request,
  ): Promise<SigningResponseDto> {
    return this.signingService.resubmit(
      slug,
      getSigningRequestMetadata(request),
    );
  }

  @Post(':slug/phone-verification/send')
  @ApiParam({
    description: 'Public submitter signing slug.',
    name: 'slug',
  })
  @ApiOperation({
    description:
      'Sends a phone verification code for signing fields or flows that require verified phone ownership.',
    summary: 'Send public signing phone verification code',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        phone: { type: 'string' },
        status: { type: 'string' },
      },
    },
  })
  sendPhoneVerification(
    @Param('slug') slug: string,
    @Body() body: SendPhoneVerificationDto,
    @Req() request: Request,
  ): Promise<{ phone: string; status: string }> {
    return this.signingService.sendPhoneVerification(
      slug,
      body,
      getSigningRequestMetadata(request),
    );
  }

  @Post(':slug/phone-verification/validate')
  @ApiParam({
    description: 'Public submitter signing slug.',
    name: 'slug',
  })
  @ApiOperation({
    description:
      'Validates phone number format and configured country rules without sending a verification code.',
    summary: 'Validate a public signing phone number',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        phone: { type: 'string' },
        valid: { type: 'boolean' },
      },
    },
  })
  validatePhoneNumber(
    @Param('slug') slug: string,
    @Body() body: SendPhoneVerificationDto,
  ): Promise<{ phone: string; valid: boolean }> {
    return this.signingService.validatePhoneNumber(slug, body);
  }

  @Post(':slug/phone-verification/check')
  @ApiParam({
    description: 'Public submitter signing slug.',
    name: 'slug',
  })
  @ApiOperation({
    description:
      'Checks a phone verification code and records the phone as verified for the submitter session.',
    summary: 'Verify public signing phone code',
  })
  @ApiOkResponse({ type: SigningResponseDto })
  verifyPhoneCode(
    @Param('slug') slug: string,
    @Body() body: VerifyPhoneCodeDto,
    @Req() request: Request,
  ): Promise<SigningResponseDto> {
    return this.signingService.verifyPhoneCode(
      slug,
      body,
      getSigningRequestMetadata(request),
    );
  }

  @Post(':slug/email-verification/send')
  @ApiParam({
    description: 'Public submitter signing slug.',
    name: 'slug',
  })
  @ApiOperation({
    description:
      'Sends an email verification code for shared-link or signing flows that require verified recipient email.',
    summary: 'Send public signing email verification code',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        email: { type: 'string' },
        status: { type: 'string' },
      },
    },
  })
  sendEmailVerification(
    @Param('slug') slug: string,
    @Body() body: SendEmailVerificationDto,
    @Req() request: Request,
  ): Promise<{ email: string; status: string }> {
    return this.signingService.sendEmailVerification(
      slug,
      body,
      getSigningRequestMetadata(request),
    );
  }

  @Post(':slug/email-verification/check')
  @ApiParam({
    description: 'Public submitter signing slug.',
    name: 'slug',
  })
  @ApiOperation({
    description:
      'Checks an email verification code and returns the updated signing form when verification succeeds.',
    summary: 'Verify public signing email code',
  })
  @ApiOkResponse({ type: SigningResponseDto })
  verifyEmailCode(
    @Param('slug') slug: string,
    @Body() body: VerifyEmailCodeDto,
    @Req() request: Request,
  ): Promise<SigningResponseDto> {
    return this.signingService.verifyEmailCode(
      slug,
      body,
      getSigningRequestMetadata(request),
    );
  }

  @Post(':slug/payment-attempts')
  @ApiParam({
    description: 'Public submitter signing slug.',
    name: 'slug',
  })
  @ApiOperation({
    description:
      'Initializes an unconfirmed payment attempt. Client requests cannot confirm payment success; required payment fields remain blocked until trusted provider confirmation is implemented.',
    summary: 'Initialize an unconfirmed signing payment attempt',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        id: { type: 'string' },
        status: { type: 'string' },
      },
    },
  })
  createPaymentAttempt(
    @Param('slug') slug: string,
    @Body() body: CreatePaymentAttemptDto,
    @Req() request: Request,
  ): Promise<{ id: string; status: string }> {
    return this.signingService.createPaymentAttempt(
      slug,
      body,
      getSigningRequestMetadata(request),
    );
  }

  @Post(':slug/identity-verifications')
  @ApiParam({
    description: 'Public submitter signing slug.',
    name: 'slug',
  })
  @ApiOperation({
    description:
      'Initializes a pending identity verification. Client requests cannot mark an identity verified; required verification fields remain blocked until trusted provider confirmation is implemented.',
    summary: 'Initialize pending signing identity verification',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        id: { type: 'string' },
        status: { type: 'string' },
      },
    },
  })
  createIdentityVerification(
    @Param('slug') slug: string,
    @Body() body: CreateIdentityVerificationDto,
    @Req() request: Request,
  ): Promise<{ id: string; status: string }> {
    return this.signingService.createIdentityVerification(
      slug,
      body,
      getSigningRequestMetadata(request),
    );
  }

  @Get(':slug/download')
  @ApiParam({
    description: 'Public submitter signing slug.',
    name: 'slug',
  })
  @ApiOperation({
    description:
      'Returns signed download URLs for the completed document, audit trail, or combined package allowed for this submitter.',
    summary: 'Get public signing form download URLs',
  })
  @ApiOkResponse({ type: SigningDownloadResponseDto })
  download(@Param('slug') slug: string): Promise<SigningDownloadResponseDto> {
    return this.signingService.getDownload(slug);
  }
}

function getSigningRequestMetadata(
  request: Request,
  trackingParam?: string,
  smsTrackingParam?: string,
): SigningRequestMetadata {
  return {
    ip: request.ip,
    locale: request.get('x-signa-locale') ?? request.get('accept-language'),
    smsTrackingParam,
    timezone: request.get('x-signa-timezone'),
    trackingParam,
    ua: request.get('user-agent'),
  };
}
