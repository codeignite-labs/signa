import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthenticatedRequest } from '../../authenticated-request';
import { UsersService } from '../../../users/users.service';

@Injectable()
export class UserHydrationGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user) return true;
    const userId = request.session?.userId ?? request.tenant?.userId;

    if (!userId) {
      throw new UnauthorizedException({ error: 'Not authenticated' });
    }

    const user = await this.usersService.findActiveUser(userId, request.tenant?.accountId ?? request.session?.accountId);

    if (!user) {
      throw new UnauthorizedException({ error: 'Not authenticated' });
    }

    request.user = user;
    return true;
  }
}
