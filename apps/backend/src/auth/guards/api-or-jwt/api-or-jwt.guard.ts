import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRequiredApiTokenPermission } from '../../api-token-permissions';
import { AuthService } from '../../auth.service';
import { AuthenticatedRequest } from '../../authenticated-request';
import { WebSessionJwtPayload } from '../../web-session';

@Injectable()
export class ApiOrJwtGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (await this.tryApiToken(request)) {
      return true;
    }

    if (await this.tryJwt(request)) {
      return true;
    }

    throw new UnauthorizedException({ error: 'Not authenticated' });
  }

  private async tryApiToken(request: AuthenticatedRequest): Promise<boolean> {
    const apiToken = this.getApiToken(request);

    if (!apiToken) {
      return false;
    }

    const tenant = await this.authService.resolveApiToken(apiToken);

    if (!tenant) {
      return false;
    }

    request.tenant = tenant;
    const requiredPermission = getRequiredApiTokenPermission(request);

    if (
      requiredPermission &&
      !tenant.apiTokenPermissions?.includes(requiredPermission)
    ) {
      throw new ForbiddenException({ error: 'API token is not permitted' });
    }

    return true;
  }

  private async tryJwt(request: AuthenticatedRequest): Promise<boolean> {
    const token = this.getBearerToken(request);

    if (!token) {
      return false;
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<WebSessionJwtPayload>(token);
      const user = await this.authService.resolveSessionUser(payload);
      if (!user) return false;
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
      return true;
    } catch {
      return false;
    }
  }

  private getApiToken(request: AuthenticatedRequest): string | null {
    const headerValue = request.headers['x-auth-token'];

    if (Array.isArray(headerValue)) {
      return headerValue[0] ?? null;
    }

    return headerValue ?? null;
  }

  private getBearerToken(request: AuthenticatedRequest): string | null {
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      return null;
    }

    return authorization.slice('Bearer '.length);
  }
}
