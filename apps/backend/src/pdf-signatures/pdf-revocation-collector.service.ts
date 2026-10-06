import {
  validateOcspEvidence,
  validateCrlEvidence,
  parseBasicOcspResponse,
  parseCrl,
} from './revocation-evidence-validation';
import { fetchPki } from './pki-http';
import {
  parsePemCertificates,
  signatureValidationPaths,
} from './certificate-validation-path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import * as asn1js from 'asn1js';
import { BasicOCSPResponse, Certificate, OCSPRequest } from 'pkijs';
import {
  certificateToDer,
  ParsedPdfCmsSignature,
  parsePdfCmsSignature,
  toArrayBuffer,
} from './pdf-cms-utils';
import { PdfDssEvidence, ParsedPdfDssEvidence } from './pdf-dss-vri-embedder';
import { detectPdfSignatures } from './pdf-signature-detection';
import { PdfRevocationEvidenceStatus } from './entities/pdf-revocation-evidence.entity';
import { PdfRevocationEvidenceService } from './pdf-revocation-evidence.service';
import { StoredSigningCertificateRevocation } from './pdf-signature-certificate';
import { buildSignaInternalCrl } from './signa-internal-crl';

const maxOcspResponseBytes = 1024 * 1024;
const maxCrlResponseBytes = 10 * 1024 * 1024;

export type PdfLtvCollectionResult = {
  evidences: PdfDssEvidence[];
  metadata: {
    evidenceStatus: PdfRevocationEvidenceStatus | 'missing';
    ltvRequired: boolean;
  };
};

@Injectable()
export class PdfRevocationCollectorService {
  private readonly logger = new Logger(PdfRevocationCollectorService.name);
  private readonly inFlightCollections = new Map<
    string,
    Promise<CollectedEvidence>
  >();

  constructor(
    private readonly config: ConfigService,
    private readonly evidenceCache: PdfRevocationEvidenceService,
  ) {}

  async collectForSignedPdf(input: {
    accountId: string;
    internalRevocation: StoredSigningCertificateRevocation | null;
    pdfBuffer: Buffer;
  }): Promise<PdfLtvCollectionResult> {
    const signatures = detectPdfSignatures(input.pdfBuffer).filter(
      (signature) => !signature.isTimestampSignature,
    );
    const evidences: PdfDssEvidence[] = [];
    const statuses: Array<PdfRevocationEvidenceStatus | 'missing'> = [];

    for (const signature of signatures) {
      const parsed = parsePdfCmsSignature(signature.contents);

      if (!parsed) {
        statuses.push('missing');
        continue;
      }

      const evidence = await this.collectForCmsSignature({
        accountId: input.accountId,
        internalRevocation: input.internalRevocation,
        parsed,
      });

      evidences.push(evidence.dssEvidence);
      statuses.push(evidence.status);
    }

    const evidenceStatus = summarizeEvidenceStatuses(statuses);

    return {
      evidences,
      metadata: {
        evidenceStatus,
        ltvRequired: this.config.get<boolean>('PDF_LTV_REQUIRED', false),
      },
    };
  }

  async validateEmbeddedEvidence(input: {
    evidence: ParsedPdfDssEvidence;
    parsed: ParsedPdfCmsSignature;
    validationTime?: Date;
  }): Promise<PdfRevocationEvidenceStatus | 'missing'> {
    if (!input.evidence.hasMatchingVri) {
      return 'missing';
    }

    try {
      const additional = input.evidence.certificateDer.map(
        (der) =>
          new Certificate({
            schema: asn1js.fromBER(toArrayBuffer(der)).result,
          }),
      );
      const paths = await signatureValidationPaths(
        input.parsed.signedData,
        additional,
      );
      const statuses: Array<PdfRevocationEvidenceStatus | 'missing'> = [];
      for (const path of paths) {
        for (let index = 0; index < path.certificates.length - 1; index++) {
          statuses.push(
            await this.validateCertificateEvidence(
              input.evidence,
              path.certificates[index],
              path.certificates[index + 1],
              input.validationTime,
            ),
          );
        }
      }
      return summarizeEvidenceStatuses(statuses);
    } catch {
      return 'missing';
    }
  }

  private async validateCertificateEvidence(
    evidence: ParsedPdfDssEvidence,
    signer: Certificate,
    issuer: Certificate,
    validationTime?: Date,
  ): Promise<PdfRevocationEvidenceStatus | 'missing'> {
    for (const ocsp of evidence.ocspResponses) {
      const status = await validateOcspEvidence(
        ocsp,
        signer,
        issuer,
        validationTime,
      );
      if (status === 'good' || status === 'revoked') return status;
    }
    for (const crl of evidence.crlResponses) {
      const status = await validateCrlEvidence(
        crl,
        signer,
        issuer,
        validationTime,
      );
      if (status === 'good' || status === 'revoked') return status;
    }
    return evidence.ocspResponses.length || evidence.crlResponses.length
      ? 'unknown'
      : 'missing';
  }

  private async collectForCmsSignature(input: {
    accountId: string;
    internalRevocation: StoredSigningCertificateRevocation | null;
    parsed: ParsedPdfCmsSignature;
  }): Promise<{
    dssEvidence: PdfDssEvidence;
    status: PdfRevocationEvidenceStatus | 'missing';
  }> {
    const dssEvidence: PdfDssEvidence = {
      certificateDer: [],
      crlResponses: [],
      ocspResponses: [],
      vriKey: input.parsed.vriKey,
    };
    try {
      const paths = await signatureValidationPaths(
        input.parsed.signedData,
        parsePemCertificates(
          this.config.get<string>('PDF_TSA_TRUST_CERTIFICATES', ''),
        ),
      );
      const statuses: Array<PdfRevocationEvidenceStatus | 'missing'> = [];
      for (const path of paths) {
        dssEvidence.certificateDer.push(
          ...path.certificates.map(certificateToDer),
        );
        for (let index = 0; index < path.certificates.length - 1; index++) {
          const key =
            index === 0
              ? input.internalRevocation?.crl_issuer_private_key_pem
              : input.internalRevocation?.root_crl_issuer_private_key_pem;
          const result = await this.collectForCertificate({
            ...input,
            internalRevocation:
              !path.isTimestamp && key
                ? { crl_issuer_private_key_pem: key }
                : null,
            parsed: {
              ...input.parsed,
              certificates: path.certificates.slice(index),
            },
          });
          statuses.push(result.status);
          dssEvidence.crlResponses.push(...result.dssEvidence.crlResponses);
          dssEvidence.ocspResponses.push(...result.dssEvidence.ocspResponses);
        }
      }
      return { dssEvidence, status: summarizeEvidenceStatuses(statuses) };
    } catch {
      return { dssEvidence, status: 'missing' };
    }
  }

  private async collectForCertificate(input: {
    accountId: string;
    internalRevocation: StoredSigningCertificateRevocation | null;
    parsed: ParsedPdfCmsSignature;
  }): Promise<{
    dssEvidence: PdfDssEvidence;
    status: PdfRevocationEvidenceStatus | 'missing';
  }> {
    const [signer, issuer] = findSignerAndIssuer(input.parsed);
    const certificateDer = input.parsed.certificates.map(certificateToDer);

    if (!signer || !issuer) {
      return {
        dssEvidence: {
          certificateDer,
          crlResponses: [],
          ocspResponses: [],
          vriKey: input.parsed.vriKey,
        },
        status: 'missing',
      };
    }

    const signerDer = certificateToDer(signer);
    const cachedOcsp = await this.evidenceCache.findFresh({
      accountId: input.accountId,
      certificateDer: signerDer,
      evidenceType: 'ocsp',
    });

    const cachedOcspData = cachedEvidenceData(cachedOcsp);

    if (cachedOcspData && cachedOcsp) {
      return {
        dssEvidence: {
          certificateDer,
          crlResponses: [],
          ocspResponses: [cachedOcspData],
          vriKey: input.parsed.vriKey,
        },
        status: await validateOcspEvidence(cachedOcspData, signer, issuer),
      };
    }

    if (input.internalRevocation) {
      return this.collectSignaInternalCrl({
        accountId: input.accountId,
        certificateDer,
        internalRevocation: input.internalRevocation,
        issuer,
        signer,
        vriKey: input.parsed.vriKey,
      });
    }

    const ocsp = cachedOcsp
      ? { data: null, status: cachedOcsp.status }
      : await this.collectOcsp({
          accountId: input.accountId,
          issuer,
          signer,
        });

    if (ocsp.status === 'good' || ocsp.status === 'revoked') {
      return {
        dssEvidence: {
          certificateDer,
          crlResponses: [],
          ocspResponses: ocsp.data ? [ocsp.data] : [],
          vriKey: input.parsed.vriKey,
        },
        status: ocsp.status,
      };
    }

    const crl = await this.collectCrl({
      accountId: input.accountId,
      issuer,
      signer,
    });

    return {
      dssEvidence: {
        certificateDer,
        crlResponses: crl.data ? [crl.data] : [],
        ocspResponses: ocsp.data ? [ocsp.data] : [],
        vriKey: input.parsed.vriKey,
      },
      status: crl.status === 'unavailable' ? ocsp.status : crl.status,
    };
  }

  private async collectSignaInternalCrl(input: {
    accountId: string;
    certificateDer: Buffer[];
    internalRevocation: StoredSigningCertificateRevocation;
    issuer: Certificate;
    signer: Certificate;
    vriKey: string;
  }): Promise<{
    dssEvidence: PdfDssEvidence;
    status: PdfRevocationEvidenceStatus | 'missing';
  }> {
    const signerDer = certificateToDer(input.signer);
    const cachedCrl = await this.evidenceCache.findFresh({
      accountId: input.accountId,
      certificateDer: signerDer,
      evidenceType: 'crl',
    });

    const cachedCrlData = cachedEvidenceData(cachedCrl);

    if (cachedCrl && cachedCrlData) {
      return {
        dssEvidence: {
          certificateDer: input.certificateDer,
          crlResponses: [cachedCrlData],
          ocspResponses: [],
          vriKey: input.vriKey,
        },
        status: await validateCrlEvidence(
          cachedCrlData,
          input.signer,
          input.issuer,
        ),
      };
    }

    const thisUpdate = new Date();
    const nextUpdate = new Date(thisUpdate);

    nextUpdate.setDate(thisUpdate.getDate() + 7);

    try {
      const data = buildSignaInternalCrl({
        issuer: input.issuer,
        issuerPrivateKeyPem:
          input.internalRevocation.crl_issuer_private_key_pem,
        nextUpdate,
        thisUpdate,
      });
      const status = await validateCrlEvidence(
        data,
        input.signer,
        input.issuer,
      );

      await this.evidenceCache.store({
        accountId: input.accountId,
        certificateDer: signerDer,
        data,
        evidenceType: 'crl',
        issuerHash: certificateHash(input.issuer),
        nextUpdate,
        serialNumber: certificateSerial(input.signer),
        status,
        thisUpdate,
        url: 'signa:internal-crl',
      });

      return {
        dssEvidence: {
          certificateDer: input.certificateDer,
          crlResponses: [data],
          ocspResponses: [],
          vriKey: input.vriKey,
        },
        status,
      };
    } catch (error) {
      this.logger.warn(
        `Internal Signa CRL generation failed: ${errorMessage(error)}`,
      );

      return {
        dssEvidence: {
          certificateDer: input.certificateDer,
          crlResponses: [],
          ocspResponses: [],
          vriKey: input.vriKey,
        },
        status: 'unavailable',
      };
    }
  }

  private async collectOcsp(input: {
    accountId: string;
    issuer: Certificate;
    signer: Certificate;
  }): Promise<CollectedEvidence> {
    const key = `ocsp:${input.accountId}:${certificateHash(input.signer)}`;

    return this.singleFlight(key, () => this.collectOcspUncached(input));
  }

  private async collectOcspUncached(input: {
    accountId: string;
    issuer: Certificate;
    signer: Certificate;
  }): Promise<CollectedEvidence> {
    const urls = getExtensionHttpUrls(input.signer, '1.3.6.1.5.5.7.1.1');
    const issuerHash = certificateHash(input.issuer);
    const serialNumber = certificateSerial(input.signer);

    for (const url of urls) {
      try {
        const request = new OCSPRequest();
        await request.createForCertificate(input.signer, {
          hashAlgorithm: 'SHA-1',
          issuerCertificate: input.issuer,
        });
        const response = await fetchPki(url, {
          body: Buffer.from(request.toSchema(true).toBER(false)),
          headers: {
            Accept: 'application/ocsp-response',
            'Content-Type': 'application/ocsp-request',
          },
          method: 'POST',
          timeoutMs: this.config.get<number>('PDF_LTV_HTTP_TIMEOUT_MS', 10_000),
        });

        if (!response.ok) {
          continue;
        }

        const data = await readLimitedResponseBody(
          response,
          maxOcspResponseBytes,
        );
        const status = await validateOcspEvidence(
          data,
          input.signer,
          input.issuer,
        );
        const basic = parseBasicOcspResponse(data);

        await this.evidenceCache.store({
          accountId: input.accountId,
          certificateDer: certificateToDer(input.signer),
          data,
          evidenceType: 'ocsp',
          issuerHash,
          nextUpdate: getOcspNextUpdate(basic),
          serialNumber,
          status,
          thisUpdate: getOcspThisUpdate(basic),
          url,
        });

        return { data, status };
      } catch (error) {
        this.logger.warn(
          `OCSP collection failed for ${url}: ${errorMessage(error)}`,
        );
      }
    }

    if (urls.length) {
      await this.evidenceCache.store({
        accountId: input.accountId,
        certificateDer: certificateToDer(input.signer),
        data: null,
        evidenceType: 'ocsp',
        issuerHash,
        nextUpdate: null,
        serialNumber,
        status: 'unavailable',
        thisUpdate: null,
        url: urls[0],
      });
    }

    return { data: null, status: 'unavailable' };
  }

  private async collectCrl(input: {
    accountId: string;
    issuer: Certificate;
    signer: Certificate;
  }): Promise<CollectedEvidence> {
    const cached = await this.evidenceCache.findFresh({
      accountId: input.accountId,
      certificateDer: certificateToDer(input.signer),
      evidenceType: 'crl',
    });

    if (cached) {
      return {
        data: cachedEvidenceData(cached),
        status: cachedEvidenceData(cached)
          ? await validateCrlEvidence(
              cachedEvidenceData(cached)!,
              input.signer,
              input.issuer,
            )
          : 'unavailable',
      };
    }

    const key = `crl:${input.accountId}:${certificateHash(input.signer)}`;

    return this.singleFlight(key, () => this.collectCrlUncached(input));
  }

  private async collectCrlUncached(input: {
    accountId: string;
    issuer: Certificate;
    signer: Certificate;
  }): Promise<CollectedEvidence> {
    const urls = getExtensionHttpUrls(input.signer, '2.5.29.31');
    const issuerHash = certificateHash(input.issuer);
    const serialNumber = certificateSerial(input.signer);

    for (const url of urls) {
      try {
        const response = await fetchPki(url, {
          headers: { Accept: 'application/pkix-crl,*/*' },
          timeoutMs: this.config.get<number>('PDF_LTV_HTTP_TIMEOUT_MS', 10_000),
        });

        if (!response.ok) {
          continue;
        }

        const data = await readLimitedResponseBody(
          response,
          maxCrlResponseBytes,
        );
        const status = await validateCrlEvidence(
          data,
          input.signer,
          input.issuer,
        );
        const crl = parseCrl(data);

        await this.evidenceCache.store({
          accountId: input.accountId,
          certificateDer: certificateToDer(input.signer),
          data,
          evidenceType: 'crl',
          issuerHash,
          nextUpdate: crl?.nextUpdate?.value ?? null,
          serialNumber,
          status,
          thisUpdate: crl?.thisUpdate.value ?? null,
          url,
        });

        return { data, status };
      } catch (error) {
        this.logger.warn(
          `CRL collection failed for ${url}: ${errorMessage(error)}`,
        );
      }
    }

    if (urls.length) {
      await this.evidenceCache.store({
        accountId: input.accountId,
        certificateDer: certificateToDer(input.signer),
        data: null,
        evidenceType: 'crl',
        issuerHash,
        nextUpdate: null,
        serialNumber,
        status: 'unavailable',
        thisUpdate: null,
        url: urls[0],
      });
    }

    return { data: null, status: 'unavailable' };
  }

  private singleFlight(
    key: string,
    operation: () => Promise<CollectedEvidence>,
  ): Promise<CollectedEvidence> {
    const existing = this.inFlightCollections.get(key);

    if (existing) {
      return existing;
    }

    const pending = operation().finally(() => {
      if (this.inFlightCollections.get(key) === pending) {
        this.inFlightCollections.delete(key);
      }
    });

    this.inFlightCollections.set(key, pending);
    return pending;
  }
}

type CollectedEvidence = {
  data: Buffer | null;
  status: PdfRevocationEvidenceStatus;
};

function cachedEvidenceData(
  evidence: {
    dataBase64?: string | null;
  } | null,
): Buffer | null {
  return evidence?.dataBase64
    ? Buffer.from(evidence.dataBase64, 'base64')
    : null;
}

function findSignerAndIssuer(
  parsed: ParsedPdfCmsSignature,
): [Certificate | null, Certificate | null] {
  const signer = parsed.certificates[0] ?? null;
  const issuer =
    signer &&
    parsed.certificates.find(
      (certificate) =>
        formatName(certificate.subject) === formatName(signer.issuer),
    );

  return [signer, issuer || null];
}

function getExtensionHttpUrls(certificate: Certificate, oid: string): string[] {
  const extension = certificate.extensions?.find((item) => item.extnID === oid);

  if (!extension) {
    return [];
  }

  if (oid === '1.3.6.1.5.5.7.1.1') {
    const access = extension.parsedValue as
      | {
          accessDescriptions?: Array<{
            accessMethod: string;
            accessLocation: { type: number; value: string };
          }>;
        }
      | undefined;
    return (access?.accessDescriptions ?? [])
      .filter(
        (entry) =>
          entry.accessMethod === '1.3.6.1.5.5.7.48.1' &&
          entry.accessLocation.type === 6,
      )
      .map((entry) => entry.accessLocation.value)
      .filter((value) => /^https?:\/\//.test(value));
  }
  return [...collectHttpUrls(extension.toJSON())];
}

function collectHttpUrls(value: unknown): Set<string> {
  const urls = new Set<string>();

  if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
    urls.add(value);
    return urls;
  }

  if (!value || typeof value !== 'object') {
    return urls;
  }

  for (const child of Object.values(value)) {
    for (const url of collectHttpUrls(child)) {
      urls.add(url);
    }
  }

  return urls;
}

function getOcspThisUpdate(response: BasicOCSPResponse | null): Date | null {
  return response?.tbsResponseData.responses[0]?.thisUpdate ?? null;
}

function getOcspNextUpdate(response: BasicOCSPResponse | null): Date | null {
  return response?.tbsResponseData.responses[0]?.nextUpdate ?? null;
}

function certificateHash(certificate: Certificate): string {
  return createHash('sha256')
    .update(certificateToDer(certificate))
    .digest('hex');
}

function certificateSerial(certificate: Certificate): string {
  return certificate.serialNumber.valueBlock.toString();
}

function formatName(name: Certificate['subject']): string {
  return name.typesAndValues
    .map((value) => `${value.type}:${String(value.value.valueBlock.value)}`)
    .join('|');
}

async function readLimitedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const contentLength = Number(response.headers.get('content-length'));

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Revocation response exceeds ${maxBytes} bytes`);
  }

  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`Revocation response exceeds ${maxBytes} bytes`);
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    totalBytes,
  );
}

function summarizeEvidenceStatuses(
  statuses: Array<PdfRevocationEvidenceStatus | 'missing'>,
): PdfRevocationEvidenceStatus | 'missing' {
  if (!statuses.length) {
    return 'missing';
  }

  if (statuses.includes('revoked')) {
    return 'revoked';
  }

  if (statuses.every((status) => status === 'good')) {
    return 'good';
  }

  if (statuses.includes('unknown')) {
    return 'unknown';
  }

  if (statuses.includes('unavailable')) {
    return 'unavailable';
  }

  return 'missing';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
