// Local test authority: never uses a public TSA or real customer documents.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import { generateSignaDefaultCertificate } from './pdf-signature-certificate';
import { readSigningIdentity } from './signing-identity';
import { parsePemCertificates } from './certificate-validation-path';
import { buildSignaInternalCrl } from './signa-internal-crl';

export function createTestTimestampAuthority() {
  const directory = mkdtempSync(join(tmpdir(), 'signa-tsa-'));
  const stored = generateSignaDefaultCertificate();
  const root = readSigningIdentity(
    Buffer.from(stored.data, 'base64'),
    '',
  ).certificates.at(-1)!;
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '013456';
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 86400_000);
  cert.setSubject([{ name: 'commonName', value: 'Signa test TSA' }]);
  cert.setIssuer(root.subject.attributes);
  const uri = 'https://revocation.example.com/tsa.crl';
  const { Class: C, Type: T, create } = forge.asn1;
  const crlPoints = create(C.UNIVERSAL, T.SEQUENCE, true, [
    create(C.UNIVERSAL, T.SEQUENCE, true, [
      create(C.CONTEXT_SPECIFIC, 0, true, [
        create(C.CONTEXT_SPECIFIC, 0, true, [
          create(C.CONTEXT_SPECIFIC, 6, false, uri),
        ]),
      ]),
    ]),
  ]);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, critical: true },
    { name: 'extKeyUsage', timeStamping: true, critical: true },
    { name: 'subjectKeyIdentifier' },
    { id: '2.5.29.31', value: forge.asn1.toDer(crlPoints).getBytes() },
  ]);
  const rootKey = stored.internal_revocation!.root_crl_issuer_private_key_pem!;
  cert.sign(forge.pki.privateKeyFromPem(rootKey), forge.md.sha256.create());
  const rootPem = forge.pki.certificateToPem(root);
  writeFileSync(join(directory, 'root.pem'), rootPem);
  writeFileSync(join(directory, 'tsa.pem'), forge.pki.certificateToPem(cert));
  writeFileSync(
    join(directory, 'tsa.key'),
    forge.pki.privateKeyToPem(keys.privateKey),
    { mode: 0o600 },
  );
  writeFileSync(join(directory, 'serial'), '01');
  writeFileSync(
    join(directory, 'tsa.conf'),
    `[tsa]\ndefault_tsa = authority\n[authority]\nserial = ${directory}/serial\ncrypto_device = builtin\nsigner_cert = ${directory}/tsa.pem\ncerts = ${directory}/root.pem\nsigner_key = ${directory}/tsa.key\nsigner_digest = sha256\ndefault_policy = 1.2.3.4\ndigests = sha256\naccuracy = secs:1\nordering = no\ntsa_name = yes\ness_cert_id_chain = no\ness_cert_id_alg = sha256\n`,
  );
  const rootCertificate = parsePemCertificates(rootPem)[0];
  return {
    directory,
    rootPem,
    rootCertificate,
    uri,
    crl: buildSignaInternalCrl({
      issuer: rootCertificate,
      issuerPrivateKeyPem: rootKey,
      thisUpdate: new Date(),
      nextUpdate: new Date(Date.now() + 3600_000),
    }),
    respond(query: Buffer): Buffer {
      writeFileSync(join(directory, 'request.tsq'), query);
      execFileSync(
        'openssl',
        [
          'ts',
          '-reply',
          '-config',
          join(directory, 'tsa.conf'),
          '-queryfile',
          join(directory, 'request.tsq'),
          '-out',
          join(directory, 'response.tsr'),
        ],
        { stdio: 'pipe' },
      );
      return readFileSync(join(directory, 'response.tsr'));
    },
    dispose() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
