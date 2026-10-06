import { createPrivateKey, webcrypto } from 'node:crypto';
import * as asn1js from 'asn1js';
import {
  BasicOCSPResponse,
  CertID,
  OCSPResponse,
  ResponseBytes,
  ResponseData,
  SingleResponse,
} from 'pkijs';
import { generateSignaDefaultCertificate } from './pdf-signature-certificate';
import { p12SigningIdentity } from './pades-signer';
import { toArrayBuffer } from './pdf-cms-utils';
import { validateOcspEvidence } from './revocation-evidence-validation';

describe('OCSP evidence authentication', () => {
  const stored = generateSignaDefaultCertificate();
  const [leaf, issuer] = p12SigningIdentity(
    Buffer.from(stored.data, 'base64'),
    '',
  ).certificates;

  async function response(
    options: { stale?: boolean; wrongIssuer?: boolean; status?: number } = {},
  ) {
    const id = new CertID();
    await id.createForCertificate(leaf, {
      hashAlgorithm: 'SHA-256',
      issuerCertificate: issuer,
    });
    if (options.wrongIssuer)
      id.issuerKeyHash = new asn1js.OctetString({
        valueHex: new Uint8Array(32).buffer,
      });
    const basic = new BasicOCSPResponse({
      tbsResponseData: new ResponseData({
        responderID: issuer.subject,
        producedAt: new Date(),
        responses: [
          new SingleResponse({
            certID: id,
            certStatus: new asn1js.Primitive({
              idBlock: { tagClass: 3, tagNumber: options.status ?? 0 },
            }),
            thisUpdate: new Date(Date.now() - 60_000),
            nextUpdate: new Date(
              Date.now() + (options.stale ? -30_000 : 3600_000),
            ),
          }),
        ],
      }),
    });
    const key = createPrivateKey(
      stored.internal_revocation!.crl_issuer_private_key_pem,
    );
    const cryptoKey = await webcrypto.subtle.importKey(
      'pkcs8',
      key.export({ format: 'der', type: 'pkcs8' }),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    await basic.sign(cryptoKey as CryptoKey, 'SHA-256');
    return Buffer.from(
      new OCSPResponse({
        responseStatus: new asn1js.Enumerated({ value: 0 }),
        responseBytes: new ResponseBytes({
          responseType: '1.3.6.1.5.5.7.48.1.1',
          response: new asn1js.OctetString({
            valueHex: toArrayBuffer(Buffer.from(basic.toSchema().toBER(false))),
          }),
        }),
      })
        .toSchema()
        .toBER(false),
    );
  }

  it('accepts a fresh CA-signed response even when the issuer certificate is omitted', async () => {
    expect(await validateOcspEvidence(await response(), leaf, issuer)).toBe(
      'good',
    );
  });
  it('rejects stale, unrelated and unknown-status evidence', async () => {
    for (const options of [
      { stale: true },
      { wrongIssuer: true },
      { status: 2 },
    ]) {
      expect(
        await validateOcspEvidence(await response(options), leaf, issuer),
      ).toBe('unknown');
    }
  });
  it('rejects a tampered responder signature', async () => {
    const bytes = await response();
    bytes[bytes.length - 1] ^= 1;
    expect(await validateOcspEvidence(bytes, leaf, issuer)).toBe('unknown');
  });
});
