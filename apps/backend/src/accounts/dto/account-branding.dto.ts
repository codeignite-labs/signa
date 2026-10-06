import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AccountLogoResponseDto {
  @ApiProperty({ example: '77d8b59b-1741-4c25-b95e-f8cd7a22a302' })
  uuid!: string;

  @ApiProperty({ example: 'logo.png' })
  filename!: string;

  @ApiProperty({ example: 'image/png', nullable: true })
  content_type!: string | null;

  @ApiProperty({ example: 'http://localhost:3001/api/storage/blobs/...' })
  url!: string;
}

export class SigningCertificateResponseDto {
  @ApiProperty()
  is_active!: boolean;

  @ApiProperty({ nullable: true })
  fingerprint_sha256!: string | null;

  @ApiProperty({ example: 'production-cert' })
  name!: string;

  @ApiPropertyOptional({ example: 'certificate.p12' })
  filename?: string;

  @ApiProperty({ example: 'default' })
  status!: 'default' | 'active';

  @ApiProperty({ example: null, nullable: true })
  valid_to!: string | null;

  @ApiProperty({ example: null, nullable: true })
  valid_from!: string | null;

  @ApiProperty({ example: 'CN=Signa, O=Signa, C=US', nullable: true })
  subject!: string | null;

  @ApiProperty({ example: 'CN=Signa Sub-CA, O=Signa, C=US', nullable: true })
  issuer!: string | null;

  @ApiProperty({ example: '4f9d...', nullable: true })
  serial_number!: string | null;
}

export class SigningCertificateListResponseDto {
  @ApiProperty({ type: [SigningCertificateResponseDto] })
  data!: SigningCertificateResponseDto[];

  @ApiProperty({ example: 'https://freetsa.org/tsr', nullable: true })
  timestamp_server_url!: string | null;
}

export class SigningTrustRootResponseDto {
  @ApiProperty({
    description: 'Application-generated trust root identifier.',
    example: '80d5f422-3ef3-4c3e-a17d-e1f4ff2455ef',
  })
  id!: string;

  @ApiProperty({
    description: 'Display name for this uploaded trust root.',
    example: 'Customer Root CA',
  })
  name!: string;

  @ApiProperty({
    description: 'SHA-256 fingerprint of the DER certificate.',
    example: '75f8c0df1d1cbcf482b0f9b6d0f36e8f2e9b5c0a7e...',
  })
  fingerprint_sha256!: string;

  @ApiProperty({
    description: 'X.509 subject distinguished name.',
    example: 'CN=Customer Root CA, O=Customer, C=KE',
  })
  subject!: string;

  @ApiProperty({
    description: 'X.509 issuer distinguished name.',
    example: 'CN=Customer Root CA, O=Customer, C=KE',
  })
  issuer!: string;

  @ApiProperty({
    description: 'Certificate serial number.',
    example: '3f7a91c4',
  })
  serial_number!: string;

  @ApiProperty({
    description: 'Certificate validity start time.',
    example: '2026-07-01T00:00:00.000Z',
  })
  valid_from!: string;

  @ApiProperty({
    description: 'Certificate validity end time.',
    example: '2036-07-01T00:00:00.000Z',
  })
  valid_to!: string;

  @ApiProperty({
    description: 'Whether this trust root is active for verification policy.',
    example: true,
  })
  enabled!: boolean;

  @ApiProperty({
    description: 'Upload time.',
    example: '2026-07-05T08:00:00.000Z',
  })
  created_at!: string;
}

export class SigningTrustRootListResponseDto {
  @ApiProperty({ type: [SigningTrustRootResponseDto] })
  data!: SigningTrustRootResponseDto[];
}
