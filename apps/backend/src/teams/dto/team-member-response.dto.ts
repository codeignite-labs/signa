import { ApiProperty } from '@nestjs/swagger';

export class TeamMemberUserResponseDto {
  @ApiProperty({ description: 'Account user id.', example: '1' })
  id!: string;

  @ApiProperty({
    description: 'User first name.',
    example: 'Ada',
    nullable: true,
  })
  first_name!: string | null;

  @ApiProperty({
    description: 'User last name.',
    example: 'Lovelace',
    nullable: true,
  })
  last_name!: string | null;

  @ApiProperty({
    description: 'User email address.',
    example: 'ada@example.com',
  })
  email!: string;

  @ApiProperty({
    description: 'Account-level role assigned to the user.',
    example: 'admin',
  })
  account_role!: string;
}

export class TeamMemberResponseDto {
  account_id!: string;
  @ApiProperty({ description: 'Team member row id.', example: '1' })
  id!: string;

  @ApiProperty({ description: 'Team id.', example: '1' })
  team_id!: string;

  @ApiProperty({ description: 'Account user id.', example: '1' })
  user_id!: string;

  @ApiProperty({
    description: 'Team-scoped role such as manager or member.',
    example: 'manager',
  })
  role!: string;

  @ApiProperty({
    description: 'Embedded account user details for display.',
    type: TeamMemberUserResponseDto,
  })
  user!: TeamMemberUserResponseDto;

  @ApiProperty({
    description: 'Archive timestamp when membership was removed.',
    example: null,
    nullable: true,
  })
  archived_at!: Date | null;

  @ApiProperty({
    description: 'UTC timestamp when the member was added.',
    example: '2026-06-20T08:00:00.000Z',
  })
  created_at!: Date;
}
