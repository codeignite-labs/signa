import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import signpdf from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import { PDFDocument } from 'pdf-lib';
import {
  generateSignaDefaultCertificate,
  p12BufferFromStoredCertificate,
} from '../pdf-signatures/pdf-signature-certificate';
import { PdfDssVriEmbedder } from '../pdf-signatures/pdf-dss-vri-embedder';
import { PdfRevocationCollectorService } from '../pdf-signatures/pdf-revocation-collector.service';
import { PdfSignatureVerifierService } from './pdf-signature-verifier.service';

jest.setTimeout(20_000);

describe('PdfSignatureVerifierService', () => {
  const revocationCollector = {
    validateEmbeddedEvidence: jest.fn().mockResolvedValue('missing'),
  } as unknown as PdfRevocationCollectorService;
  const service = new PdfSignatureVerifierService(
    new PdfDssVriEmbedder(),
    revocationCollector,
  );

  it('validates CMS signed attributes and the PDF ByteRange digest', async () => {
    const signedPdf = await buildSignedPdf();
    const signature = extractSignatureInput(signedPdf);

    await expect(service.verify(signature)).resolves.toMatchObject({
      certificateChainStatus: 'external',
      cmsMessageDigestValid: true,
      cmsSignatureValid: true,
      revocationStatus: 'missing',
    });
  });

  it('detects ByteRange digest mismatches through CMS messageDigest validation', async () => {
    const signedPdf = await buildSignedPdf();
    const signature = extractSignatureInput(signedPdf);
    const tamperedSignedBytes = Buffer.from(signature.signedBytes);

    tamperedSignedBytes[20] = tamperedSignedBytes[20] ^ 1;

    await expect(
      service.verify({
        ...signature,
        signedBytes: tamperedSignedBytes,
      }),
    ).resolves.toMatchObject({
      cmsMessageDigestValid: false,
      cmsSignatureValid: false,
    });
  });
});

async function buildSignedPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();

  pdf.addPage([200, 200]);

  pdflibAddPlaceholder({
    appName: 'Signa',
    contactInfo: 'ada@example.com',
    location: '',
    name: 'Ada Lovelace',
    pdfDoc: pdf,
    reason: 'Signed document',
    signatureLength: 16_384,
    signingTime: new Date('2026-06-22T00:00:00.000Z'),
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
  });

  const certificate = generateSignaDefaultCertificate();
  const signer = new P12Signer(p12BufferFromStoredCertificate(certificate), {
    passphrase: certificate.password ?? '',
  });

  return Buffer.from(
    await signpdf.sign(
      Buffer.from(
        await pdf.save({ addDefaultPage: false, useObjectStreams: false }),
      ),
      signer,
      new Date('2026-06-22T00:00:00.000Z'),
    ),
  );
}

function extractSignatureInput(file: Buffer): {
  cmsContents: Buffer;
  pdfBuffer: Buffer;
  signedBytes: Buffer;
} {
  const text = file.toString('latin1');
  const byteRangeText = /\/ByteRange\s*\[([^\]]+)\]/.exec(text)?.[1];
  const contentsHex = /\/Contents\s*<([0-9A-Fa-f\s]+)>/.exec(text)?.[1];

  if (!byteRangeText || !contentsHex) {
    throw new Error('Signed PDF fixture is missing signature data');
  }

  const values = byteRangeText.match(/\d+/g)?.map(Number) ?? [];

  if (values.length !== 4) {
    throw new Error('Signed PDF fixture has malformed ByteRange');
  }

  const [firstOffset, firstLength, secondOffset, secondLength] = values;
  const signedBytes = Buffer.concat([
    file.subarray(firstOffset, firstOffset + firstLength),
    file.subarray(secondOffset, secondOffset + secondLength),
  ]);

  return {
    cmsContents: Buffer.from(contentsHex.replace(/\s/g, ''), 'hex'),
    pdfBuffer: file,
    signedBytes,
  };
}
