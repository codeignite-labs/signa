import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type { TemplateField } from '../../templates/types/template-json';

export class CreateSubmissionMessageDto {
  @ApiPropertyOptional({
    description:
      'Email subject override for this signature request. Supports DocuSeal-style variables such as {template.name}.',
    example: 'You are invited to sign a document',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  subject?: string;

  @ApiPropertyOptional({
    description:
      'Email body override for this signature request. Markdown and DocuSeal-style variables are rendered before delivery.',
    example:
      'Hi there,\n\nYou have been invited to sign the "{template.name}".',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  body?: string;
}

export class CreateSubmissionSubmitterDto {
  @ApiPropertyOptional({
    description:
      'Stable submitter UUID. Use this when updating or correlating generated submitters across API calls.',
    example: '884d545b-3396-49f1-8c07-05b8b2a78755',
  })
  @IsOptional()
  @IsString()
  uuid?: string;

  @ApiPropertyOptional({
    description:
      'Template submitter role this recipient fills, for example "First Party".',
    example: 'First Party',
  })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({
    description:
      'Multiple template roles for the same recipient. Signa merges these roles into one submitter, matching DocuSeal multi-role behavior.',
    example: ['First Party', 'Second Party'],
  })
  @IsOptional()
  @IsArray()
  roles?: string[];

  @ApiPropertyOptional({
    description: 'Recipient display name used in emails, audit logs, and PDFs.',
    example: 'John Doe',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Recipient email address. Required when send_email is true.',
    example: 'john.doe@example.com',
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({
    description:
      'Recipient phone number in E.164 format. Required when send_sms is true.',
    example: '+1234567890',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Application-specific id for correlating this submitter.',
    example: '2321',
  })
  @IsOptional()
  @IsString()
  external_id?: string;

  @ApiPropertyOptional({
    description:
      'DocuSeal-compatible alias for external_id. If both are supplied, external_id wins.',
    example: '2321',
  })
  @IsOptional()
  @IsString()
  application_key?: string;

  @ApiPropertyOptional({
    description:
      'Marks this submitter as completed immediately using supplied values. Useful for API-completed roles.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @ApiPropertyOptional({
    description:
      'Completes this submitter with the authenticated account owner saved signature and initials. Intended for owner/business roles created through API workflows.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  use_saved_signature?: boolean;

  @ApiPropertyOptional({
    description:
      'User id whose saved signature should complete this submitter. Defaults to the authenticated API user and must belong to the same account.',
    example: '1',
  })
  @IsOptional()
  @IsString()
  completed_by_user_id?: string;

  @ApiPropertyOptional({
    description:
      'Send a signature request email for this recipient. Submission-level send_email is used when omitted.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  send_email?: boolean;

  @ApiPropertyOptional({
    description:
      'Send a signature request SMS for this recipient. Requires SMS provider configuration and a phone number.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  send_sms?: boolean;

  @ApiPropertyOptional({
    description:
      'Zero-based recipient order. Preserved ordering is used when submitters_order/order is preserved.',
    example: 0,
  })
  @IsOptional()
  index?: number;

  @ApiPropertyOptional({
    description: 'DocuSeal-compatible alias for index.',
    example: 0,
  })
  @IsOptional()
  order?: number;

  @ApiPropertyOptional({
    description:
      'Arbitrary submitter metadata returned in API responses and webhook payloads.',
    example: { crm_contact_id: 'contact_123' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Prefilled field values keyed by field name or UUID. File/image/signature values can reference uploaded attachment UUIDs.',
    example: { 'Full Name': 'John Doe', Approved: true },
  })
  @IsOptional()
  @IsObject()
  values?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Field names/UUIDs that should be shown as read-only for this submitter.',
    example: ['email'],
  })
  @IsOptional()
  @IsArray()
  readonly_fields?: string[];

  @ApiPropertyOptional({
    description:
      'Submitter-specific field overrides. Supports DocuSeal field JSON shape with areas, preferences, validation, and conditions.',
    example: [],
  })
  @IsOptional()
  @IsArray()
  fields?: TemplateField[];

  @ApiPropertyOptional({
    description:
      'Submitter-specific preferences such as completed redirect URL or delivery flags.',
    example: {},
  })
  @IsOptional()
  @IsObject()
  preferences?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'URL where this submitter should be redirected after completion.',
    example: 'https://example.test/completed',
  })
  @IsOptional()
  @IsString()
  completed_redirect_url?: string;

  @ApiPropertyOptional({
    description: 'Reply-To address used by signature request emails.',
    example: 'reply@example.com',
  })
  @IsOptional()
  @IsString()
  reply_to?: string;

  @ApiPropertyOptional({ type: CreateSubmissionMessageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateSubmissionMessageDto)
  message?: CreateSubmissionMessageDto;
}

export class CreateSubmissionDto {
  @ApiProperty({
    description: 'Template id to create the submission from.',
    example: '1000001',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'number' ? String(value) : value,
  )
  @IsString()
  template_id: string;

  @ApiProperty({
    description:
      'Recipients and roles for the signing request. At least one submitter is required.',
    type: [CreateSubmissionSubmitterDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSubmissionSubmitterDto)
  submitters: CreateSubmissionSubmitterDto[];

  @ApiPropertyOptional({
    description:
      'Submission display name. Defaults to the source template name when omitted.',
    example: 'Test Submission Document',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description:
      'Default email delivery flag applied to submitters unless overridden on the submitter.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  send_email?: boolean;

  @ApiPropertyOptional({
    description:
      'Default SMS delivery flag applied to submitters unless overridden on the submitter.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  send_sms?: boolean;

  @ApiPropertyOptional({
    description:
      'Submission-level override for account/template owner auto-sign. When true, Signa adds and completes the configured owner role before sending invitations.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  auto_sign_owner?: boolean;

  @ApiPropertyOptional({
    description:
      'Submission-level owner role override for auto-sign. Defaults to template/account configuration or First Party.',
    example: 'Business',
  })
  @IsOptional()
  @IsString()
  auto_sign_owner_role?: string;

  @ApiPropertyOptional({
    default: 'preserved',
    description:
      'Recipient signing order. preserved keeps the supplied order; random randomizes submitter order.',
    enum: ['preserved', 'random'],
  })
  @IsOptional()
  @IsIn(['preserved', 'random'])
  order?: 'preserved' | 'random';

  @ApiPropertyOptional({
    default: 'preserved',
    description: 'DocuSeal-compatible alias for order.',
    enum: ['preserved', 'random'],
  })
  @IsOptional()
  @IsIn(['preserved', 'random'])
  submitters_order?: 'preserved' | 'random';

  @ApiPropertyOptional({
    description:
      'ISO timestamp when pending submitters expire. Expired submitters cannot continue signing.',
    example: '2026-09-01T12:00:00.000Z',
  })
  @IsOptional()
  @IsString()
  expire_at?: string;

  @ApiPropertyOptional({
    description:
      'Template variables used by dynamic DOCX/HTML content and email variable rendering.',
    example: { client_name: 'Acme Inc.' },
  })
  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Comma-separated or single BCC email address for completed document notifications.',
    example: 'completed@example.com',
  })
  @IsOptional()
  @IsString()
  bcc_completed?: string;

  @ApiPropertyOptional({ example: 'https://example.test/completed' })
  @IsOptional()
  @IsString()
  completed_redirect_url?: string;

  @ApiPropertyOptional({ example: 'reply@example.com' })
  @IsOptional()
  @IsString()
  reply_to?: string;

  @ApiPropertyOptional({ type: CreateSubmissionMessageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateSubmissionMessageDto)
  message?: CreateSubmissionMessageDto;

  @ApiPropertyOptional({
    description:
      'Optional comma-separated includes. Currently supports fields where applicable.',
    example: 'fields',
  })
  @IsOptional()
  @IsString()
  include?: string;
}

export class CreateSubmissionAliasDto {
  @ApiPropertyOptional({ example: '1000001' })
  @IsOptional()
  @IsString()
  template_id?: string;

  @ApiPropertyOptional({ example: ['john@example.com', 'jane@example.com'] })
  @IsOptional()
  emails?: string[] | string;

  @ApiPropertyOptional({ example: 'john@example.com' })
  @IsOptional()
  email?: string[] | string;

  @ApiPropertyOptional({ type: [CreateSubmissionSubmitterDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSubmissionSubmitterDto)
  submitters?: CreateSubmissionSubmitterDto[];

  @ApiPropertyOptional({ example: 'Test Submission Document' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  send_email?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  send_sms?: boolean;

  @ApiPropertyOptional({
    description:
      'Template-submission override for owner auto-sign. When true, Signa completes the configured owner role before invitations are sent.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  auto_sign_owner?: boolean;

  @ApiPropertyOptional({
    description:
      'Template-submission owner role override for auto-sign. Defaults to template/account configuration or First Party.',
    example: 'First Party',
  })
  @IsOptional()
  @IsString()
  auto_sign_owner_role?: string;

  @ApiPropertyOptional({ enum: ['preserved', 'random'], default: 'preserved' })
  @IsOptional()
  @IsIn(['preserved', 'random'])
  order?: 'preserved' | 'random';

  @ApiPropertyOptional({ enum: ['preserved', 'random'], default: 'preserved' })
  @IsOptional()
  @IsIn(['preserved', 'random'])
  submitters_order?: 'preserved' | 'random';

  @ApiPropertyOptional({ example: '2026-09-01T12:00:00.000Z' })
  @IsOptional()
  @IsString()
  expire_at?: string;

  @ApiPropertyOptional({ example: {} })
  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'completed@example.com' })
  @IsOptional()
  @IsString()
  bcc_completed?: string;

  @ApiPropertyOptional({ example: 'https://example.test/completed' })
  @IsOptional()
  @IsString()
  completed_redirect_url?: string;

  @ApiPropertyOptional({ example: 'reply@example.com' })
  @IsOptional()
  @IsString()
  reply_to?: string;

  @ApiPropertyOptional({ type: CreateSubmissionMessageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateSubmissionMessageDto)
  message?: CreateSubmissionMessageDto;

  @ApiPropertyOptional({ example: 'fields' })
  @IsOptional()
  @IsString()
  include?: string;
}

export class CreateSubmissionBatchDto {
  @ApiProperty({ type: [CreateSubmissionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSubmissionDto)
  submissions!: CreateSubmissionDto[];
}
