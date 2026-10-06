import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type OAuthProviderConfig = {
  authorizationEndpoint: string;
  clientId: string;
  clientSecret: string;
  issuer: 'google';
  jwksUri: string;
  redirectUri: string;
  scopes: string[];
  tokenEndpoint: string;
  userinfoEndpoint: string;
};

export function googleOAuthConfig(
  configService: ConfigService,
): OAuthProviderConfig {
  const clientId = configService.get<string>('GOOGLE_AUTH_CLIENT_ID', '');
  const clientSecret = configService.get<string>(
    'GOOGLE_AUTH_CLIENT_SECRET',
    '',
  );
  const redirectUri = configService.get<string>('GOOGLE_AUTH_REDIRECT_URI', '');
  if (!clientId || !clientSecret || !redirectUri) {
    throw new ServiceUnavailableException({
      error:
        'Google sign-in is not configured. Set GOOGLE_AUTH_CLIENT_ID, GOOGLE_AUTH_CLIENT_SECRET, and GOOGLE_AUTH_REDIRECT_URI on the backend.',
    });
  }
  return {
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    clientId,
    clientSecret,
    redirectUri,
    issuer: 'google',
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    scopes: ['openid', 'email', 'profile'],
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    userinfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
  };
}
