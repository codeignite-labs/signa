import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, Matches, ValidateIf } from 'class-validator';

export class UpdateBrandingDto {
  @ApiProperty({
    nullable: true,
    example: '#27639d',
    description: 'Six-digit RGB hex color; null restores the default theme.',
  })
  @ValidateIf((_object, value: unknown) => value !== null)
  @Matches(/^#[a-fA-F0-9]{6}$/)
  primary_color!: string | null;

  @ApiProperty({
    description:
      'Use the organization identity and hide platform attribution on public forms and emails.',
  })
  @IsBoolean()
  white_label!: boolean;

  @ApiPropertyOptional({
    description: 'Display the account name beside its logo. Defaults to true.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  show_business_name?: boolean;
}
