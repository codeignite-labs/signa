import { CertificateChainValidationEngine } from 'pkijs';
import { PdfTrustRootService } from './pdf-trust-root.service';
import {
  Injectable,
  Logger,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import signpdf from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { createHash } from 'node:crypto';
import { PadesSigner, p12SigningIdentity } from './pades-signer';
import {
  decryptSigningKey,
  encryptSigningKey,
  isEncryptedSigningKey,
} from './signing-key-envelope';
import { inspectP12Certificate } from './pdf-signature-certificate';
import {
  SUBFILTER_ADOBE_PKCS7_DETACHED,
  SUBFILTER_ETSI_CADES_DETACHED,
} from '@signpdf/utils';
import { PDFDocument } from 'pdf-lib';
import { Repository } from 'typeorm';
import { EncryptedConfig } from '../accounts/entities/encrypted-config.entity';
import { PdfDssVriEmbedder } from './pdf-dss-vri-embedder';
import { PdfAResult, PdfAService } from './pdf-a.service';
import {
  defaultSigningCertificateKey,
  generateSignaDefaultCertificate,
  parseStoredSigningCertificate,
  p12BufferFromStoredCertificate,
  signaDefaultCertificateName,
  signingCertificatePrefix,
  StoredSigningCertificate,
  timestampServerUrlKey,
} from './pdf-signature-certificate';
import { PdfTimestampEvidence } from './pdf-timestamp-evidence';
import {
  PdfLtvCollectionResult,
  PdfRevocationCollectorService,
} from './pdf-revocation-collector.service';
import {
  parseTimestampServerUrls,
  timestampEndpointLabel,
  Rfc3161TimestampClient,
} from './rfc3161-timestamp-client';

export const pdfSignatureSubFilterModes = ['pades', 'adobe'] as const;

export type PdfSignatureSubFilterMode =
  (typeof pdfSignatureSubFilterModes)[number];

export type PdfSignatureResult = {
  buffer: Buffer;
  certificateName: string | null;
  certificateFingerprint?: string;
  pdfA: PdfAResult['metadata'];
  signed: boolean;
  signatureSubFilter: string;
  timestamp: PdfTimestampEvidence;
  timestampServerUrl: string | null;
  ltv: PdfLtvCollectionResult['metadata'];
};

@Injectable()
export class PdfSignatureService {
  private readonly logger = new Logger(PdfSignatureService.name);

  constructor(
    @InjectRepository(EncryptedConfig)
    private readonly encryptedConfigs: Repository<EncryptedConfig>,
    private readonly config: ConfigService,
    private readonly timestampClient: Rfc3161TimestampClient,
    private readonly revocationCollector: PdfRevocationCollectorService,
    private readonly dssVriEmbedder: PdfDssVriEmbedder,
    private readonly pdfAService: PdfAService,
    @Optional() private readonly trustRoots?: PdfTrustRootService,
  ) {}

  async ensureDefaultCertificate(accountId: string): Promise<EncryptedConfig> {
    const existing = await this.encryptedConfigs.findOne({
      where: {
        accountId,
        key: `${signingCertificatePrefix}${signaDefaultCertificateName}`,
      },
    });

    if (existing) {
      return existing;
    }

    try {
      return await this.encryptedConfigs.save(
        this.encryptedConfigs.create({
          accountId,
          key: `${signingCertificatePrefix}${signaDefaultCertificateName}`,
          value: encryptSigningKey(
            JSON.stringify(generateSignaDefaultCertificate()),
            accountId,
          ),
        }),
      );
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error;
      const winner = await this.encryptedConfigs.findOne({
        where: {
          accountId,
          key: `${signingCertificatePrefix}${signaDefaultCertificateName}`,
        },
      });
      if (!winner) throw error;
      return winner;
    }
  }

  async getActiveCertificateName(accountId: string): Promise<string> {
    // Document cache metadata must not create, decrypt, or migrate signing keys.
    const config = await this.encryptedConfigs.findOne({
      where: { accountId, key: defaultSigningCertificateKey },
    });

    return config?.value || signaDefaultCertificateName;
  }

  async getTimestampServerUrl(accountId: string): Promise<string | null> {
    const config = await this.encryptedConfigs.findOne({
      where: { accountId, key: timestampServerUrlKey },
    });

    return config?.value || null;
  }

  async upsertTimestampServerUrl(
    accountId: string,
    value: string | null,
  ): Promise<string | null> {
    const normalized = value?.trim() ?? '';
    const existing = await this.encryptedConfigs.findOne({
      where: { accountId, key: timestampServerUrlKey },
    });

    if (!normalized) {
      if (existing) {
        await this.encryptedConfigs.remove(existing);
      }

      return null;
    }

    await this.timestampClient.assertTimestampServerWorks(normalized);

    const config =
      existing ??
      this.encryptedConfigs.create({
        accountId,
        key: timestampServerUrlKey,
      });

    config.value = normalized;
    await this.encryptedConfigs.save(config);

    return normalized;
  }

  async loadDefaultCertificate(accountId: string): Promise<{
    certificate: StoredSigningCertificate;
    name: string;
  }> {
    const defaultConfig = await this.encryptedConfigs.findOne({
      where: { accountId, key: defaultSigningCertificateKey },
    });
    const defaultName = defaultConfig?.value || signaDefaultCertificateName;
    if (!defaultConfig) await this.ensureDefaultCertificate(accountId);
    const certificateConfig = await this.encryptedConfigs.findOne({
      where: {
        accountId,
        key: `${signingCertificatePrefix}${defaultName}`,
      },
    });

    if (!certificateConfig)
      throw new UnprocessableEntityException(
        'The active signing certificate is missing; select a valid identity',
      );
    const plaintext = decryptSigningKey(certificateConfig.value, accountId);
    const certificate = parseStoredSigningCertificate(plaintext);
    if (!certificate)
      throw new UnprocessableEntityException(
        'The active signing certificate is malformed',
      );
    const inspection = inspectP12Certificate(
      p12BufferFromStoredCertificate(certificate),
      certificate.password ?? '',
    );
    Object.assign(certificate, inspection);
    if (!isEncryptedSigningKey(certificateConfig.value)) {
      certificateConfig.value = encryptSigningKey(plaintext, accountId);
      await this.encryptedConfigs.save(certificateConfig);
    }

    await this.assertSigningPolicy(certificate, accountId);
    return { certificate, name: defaultName };
  }

  async assertSigningPolicy(
    certificate: StoredSigningCertificate,
    accountId: string,
  ): Promise<void> {
    if (!this.config.get<boolean>('PDF_REQUIRE_TRUSTED_SIGNER', false)) return;
    const identity = p12SigningIdentity(
      p12BufferFromStoredCertificate(certificate),
      certificate.password ?? '',
    );
    const trustedCerts =
      (await this.trustRoots?.getTrustedCertificates(accountId)) ?? [];
    if (!trustedCerts.length)
      throw new UnprocessableEntityException(
        'Upload an approved CA trust anchor before activating this signing identity',
      );
    const result = await new CertificateChainValidationEngine({
      trustedCerts,
      certs: [...identity.certificates.slice(1), identity.certificates[0]],
      checkDate: new Date(),
    }).verify({ passedWhenNotRevValues: true });
    if (!result.result)
      throw new UnprocessableEntityException(
        'The signing certificate does not chain to an approved account CA',
      );
  }

  async signPdf(input: {
    accountId: string;
    buffer: Buffer;
    contactInfo?: string | null;
    reason: string;
    signerName: string;
    signingTime?: Date;
  }): Promise<PdfSignatureResult> {
    const startedAt = Date.now();
    const [{ certificate, name }, timestampServerUrl] = await Promise.all([
      this.loadDefaultCertificate(input.accountId),
      this.getTimestampServerUrl(input.accountId),
    ]);
    const configurationReadyAt = Date.now();
    const signatureSubFilter = this.getSignatureSubFilter();

    try {
      const pdfA = await this.pdfAService.convertBeforeSigning(input.buffer);
      const pdfAReadyAt = Date.now();
      const pdf = await PDFDocument.load(pdfA.buffer, {
        ignoreEncryption: true,
        updateMetadata: false,
      });

      pdflibAddPlaceholder({
        appName: 'Signa',
        contactInfo: input.contactInfo ?? '',
        location: '',
        name: input.signerName,
        pdfDoc: pdf,
        reason: input.reason,
        signatureLength: 16_384,
        signingTime: input.signingTime ?? new Date(),
        subFilter: signatureSubFilter,
      });

      const prepared = Buffer.from(
        await pdf.save({
          addDefaultPage: false,
          useObjectStreams: false,
        }),
      );
      const timestampRequired =
        this.config.get<boolean>('PDF_TIMESTAMP_REQUIRED', false) ||
        this.config.get<boolean>('PDF_LTV_REQUIRED', false);
      let timestamp: PdfTimestampEvidence = {
        attempts: [],
        embedded: false,
        required: timestampRequired,
        status: 'disabled',
        tokenSha256: null,
        url: null,
      };
      const serverUrls = parseTimestampServerUrls(timestampServerUrl);
      if (timestampRequired && !serverUrls.length)
        throw new Error(
          'A trusted timestamp server is required by the signing policy',
        );
      if (
        signatureSubFilter !== SUBFILTER_ETSI_CADES_DETACHED &&
        (timestampRequired || serverUrls.length)
      )
        throw new Error('Timestamped signing requires PAdES mode');
      const timestampSignature = async (signature: Buffer) => {
        if (!serverUrls.length) return null;
        const response = await this.timestampClient.requestTimestampToken({
          digest: createHash('sha256').update(signature).digest(),
          serverUrls,
        });
        timestamp = {
          attempts: response.attempts,
          embedded: !!response.token,
          required: timestampRequired,
          status: response.token ? 'embedded' : 'failed',
          tokenSha256: response.token
            ? createHash('sha256').update(response.token).digest('base64url')
            : null,
          url: response.url,
        };
        if (!response.token && timestampRequired)
          throw new Error('A valid trusted TSA token is required');
        return response.token;
      };
      const signer =
        signatureSubFilter === SUBFILTER_ETSI_CADES_DETACHED
          ? new PadesSigner(
              p12SigningIdentity(
                p12BufferFromStoredCertificate(certificate),
                certificate.password ?? '',
              ),
              timestampSignature,
            )
          : new P12Signer(p12BufferFromStoredCertificate(certificate), {
              passphrase: certificate.password ?? '',
            });

      const signedBuffer = await signpdf.sign(
        prepared,
        signer,
        input.signingTime,
      );
      const cmsReadyAt = Date.now();
      const ltv = await this.revocationCollector.collectForSignedPdf({
        accountId: input.accountId,
        internalRevocation: certificate.internal_revocation ?? null,
        pdfBuffer: signedBuffer,
      });
      const revocationReadyAt = Date.now();

      if (
        ltv.metadata.evidenceStatus === 'revoked' ||
        (ltv.metadata.ltvRequired && ltv.metadata.evidenceStatus !== 'good')
      ) {
        throw new UnprocessableEntityException({
          error:
            'PDF LTV evidence could not be collected for the signer certificate',
          ltv_status: 'missing',
          revocation_status: ltv.metadata.evidenceStatus,
        });
      }

      const ltvPdf = this.dssVriEmbedder.embed({
        evidences: ltv.evidences,
        pdfBuffer: signedBuffer,
      });
      const dssReadyAt = Date.now();
      const completedAt = Date.now();

      const finalEvidenceStatus: PdfLtvCollectionResult['metadata']['evidenceStatus'] =
        ltv.metadata.evidenceStatus === 'good' &&
        this.hasEmbeddedDssEvidence(signedBuffer, ltvPdf)
          ? 'good'
          : ltv.metadata.evidenceStatus === 'good'
            ? 'missing'
            : ltv.metadata.evidenceStatus;

      const finalLtv = {
        ...ltv.metadata,
        evidenceStatus: finalEvidenceStatus,
      };

      if (finalLtv.ltvRequired && finalLtv.evidenceStatus !== 'good') {
        throw new UnprocessableEntityException({
          error: 'PDF LTV evidence could not be embedded into the signed PDF',
          ltv_status: 'missing',
          revocation_status: finalLtv.evidenceStatus,
        });
      }

      this.logger.debug(
        `PDF signing completed ${JSON.stringify({
          accountId: input.accountId,
          bytes: input.buffer.byteLength,
          cmsMs: cmsReadyAt - pdfAReadyAt,
          configurationMs: configurationReadyAt - startedAt,
          dssMs: dssReadyAt - revocationReadyAt,
          pdfAMs: pdfAReadyAt - configurationReadyAt,
          revocationMs: revocationReadyAt - cmsReadyAt,
          timestampMs: completedAt - dssReadyAt,
          totalMs: completedAt - startedAt,
        })}`,
      );

      return {
        buffer: ltvPdf,
        certificateName: name,
        certificateFingerprint: certificate.fingerprint_sha256,
        ltv: finalLtv,
        pdfA: pdfA.metadata,
        signatureSubFilter,
        signed: true,
        timestamp,
        timestampServerUrl: serverUrls.length
          ? serverUrls.map(timestampEndpointLabel).join(',')
          : null,
      };
    } catch (error) {
      this.logger.error(
        `PDF cryptographic signing failed for account ${input.accountId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  private getSignatureSubFilter(): string {
    const mode = this.config.get<PdfSignatureSubFilterMode>(
      'PDF_SIGNATURE_SUBFILTER',
      'pades',
    );

    return mode === 'adobe'
      ? SUBFILTER_ADOBE_PKCS7_DETACHED
      : SUBFILTER_ETSI_CADES_DETACHED;
  }

  private hasEmbeddedDssEvidence(
    signedBuffer: Buffer,
    ltvBuffer: Buffer,
  ): boolean {
    return (
      ltvBuffer.byteLength > signedBuffer.byteLength &&
      ltvBuffer.includes('/DSS')
    );
  }
}
