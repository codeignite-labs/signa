import { UnprocessableEntityException } from '@nestjs/common';
import forge from 'node-forge';

export function readSigningIdentity(buffer: Buffer, password: string) {
  try {
    const p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(buffer.toString('binary')),
      false,
      password,
    );
    const bags =
      p12.getBags({ bagType: forge.pki.oids.certBag })[
        forge.pki.oids.certBag
      ] ?? [];
    const keys = [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag]
      .flatMap((bagType) => p12.getBags({ bagType })[bagType] ?? [])
      .filter((bag) => bag.key);
    if (keys.length !== 1)
      throw new Error('Provide exactly one signing private key');
    const key = keys[0].key!;
    const certificates = bags.flatMap((bag) => (bag.cert ? [bag.cert] : []));
    const certificate = certificates.find((cert) => {
      const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
      return publicKey.n?.equals(key.n) && publicKey.e?.equals(key.e);
    });
    if (!certificate)
      throw new Error('The certificate must match the RSA private key');
    validateSigningCertificate(certificate, key);
    const chain = orderCertificateChain(certificate, certificates);
    forge.pki.verifyCertificateChain(
      forge.pki.createCaStore([chain.at(-1)!]),
      chain,
    );
    return { certificate, certificates: chain, key };
  } catch (error) {
    throw new UnprocessableEntityException(
      `Invalid signing identity: ${error instanceof Error ? error.message : 'certificate chain validation failed'}`,
    );
  }
}

function validateSigningCertificate(
  certificate: forge.pki.Certificate,
  key: forge.pki.rsa.PrivateKey,
) {
  const constraints = certificate.getExtension('basicConstraints') as {
    cA?: boolean;
  } | null;
  const usage = certificate.getExtension('keyUsage') as {
    digitalSignature?: boolean;
    nonRepudiation?: boolean;
  } | null;
  if (constraints?.cA)
    throw new Error(
      'Use an end-entity document-signing certificate, not a CA private key',
    );
  if (usage && !usage.digitalSignature && !usage.nonRepudiation)
    throw new Error('Certificate key usage does not permit signing');
  if (key.n.bitLength() < 2048)
    throw new Error('RSA signing keys must be at least 2048 bits');
}

function orderCertificateChain(
  leaf: forge.pki.Certificate,
  certificates: forge.pki.Certificate[],
) {
  const chain = [leaf];
  while (!chain.at(-1)!.isIssuer(chain.at(-1)!)) {
    const current = chain.at(-1)!;
    const issuer = certificates.find(
      (candidate) => current.isIssuer(candidate) && candidate.verify(current),
    );
    if (!issuer || chain.includes(issuer) || chain.length >= 10)
      throw new Error(
        'Include a complete, valid certificate chain in the P12/PFX',
      );
    chain.push(issuer);
  }
  for (const cert of chain) {
    if (
      cert.validity.notBefore > new Date() ||
      cert.validity.notAfter <= new Date()
    )
      throw new Error('Certificate is expired or not yet valid');
    if (
      [
        forge.pki.oids.md5WithRSAEncryption,
        forge.pki.oids.sha1WithRSAEncryption,
      ].includes(cert.signatureOid)
    )
      throw new Error('SHA-1/MD5 certificate signatures are not supported');
  }
  if (!chain.at(-1)!.verify(chain.at(-1)!))
    throw new Error('Invalid root certificate signature');
  return chain;
}
