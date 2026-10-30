import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { PdfSignatureService } from '../pdf-signatures/pdf-signature.service';
import { PdfTrustRootService } from '../pdf-signatures/pdf-trust-root.service';
import { StorageService } from '../storage/storage.service';
import { User } from '../users/entities/user.entity';
import { AccountsService } from './accounts.service';
import { AccountConfig } from './entities/account-config.entity';
import { AccountLinkedAccount } from './entities/account-linked-account.entity';
import { Account } from './entities/account.entity';
import { EncryptedConfig } from './entities/encrypted-config.entity';
function setup(options: Record<string, unknown> = {}) {
  const accounts = {
    findOneByOrFail: jest
      .fn()
      .mockResolvedValue(Object.assign(new Account(), { id: 'tenant' })),
  };
  const encrypted = {
    find: jest
      .fn<Promise<EncryptedConfig[]>, [unknown]>()
      .mockResolvedValue([]),
    findOne: jest
      .fn<Promise<EncryptedConfig | null>, [unknown]>()
      .mockResolvedValue(null),
    create: jest.fn((value: Partial<EncryptedConfig>) =>
      Object.assign(new EncryptedConfig(), value),
    ),
    save: jest.fn((value: EncryptedConfig) => Promise.resolve(value)),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AccountsService(
    accounts as unknown as Repository<Account>,
    {} as Repository<AccountConfig>,
    {} as Repository<AccountLinkedAccount>,
    {} as Repository<User>,
    encrypted as unknown as Repository<EncryptedConfig>,
    {} as DataSource,
    {} as StorageService,
    new ConfigService({
      GMAIL_OAUTH_CLIENT_ID: 'test-client',
      GMAIL_OAUTH_CLIENT_SECRET: 'test-secret',
      GMAIL_OAUTH_REDIRECT_URI: 'https://sign.example.test/callback',
      ...options,
    }),
    {} as MailService,
    {} as PdfSignatureService,
    {} as PdfTrustRootService,
  );
  return { service, encrypted };
}
function stored(value: unknown) {
  return Object.assign(new EncryptedConfig(), {
    accountId: 'tenant',
    key: 'email_integration:gmail',
    value: typeof value === 'string' ? value : JSON.stringify(value),
  });
}
let fetchSpy: jest.SpiedFunction<typeof fetch>;
beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch');
});
afterEach(() => jest.restoreAllMocks());
it('builds a Google consent URL with offline Gmail send scope and no client secret', async () => {
  const { service } = setup();
  const result = await service.startEmailIntegrationConnect('tenant', 'gmail');
  expect(result).toMatchObject({
    provider: 'gmail',
    configured: true,
    connected: false,
  });
  const url = new URL(result.url!);
  expect(url.origin + url.pathname).toBe(
    'https://accounts.google.com/o/oauth2/v2/auth',
  );
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    client_id: 'test-client',
    redirect_uri: 'https://sign.example.test/callback',
    response_type: 'code',
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
  });
  expect(url.searchParams.get('scope')).toContain(
    'https://www.googleapis.com/auth/gmail.send',
  );
  expect(url.searchParams.has('client_secret')).toBe(false);
  expect(
    JSON.parse(
      Buffer.from(url.searchParams.get('state')!, 'base64url').toString(),
    ) as unknown,
  ).toMatchObject({
    provider: 'gmail',
    timestamp: expect.any(Number) as unknown,
  });
});
it.each([
  'GMAIL_OAUTH_CLIENT_ID',
  'GMAIL_OAUTH_CLIENT_SECRET',
  'GMAIL_OAUTH_REDIRECT_URI',
])(
  'reports an incomplete %s configuration and rejects callback completion',
  async (key) => {
    const { service } = setup({ [key]: '' });
    expect(
      await service.startEmailIntegrationConnect('tenant', 'gmail'),
    ).toEqual({
      provider: 'gmail',
      configured: false,
      connected: false,
      url: null,
    });
    await expect(
      service.completeEmailIntegrationConnect('tenant', 'gmail', 'code'),
    ).rejects.toMatchObject({ status: 422 });
    expect(fetchSpy).not.toHaveBeenCalled();
  },
);
it('exchanges the code, fetches identity and stores private token data without returning it to clients', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  const { service, encrypted } = setup();
  fetchSpy
    .mockResolvedValueOnce(
      Response.json({
        access_token: 'private-access-token',
        refresh_token: 'private-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'email',
      }),
    )
    .mockResolvedValueOnce(Response.json({ email: 'connected@example.test' }));
  expect(
    await service.completeEmailIntegrationConnect(
      'tenant',
      'gmail',
      'one-time-code',
    ),
  ).toMatchObject({
    provider: 'gmail',
    name: 'Gmail',
    connected: true,
    configured: true,
    email: 'connected@example.test',
  });
  const [tokenUrl, tokenRequest] = fetchSpy.mock.calls[0];
  expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
  expect(tokenRequest?.method).toBe('POST');
  expect(Object.fromEntries(tokenRequest?.body as URLSearchParams)).toEqual({
    client_id: 'test-client',
    client_secret: 'test-secret',
    code: 'one-time-code',
    grant_type: 'authorization_code',
    redirect_uri: 'https://sign.example.test/callback',
  });
  expect(fetchSpy.mock.calls[1]).toEqual([
    'https://openidconnect.googleapis.com/v1/userinfo',
    { headers: { Authorization: 'Bearer private-access-token' } },
  ]);
  expect(encrypted.findOne).toHaveBeenCalledWith({
    where: { accountId: 'tenant', key: 'email_integration:gmail' },
  });
  const saved = encrypted.save.mock.calls[0][0];
  expect(JSON.parse(saved.value) as unknown).toMatchObject({
    access_token: 'private-access-token',
    refresh_token: 'private-refresh-token',
    expires_at: new Date(4_600_000).toISOString(),
    scope: 'email',
  });
  encrypted.find.mockResolvedValue([saved]);
  const listed = await service.listEmailIntegrations('tenant');
  expect(listed.data).toHaveLength(1);
  expect(JSON.stringify(listed)).not.toContain('private-access-token');
  expect(JSON.stringify(listed)).not.toContain('private-refresh-token');
});
it.each([
  [Response.json({ error: 'denied' }, { status: 400 }), 'Failed to connect'],
  [new Response('not-json'), 'Failed to connect'],
  [Response.json([]), 'Failed to connect'],
  [Response.json({ access_token: 123 }), 'Missing gmail access token'],
  [Response.json({}), 'Missing gmail access token'],
])(
  'rejects invalid OAuth token replies without storing credentials',
  async (response, message) => {
    const { service, encrypted } = setup();
    fetchSpy.mockResolvedValue(response.clone());
    await expect(
      service.completeEmailIntegrationConnect('tenant', 'gmail', 'code'),
    ).rejects.toMatchObject({
      response: { error: expect.stringContaining(message) as unknown },
    });
    expect(encrypted.save).not.toHaveBeenCalled();
  },
);
it.each([
  [
    Response.json({ preferred_username: 'fallback@example.test' }),
    'fallback@example.test',
  ],
  [Response.json({ email: 42, preferred_username: false }), null],
  [Response.json({ error: 'denied' }, { status: 403 }), null],
  [new Response('invalid-json'), null],
  [Response.json([]), null],
])(
  'handles optional identity responses without discarding an authorized connection',
  async (response, email) => {
    const { service, encrypted } = setup();
    const previous = stored({ email: 'old@example.test' });
    encrypted.findOne.mockResolvedValue(previous);
    fetchSpy
      .mockResolvedValueOnce(Response.json({ access_token: 'private-token' }))
      .mockResolvedValueOnce(response.clone());
    const result = await service.completeEmailIntegrationConnect(
      'tenant',
      'gmail',
      'code',
    );
    expect(result).toMatchObject({ connected: true, email });
    expect(encrypted.create).not.toHaveBeenCalled();
    expect(encrypted.save.mock.calls[0][0]).toBe(previous);
    expect(JSON.parse(previous.value) as unknown).toMatchObject({
      refresh_token: null,
      expires_at: null,
      scope: null,
    });
  },
);
it.each(['invalid-json', '[]', '{}', '{"email":42,"connected_at":false}'])(
  'lists corrupt stored metadata %s without exposing a parser error',
  async (value) => {
    const { service, encrypted } = setup();
    encrypted.find.mockResolvedValue([stored(value)]);
    expect((await service.listEmailIntegrations('tenant')).data).toEqual([
      {
        provider: 'gmail',
        name: 'Gmail',
        configured: true,
        connected: true,
        email: null,
        connected_at: null,
      },
    ]);
  },
);
it('disconnects the tenant-owned provider and is idempotent when no connection exists', async () => {
  const { service, encrypted } = setup();
  const previous = stored({
    email: 'connected@example.test',
    connected_at: '2026-01-01',
  });
  encrypted.findOne.mockResolvedValueOnce(previous);
  expect(
    await service.disconnectEmailIntegration('tenant', 'gmail'),
  ).toMatchObject({ connected: false, email: null, connected_at: null });
  expect(encrypted.remove).toHaveBeenCalledWith(previous);
  encrypted.remove.mockClear();
  await service.disconnectEmailIntegration('tenant', 'gmail');
  expect(encrypted.remove).not.toHaveBeenCalled();
  await expect(
    service.disconnectEmailIntegration('tenant', 'microsoft'),
  ).rejects.toMatchObject({ status: 404 });
});
