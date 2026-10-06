import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AccountEmailIntegrationResponseDto {
  @ApiProperty({ example: 'gmail' })
  provider!: 'gmail';

  @ApiProperty({ example: 'Gmail' })
  name!: string;

  @ApiProperty({ example: false })
  connected!: boolean;

  @ApiProperty({ example: true })
  configured!: boolean;

  @ApiPropertyOptional({ example: 'ada@example.com', nullable: true })
  email!: string | null;

  @ApiPropertyOptional({ example: '2026-06-21T08:00:00.000Z', nullable: true })
  connected_at!: string | null;
}

export class AccountEmailIntegrationListResponseDto {
  @ApiProperty({ type: [AccountEmailIntegrationResponseDto] })
  data!: AccountEmailIntegrationResponseDto[];
}

export class AccountEmailIntegrationConnectResponseDto {
  @ApiProperty({ example: 'gmail' })
  provider!: 'gmail';

  @ApiProperty({ example: false })
  connected!: boolean;

  @ApiProperty({ example: true })
  configured!: boolean;

  @ApiProperty({
    example: 'https://accounts.google.com/o/oauth2/v2/auth?...',
    nullable: true,
  })
  url!: string | null;
}

export class CompleteAccountEmailIntegrationDto {
  @ApiProperty({ example: '4/0Ab...' })
  @IsString()
  code!: string;

  @ApiPropertyOptional({ example: 'eyJwcm92aWRlciI6ImdtYWlsIn0' })
  @IsOptional()
  @IsString()
  state?: string;
}
