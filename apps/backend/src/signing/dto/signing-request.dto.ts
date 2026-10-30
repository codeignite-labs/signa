import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateSigningValuesDto {
  @ApiProperty({
    description:
      'Map of field UUID to submitted value. Attachment-backed fields use attachment UUIDs returned by upload endpoints.',
    example: { 'field-uuid': 'Ada Lovelace' },
  })
  @IsObject()
  values!: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Set to true to validate and complete the signing form.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}

export class DeclineSigningDto {
  @ApiPropertyOptional({
    description: 'Optional recipient-supplied reason for declining to sign.',
    example: 'I am not the right signer.',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class SendPhoneVerificationDto {
  @ApiPropertyOptional({
    description:
      'Phone number to validate or verify. Uses E.164 format when available.',
    example: '+14155552671',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Field UUID that requires phone verification.',
    example: 'field-uuid',
  })
  @IsOptional()
  @IsString()
  field_uuid?: string;
}

export class VerifyPhoneCodeDto extends SendPhoneVerificationDto {
  @ApiProperty({
    description: 'One-time phone verification code.',
    example: '123456',
  })
  @IsString()
  code!: string;
}

export class SendEmailVerificationDto {
  @ApiPropertyOptional({
    description: 'Field UUID or flow step that requires email verification.',
    example: 'field-uuid',
  })
  @IsOptional()
  @IsString()
  field_uuid?: string;
}

export class VerifyEmailCodeDto extends SendEmailVerificationDto {
  @ApiProperty({
    description: 'One-time email verification code.',
    example: '123456',
  })
  @IsString()
  code!: string;
}

export class CreatePaymentAttemptDto {
  @ApiProperty({
    description: 'Payment field UUID associated with the provider attempt.',
    example: 'field-uuid',
  })
  @IsString()
  field_uuid!: string;

  @ApiPropertyOptional({
    description: 'Payment provider name.',
    example: 'stripe',
  })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({
    description: 'Provider-side payment intent/session/reference id.',
    example: 'pi_123',
  })
  @IsOptional()
  @IsString()
  provider_reference?: string;

  @ApiPropertyOptional({
    description:
      'Optional pending initialization. Provider outcomes cannot be supplied by the signer.',
    enum: ['pending'],
  })
  @IsOptional()
  @IsIn(['pending'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Raw or normalized payment provider payload.',
    example: { amount: 2500, currency: 'usd' },
    type: Object,
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

export class CreateIdentityVerificationDto {
  @ApiProperty({
    description: 'Identity verification field UUID.',
    example: 'field-uuid',
  })
  @IsString()
  field_uuid!: string;

  @ApiPropertyOptional({
    description: 'Verification method such as kba, document, or phone.',
    example: 'kba',
  })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({
    description: 'Identity verification provider name.',
    example: 'provider',
  })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({
    description: 'Provider-side identity verification reference id.',
    example: 'kyc_123',
  })
  @IsOptional()
  @IsString()
  provider_reference?: string;

  @ApiPropertyOptional({
    description:
      'Optional pending initialization. Verified outcomes require a trusted provider.',
    enum: ['pending'],
  })
  @IsOptional()
  @IsIn(['pending'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Raw or normalized identity provider payload.',
    example: { reason: 'verified_by_provider' },
    type: Object,
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

export class DelegateSigningDto {
  @ApiProperty({
    description: 'Email address of the new recipient.',
    example: 'legal@example.com',
  })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({
    description: 'Optional display name for the delegated recipient.',
    example: 'Legal Reviewer',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Optional phone number for delegated SMS delivery.',
    example: '+14155552671',
  })
  @IsOptional()
  @IsString()
  phone?: string;
}
