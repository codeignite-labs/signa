import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class StartFormSubmitterDto {
  @ApiPropertyOptional({
    description: 'Recipient name to prefill on the shared-link submitter.',
    example: 'Ada Lovelace',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description:
      'Recipient email address. Required when the shared-link form asks for email or email verification.',
    example: 'ada@example.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description:
      'Recipient phone number in international format. Required when the shared-link form asks for phone.',
    example: '+14155552671',
  })
  @IsOptional()
  @IsString()
  phone?: string;
}

export class SubmitStartFormDto extends StartFormSubmitterDto {
  @ApiPropertyOptional({
    description:
      'One-time verification code previously sent to the recipient email.',
    example: '123456',
  })
  @IsOptional()
  @IsString()
  one_time_code?: string;
}

export class SendStartFormEmailVerificationDto {
  @ApiProperty({
    description: 'Recipient email address that should receive the code.',
    example: 'ada@example.com',
  })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({
    description: 'Recipient name to store with the eventual submitter.',
    example: 'Ada Lovelace',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Recipient phone number to store with the eventual submitter.',
    example: '+14155552671',
  })
  @IsOptional()
  @IsString()
  phone?: string;
}

export class VerifyStartFormEmailVerificationDto extends StartFormSubmitterDto {
  @ApiProperty({
    description: 'One-time code sent through the email verification endpoint.',
    example: '123456',
  })
  @IsString()
  one_time_code!: string;
}

export class StartFormResponseDto {
  @ApiProperty({ type: Object, description: 'Document owner branding' })
  branding!: import('@repo/shared/branding').AccountBranding;

  @ApiProperty({
    description: 'Account/workspace name displayed on the public start form.',
    example: 'Acme Legal',
  })
  account_name!: string;

  @ApiProperty({
    description: 'Template name shown to recipients before starting.',
    example: 'Mutual NDA',
  })
  template_name!: string;

  @ApiProperty({
    description: 'Whether the template currently exposes a public shared link.',
    example: true,
  })
  shared_link!: boolean;

  @ApiProperty({
    description:
      'Whether the recipient must verify email before receiving a signing link.',
    example: false,
  })
  require_email_2fa!: boolean;

  @ApiProperty({
    description:
      'Contact fields the public start form should collect before opening signing.',
    example: ['email'],
  })
  link_form_fields!: string[];
}

export class StartFormSubmitResponseDto {
  @ApiProperty({
    description: 'Public submitter slug created or reused for signing.',
    example: 'submitter-slug',
  })
  signing_slug!: string;

  @ApiProperty({
    description: 'Frontend route where the recipient can complete signing.',
    example: '/s/submitter-slug',
  })
  signing_url!: string;
}

export class StartFormVerificationResponseDto {
  @ApiProperty({
    description: 'Email address that received the verification code.',
    example: 'ada@example.com',
  })
  email!: string;

  @ApiProperty({
    description: 'Delivery request status for the verification email.',
    example: 'sent',
  })
  status!: 'sent';
}
