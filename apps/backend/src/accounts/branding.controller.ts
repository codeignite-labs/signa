import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BrandingService } from '../branding/branding.service';
import { UpdateBrandingDto } from '../branding/branding.dto';
import { JwtGuard } from '../auth/guards/jwt/jwt.guard';
import { AccountHydrationGuard } from '../auth/guards/account-hydration/account-hydration.guard';
import { AdminGuard } from '../auth/guards/admin/admin.guard';
import { CurrentAccount } from '../common/decorators/account.decorator';
import { Account } from './entities/account.entity';

@Controller('account/branding')
@UseGuards(JwtGuard, AccountHydrationGuard)
@ApiBearerAuth()
@ApiTags('Account')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}
  @Get()
  @ApiOperation({
    summary: 'Read current account branding',
    description:
      'Available to every authenticated account member. Does not expose account settings or private data.',
  })
  get(@CurrentAccount() account: Account) {
    return this.branding.get(account.id);
  }
  @Patch()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Save account branding',
    description:
      'Admin only. Send both primary_color and white_label. Existing logo endpoints manage the image.',
  })
  update(@CurrentAccount() account: Account, @Body() input: UpdateBrandingDto) {
    return this.branding.update(account.id, input);
  }
}
