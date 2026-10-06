import forge from 'node-forge';
import { generateSignaDefaultCertificate } from './pdf-signature-certificate';
import { readSigningIdentity } from './signing-identity';

describe('PKCS#12 signing identity validation', () => {
  const stored = generateSignaDefaultCertificate();
  const identity = readSigningIdentity(Buffer.from(stored.data, 'base64'), '');
  const packageIdentity = (
    key: forge.pki.rsa.PrivateKey,
    chain: forge.pki.Certificate[],
  ) =>
    Buffer.from(
      forge.asn1
        .toDer(forge.pkcs12.toPkcs12Asn1(key, chain, 'test-password'))
        .getBytes(),
      'binary',
    );

  it('rejects a CA private key as the document signer', () => {
    const root = identity.certificates.at(-1)!;
    const key = forge.pki.privateKeyFromPem(
      stored.internal_revocation!.root_crl_issuer_private_key_pem!,
    );
    expect(() =>
      readSigningIdentity(packageIdentity(key, [root]), 'test-password'),
    ).toThrow('end-entity');
  });
  it('rejects missing issuers and incorrect passwords', () => {
    expect(() =>
      readSigningIdentity(
        packageIdentity(identity.key, [identity.certificate]),
        'test-password',
      ),
    ).toThrow('complete');
    expect(() =>
      readSigningIdentity(Buffer.from(stored.data, 'base64'), 'wrong-password'),
    ).toThrow();
  });
  it('rejects an expired leaf even when its key and chain match', () => {
    const leaf = forge.pki.certificateFromPem(
      forge.pki.certificateToPem(identity.certificate),
    );
    leaf.validity.notBefore = new Date(Date.now() - 86400_000);
    leaf.validity.notAfter = new Date(Date.now() - 60_000);
    leaf.sign(
      forge.pki.privateKeyFromPem(
        stored.internal_revocation!.crl_issuer_private_key_pem,
      ),
      forge.md.sha256.create(),
    );
    expect(() =>
      readSigningIdentity(
        packageIdentity(identity.key, [
          leaf,
          ...identity.certificates.slice(1),
        ]),
        'test-password',
      ),
    ).toThrow('expired');
  });
});
