import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountMembershipsService } from '../../../account-memberships/account-memberships.service';
import { AuthenticatedRequest } from '../../authenticated-request';
import { WebSessionJwtPayload } from '../../web-session';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly memberships: AccountMembershipsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.getBearerToken(request);

    if (!token) {
      throw new UnauthorizedException({ error: 'Not authenticated' });
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<WebSessionJwtPayload>(token);
      const user = await this.memberships.resolveUser(
        payload.userId,
        payload.accountId,
      );
      if (!user) throw new UnauthorizedException();
      request.user = user;
      request.session = {
        userId: payload.userId,
        accountId: payload.accountId,
        isTestMode: payload.isTestMode,
        role: user.role,
        teamId: payload.teamId,
        trueAccountId: payload.trueAccountId,
        trueUserId: payload.trueUserId,
      };
    } catch {
      throw new UnauthorizedException({ error: 'Not authenticated' });
    }

    return true;
  }

  private getBearerToken(request: AuthenticatedRequest): string | null {
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      return null;
    }

    return authorization.slice('Bearer '.length);
  }
}
