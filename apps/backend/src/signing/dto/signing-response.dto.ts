import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SigningPreviewImageDto {
  @ApiProperty({ description: 'Preview image blob id.', example: '22' })
  id!: string;

  @ApiProperty({
    description: 'Signed URL for this page preview image.',
    example: 'http://localhost:3001/api/storage/blobs/...',
  })
  url!: string;

  @ApiProperty({ description: 'Preview image filename.', example: '0.png' })
  filename!: string;

  @ApiProperty({
    description: 'Image metadata such as width and height.',
    example: { width: 1400, height: 1800 },
  })
  metadata!: Record<string, unknown>;
}

export class SigningDocumentDto {
  @ApiProperty({ description: 'Document id.', example: '21' })
  id!: string;

  @ApiProperty({
    description: 'Document UUID used by template schema and fields.',
    example: 'a453be1e-ad7c-4001-8521-ca90d0920956',
  })
  uuid!: string;

  @ApiProperty({
    description: 'Original or generated filename.',
    example: 'contract.pdf',
  })
  filename!: string;

  @ApiProperty({ description: 'Document display name.', example: 'Contract' })
  name!: string;

  @ApiProperty({
    description: 'Signed URL for the source or generated PDF document.',
    example: 'http://localhost:3001/api/storage/blobs/...',
  })
  url!: string;

  @ApiProperty({
    description: 'Rendered page previews used by the signing UI.',
    type: [SigningPreviewImageDto],
  })
  preview_images!: SigningPreviewImageDto[];
}

export class SigningSubmitterDto {
  @ApiProperty({ description: 'Submitter id.', example: '1' })
  id!: string;

  @ApiProperty({
    description: 'Public signing slug.',
    example: 'pAMimKcyrLjqVt',
  })
  slug!: string;

  @ApiProperty({
    description: 'Stable submitter UUID.',
    example: '884d545b-3396-49f1-8c07-05b8b2a78755',
  })
  uuid!: string;

  @ApiPropertyOptional({
    description: 'Recipient name.',
    example: 'Ada Lovelace',
    nullable: true,
  })
  name!: string | null;

  @ApiPropertyOptional({
    description: 'Recipient email address.',
    example: 'ada@example.com',
    nullable: true,
  })
  email!: string | null;

  @ApiProperty({
    description: 'Template role this submitter is signing as.',
    example: 'First Party',
  })
  role!: string;

  @ApiPropertyOptional({
    description: 'Completion timestamp, or null while pending.',
    example: null,
    nullable: true,
  })
  completed_at!: Date | null;

  @ApiPropertyOptional({
    description: 'Decline timestamp, or null when not declined.',
    example: null,
    nullable: true,
  })
  declined_at!: Date | null;
}

export class SigningAttachmentDto {
  @ApiProperty({
    description: 'Attachment UUID used as the field value.',
    example: '77d8b59b-1741-4c25-b95e-f8cd7a22a302',
  })
  uuid!: string;

  @ApiProperty({
    description: 'Stored attachment filename.',
    example: 'signature.png',
  })
  filename!: string;

  @ApiProperty({
    description: 'Attachment MIME type.',
    example: 'image/png',
  })
  content_type!: string | null;

  @ApiProperty({
    description: 'Signed URL for downloading or previewing the attachment.',
    example: 'http://localhost:3001/api/storage/blobs/...',
  })
  url!: string;
}

export class SigningFormCompletedMessageDto {
  @ApiPropertyOptional({ example: 'Thank you' })
  title?: string;

  @ApiPropertyOptional({ example: 'Your document has been completed.' })
  body?: string;
}

export class SigningFormCompletedButtonDto {
  @ApiPropertyOptional({ example: 'Back to website' })
  title?: string;

  @ApiPropertyOptional({ example: 'https://example.com' })
  url?: string;
}

export class SigningFormConfigDto {
  @ApiProperty({ example: false })
  with_confetti!: boolean;

  @ApiProperty({ example: true })
  with_typed_signature!: boolean;

  @ApiProperty({ example: true })
  with_decline!: boolean;

  @ApiProperty({ example: false })
  with_delegate!: boolean;

  @ApiProperty({ example: false })
  require_signing_reason!: boolean;

  @ApiProperty({ example: false })
  with_signature_id!: boolean;

  @ApiProperty({ example: true })
  prefill_signature!: boolean;

  @ApiProperty({ example: true })
  download_links_expire!: boolean;

  @ApiProperty({ example: false })
  download_links_auth!: boolean;

  @ApiProperty({ example: false })
  combine_pdf_result!: boolean;

  @ApiProperty({ example: true })
  flatten_result_pdf!: boolean;

  @ApiProperty({ example: false })
  force_mfa!: boolean;

  @ApiProperty({ type: SigningFormCompletedMessageDto })
  completed_message!: SigningFormCompletedMessageDto;

  @ApiProperty({ type: SigningFormCompletedButtonDto })
  completed_button!: SigningFormCompletedButtonDto;

  @ApiPropertyOptional({ example: '[Privacy Policy](https://example.com)' })
  policy_links?: string;
}

export class SigningResponseDto {
  @ApiProperty({ type: Object, description: 'Document owner branding' })
  branding!: import('@repo/shared/branding').AccountBranding;

  @ApiProperty({ example: '1' })
  submission_id!: string;

  @ApiProperty({ example: 'fw8ben-ced' })
  title!: string;

  @ApiProperty({ type: SigningSubmitterDto })
  submitter!: SigningSubmitterDto;

  @ApiProperty({ type: [SigningDocumentDto] })
  documents!: SigningDocumentDto[];

  @ApiProperty({ example: [] })
  fields!: Record<string, unknown>[];

  @ApiProperty({ example: {} })
  values!: Record<string, unknown>;

  @ApiProperty({ example: {} })
  readonly_values!: Record<string, unknown>;

  @ApiProperty({ type: [SigningAttachmentDto] })
  attachments!: SigningAttachmentDto[];

  @ApiProperty({ type: SigningFormConfigDto })
  configs!: SigningFormConfigDto;
}

export class SigningDownloadResponseDto {
  @ApiProperty({ type: [SigningDocumentDto] })
  documents!: SigningDocumentDto[];
}

export class SigningFieldValueResponseDto {
  @ApiPropertyOptional({
    example: '77d8b59b-1741-4c25-b95e-f8cd7a22a302',
    nullable: true,
  })
  value!: unknown;

  @ApiPropertyOptional({ type: SigningAttachmentDto, nullable: true })
  attachment!: SigningAttachmentDto | null;
}
