import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync, sign } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { OAuthAuthService } from './oauth-auth.service';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const config = {
  GOOGLE_AUTH_CLIENT_ID: 'test-client',
  GOOGLE_AUTH_CLIENT_SECRET: 'test-secret',
  GOOGLE_AUTH_REDIRECT_URI: 'http://localhost:3000/auth/oauth/google/callback',
  JWT_SECRET: 'test-state-secret',
};

describe('Google OAuth', () => {
  const user = { id: 1, email: 'alex@example.invalid', account: { id: 1 } };
  const login = jest.fn().mockResolvedValue({ token: 'session' });
  const findOne = jest.fn().mockResolvedValue(user);
  let service: OAuthAuthService;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OAuthAuthService(
      { createLoginResponse: login } as unknown as AuthService,
      new ConfigService(config),
      { getRepository: () => ({ findOne }) } as unknown as DataSource,
      new JwtService(),
    );
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  function mockToken(state: string, overrides: Record<string, unknown> = {}) {
    const payload = JSON.parse(
      Buffer.from(state.split('.')[0], 'base64url').toString(),
    ) as { nonce: string };
    const header = Buffer.from(
      JSON.stringify({ alg: 'RS256', kid: 'test-key' }),
    ).toString('base64url');
    const claims = Buffer.from(
      JSON.stringify({
        aud: config.GOOGLE_AUTH_CLIENT_ID,
        iss: 'https://accounts.google.com',
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce: payload.nonce,
        email: 'Alex@example.invalid',
        email_verified: true,
        ...overrides,
      }),
    ).toString('base64url');
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(`${header}.${claims}`),
      privateKey,
    ).toString('base64url');
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id_token: `${header}.${claims}.${signature}` }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key' }],
          }),
        ),
      );
  }

  it('uses the configured callback and signed state for Google authorization', () => {
    const result = service.start('google', { mode: 'login' });
    const url = new URL(result.url);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe(
      config.GOOGLE_AUTH_REDIRECT_URI,
    );
    expect(url.searchParams.get('state')).toBe(result.state);
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });

  it('returns the existing user session after validating a signed Google token', async () => {
    const { state } = service.start('google', {});
    mockToken(state);
    await expect(
      service.complete({ provider: 'google', code: 'test-code', state }),
    ).resolves.toEqual({ token: 'session' });
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'alex@example.invalid' } }),
    );
    expect(login).toHaveBeenCalledWith(user);
  });

  it.each([
    { aud: 'another-client' },
    { iss: 'https://attacker.example' },
    { exp: 1 },
    { nonce: 'another-request' },
    { email_verified: false },
    { email_verified: undefined },
  ])('rejects invalid identity claims: %j', async (claims) => {
    const { state } = service.start('google', {});
    mockToken(state, claims);
    await expect(
      service.complete({ provider: 'google', code: 'test-code', state }),
    ).rejects.toThrow();
    expect(login).not.toHaveBeenCalled();
  });

  it('rejects tampered state before contacting Google', async () => {
    const { state } = service.start('google', {});
    await expect(
      service.complete({
        provider: 'google',
        code: 'test-code',
        state: `${state}x`,
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects Microsoft as an unsupported provider', () => {
    expect(() => service.start('microsoft' as 'google', {})).toThrow(
      BadRequestException,
    );
  });
});
