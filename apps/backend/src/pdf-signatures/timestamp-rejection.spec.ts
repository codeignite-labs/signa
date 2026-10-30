import { createHash } from 'node:crypto';
import * as asn1js from 'asn1js';
import {
  AlgorithmIdentifier,
  ContentInfo,
  Certificate,
  ExtKeyUsage,
  PKIStatusInfo,
  SignedData,
  TimeStampReq,
  TimeStampResp,
  TSTInfo,
} from 'pkijs';
import { certificateToDer, toArrayBuffer } from './pdf-cms-utils';
import { buildTimestampRequest } from './rfc3161-timestamp-client';
import { createTestTimestampAuthority } from './test-timestamp-authority';
import {
  assertSigningCertificateReference,
  cmsSignerCertificate,
  parseTimestampResponse,
  parseTimestampToken,
  validateTimestampToken,
} from './timestamp-validation';
let tsa: ReturnType<typeof createTestTimestampAuthority>;
let token: Buffer;
let response: Buffer;
let request: Buffer;
const digest = createHash('sha256').update('synthetic signed bytes').digest();
beforeAll(() => {
  tsa = createTestTimestampAuthority();
  request = buildTimestampRequest(digest);
  response = tsa.respond(request);
  token = parseTimestampResponse(response, request).token;
});
afterAll(() => tsa?.dispose());
function encode(cms: SignedData): Buffer {
  return Buffer.from(
    new ContentInfo({
      contentType: ContentInfo.SIGNED_DATA,
      content: cms.toSchema(true),
    })
      .toSchema()
      .toBER(false),
  );
}
function changedToken(
  change: (cms: SignedData, info: TSTInfo) => void,
): Buffer {
  const parsed = parseTimestampToken(token);
  change(parsed.cms, parsed.info);
  return encode(parsed.cms);
}
function replaceInfo(cms: SignedData, info: TSTInfo): void {
  cms.encapContentInfo.eContent = new asn1js.OctetString({
    valueHex: info.toSchema().toBER(false),
  });
}
function validate(value: Buffer, earliestTime?: Date) {
  return validateTimestampToken({
    token: value,
    digest,
    trustedCertificates: [tsa.rootCertificate],
    earliestTime,
  });
}
it('rejects a TSA rejection response and a matching-nonce request with a different imprint algorithm or value', () => {
  const rejection = new TimeStampResp({
    status: new PKIStatusInfo({ status: 2 }),
  });
  expect(() =>
    parseTimestampResponse(
      Buffer.from(rejection.toSchema().toBER(false)),
      request,
    ),
  ).toThrow('rejected');
  for (const algorithm of [false, true]) {
    const query = new TimeStampReq({
      schema: asn1js.fromBER(toArrayBuffer(request)).result,
    });
    if (algorithm)
      query.messageImprint.hashAlgorithm.algorithmId = '2.16.840.1.101.3.4.2.2';
    else
      query.messageImprint.hashedMessage = new asn1js.OctetString({
        valueHex: new Uint8Array(32).buffer,
      });
    expect(() =>
      parseTimestampResponse(
        response,
        Buffer.from(query.toSchema().toBER(false)),
      ),
    ).toThrow('imprint');
  }
});
it('rejects non-signed CMS and a signed envelope without the timestamp content type', () => {
  const invalid = new ContentInfo({
    contentType: '1.2.840.113549.1.7.1',
    content: new asn1js.OctetString(),
  });
  expect(() =>
    parseTimestampToken(Buffer.from(invalid.toSchema().toBER(false))),
  ).toThrow('content type');
  expect(() =>
    parseTimestampToken(
      changedToken((cms) => {
        cms.encapContentInfo.eContentType = '1.2.3';
      }),
    ),
  ).toThrow('TSTInfo');
});
it('rejects timestamps outside the future and earliest-signing time windows', async () => {
  await expect(
    validate(
      changedToken((cms, info) => {
        info.genTime = new Date(Date.now() + 120000);
        replaceInfo(cms, info);
      }),
    ),
  ).rejects.toThrow('allowed window');
  await expect(validate(token, new Date(Date.now() + 120000))).rejects.toThrow(
    'allowed window',
  );
});
it('requires a critical exclusive timestamp certificate EKU', async () => {
  for (const usage of [undefined, '1.3.6.1.5.5.7.3.1']) {
    const invalid = changedToken((cms) => {
      const cert = cmsSignerCertificate(cms);
      const eku = cert.extensions!.find(
        (extension) => extension.extnID === '2.5.29.37',
      )!;
      if (!usage) eku.critical = false;
      else
        eku.extnValue = new asn1js.OctetString({
          valueHex: new ExtKeyUsage({ keyPurposes: [usage] })
            .toSchema()
            .toBER(false),
        });
      cms.certificates![cms.certificates!.indexOf(cert)] = new Certificate({
        schema: asn1js.fromBER(cert.toSchema(true).toBER(false)).result,
      });
    });
    await expect(validate(invalid)).rejects.toThrow('exclusive timeStamping');
  }
});
it('rejects absent/multiple signers and missing signer certificates', () => {
  const { cms } = parseTimestampToken(token);
  const signer = cms.signerInfos[0];
  cms.signerInfos = [];
  expect(() => cmsSignerCertificate(cms)).toThrow('exactly one');
  cms.signerInfos = [signer, signer];
  expect(() => cmsSignerCertificate(cms)).toThrow('exactly one');
  cms.signerInfos = [signer];
  cms.certificates = [];
  expect(() => cmsSignerCertificate(cms)).toThrow('not found');
});
it.each(['digest', 'attributes', 'signature-algorithm'])(
  'rejects unsupported TSA %s before trusting the signed envelope',
  async (failure) => {
    const invalid = changedToken((cms) => {
      const signer = cms.signerInfos[0];
      if (failure === 'digest') signer.digestAlgorithm.algorithmId = '1.2.3';
      if (failure === 'attributes') delete signer.signedAttrs;
      if (failure === 'signature-algorithm')
        signer.signatureAlgorithm.algorithmId = '1.2.840.113549.1.1.12';
    });
    await expect(validate(invalid)).rejects.toThrow('Unsupported');
  },
);
it.each([
  'missing-digest',
  'duplicate-digest',
  'missing-type',
  'wrong-type',
  'wrong-digest',
])('rejects %s authenticated content attributes', async (failure) => {
  const invalid = changedToken((cms) => {
    const attributes = cms.signerInfos[0].signedAttrs!.attributes;
    const contentDigest = attributes.find(
      (attribute) => attribute.type === '1.2.840.113549.1.9.4',
    )!;
    const contentType = attributes.find(
      (attribute) => attribute.type === '1.2.840.113549.1.9.3',
    )!;
    if (failure === 'missing-digest')
      attributes.splice(attributes.indexOf(contentDigest), 1);
    if (failure === 'duplicate-digest') attributes.push(contentDigest);
    if (failure === 'missing-type')
      attributes.splice(attributes.indexOf(contentType), 1);
    if (failure === 'wrong-type')
      contentType.values = [new asn1js.ObjectIdentifier({ value: '1.2.3' })];
    if (failure === 'wrong-digest')
      contentDigest.values = [
        new asn1js.OctetString({ valueHex: new Uint8Array(32).buffer }),
      ];
  });
  await expect(validate(invalid)).rejects.toThrow('attributes mismatch');
});
it('rejects a valid certificate from another trust anchor', async () => {
  const wrongRoot = cmsSignerCertificate(parseTimestampToken(token).cms);
  await expect(
    validateTimestampToken({ token, digest, trustedCertificates: [wrongRoot] }),
  ).rejects.toThrow('not trusted');
});
it.each([
  'missing',
  'duplicate',
  'malformed',
  'hash-mismatch',
  'unsupported-hash',
])('rejects %s ESS certificate identity references', (failure) => {
  const { cms } = parseTimestampToken(token);
  const certificate = cmsSignerCertificate(cms);
  const attributes = cms.signerInfos[0].signedAttrs!.attributes;
  const reference = attributes.find(
    (attribute) => attribute.type === '1.2.840.113549.1.9.16.2.47',
  )!;
  if (failure === 'missing')
    attributes.splice(attributes.indexOf(reference), 1);
  if (failure === 'duplicate') attributes.push(reference);
  if (failure === 'malformed') reference.values = [new asn1js.OctetString()];
  if (failure === 'hash-mismatch')
    reference.values = [
      new asn1js.Sequence({
        value: [
          new asn1js.Sequence({
            value: [
              new asn1js.Sequence({
                value: [
                  new asn1js.OctetString({
                    valueHex: new Uint8Array(32).buffer,
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
  if (failure === 'unsupported-hash')
    reference.values = [
      new asn1js.Sequence({
        value: [
          new asn1js.Sequence({
            value: [
              new asn1js.Sequence({
                value: [
                  new AlgorithmIdentifier({ algorithmId: '1.2.3' }).toSchema(),
                  new asn1js.OctetString(),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
  expect(() => assertSigningCertificateReference(cms, certificate)).toThrow();
});
it.each(['sha1', 'sha256'] as const)(
  'accepts a matching explicit ESS certificate hash using %s',
  (hash) => {
    const { cms } = parseTimestampToken(token);
    const certificate = cmsSignerCertificate(cms);
    const reference = cms.signerInfos[0].signedAttrs!.attributes.find(
      (attribute) => attribute.type === '1.2.840.113549.1.9.16.2.47',
    )!;
    const hashBytes = new asn1js.OctetString({
      valueHex: toArrayBuffer(
        createHash(hash).update(certificateToDer(certificate)).digest(),
      ),
    });
    reference.type =
      hash === 'sha1'
        ? '1.2.840.113549.1.9.16.2.12'
        : '1.2.840.113549.1.9.16.2.47';
    reference.values = [
      new asn1js.Sequence({
        value: [
          new asn1js.Sequence({
            value: [
              new asn1js.Sequence({
                value:
                  hash === 'sha1'
                    ? [hashBytes]
                    : [
                        new AlgorithmIdentifier({
                          algorithmId: '2.16.840.1.101.3.4.2.1',
                        }).toSchema(),
                        hashBytes,
                      ],
              }),
            ],
          }),
        ],
      }),
    ];
    expect(() =>
      assertSigningCertificateReference(cms, certificate),
    ).not.toThrow();
  },
);

it('rejects a corrupted signature even when its timestamp imprint and certificate reference are intact', async () => {
  const invalid = changedToken((cms) => {
    cms.signerInfos[0].signature = new asn1js.OctetString({
      valueHex: new Uint8Array(256).buffer,
    });
  });
  await expect(validate(invalid)).rejects.toThrow(
    'signature verification failed',
  );
});
