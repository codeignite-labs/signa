import {
  verifySignatureTimestamp,
  hasPadesAttributes,
} from './pdf-signature-timestamp';
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cmsSignerCertificate } from '../pdf-signatures/timestamp-validation';
import { parsePemCertificates } from '../pdf-signatures/certificate-validation-path';
import { createHash } from 'node:crypto';
import {
  Certificate,
  CertificateRevocationList,
  SignedData,
  SignedDataVerifyError,
} from 'pkijs';
import {
  PdfDssReadContext,
  PdfDssVriEmbedder,
} from '../pdf-signatures/pdf-dss-vri-embedder';
import {
  parsePdfCmsSignature,
  toArrayBuffer,
} from '../pdf-signatures/pdf-cms-utils';
import { PdfRevocationCollectorService } from '../pdf-signatures/pdf-revocation-collector.service';
import { materializePdfSignedBytes } from '../pdf-signatures/pdf-signature-detection';

export type PdfCmsCertificate = {
  issuer: string | null;
  serialNumber: string | null;
  subject: string | null;
  validFrom: string | null;
  validTo: string | null;
};

export type PdfCmsVerificationResult = {
  certificateChain: PdfCmsCertificate[];
  certificateChainStatus:
    | 'expired'
    | 'external'
    | 'invalid'
    | 'missing'
    | 'trusted';
  certificatePolicyErrors: string[];
  cmsMessageDigestValid: boolean | null;
  cmsSignatureValid: boolean | null;
  messages: string[];
  revocationStatus: 'good' | 'missing' | 'revoked' | 'unavailable' | 'unknown';
  ltvStatus: 'invalid' | 'missing' | 'valid';
  timestampValid: boolean | null;
  trustAnchor: string | null;
  trustAnchorFingerprint: string | null;
};

@Injectable()
export class PdfSignatureVerifierService {
  constructor(
    private readonly dssVriEmbedder: PdfDssVriEmbedder,
    private readonly revocationCollector: PdfRevocationCollectorService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  prepareDssRead(pdfBuffer: Buffer): PdfDssReadContext {
    return this.dssVriEmbedder.prepareRead(pdfBuffer);
  }

  async verify(input: {
    cmsContents: Buffer | null;
    dssContext?: PdfDssReadContext;
    pdfBuffer: Buffer;
    signedByteRanges?: readonly [number, number, number, number] | null;
    signedBytes?: Buffer | null;
    trustedCertificates?: Certificate[];
  }): Promise<PdfCmsVerificationResult> {
    const signedBytes =
      input.signedBytes ??
      materializePdfSignedBytes(
        input.pdfBuffer,
        input.signedByteRanges ?? null,
      );

    if (!input.cmsContents || !signedBytes) {
      return missingCmsResult();
    }

    const parsed = parsePdfCmsSignature(input.cmsContents);

    if (!parsed) {
      return missingCmsResult([
        'cms_parse_failed: PDF signature Contents could not be parsed as CMS SignedData',
      ]);
    }

    const trustedRoots = input.trustedCertificates ?? [];
    const timestamp = await verifySignatureTimestamp(parsed.signedData, [
      ...trustedRoots,
      ...parsePemCertificates(
        this.config?.get<string>('PDF_TSA_TRUST_CERTIFICATES', '') ?? '',
      ),
    ]);
    const policy = getCertificatePolicy(
      parsed.certificates,
      timestamp.time ?? new Date(),
      parsed.signedData,
    );
    const chainStatus = getCertificateChainStatus({
      certificates: parsed.certificates,
      policyErrors: policy.errors,
      trustedRoots,
    });
    const trustAnchor = findTrustAnchor(parsed.certificates, trustedRoots);
    const embeddedRevocationStatus = getEmbeddedRevocationStatus(
      parsed.signedData,
    );
    const dssEvidence = this.dssVriEmbedder.read({
      context: input.dssContext,
      pdfBuffer: input.dssContext ? undefined : input.pdfBuffer,
      vriKey: parsed.vriKey,
    });
    const dssRevocationStatus =
      await this.revocationCollector.validateEmbeddedEvidence({
        evidence: dssEvidence,
        parsed,
        validationTime: timestamp.time ?? undefined,
      });
    const revocationStatus =
      dssRevocationStatus === 'missing'
        ? embeddedRevocationStatus
        : dssRevocationStatus;
    const evidenceLtvStatus = getLtvStatus({
      hasMatchingVri: dssEvidence.hasMatchingVri,
      revocationStatus,
    });

    try {
      const verification = await parsed.signedData.verify({
        checkChain: trustedRoots.length > 0,
        checkDate: timestamp.time ?? new Date(),
        data: toArrayBuffer(signedBytes),
        extendedMode: true,
        passedWhenNotRevValues: true,
        signer: 0,
        trustedCerts: trustedRoots,
      });
      const signatureValid = verification.signatureVerified === true;
      const chainTrusted =
        trustedRoots.length > 0 &&
        policy.errors.length === 0 &&
        verification.signerCertificateVerified === true;
      const ltvStatus =
        signatureValid &&
        chainTrusted &&
        timestamp.valid === true &&
        hasPadesAttributes(parsed.signedData)
          ? evidenceLtvStatus
          : evidenceLtvStatus === 'missing'
            ? 'missing'
            : 'invalid';

      return {
        certificateChain: parsed.certificates.map(certificateToResponse),
        certificateChainStatus: chainTrusted
          ? 'trusted'
          : chainStatus === 'trusted'
            ? 'invalid'
            : chainStatus,
        certificatePolicyErrors: policy.errors,
        cmsMessageDigestValid: signatureValid,
        cmsSignatureValid: signatureValid,
        messages: [
          signatureValid
            ? 'cms_signature_valid: CMS signature and signed attributes verify against the PDF ByteRange digest'
            : 'cms_signature_invalid: CMS signature verification failed',
          chainTrusted
            ? 'certificate_chain_trusted: signer certificate chains to a configured trust anchor'
            : chainMessage(chainStatus),
          revocationMessage(revocationStatus),
          ltvMessage(ltvStatus),
          timestamp.message,
        ],
        ltvStatus,
        revocationStatus,
        timestampValid: timestamp.valid,
        trustAnchor: chainTrusted ? (trustAnchor?.subject ?? null) : null,
        trustAnchorFingerprint: chainTrusted
          ? (trustAnchor?.fingerprintSha256 ?? null)
          : null,
      };
    } catch (error) {
      const ltvStatus = evidenceLtvStatus === 'missing' ? 'missing' : 'invalid';
      const messages = [
        cmsErrorMessage(error),
        chainMessage(chainStatus),
        revocationMessage(revocationStatus),
        ltvMessage(ltvStatus),
      ];

      return {
        certificateChain: parsed.certificates.map(certificateToResponse),
        certificateChainStatus:
          chainStatus === 'trusted' ? 'invalid' : chainStatus,
        certificatePolicyErrors: policy.errors,
        cmsMessageDigestValid: isMessageDigestFailure(error) ? false : null,
        cmsSignatureValid: false,
        ltvStatus,
        messages,
        revocationStatus,
        timestampValid: timestamp.valid,
        trustAnchor: null,
        trustAnchorFingerprint: null,
      };
    }
  }
}

function getEmbeddedRevocationStatus(
  signedData: SignedData,
): PdfCmsVerificationResult['revocationStatus'] {
  const ocspResponses = signedData.ocsps ?? [];
  const crls = (signedData.crls ?? []).filter(
    (crl): crl is CertificateRevocationList =>
      crl instanceof CertificateRevocationList,
  );

  if (!ocspResponses.length && !crls.length) {
    return 'missing';
  }

  return 'unknown';
}

function getCertificateChainStatus(input: {
  certificates: Certificate[];
  policyErrors: string[];
  trustedRoots: Certificate[];
}): PdfCmsVerificationResult['certificateChainStatus'] {
  const { certificates, policyErrors, trustedRoots } = input;

  if (!certificates.length) {
    return 'missing';
  }

  if (policyErrors.some((error) => error.includes('expired'))) {
    return 'expired';
  }

  if (policyErrors.length) {
    return 'invalid';
  }

  return findTrustAnchor(certificates, trustedRoots) ? 'trusted' : 'external';
}

function certificateToResponse(certificate: Certificate): PdfCmsCertificate {
  return {
    issuer: formatCertificateName(certificate.issuer.typesAndValues),
    serialNumber: certificate.serialNumber.valueBlock.toString(),
    subject: formatCertificateName(certificate.subject.typesAndValues),
    validFrom: certificate.notBefore.value.toISOString(),
    validTo: certificate.notAfter.value.toISOString(),
  };
}

function formatCertificateName(
  values: Certificate['subject']['typesAndValues'],
): string {
  return values
    .map((value) => {
      const name = oidToShortName(value.type);
      const text = formatRdnValue(value.value);

      return `${name}=${text}`;
    })
    .join(', ');
}

function findTrustAnchor(
  certificates: Certificate[],
  trustedRoots: Certificate[],
): { fingerprintSha256: string; subject: string } | null {
  const rootFingerprints = new Map(
    trustedRoots.map((certificate) => [
      certificateFingerprint(certificate),
      formatCertificateName(certificate.subject.typesAndValues),
    ]),
  );

  for (const certificate of certificates) {
    const fingerprint = certificateFingerprint(certificate);
    const subject = rootFingerprints.get(fingerprint);

    if (subject) {
      return { fingerprintSha256: fingerprint, subject };
    }
  }

  return null;
}

function certificateFingerprint(certificate: Certificate): string {
  const buffer = Buffer.from(certificate.toSchema(true).toBER(false));

  return createHash('sha256').update(buffer).digest('hex');
}

function getCertificatePolicy(
  certificates: Certificate[],
  now: Date,
  cms: SignedData,
): {
  errors: string[];
} {
  const errors: string[] = [];
  let signer: Certificate;
  try {
    signer = cmsSignerCertificate(cms);
  } catch {
    return { errors: ['certificate_signer_missing'] };
  }

  certificates.forEach((certificate, index) => {
    const label =
      formatCertificateName(certificate.subject.typesAndValues) ||
      `certificate_${index}`;

    if (certificate.notBefore.value > now || certificate.notAfter.value < now) {
      errors.push(`certificate_expired: ${label}`);
    }

    if (certificate !== signer && !hasCaBasicConstraints(certificate)) {
      errors.push(`certificate_not_ca: ${label}`);
    }
  });

  return { errors };
}

function hasCaBasicConstraints(certificate: Certificate): boolean {
  const extensions = certificate.extensions ?? [];
  const basicConstraints = extensions.find(
    (extension) => extension.extnID === '2.5.29.19',
  )?.parsedValue as { cA?: boolean } | undefined;

  return basicConstraints?.cA === true;
}

function formatRdnValue(value: unknown): string {
  if (!value || typeof value !== 'object' || !('valueBlock' in value)) {
    return '';
  }

  const valueBlock = value.valueBlock;

  if (valueBlock && typeof valueBlock === 'object' && 'value' in valueBlock) {
    const raw = valueBlock.value;

    if (
      typeof raw === 'string' ||
      typeof raw === 'number' ||
      typeof raw === 'boolean' ||
      typeof raw === 'bigint'
    ) {
      return String(raw);
    }
  }

  return '';
}

function oidToShortName(oid: string): string {
  switch (oid) {
    case '2.5.4.3':
      return 'CN';
    case '2.5.4.6':
      return 'C';
    case '2.5.4.10':
      return 'O';
    default:
      return oid;
  }
}

function missingCmsResult(
  extraMessages: string[] = [],
): PdfCmsVerificationResult {
  return {
    certificateChain: [],
    certificateChainStatus: 'missing',
    certificatePolicyErrors: [],
    cmsMessageDigestValid: null,
    cmsSignatureValid: null,
    ltvStatus: 'missing',
    messages: [
      ...extraMessages,
      'certificate_chain_missing: CMS certificate chain was not found',
      'revocation_evidence_missing: no embedded OCSP or CRL evidence was found',
      'ltv_missing: no matching DSS/VRI entry was found for this signature',
    ],
    revocationStatus: 'missing',
    timestampValid: null,
    trustAnchor: null,
    trustAnchorFingerprint: null,
  };
}

function cmsErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (isMessageDigestFailure(error)) {
    return 'cms_message_digest_invalid: signed messageDigest does not match the PDF ByteRange digest';
  }

  if (error instanceof SignedDataVerifyError) {
    return `cms_signature_invalid: ${message}`;
  }

  return `cms_signature_invalid: ${message}`;
}

function isMessageDigestFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("message digest doesn't match")
  );
}

function chainMessage(
  status: PdfCmsVerificationResult['certificateChainStatus'],
): string {
  if (status === 'trusted') {
    return 'certificate_chain_trusted: CMS chain resolves to a trusted account or Signa root certificate';
  }

  if (status === 'external') {
    return 'certificate_chain_external: CMS chain is present but does not chain to a trusted Signa or account root';
  }

  if (status === 'expired') {
    return 'certificate_chain_expired: CMS chain contains a certificate outside its validity window';
  }

  if (status === 'invalid') {
    return 'certificate_chain_invalid: CMS chain failed local trust policy checks';
  }

  return 'certificate_chain_missing: CMS certificate chain was not found';
}

function revocationMessage(
  status: PdfCmsVerificationResult['revocationStatus'],
): string {
  switch (status) {
    case 'good':
      return 'revocation_evidence_present: embedded OCSP or CRL evidence was found';
    case 'revoked':
      return 'revocation_evidence_revoked: embedded evidence reports a revoked certificate';
    case 'unknown':
      return 'revocation_evidence_unknown: embedded revocation evidence could not be fully classified';
    case 'missing':
      return 'revocation_evidence_missing: no embedded OCSP or CRL evidence was found';
    case 'unavailable':
      return 'revocation_evidence_unavailable: revocation endpoints could not be reached';
  }
}

function getLtvStatus(input: {
  hasMatchingVri: boolean;
  revocationStatus: PdfCmsVerificationResult['revocationStatus'];
}): PdfCmsVerificationResult['ltvStatus'] {
  if (!input.hasMatchingVri) {
    return 'missing';
  }

  if (input.revocationStatus === 'missing') {
    return 'missing';
  }

  return input.revocationStatus === 'good' ? 'valid' : 'invalid';
}

function ltvMessage(status: PdfCmsVerificationResult['ltvStatus']): string {
  switch (status) {
    case 'valid':
      return 'ltv_valid: matching DSS/VRI revocation evidence validates for this signature';
    case 'invalid':
      return 'ltv_invalid: matching DSS/VRI evidence is present but could not be validated as good';
    case 'missing':
      return 'ltv_missing: no matching DSS/VRI entry was found for this signature';
  }
}
