import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EncryptedConfig } from '../accounts/entities/encrypted-config.entity';
import { PdfRevocationEvidence } from './entities/pdf-revocation-evidence.entity';
import { PdfTrustRoot } from './entities/pdf-trust-root.entity';
import { PdfDssVriEmbedder } from './pdf-dss-vri-embedder';
import { PdfAService } from './pdf-a.service';
import { PdfRevocationCollectorService } from './pdf-revocation-collector.service';
import { PdfRevocationEvidenceService } from './pdf-revocation-evidence.service';
import { PdfSignatureService } from './pdf-signature.service';
import { PdfTrustRootService } from './pdf-trust-root.service';
import { Rfc3161TimestampClient } from './rfc3161-timestamp-client';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EncryptedConfig,
      PdfRevocationEvidence,
      PdfTrustRoot,
    ]),
  ],
  providers: [
    PdfSignatureService,
    PdfAService,
    PdfDssVriEmbedder,
    PdfRevocationCollectorService,
    PdfRevocationEvidenceService,
    PdfTrustRootService,
    Rfc3161TimestampClient,
  ],
  exports: [
    PdfDssVriEmbedder,
    PdfRevocationCollectorService,
    PdfSignatureService,
    PdfTrustRootService,
  ],
})
export class PdfSignaturesModule {}
