import { createHash, X509Certificate, verify } from 'node:crypto';
import * as asn1js from 'asn1js';
import {
  Certificate,
  CertificateChainValidationEngine,
  ContentInfo,
  IssuerAndSerialNumber,
  SignedData,
  TimeStampReq,
  TimeStampResp,
  TSTInfo,
} from 'pkijs';
import { certificateToDer, toArrayBuffer } from './pdf-cms-utils';

export function parseTimestampResponse(
  response: Buffer,
  request: Buffer,
): { token: Buffer; info: TSTInfo } {
  const parsed = new TimeStampResp({
    schema: asn1js.fromBER(toArrayBuffer(response)).result,
  });
  const query = new TimeStampReq({
    schema: asn1js.fromBER(toArrayBuffer(request)).result,
  });
  if (![0, 1].includes(parsed.status.status) || !parsed.timeStampToken)
    throw new Error('TSA rejected the timestamp request');
  const token = Buffer.from(parsed.timeStampToken.toSchema().toBER(false));
  const { info } = parseTimestampToken(token);
  if (!info.nonce || !query.nonce || !info.nonce.isEqual(query.nonce))
    throw new Error('TSA nonce mismatch');
  if (
    info.messageImprint.hashAlgorithm.algorithmId !==
      query.messageImprint.hashAlgorithm.algorithmId ||
    !info.messageImprint.hashedMessage.isEqual(
      query.messageImprint.hashedMessage,
    )
  )
    throw new Error('TSA message imprint mismatch');
  return { token, info };
}

export function parseTimestampToken(token: Buffer) {
  const content = new ContentInfo({
    schema: asn1js.fromBER(toArrayBuffer(token)).result,
  });
  if (content.contentType !== ContentInfo.SIGNED_DATA)
    throw new Error('Invalid TSA CMS content type');
  const cms = new SignedData({ schema: content.content });
  if (
    cms.encapContentInfo.eContentType !== '1.2.840.113549.1.9.16.1.4' ||
    !cms.encapContentInfo.eContent
  )
    throw new Error('TSA token does not contain TSTInfo');
  const bytes = Buffer.from(cms.encapContentInfo.eContent.getValue());
  const info = new TSTInfo({
    schema: asn1js.fromBER(toArrayBuffer(bytes)).result,
  });
  return { cms, info, bytes };
}

export async function validateTimestampToken(input: {
  token: Buffer;
  digest: Buffer;
  trustedCertificates: Certificate[];
  earliestTime?: Date;
}) {
  const { cms, info, bytes } = parseTimestampToken(input.token);
  if (!input.trustedCertificates.length)
    throw new Error(
      'Configure trusted TSA CA certificates before enabling timestamps',
    );
  if (
    info.messageImprint.hashAlgorithm.algorithmId !==
      '2.16.840.1.101.3.4.2.1' ||
    !Buffer.from(info.messageImprint.hashedMessage.getValue()).equals(
      input.digest,
    )
  )
    throw new Error('TSA imprint mismatch');
  if (
    info.genTime.getTime() > Date.now() + 60_000 ||
    (input.earliestTime &&
      info.genTime.getTime() < input.earliestTime.getTime() - 60_000)
  )
    throw new Error('TSA response time is outside the allowed window');
  const certificate = cmsSignerCertificate(cms);
  const eku = certificate.extensions?.find((ext) => ext.extnID === '2.5.29.37');
  const usages = (eku?.parsedValue as { keyPurposes?: string[] } | undefined)
    ?.keyPurposes;
  if (
    !eku?.critical ||
    usages?.length !== 1 ||
    usages[0] !== '1.3.6.1.5.5.7.3.8'
  )
    throw new Error(
      'TSA certificate must have critical, exclusive timeStamping EKU',
    );
  verifyTimestampCms(cms, bytes, certificate);
  const certs = (cms.certificates ?? []).filter(
    (cert): cert is Certificate => cert instanceof Certificate,
  );
  const chain = await new CertificateChainValidationEngine({
    trustedCerts: input.trustedCertificates,
    certs: [...certs.filter((cert) => cert !== certificate), certificate],
    checkDate: info.genTime,
  }).verify({ passedWhenNotRevValues: true });
  if (!chain.result) throw new Error('TSA certificate chain is not trusted');
  return { cms, info, certificates: certs };
}

export function cmsSignerCertificate(cms: SignedData): Certificate {
  if (cms.signerInfos.length !== 1)
    throw new Error('Expected exactly one CMS signer');
  const sid: unknown = cms.signerInfos[0].sid;
  const cert = (cms.certificates ?? []).find(
    (candidate): candidate is Certificate =>
      candidate instanceof Certificate &&
      sid instanceof IssuerAndSerialNumber &&
      candidate.issuer.isEqual(sid.issuer) &&
      candidate.serialNumber.isEqual(sid.serialNumber),
  );
  if (!cert) throw new Error('CMS signer certificate not found');
  return cert;
}

function verifyTimestampCms(
  cms: SignedData,
  content: Buffer,
  cert: Certificate,
) {
  const signer = cms.signerInfos[0];
  const hash = (
    {
      '2.16.840.1.101.3.4.2.1': 'sha256',
      '2.16.840.1.101.3.4.2.2': 'sha384',
      '2.16.840.1.101.3.4.2.3': 'sha512',
    } as Record<string, string>
  )[signer.digestAlgorithm.algorithmId];
  if (!hash || !signer.signedAttrs)
    throw new Error('Unsupported TSA digest or missing signed attributes');
  const signatureHash = (
    {
      '1.2.840.113549.1.1.11': 'sha256',
      '1.2.840.113549.1.1.12': 'sha384',
      '1.2.840.113549.1.1.13': 'sha512',
      '1.2.840.10045.4.3.2': 'sha256',
      '1.2.840.10045.4.3.3': 'sha384',
      '1.2.840.10045.4.3.4': 'sha512',
    } as Record<string, string>
  )[signer.signatureAlgorithm.algorithmId];
  if (
    signer.signatureAlgorithm.algorithmId !== '1.2.840.113549.1.1.1' &&
    signatureHash !== hash
  )
    throw new Error('Unsupported or mismatched TSA signature algorithm');
  const attributes = signer.signedAttrs.attributes;
  const digest = attributes.filter(
    (attr) => attr.type === '1.2.840.113549.1.9.4',
  );
  const type = attributes.filter(
    (attr) => attr.type === '1.2.840.113549.1.9.3',
  );
  const contentType: unknown = type[0]?.values[0];
  const contentDigest: unknown = digest[0]?.values[0];
  if (
    digest.length !== 1 ||
    type.length !== 1 ||
    digest[0].values.length !== 1 ||
    type[0].values.length !== 1 ||
    !(contentType instanceof asn1js.ObjectIdentifier) ||
    contentType.valueBlock.toString() !== '1.2.840.113549.1.9.16.1.4' ||
    !(contentDigest instanceof asn1js.OctetString) ||
    !Buffer.from(contentDigest.getValue()).equals(
      createHash(hash).update(content).digest(),
    )
  )
    throw new Error('TSA signed attributes mismatch');
  assertSigningCertificateReference(cms, cert);
  const encoded = Buffer.from(signer.signedAttrs.encodedValue);
  if (!encoded.length || encoded[0] !== 0x31)
    throw new Error('Invalid TSA signed attribute encoding');
  if (
    !verify(
      hash,
      encoded,
      new X509Certificate(certificateToDer(cert)).publicKey,
      Buffer.from(signer.signature.getValue()),
    )
  )
    throw new Error('TSA signature verification failed');
}

export function assertSigningCertificateReference(
  cms: SignedData,
  certificate: Certificate,
) {
  const refs =
    cms.signerInfos[0].signedAttrs?.attributes.filter((attr) =>
      ['1.2.840.113549.1.9.16.2.47', '1.2.840.113549.1.9.16.2.12'].includes(
        attr.type,
      ),
    ) ?? [];
  if (refs.length !== 1 || refs[0].values.length !== 1)
    throw new Error('Missing or ambiguous ESS signing certificate reference');
  const outer = sequenceValues(refs[0].values[0] as unknown);
  const ess = sequenceValues(sequenceValues(outer[0])[0]);
  let hash = refs[0].type.endsWith('.12') ? 'sha1' : 'sha256';
  let hashValue = ess[0];
  if (hashValue instanceof asn1js.Sequence) {
    const oid = hashValue.valueBlock.value[0];
    if (
      !(oid instanceof asn1js.ObjectIdentifier) ||
      oid.valueBlock.toString() !== '2.16.840.1.101.3.4.2.1'
    )
      throw new Error('Unsupported ESS hash');
    hash = 'sha256';
    hashValue = ess[1];
  }
  if (
    !(hashValue instanceof asn1js.OctetString) ||
    !Buffer.from(hashValue.getValue()).equals(
      createHash(hash).update(certificateToDer(certificate)).digest(),
    )
  )
    throw new Error('ESS certificate hash mismatch');
}

function sequenceValues(value: unknown) {
  if (!(value instanceof asn1js.Sequence))
    throw new Error('Malformed ESS signing certificate reference');
  return value.valueBlock.value;
}
