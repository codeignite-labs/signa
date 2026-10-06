import { ApiProperty } from '@nestjs/swagger';

export class UserResponseDto {
  membership_status?: string;
  shared_identity?: boolean;
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'Ada' })
  first_name!: string | null;

  @ApiProperty({ example: 'Lovelace' })
  last_name!: string | null;

  @ApiProperty({ example: 'ada@example.com' })
  email!: string;

  @ApiProperty({ example: 'admin' })
  role!: string;

  @ApiProperty({ example: false })
  otp_required_for_login!: boolean;

  @ApiProperty({ example: null, nullable: true })
  archived_at!: Date | null;
}
