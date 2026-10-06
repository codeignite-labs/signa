/* eslint-disable @typescript-eslint/require-await -- Test adapters deliberately implement asynchronous interfaces. */
import { ConfigService } from '@nestjs/config';
import { PDFDocument } from 'pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import forge from 'node-forge';
import { EncryptedConfig } from '../accounts/entities/encrypted-config.entity';
import { PdfSignatureVerifierService } from '../tools/pdf-signature-verifier.service';
import { timestampServerUrlKey } from './pdf-signature-certificate';
import {
  detectPdfSignatures,
  materializePdfSignedBytes,
} from './pdf-signature-detection';
import { PdfDssVriEmbedder } from './pdf-dss-vri-embedder';
import { PdfRevocationEvidenceService } from './pdf-revocation-evidence.service';
import { PdfRevocationCollectorService } from './pdf-revocation-collector.service';
import { PdfSignatureService } from './pdf-signature.service';
import { Rfc3161TimestampClient } from './rfc3161-timestamp-client';
import { createTestTimestampAuthority } from './test-timestamp-authority';
import { fetchPki } from './pki-http';
import { parsePdfCmsSignature, certificateToDer } from './pdf-cms-utils';

jest.mock('./pki-http', () => ({ fetchPki: jest.fn() }));
jest.setTimeout(30_000);

describe('PAdES signing with a real TSA and full-chain DSS', () => {
  it('verifies CMS, TSA, signer/intermediate/TSA CRLs and configured trust', async () => {
    const oldKey = process.env.SIGNING_KEY_ENCRYPTION_KEY;
    process.env.SIGNING_KEY_ENCRYPTION_KEY = 'b2'.repeat(32);
    const tsa = createTestTimestampAuthority();
    try {
      jest
        .mocked(fetchPki)
        .mockImplementation(
          async (url, options) =>
            new Response(
              new Uint8Array(
                String(url) === tsa.uri
                  ? tsa.crl
                  : tsa.respond(Buffer.from(options.body!)),
              ),
            ),
        );
      const configs = new Map<string, EncryptedConfig>();
      configs.set(timestampServerUrlKey, {
        accountId: '1',
        key: timestampServerUrlKey,
        value: 'https://tsa.example.com',
      } as EncryptedConfig);
      const config = new ConfigService({
        PDF_LTV_REQUIRED: true,
        PDF_TIMESTAMP_REQUIRED: true,
        PDF_TSA_TRUST_CERTIFICATES: tsa.rootPem,
      });
      const dss = new PdfDssVriEmbedder();
      const cache = new PdfRevocationEvidenceService({
        create: (value: unknown) => value,
        findOne: async () => null,
        save: async (value: unknown) => value,
      } as never);
      const collector = new PdfRevocationCollectorService(config, cache);
      const service = new PdfSignatureService(
        {
          create: (value: EncryptedConfig) => value,
          findOne: async ({ where }: { where: { key: string } }) =>
            configs.get(where.key) ?? null,
          save: async (value: EncryptedConfig) => {
            configs.set(value.key, value);
            return value;
          },
        } as never,
        config,
        new Rfc3161TimestampClient(config),
        collector,
        dss,
        {
          convertBeforeSigning: async (buffer: Buffer) => ({
            buffer,
            metadata: {},
          }),
        } as never,
      );
      const pdf = await PDFDocument.create();
      pdf.addPage([200, 200]);
      const result = await service.signPdf({
        accountId: '1',
        buffer: Buffer.from(await pdf.save()),
        signerName: 'Organization',
        reason: 'Signed document',
      });
      expect(result.timestamp.status).toBe('embedded');
      expect(result.ltv.evidenceStatus).toBe('good');
      const signatures = detectPdfSignatures(result.buffer);
      expect(signatures).toHaveLength(1); // CMS timestamp, no orphan document timestamp
      const signature = signatures[0];
      const parsed = parsePdfCmsSignature(signature.contents)!;
      const evidence = dss.read({
        pdfBuffer: result.buffer,
        vriKey: parsed.vriKey,
      });
      expect(evidence.crlResponses).toHaveLength(3);
      expect(
        await collector.validateEmbeddedEvidence({
          evidence: {
            ...evidence,
            crlResponses: evidence.crlResponses.slice(0, 1),
          },
          parsed,
        }),
      ).not.toBe('good');
      expect(
        await collector.validateEmbeddedEvidence({
          evidence,
          parsed,
          validationTime: new Date(Date.now() + 8 * 86400_000),
        }),
      ).not.toBe('good');
      const verifier = new PdfSignatureVerifierService(dss, collector, config);
      const verification = await verifier.verify({
        cmsContents: signature.contents,
        pdfBuffer: result.buffer,
        signedBytes: materializePdfSignedBytes(
          result.buffer,
          signature.byteRange.ranges,
        ),
        trustedCertificates: [parsed.certificates.at(-1)!, tsa.rootCertificate],
      });
      expect(verification).toMatchObject({
        cmsSignatureValid: true,
        timestampValid: true,
        certificateChainStatus: 'trusted',
        revocationStatus: 'good',
        ltvStatus: 'valid',
      });
      const untrusted = await verifier.verify({
        cmsContents: signature.contents,
        pdfBuffer: result.buffer,
        signedBytes: materializePdfSignedBytes(
          result.buffer,
          signature.byteRange.ranges,
        ),
      });
      expect(untrusted.certificateChainStatus).toBe('external');
      expect(untrusted.ltvStatus).not.toBe('valid');
      if (process.env.SIGNA_AUDIT_OUTPUT_DIR) {
        const directory = process.env.SIGNA_AUDIT_OUTPUT_DIR;
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, 'signed.pdf'), result.buffer);
        writeFileSync(
          join(directory, 'roots.pem'),
          forge.pki.certificateToPem(
            forge.pki.certificateFromAsn1(
              forge.asn1.fromDer(
                certificateToDer(parsed.certificates.at(-1)!).toString(
                  'binary',
                ),
              ),
            ),
          ) + tsa.rootPem,
        );
      }
      jest.spyOn(dss, 'embed').mockImplementation(({ pdfBuffer }) => pdfBuffer);
      await expect(
        service.signPdf({
          accountId: '1',
          buffer: Buffer.from(await pdf.save()),
          signerName: 'Organization',
          reason: 'Signed document',
        }),
      ).rejects.toMatchObject({
        response: {
          error: 'PDF LTV evidence could not be embedded into the signed PDF',
        },
      });
    } finally {
      tsa.dispose();
      if (oldKey === undefined) delete process.env.SIGNING_KEY_ENCRYPTION_KEY;
      else process.env.SIGNING_KEY_ENCRYPTION_KEY = oldKey;
    }
  });
});
