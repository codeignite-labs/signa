import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBase64,
  IsOptional,
  IsString,
} from 'class-validator';

export class MergePdfsDto {
  @ApiProperty({
    description:
      'Base64-encoded PDFs to merge in order. At least two files are required.',
    example: ['JVBERi0xLjQKJcfs...', 'JVBERi0xLjQKJcTl...'],
    isArray: true,
  })
  @IsArray()
  @ArrayMinSize(2)
  @IsBase64({}, { each: true })
  files!: string[];
}

export class MergePdfsResponseDto {
  @ApiProperty({
    description: 'Merged PDF returned as a base64-encoded string.',
    example: 'JVBERi0xLjQKJcfs...',
  })
  data!: string;
}

export class VerifyPdfDto {
  @ApiPropertyOptional({
    description:
      'Base64-encoded PDF. Browser clients should prefer multipart file uploads.',
    example: 'JVBERi0xLjQKJcfs...',
  })
  @IsOptional()
  @IsString()
  @IsBase64()
  file?: string;
}

export class VerifyPdfSignatureDto {
  @ApiProperty({
    description:
      'Human-readable verification messages for this signature dictionary.',
    example: ['Signature valid', 'Signed with trusted certificate'],
    type: [String],
  })
  verification_result!: string[];

  @ApiProperty({
    description:
      'True when the PDF signature dictionary uses the PAdES ETSI.CAdES.detached SubFilter.',
  })
  pades_compliant_sub_filter!: boolean;

  @ApiProperty({
    description:
      'True when the signature ByteRange is structurally valid for this PDF.',
  })
  byte_range_valid!: boolean;

  @ApiPropertyOptional({
    description:
      'SHA-256 over the signed ByteRange segments. This is not certificate-chain validation.',
    nullable: true,
  })
  byte_range_sha256!: string | null;

  @ApiProperty({
    description: 'Signer name embedded in the PDF signature dictionary.',
    example: 'Cedrouseroll Omondi',
    nullable: true,
  })
  signer_name!: string | null;

  @ApiProperty({
    description: 'Signing reason embedded in the PDF signature dictionary.',
    example: 'Approved document',
    nullable: true,
  })
  signing_reason!: string | null;

  @ApiProperty({
    description:
      'Signing time from the PDF signature dictionary, formatted as an ISO timestamp when parsable.',
    example: '2026-06-30T12:44:19.000Z',
    nullable: true,
  })
  signing_time!: string | null;

  @ApiProperty({
    description: 'PDF signature SubFilter, for example ETSI.CAdES.detached.',
    example: 'ETSI.CAdES.detached',
    nullable: true,
  })
  signature_type!: string | null;

  @ApiProperty({
    description:
      'True when this signature dictionary is an RFC3161 document timestamp.',
  })
  timestamp_signature!: boolean;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      'Cryptographic validation of the CMS signature timestamp against configured TSA trust anchors; null means absent',
  })
  signature_timestamp_valid!: boolean | null;

  @ApiProperty({
    description:
      'Certificate-chain classification from the CMS signature contents.',
    enum: ['trusted', 'external', 'expired', 'invalid', 'missing'],
    example: 'trusted',
  })
  certificate_chain_status!:
    | 'expired'
    | 'external'
    | 'invalid'
    | 'missing'
    | 'trusted';

  @ApiProperty({
    description:
      'Local certificate policy errors, for example expired certificates or non-CA trust anchors.',
    example: [],
    type: [String],
  })
  certificate_policy_errors!: string[];

  @ApiProperty({
    description:
      'True when the CMS signature value validates over the signed attributes. Null means the CMS object could not be parsed.',
    example: true,
    nullable: true,
  })
  cms_signature_valid!: boolean | null;

  @ApiProperty({
    description:
      'True when the CMS signed messageDigest attribute equals the SHA digest of the PDF ByteRange bytes. Null means no signed attribute check was possible.',
    example: true,
    nullable: true,
  })
  cms_message_digest_valid!: boolean | null;

  @ApiProperty({
    description:
      'Revocation evidence state from embedded OCSP/CRL evidence. Missing means the PDF is not LTV-ready yet.',
    enum: ['good', 'missing', 'revoked', 'unavailable', 'unknown'],
    example: 'missing',
  })
  revocation_status!:
    | 'good'
    | 'missing'
    | 'revoked'
    | 'unavailable'
    | 'unknown';

  @ApiProperty({
    description:
      'Long-term validation state. Valid requires DSS/VRI plus good embedded OCSP/CRL evidence.',
    enum: ['invalid', 'missing', 'valid'],
    example: 'missing',
  })
  ltv_status!: 'invalid' | 'missing' | 'valid';

  @ApiProperty({
    description:
      'Subject name of the Signa or account-uploaded trust root that anchored this chain.',
    example: 'CN=Signa Root CA, O=Signa, C=US',
    nullable: true,
  })
  trust_anchor!: string | null;

  @ApiProperty({
    description: 'SHA-256 fingerprint of the matched trust anchor.',
    example: '75f8c0df1d1cbcf482b0f9b6d0f36e8f2e9b5c0a7e...',
    nullable: true,
  })
  trust_anchor_fingerprint!: string | null;

  @ApiProperty({
    description:
      'Certificates extracted from the CMS signature contents, ordered as embedded by the signer.',
    example: [
      {
        issuer: 'CN=Signa Sub-CA, O=Signa, C=US',
        serial_number: '4f9d...',
        subject: 'CN=Signa, O=Signa, C=US',
        valid_from: '2026-06-30T00:00:00.000Z',
        valid_to: '2126-06-30T00:00:00.000Z',
      },
    ],
    type: [Object],
  })
  certificate_chain!: Array<Record<string, string | null>>;
}

export class VerifyPdfResponseDto {
  @ApiProperty({
    description:
      'Whether the uploaded PDF checksum matches a completed Signa document record.',
    enum: ['verified', 'not_found'],
  })
  checksum_status!: 'verified' | 'not_found';

  @ApiProperty({
    description: 'SHA-256 checksum checked against completed Signa documents.',
  })
  sha256!: string;

  @ApiProperty({ type: VerifyPdfSignatureDto, isArray: true })
  signatures!: VerifyPdfSignatureDto[];

  @ApiProperty({
    description:
      'True when at least one PDF signature has a valid CMS signature over its ByteRange signed attributes.',
    example: true,
  })
  cryptographic_verification!: boolean;
}
