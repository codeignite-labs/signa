import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OAuthAuthService } from './oauth-auth.service';
import { AuthenticatedRequest } from './authenticated-request';
import { ApiTokenRevealResponseDto } from './dto/api-token-response.dto';
it('rotates the API token for the active session account rather than the identity home account', async () => {
  const result = {
    id: 'secondary-token',
    revealed_token: 'new-token',
  } as ApiTokenRevealResponseDto;
  const rotateUserApiToken = jest.fn().mockResolvedValue(result);
  const controller = new AuthController(
    { rotateUserApiToken } as unknown as AuthService,
    {} as OAuthAuthService,
  );
  const request = {
    session: {
      userId: 'shared-identity',
      accountId: 'active-secondary-account',
      role: 'admin',
    },
    user: { accountId: 'original-home-account' },
  } as unknown as AuthenticatedRequest;
  const input = {
    password: 'synthetic-password',
    permissions: ['templates:read'],
  };
  expect(await controller.rotateApiToken(request, input)).toBe(result);
  expect(rotateUserApiToken).toHaveBeenCalledWith(
    'shared-identity',
    input,
    'active-secondary-account',
  );
});
