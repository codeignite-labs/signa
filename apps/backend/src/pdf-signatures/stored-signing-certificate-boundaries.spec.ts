import {
  buildStoredSigningCertificate,
  generateSignaDefaultCertificate,
  hasInternalRevocation,
  inspectP12Certificate,
  p12BufferFromStoredCertificate,
  parseStoredSigningCertificate,
} from './pdf-signature-certificate';
it.each(['invalid', 'null', '[]', '{}', '{"data":42}'])(
  'rejects invalid stored certificate JSON %s',
  (value) => {
    expect(parseStoredSigningCertificate(value)).toBeNull();
  },
);
it('reads a minimal legacy certificate and fills safe defaults without private-key metadata', () => {
  const value = parseStoredSigningCertificate('{"data":"cDEy"}');
  expect(value).toEqual({
    content_type: null,
    data: 'cDEy',
    fingerprint_sha256: undefined,
    filename: '',
    internal_revocation: null,
    issuer: null,
    password: '',
    serial_number: null,
    subject: null,
    valid_from: null,
    valid_to: null,
  });
  expect(p12BufferFromStoredCertificate(value!)).toEqual(Buffer.from('p12'));
  expect(hasInternalRevocation(value!)).toBe(false);
});
it.each([
  {},
  { crl_issuer_private_key_pem: 7 },
  { crl_issuer_private_key_pem: '   ' },
])(
  'ignores invalid embedded revocation issuer metadata %j',
  (internal_revocation) => {
    expect(
      parseStoredSigningCertificate(
        JSON.stringify({ data: 'p12', internal_revocation }),
      )?.internal_revocation,
    ).toBeNull();
  },
);
it('preserves both issuer keys and explicitly supplied inspection metadata', () => {
  const input = {
    data: 'p12',
    filename: 'org.p12',
    password: 'password',
    content_type: 'application/custom-pkcs12',
    fingerprint_sha256: 'fingerprint',
    issuer: 'CN=Issuer',
    subject: 'CN=Org',
    serial_number: '01',
    valid_from: '2026-01-01',
    valid_to: '2027-01-01',
    internal_revocation: {
      crl_issuer_private_key_pem: 'issuer-key',
      root_crl_issuer_private_key_pem: 'root-key',
    },
  };
  expect(parseStoredSigningCertificate(JSON.stringify(input))).toEqual(input);
  expect(hasInternalRevocation(input)).toBe(true);
});
it('retains an intermediate issuer key without inventing an absent root issuer key', () => {
  expect(
    parseStoredSigningCertificate(
      JSON.stringify({
        data: 'p12',
        internal_revocation: { crl_issuer_private_key_pem: 'issuer' },
      }),
    )?.internal_revocation,
  ).toEqual({
    crl_issuer_private_key_pem: 'issuer',
    root_crl_issuer_private_key_pem: undefined,
  });
});
it('inspects a real P12 with default password and MIME configuration', () => {
  const stored = generateSignaDefaultCertificate();
  const buffer = Buffer.from(stored.data, 'base64');
  const result = buildStoredSigningCertificate({ buffer });
  expect(result).toMatchObject({
    content_type: 'application/x-pkcs12',
    password: '',
    data: stored.data,
    fingerprint_sha256: stored.fingerprint_sha256,
    subject: stored.subject,
  });
  expect(
    buildStoredSigningCertificate({
      buffer,
      contentType: 'application/pkcs12',
      password: '',
      filename: 'Org.p12',
    }).filename,
  ).toBe('Org.p12');
});
it('rejects a damaged P12 with an actionable signing certificate error', async () => {
  await expect(
    Promise.resolve().then(() =>
      inspectP12Certificate(Buffer.from('invalid'), ''),
    ),
  ).rejects.toMatchObject({
    response: {
      error: expect.stringContaining('Invalid signing certificate:') as unknown,
    },
  });
});
