import forge from 'node-forge';
import { generateSignaDefaultCertificate } from './pdf-signature-certificate';
import { readSigningIdentity } from './signing-identity';
const stored = generateSignaDefaultCertificate();
const identity = readSigningIdentity(Buffer.from(stored.data, 'base64'), '');
const issuerKey = forge.pki.privateKeyFromPem(
  stored.internal_revocation!.crl_issuer_private_key_pem,
);
function packageIdentity(
  key: forge.pki.rsa.PrivateKey | null,
  certificates: forge.pki.Certificate[],
  password: string | null = '',
) {
  return Buffer.from(
    forge.asn1
      .toDer(
        forge.pkcs12.toPkcs12Asn1(key, certificates, password, {
          algorithm: '3des',
          useMac: password !== null,
        }),
      )
      .getBytes(),
    'binary',
  );
}
function leaf() {
  return forge.pki.certificateFromPem(
    forge.pki.certificateToPem(identity.certificate),
  );
}
function chain(cert: forge.pki.Certificate) {
  return [cert, ...identity.certificates.slice(1)];
}
it('rejects a certificate-only P12 without a signing private key', () => {
  expect(() =>
    readSigningIdentity(packageIdentity(null, identity.certificates), ''),
  ).toThrow('exactly one signing private key');
});
it('rejects a private key whose public key does not match the packaged leaf', () => {
  expect(() =>
    readSigningIdentity(packageIdentity(issuerKey, [identity.certificate]), ''),
  ).toThrow('must match the RSA private key');
});
it('accepts unencrypted PKCS#12 key bags', () => {
  expect(
    readSigningIdentity(
      packageIdentity(identity.key, identity.certificates, null),
      '',
    ).certificate.serialNumber,
  ).toBe(identity.certificate.serialNumber);
});
it('rejects a key usage restricted to encryption', () => {
  const cert = leaf();
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', keyEncipherment: true },
  ]);
  cert.sign(issuerKey, forge.md.sha256.create());
  expect(() =>
    readSigningIdentity(packageIdentity(identity.key, chain(cert)), ''),
  ).toThrow('key usage does not permit signing');
});
it.each(['no-usage', 'non-repudiation'])(
  'accepts an end-entity certificate using %s',
  (mode) => {
    const cert = leaf();
    cert.setExtensions(
      mode === 'no-usage' ? [] : [{ name: 'keyUsage', nonRepudiation: true }],
    );
    cert.sign(issuerKey, forge.md.sha256.create());
    expect(
      readSigningIdentity(packageIdentity(identity.key, chain(cert)), '')
        .certificate.serialNumber,
    ).toBe(cert.serialNumber);
  },
);
it('rejects RSA keys shorter than 2048 bits even when the chain matches', () => {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = leaf();
  cert.publicKey = keys.publicKey;
  cert.sign(issuerKey, forge.md.sha256.create());
  expect(() =>
    readSigningIdentity(packageIdentity(keys.privateKey, chain(cert)), ''),
  ).toThrow('at least 2048 bits');
});
it('rejects a future-dated leaf', () => {
  const cert = leaf();
  cert.validity.notBefore = new Date(Date.now() + 86400_000);
  cert.sign(issuerKey, forge.md.sha256.create());
  expect(() =>
    readSigningIdentity(packageIdentity(identity.key, chain(cert)), ''),
  ).toThrow('not yet valid');
});
it('rejects SHA-1-signed certificates despite a complete matching chain', () => {
  const cert = leaf();
  cert.sign(issuerKey, forge.md.sha1.create());
  expect(() =>
    readSigningIdentity(packageIdentity(identity.key, chain(cert)), ''),
  ).toThrow('SHA-1/MD5');
});
it('rejects a root whose self signature has been damaged', () => {
  const root = forge.pki.certificateFromPem(
    forge.pki.certificateToPem(identity.certificates.at(-1)!),
  );
  root.signature = forge.pki
    .privateKeyFromPem(
      stored.internal_revocation!.root_crl_issuer_private_key_pem!,
    )
    .sign(forge.md.sha256.create().update('unrelated certificate'));
  expect(() =>
    readSigningIdentity(
      packageIdentity(identity.key, [
        identity.certificate,
        identity.certificates[1],
        root,
      ]),
      '',
    ),
  ).toThrow('Invalid root certificate signature');
});
