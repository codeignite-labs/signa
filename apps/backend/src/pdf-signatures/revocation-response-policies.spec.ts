import * as asn1js from 'asn1js';
import { OCSPResponse, ResponseBytes } from 'pkijs';
import { createRevocationPkiFixture } from '../../test/support/revocation-pki.fixture';
import {
  parseBasicOcspResponse,
  parseCrl,
  validateCrlEvidence,
  validateOcspEvidence,
} from './revocation-evidence-validation';
let pki: ReturnType<typeof createRevocationPkiFixture>;
beforeAll(() => {
  pki = createRevocationPkiFixture();
}, 30000);
it.each([
  {},
  { byKey: true },
  { noNextUpdate: true },
  { responder: 'delegated' as const },
  { responder: 'delegated' as const, byKey: true },
])(
  'authenticates a fresh issuing/delegated OCSP response with responder policy %j',
  async (options) => {
    expect(
      await validateOcspEvidence(
        await pki.ocsp(options),
        pki.signer,
        pki.issuer,
      ),
    ).toBe('good');
  },
);
it.each([
  'missing',
  'wrong-issuer',
  'missing-eku',
  'missing-no-check',
  'expired',
  'not-yet-valid',
  'forbidden-usage',
] as const)('rejects OCSP responder policy %s', async (responder) => {
  expect(
    await validateOcspEvidence(
      await pki.ocsp({ responder }),
      pki.signer,
      pki.issuer,
    ),
  ).toBe('unknown');
});
it.each([
  { future: true },
  { old: true, noNextUpdate: true },
  { stale: true },
  { weakSignature: true },
])(
  'rejects unauthenticated or temporally invalid OCSP evidence %j',
  async (options) => {
    expect(
      await validateOcspEvidence(
        await pki.ocsp(options),
        pki.signer,
        pki.issuer,
      ),
    ).toBe('unknown');
  },
);
it('distinguishes an authenticated revoked status from unknown status', async () => {
  expect(
    await validateOcspEvidence(
      await pki.ocsp({ revoked: true }),
      pki.signer,
      pki.issuer,
    ),
  ).toBe('revoked');
  expect(
    await validateOcspEvidence(
      await pki.ocsp({ unknown: true }),
      pki.signer,
      pki.issuer,
    ),
  ).toBe('unknown');
});
it('rejects malformed outer/inner OCSP data and unsupported response types without trust', async () => {
  for (const data of [
    Buffer.from([0xff]),
    Buffer.from(new asn1js.Sequence().toBER(false)),
  ]) {
    expect(await validateOcspEvidence(data, pki.signer, pki.issuer)).toBe(
      'unknown',
    );
    expect(parseBasicOcspResponse(data)).toBeNull();
    expect(parseCrl(data)).toBeNull();
  }
  const unsuccessful = new OCSPResponse({
    responseStatus: new asn1js.Enumerated({ value: 6 }),
  });
  expect(
    await validateOcspEvidence(
      Buffer.from(unsuccessful.toSchema().toBER(false)),
      pki.signer,
      pki.issuer,
    ),
  ).toBe('unknown');
  for (const responseType of ['1.2.3', '1.3.6.1.5.5.7.48.1.1']) {
    const response = new OCSPResponse({
      responseStatus: new asn1js.Enumerated({ value: 0 }),
      responseBytes: new ResponseBytes({
        responseType,
        response: new asn1js.OctetString({
          valueHex: new Uint8Array([0xff]).buffer,
        }),
      }),
    });
    expect(
      parseBasicOcspResponse(Buffer.from(response.toSchema().toBER(false))),
    ).toBeNull();
  }
});
it.each([{}, { noNextUpdate: true }, { revoked: true }])(
  'validates a signed full CRL and its revocation list (%j)',
  async (options) => {
    expect(
      await validateCrlEvidence(await pki.crl(options), pki.signer, pki.issuer),
    ).toBe(options.revoked ? 'revoked' : 'good');
  },
);
it.each([
  { stale: true },
  { noNextUpdate: true, old: true },
  { future: true },
  { delta: true },
])('rejects stale/future/partitioned CRL evidence (%j)', async (options) => {
  expect(
    await validateCrlEvidence(await pki.crl(options), pki.signer, pki.issuer),
  ).toBe('unknown');
});
it('rejects a corrupted CRL signature rather than trusting its well-formed revocation list', async () => {
  const data = await pki.crl();
  data[data.length - 1] ^= 1;
  expect(await validateCrlEvidence(data, pki.signer, pki.issuer)).toBe(
    'unknown',
  );
});

it.each([
  { emptyResponses: true },
  { unsupportedHash: true },
  { wrongCertificate: true },
])(
  'rejects an OCSP envelope without a supported matching certificate result (%j)',
  async (options) => {
    expect(
      await validateOcspEvidence(
        await pki.ocsp(options),
        pki.signer,
        pki.issuer,
      ),
    ).toBe('unknown');
  },
);
it('handles structurally invalid inner OCSP and unsupported CRL signature encodings as unknown', async () => {
  const invalid = new OCSPResponse({
    responseStatus: new asn1js.Enumerated({ value: 0 }),
    responseBytes: new ResponseBytes({
      responseType: '1.3.6.1.5.5.7.48.1.1',
      response: new asn1js.OctetString({
        valueHex: new asn1js.Sequence().toBER(false),
      }),
    }),
  });
  expect(
    await validateOcspEvidence(
      Buffer.from(invalid.toSchema().toBER(false)),
      pki.signer,
      pki.issuer,
    ),
  ).toBe('unknown');
  expect(
    await validateCrlEvidence(
      await pki.crl({ unsupportedSignature: true }),
      pki.signer,
      pki.issuer,
    ),
  ).toBe('unknown');
});
