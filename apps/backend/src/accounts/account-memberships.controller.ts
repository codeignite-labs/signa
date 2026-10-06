import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccountMembershipsService } from '../account-memberships/account-memberships.service';
import { AuthService } from '../auth/auth.service';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtGuard } from '../auth/guards/jwt/jwt.guard';

@Controller('account-memberships')
@UseGuards(JwtGuard)
@ApiBearerAuth()
@ApiTags('Accounts')
export class AccountMembershipsController {
  constructor(
    private readonly memberships: AccountMembershipsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.memberships.listAccounts(
      request.session!.trueUserId ?? request.session!.userId,
    );
  }

  @Post(':accountId/accept')
  async accept(
    @Param('accountId') accountId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const user = await this.memberships.accept(
      accountId,
      request.session!.trueUserId ?? request.session!.userId,
    );
    return this.auth.createAuthResponse(user, user.account);
  }

  @Post(':accountId/switch')
  async switch(
    @Param('accountId') accountId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const user = await this.memberships.resolveUser(
      request.session!.trueUserId ?? request.session!.userId,
      accountId,
    );
    if (!user) throw new ForbiddenException('Account membership is required');
    return this.auth.createAuthResponse(user, user.account);
  }
}
