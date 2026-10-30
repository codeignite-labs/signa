import {
  completeOAuth,
  mockOAuthToken,
  oauthConfig,
  oauthFixture,
  providerKeys,
  signedIdToken,
  signedState,
  signTokenParts,
} from '../../test/support/oauth-auth.fixture';
let fixture: ReturnType<typeof oauthFixture>;
beforeEach(() => {
  fixture = oauthFixture();
});
afterEach(() => jest.restoreAllMocks());
it.each(['', '.signature', 'payload.', 'a.b.c', 'payload.wrong'])(
  'rejects malformed state %s before contacting the provider',
  async (state) => {
    await expect(completeOAuth(fixture, state)).rejects.toMatchObject({
      status: 401,
      response: { error: 'Invalid OAuth state' },
    });
    expect(fixture.fetch).not.toHaveBeenCalled();
  },
);
it('rejects a same-length altered state signature using constant-time comparison', async () => {
  const state = signedState();
  const signature = state.split('.')[1];
  const tampered = `${state.split('.')[0]}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;
  await expect(completeOAuth(fixture, tampered)).rejects.toMatchObject({
    status: 401,
  });
  expect(fixture.fetch).not.toHaveBeenCalled();
});
it.each([
  { issued_at: null },
  { issued_at: Date.now() + 60_000 },
  { issued_at: Date.now() - 11 * 60_000 },
  { provider: 'microsoft' },
])('rejects expired or invalid state claims %j', async (claims) => {
  await expect(
    completeOAuth(fixture, signedState(claims)),
  ).rejects.toMatchObject({ response: { error: 'OAuth state expired' } });
  expect(fixture.fetch).not.toHaveBeenCalled();
});
it('rejects a failed authorization-code exchange', async () => {
  fixture.fetch.mockResolvedValueOnce(new Response('', { status: 400 }));
  await expect(completeOAuth(fixture, signedState())).rejects.toMatchObject({
    response: { error: 'OAuth token exchange failed' },
  });
  expect(fixture.login).not.toHaveBeenCalled();
});
it('rejects a token response without an ID token', async () => {
  fixture.fetch.mockResolvedValueOnce(
    Response.json({ access_token: 'access-only' }),
  );
  await expect(completeOAuth(fixture, signedState())).rejects.toMatchObject({
    response: { error: 'OAuth provider did not return an ID token' },
  });
});
it.each(['a.b', '.b.c', 'a..c', 'a.b.'])(
  'rejects malformed ID token %s',
  async (id_token) => {
    fixture.fetch.mockResolvedValueOnce(Response.json({ id_token }));
    await expect(completeOAuth(fixture, signedState())).rejects.toMatchObject({
      response: { error: 'Invalid OAuth ID token' },
    });
  },
);
it.each([{ alg: 'HS256', kid: 'key' }, { alg: 'RS256' }])(
  'rejects unsupported token headers %j before looking up keys',
  async (header) => {
    const state = signedState();
    fixture.fetch.mockResolvedValueOnce(
      Response.json({ id_token: signedIdToken(state, {}, header) }),
    );
    await expect(completeOAuth(fixture, state)).rejects.toMatchObject({
      response: { error: 'Unsupported OAuth ID token signature' },
    });
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
  },
);
it('rejects malformed JSON in a JWT header', async () => {
  fixture.fetch.mockResolvedValueOnce(
    Response.json({ id_token: 'eA.payload.signature' }),
  );
  await expect(completeOAuth(fixture, signedState())).rejects.toMatchObject({
    response: { error: 'Invalid OAuth token payload' },
  });
});
it('rejects a correctly signed but malformed claims payload', async () => {
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'key' }),
  ).toString('base64url');
  fixture.fetch
    .mockResolvedValueOnce(
      Response.json({
        id_token: signTokenParts(
          header,
          Buffer.from('invalid-json').toString('base64url'),
        ),
      }),
    )
    .mockResolvedValueOnce(Response.json(providerKeys()));
  await expect(completeOAuth(fixture, signedState())).rejects.toMatchObject({
    response: { error: 'Invalid OAuth token payload' },
  });
});
it.each([
  new Response('', { status: 503 }),
  Response.json({}),
  Response.json({ keys: [{ kid: 'other' }] }),
])('rejects unavailable or unknown provider keys', async (keyResponse) => {
  const state = signedState();
  fixture.fetch
    .mockResolvedValueOnce(Response.json({ id_token: signedIdToken(state) }))
    .mockResolvedValueOnce(keyResponse);
  await expect(completeOAuth(fixture, state)).rejects.toMatchObject({
    status: 401,
  });
  expect(fixture.login).not.toHaveBeenCalled();
});
it('rejects an altered token signature', async () => {
  const state = signedState();
  const token = signedIdToken(state);
  const [header, claims, signature] = token.split('.');
  fixture.fetch
    .mockResolvedValueOnce(
      Response.json({
        id_token: `${header}.${claims}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`,
      }),
    )
    .mockResolvedValueOnce(Response.json(providerKeys()));
  await expect(completeOAuth(fixture, state)).rejects.toMatchObject({
    response: { error: 'OAuth ID token signature is invalid' },
  });
});
it.each([{ exp: undefined }, { email: undefined }])(
  'rejects missing required identity claims %j',
  async (claims) => {
    const state = signedState();
    mockOAuthToken(fixture, state, claims);
    await expect(completeOAuth(fixture, state)).rejects.toMatchObject({
      status: 401,
    });
    expect(fixture.transaction).not.toHaveBeenCalled();
  },
);
it('accepts an audience array, legacy Google issuer, and string email verification only after signature verification', async () => {
  fixture.users.findOne.mockResolvedValue({
    id: 'existing',
    account: { id: 'account' },
  } as never);
  const state = signedState();
  mockOAuthToken(fixture, state, {
    aud: ['other', oauthConfig.GOOGLE_AUTH_CLIENT_ID],
    iss: 'accounts.google.com',
    email_verified: 'true',
  });
  await expect(completeOAuth(fixture, state)).resolves.toEqual({
    access_token: 'session',
  });
  expect(fixture.transaction).not.toHaveBeenCalled();
});
it('rejects an archived existing identity without creating a replacement', async () => {
  fixture.users.findOne.mockResolvedValue({ archivedAt: new Date() } as never);
  const state = signedState();
  mockOAuthToken(fixture, state);
  await expect(completeOAuth(fixture, state)).rejects.toMatchObject({
    response: { error: 'Account is archived' },
  });
  expect(fixture.transaction).not.toHaveBeenCalled();
});
