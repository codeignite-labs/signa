import {
  Controller,
  MessageEvent,
  Query,
  Sse,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { from, mergeMap, Observable } from 'rxjs';
import type { WebSessionJwtPayload } from '../auth/web-session';
import { UsersService } from '../users/users.service';
import { RealtimeService } from './realtime.service';

@Controller('realtime')
@ApiTags('Realtime')
export class RealtimeController {
  constructor(
    private readonly jwtService: JwtService,
    private readonly realtime: RealtimeService,
    private readonly usersService: UsersService,
  ) {}

  @Sse('stream')
  @ApiOperation({
    description:
      'Opens an authenticated Server-Sent Events stream for live updates on templates, submissions, webhooks, and account-scoped activity.',
    summary: 'Open realtime event stream',
  })
  @ApiQuery({
    description: 'Short-lived web session JWT used to authenticate the stream.',
    name: 'token',
    required: true,
  })
  @ApiQuery({
    description: 'Optional template id scope for template-related events.',
    name: 'template_id',
    required: false,
  })
  @ApiQuery({
    description: 'Optional submission id scope for submission-related events.',
    name: 'submission_id',
    required: false,
  })
  @ApiQuery({
    description: 'Optional webhook URL id scope for webhook delivery events.',
    name: 'webhook_url_id',
    required: false,
  })
  @ApiQuery({
    description: 'Optional logical stream scope such as templates or webhooks.',
    name: 'scope',
    required: false,
  })
  @ApiOkResponse({
    description:
      'SSE stream. Each event contains a realtime event name and JSON payload.',
  })
  stream(
    @Query('token') token?: string,
    @Query('template_id') templateId?: string,
    @Query('submission_id') submissionId?: string,
    @Query('webhook_url_id') webhookUrlId?: string,
    @Query('scope') scope?: string,
  ): Observable<MessageEvent> {
    return from(this.authenticate(token)).pipe(
      mergeMap((user) =>
        this.realtime.stream(user.accountId, {
          scope,
          submissionId,
          templateId,
          webhookUrlId,
        }),
      ),
    );
  }

  private async authenticate(token?: string) {
    if (!token) {
      throw new UnauthorizedException({ error: 'Not authenticated' });
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<WebSessionJwtPayload>(token);
      const user = await this.usersService.findActiveUser(payload.userId, payload.accountId);

      if (!user || user.accountId !== payload.accountId) {
        throw new Error('Invalid realtime token');
      }

      return user;
    } catch {
      throw new UnauthorizedException({ error: 'Not authenticated' });
    }
  }
}
