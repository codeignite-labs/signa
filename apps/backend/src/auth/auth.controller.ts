import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from './authenticated-request';
import { AuthService } from './auth.service';
import {
  ApiTokenResponseDto,
  ApiTokenRevealResponseDto,
  RevealApiTokenDto,
  RotateApiTokenDto,
  UpdateApiTokenPermissionsDto,
} from './dto/api-token-response.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import {
  OAuthCallbackDto,
  OAuthStartDto,
  OAuthStartResponseDto,
} from './dto/oauth-auth.dto';
import type { OAuthAuthProvider } from './dto/oauth-auth.dto';
import { PasswordResetResponseDto } from './dto/password-reset-response.dto';
import { RegisterDto } from './dto/register.dto';
import { RegistrationStatusDto } from './dto/registration-status.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtGuard } from './guards/jwt/jwt.guard';
import { OAuthAuthService } from './oauth-auth.service';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oauthAuthService: OAuthAuthService,
  ) {}

  @Get('registration-status')
  @ApiOperation({
    description:
      'Returns whether self-service registration is currently available. On-prem deployments default to initial-only registration, matching DocuSeal non-multitenant bootstrap behavior.',
    summary: 'Get registration availability',
  })
  @ApiOkResponse({ type: RegistrationStatusDto })
  registrationStatus(): Promise<RegistrationStatusDto> {
    return this.authService.getRegistrationStatus();
  }

  @Post('register')
  @ApiOperation({
    description:
      'Creates a new account and owner user, then returns the bearer token and hydrated account/user session payload.',
    summary: 'Register a new account',
  })
  @ApiCreatedResponse({ type: AuthResponseDto })
  register(@Body() body: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(body);
  }

  @Post('login')
  @ApiOperation({
    description:
      'Authenticates a user with email/password and optional authenticator OTP when MFA is enabled.',
    summary: 'Login',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  login(@Body() body: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(body);
  }

  @Post('oauth/:provider/start')
  @ApiOperation({
    description:
      'Creates a provider authorization URL for Google sign-in. The response includes a signed state value that the frontend stores and checks on callback before exchanging the authorization code.',
    summary: 'Start OAuth sign-in',
  })
  @ApiOkResponse({ type: OAuthStartResponseDto })
  startOAuth(
    @Param('provider') provider: OAuthAuthProvider,
    @Body() body: OAuthStartDto,
  ): OAuthStartResponseDto {
    return this.oauthAuthService.start(provider, body);
  }

  @Post('oauth/:provider/callback')
  @ApiOperation({
    description:
      'Completes a Google authorization-code callback, validates the provider ID token, creates or reuses the Signa account by verified email, then returns the normal web session payload.',
    summary: 'Complete OAuth sign-in',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  completeOAuth(
    @Param('provider') provider: OAuthAuthProvider,
    @Body() body: OAuthCallbackDto,
  ): Promise<AuthResponseDto> {
    return this.oauthAuthService.complete({
      code: body.code,
      provider,
      state: body.state,
    });
  }

  @Post('forgot-password')
  @ApiOperation({
    description:
      'Queues a password reset email when the account exists. The response is intentionally generic to avoid account enumeration.',
    summary: 'Request password reset',
  })
  @ApiOkResponse({ type: PasswordResetResponseDto })
  forgotPassword(
    @Body() body: ForgotPasswordDto,
  ): Promise<PasswordResetResponseDto> {
    return this.authService.requestPasswordReset(body);
  }

  @Post('reset-password')
  @ApiOperation({
    description:
      'Consumes a password reset token and sets a new password for the associated user.',
    summary: 'Reset password',
  })
  @ApiOkResponse({ type: PasswordResetResponseDto })
  resetPassword(
    @Body() body: ResetPasswordDto,
  ): Promise<PasswordResetResponseDto> {
    return this.authService.resetPassword(body);
  }

  @Get('api-token')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    description:
      'Returns the current user API token metadata, masked token value, selected permissions, last-used time, and revocation status.',
    summary: 'Get current user API token',
  })
  @ApiOkResponse({ type: ApiTokenResponseDto })
  apiToken(@Req() request: AuthenticatedRequest): Promise<ApiTokenResponseDto> {
    return this.authService.getUserApiToken(
      request.session!.userId,
      request.session!.accountId,
    );
  }

  @Post('api-token/reveal')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    description:
      'Reveals the encrypted API token after confirming the current user password.',
    summary: 'Reveal API token',
  })
  @ApiOkResponse({ type: ApiTokenRevealResponseDto })
  revealApiToken(
    @Req() request: AuthenticatedRequest,
    @Body() body: RevealApiTokenDto,
  ): Promise<ApiTokenRevealResponseDto> {
    return this.authService.revealUserApiToken(
      request.session!.userId,
      body.password,
      request.session!.accountId,
    );
  }

  @Post('api-token/rotate')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    description:
      'Rotates the user API token after password confirmation and returns the newly generated token once.',
    summary: 'Rotate API token',
  })
  @ApiOkResponse({ type: ApiTokenRevealResponseDto })
  rotateApiToken(
    @Req() request: AuthenticatedRequest,
    @Body() body: RotateApiTokenDto,
  ): Promise<ApiTokenRevealResponseDto> {
    return this.authService.rotateUserApiToken(request.session!.userId, body);
  }

  @Patch('api-token/permissions')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    description:
      'Updates resource permissions on the current user API token. Permissions are enforced by API-key guards.',
    summary: 'Update API token permissions',
  })
  @ApiOkResponse({ type: ApiTokenResponseDto })
  updateApiTokenPermissions(
    @Req() request: AuthenticatedRequest,
    @Body() body: UpdateApiTokenPermissionsDto,
  ): Promise<ApiTokenResponseDto> {
    return this.authService.updateUserApiTokenPermissions(
      request.session!.userId,
      body,
      request.session!.accountId,
    );
  }
}
