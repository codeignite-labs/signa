import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { Account } from '../../src/accounts/entities/account.entity';
import { AuthService } from '../../src/auth/auth.service';
import { OAuthAuthService } from '../../src/auth/oauth-auth.service';
import { Team } from '../../src/teams/entities/team.entity';
import { TeamMember } from '../../src/teams/entities/team-member.entity';
import { User } from '../../src/users/entities/user.entity';

const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const oauthConfig = {
  GOOGLE_AUTH_CLIENT_ID: 'edge-client',
  GOOGLE_AUTH_CLIENT_SECRET: 'edge-secret',
  GOOGLE_AUTH_REDIRECT_URI: 'https://signa.example/auth/oauth/google/callback',
  JWT_SECRET: 'edge-state-secret',
  REGISTRATION_MODE: 'open',
};
function repository<T extends object>(id: string) {
  return {
    findOne: jest.fn<Promise<T | null>, unknown[]>().mockResolvedValue(null),
    count: jest.fn<Promise<number>, []>().mockResolvedValue(0),
    create: jest.fn((input: Partial<T>) => input),
    save: jest.fn((input: Partial<T>) =>
      Promise.resolve({ ...input, id } as T),
    ),
  };
}
export function oauthFixture() {
  const accounts = repository<Account>('account');
  const users = repository<User>('user');
  const teams = repository<Team>('team');
  const members = repository<TeamMember>('member');
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Account) return accounts;
      if (entity === Team) return teams;
      if (entity === TeamMember) return members;
      return users;
    }),
  };
  const transaction = jest.fn(
    (callback: (manager: EntityManager) => Promise<unknown>) =>
      callback(manager as unknown as EntityManager),
  );
  const login = jest.fn().mockResolvedValue({ access_token: 'session' });
  const service = new OAuthAuthService(
    { createLoginResponse: login } as unknown as AuthService,
    new ConfigService(oauthConfig),
    {
      getRepository: manager.getRepository,
      transaction,
    } as unknown as DataSource,
    new JwtService(),
  );
  const fetch = jest.spyOn(global, 'fetch');
  return {
    accounts,
    users,
    teams,
    members,
    transaction,
    login,
    service,
    fetch,
  };
}
export function signedState(overrides: Record<string, unknown> = {}) {
  const payload = Buffer.from(
    JSON.stringify({
      issued_at: Date.now(),
      nonce: 'nonce',
      mode: 'login',
      provider: 'google',
      ...overrides,
    }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', oauthConfig.JWT_SECRET).update(payload).digest('base64url')}`;
}
export function signedIdToken(
  state: string,
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = { alg: 'RS256', kid: 'key' },
) {
  const { nonce } = JSON.parse(
    Buffer.from(state.split('.')[0], 'base64url').toString(),
  ) as { nonce: string };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    'base64url',
  );
  const encodedClaims = Buffer.from(
    JSON.stringify({
      aud: oauthConfig.GOOGLE_AUTH_CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 300,
      nonce,
      iss: 'https://accounts.google.com',
      email: 'Casey@example.test',
      email_verified: true,
      ...claims,
    }),
  ).toString('base64url');
  return signTokenParts(encodedHeader, encodedClaims);
}
export function signTokenParts(header: string, claims: string) {
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${claims}`),
    key.privateKey,
  ).toString('base64url');
  return `${header}.${claims}.${signature}`;
}
export function providerKeys() {
  return { keys: [{ ...key.publicKey.export({ format: 'jwk' }), kid: 'key' }] };
}
export function mockOAuthToken(
  fixture: ReturnType<typeof oauthFixture>,
  state: string,
  claims: Record<string, unknown> = {},
) {
  fixture.fetch
    .mockResolvedValueOnce(
      Response.json({ id_token: signedIdToken(state, claims) }),
    )
    .mockResolvedValueOnce(Response.json(providerKeys()));
}
export function completeOAuth(
  fixture: ReturnType<typeof oauthFixture>,
  state: string,
) {
  return fixture.service.complete({
    provider: 'google',
    code: 'authorization-code',
    state,
  });
}
