import { createHash } from 'node:crypto';
import * as asn1js from 'asn1js';
import {
  BasicOCSPResponse,
  Certificate,
  CertificateRevocationList,
  CertID,
  getCrypto,
  id_PKIX_OCSP_Basic,
  OCSPResponse,
  RelativeDistinguishedNames,
} from 'pkijs';
import { certificateToDer, toArrayBuffer } from './pdf-cms-utils';
import { PdfRevocationEvidenceStatus } from './entities/pdf-revocation-evidence.entity';

export async function validateOcspEvidence(
  data: Buffer,
  signer: Certificate,
  issuer: Certificate,
  validationTime = new Date(),
): Promise<PdfRevocationEvidenceStatus> {
  const response = parseOcspResponse(data);

  if (!response || response.responseStatus.valueBlock.valueDec !== 0) {
    return 'unknown';
  }

  try {
    const basic = parseBasicOcspResponse(data);
    if (!basic || !basic.tbsResponseData.responses.length) return 'unknown';
    // Select freshness from the matching CertID, not an unrelated response.
    const match = await findMatchingOcspResponse(basic, signer, issuer);
    if (
      !match ||
      !freshEvidence(match.thisUpdate, match.nextUpdate, validationTime)
    )
      return 'unknown';
    const verified = await verifyOcspResponder(basic, issuer, validationTime);
    const certificateStatus: unknown = match.certStatus;

    if (
      !verified ||
      !(
        certificateStatus instanceof asn1js.Primitive ||
        certificateStatus instanceof asn1js.Constructed
      ) ||
      certificateStatus.idBlock.tagClass !== 3
    ) {
      return 'unknown';
    }

    return certificateStatus.idBlock.tagNumber === 0
      ? 'good'
      : certificateStatus.idBlock.tagNumber === 1
        ? 'revoked'
        : 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function validateCrlEvidence(
  data: Buffer,
  signer: Certificate,
  issuer: Certificate,
  validationTime = new Date(),
): Promise<PdfRevocationEvidenceStatus> {
  const crl = parseCrl(data);

  if (!crl) {
    return 'unknown';
  }

  try {
    const usage = issuer.extensions?.find(
      (extension) => extension.extnID === '2.5.29.15',
    )?.parsedValue as asn1js.BitString | undefined;
    if (
      !usage ||
      !(usage.valueBlock.valueHexView[0] & 0x02) ||
      !crl.issuer.isEqual(issuer.subject) ||
      !freshEvidence(
        crl.thisUpdate.value,
        crl.nextUpdate?.value,
        validationTime,
      )
    )
      return 'unknown';
    // Delta and partitioned CRLs need additional processing; never treat them as full evidence.
    if (
      crl.crlExtensions?.extensions.some((ext) =>
        ['2.5.29.27', '2.5.29.28'].includes(ext.extnID),
      )
    )
      return 'unknown';
    const verified = await crl.verify({ issuerCertificate: issuer });

    if (!verified) {
      return 'unknown';
    }

    const signerSerial = certificateSerial(signer);
    const revoked = (crl.revokedCertificates ?? []).some(
      (certificate) =>
        certificate.userCertificate.valueBlock.toString() === signerSerial,
    );

    return revoked ? 'revoked' : 'good';
  } catch {
    return 'unknown';
  }
}
function parseOcspResponse(data: Buffer): OCSPResponse | null {
  try {
    const asn1 = asn1js.fromBER(toArrayBuffer(data));

    if (asn1.offset === -1) {
      return null;
    }

    return new OCSPResponse({ schema: asn1.result });
  } catch {
    return null;
  }
}

export function parseBasicOcspResponse(data: Buffer): BasicOCSPResponse | null {
  const response = parseOcspResponse(data);

  if (!response?.responseBytes?.response) {
    return null;
  }

  if (response.responseBytes.responseType !== id_PKIX_OCSP_Basic) {
    return null;
  }

  const asn1 = asn1js.fromBER(
    response.responseBytes.response.valueBlock.valueHex,
  );

  if (asn1.offset === -1) {
    return null;
  }

  return new BasicOCSPResponse({ schema: asn1.result });
}

export function parseCrl(data: Buffer): CertificateRevocationList | null {
  try {
    const asn1 = asn1js.fromBER(toArrayBuffer(data));

    if (asn1.offset === -1) {
      return null;
    }

    return new CertificateRevocationList({ schema: asn1.result });
  } catch {
    return null;
  }
}

function freshEvidence(
  thisUpdate: Date,
  nextUpdate?: Date,
  validationTime = new Date(),
): boolean {
  const now = validationTime.getTime();
  return (
    thisUpdate.getTime() <= now + 60_000 &&
    (nextUpdate
      ? nextUpdate.getTime() > now && nextUpdate > thisUpdate
      : thisUpdate.getTime() >= now - 5 * 60_000)
  );
}

async function findMatchingOcspResponse(
  response: BasicOCSPResponse,
  certificate: Certificate,
  issuer: Certificate,
) {
  for (const item of response.tbsResponseData.responses) {
    const hashAlgorithm = (
      {
        '1.3.14.3.2.26': 'SHA-1',
        '2.16.840.1.101.3.4.2.1': 'SHA-256',
        '2.16.840.1.101.3.4.2.2': 'SHA-384',
        '2.16.840.1.101.3.4.2.3': 'SHA-512',
      } as Record<string, string>
    )[item.certID.hashAlgorithm.algorithmId];
    if (!hashAlgorithm) continue;
    const expected = new CertID();
    await expected.createForCertificate(certificate, {
      hashAlgorithm,
      issuerCertificate: issuer,
    });
    if (item.certID.isEqual(expected)) return item;
  }
  return null;
}

async function verifyOcspResponder(
  response: BasicOCSPResponse,
  issuer: Certificate,
  time: Date,
): Promise<boolean> {
  const id: unknown = response.tbsResponseData.responderID;
  const responder = [...(response.certs ?? []), issuer].find((certificate) =>
    id instanceof RelativeDistinguishedNames
      ? certificate.subject.isEqual(id)
      : id instanceof asn1js.OctetString &&
        Buffer.from(id.getValue()).equals(
          createHash('sha1')
            .update(
              Buffer.from(
                certificate.subjectPublicKeyInfo.subjectPublicKey.valueBlock
                  .valueHexView,
              ),
            )
            .digest(),
        ),
  );
  if (
    !responder ||
    responder.notBefore.value > time ||
    responder.notAfter.value <= time ||
    response.tbsResponseData.producedAt.getTime() > time.getTime() + 60_000
  )
    return false;
  if (!certificateToDer(responder).equals(certificateToDer(issuer))) {
    const usages = responder.extensions?.find(
      (ext) => ext.extnID === '2.5.29.37',
    )?.parsedValue as { keyPurposes?: string[] } | undefined;
    // Delegated responders without no-check require their own revocation path,
    // which is unsupported here; use the issuing CA's CRL instead.
    if (
      !usages?.keyPurposes?.includes('1.3.6.1.5.5.7.3.9') ||
      !responder.extensions?.some(
        (ext) => ext.extnID === '1.3.6.1.5.5.7.48.1.5',
      ) ||
      !responder.issuer.isEqual(issuer.subject) ||
      !(await responder.verify(issuer))
    )
      return false;
    const usage = responder.extensions?.find(
      (ext) => ext.extnID === '2.5.29.15',
    )?.parsedValue as asn1js.BitString | undefined;
    if (usage && !(usage.valueBlock.valueHexView[0] & 0x80)) return false;
  }
  if (
    [
      '1.2.840.113549.1.1.4',
      '1.2.840.113549.1.1.5',
      '1.2.840.10045.4.1',
    ].includes(response.signatureAlgorithm.algorithmId)
  )
    return false;
  return getCrypto(true).verifyWithPublicKey(
    toArrayBuffer(Buffer.from(response.tbsResponseData.tbsView)),
    response.signature,
    responder.subjectPublicKeyInfo,
    response.signatureAlgorithm,
  );
}

function certificateSerial(certificate: Certificate): string {
  return certificate.serialNumber.valueBlock.toString();
}
