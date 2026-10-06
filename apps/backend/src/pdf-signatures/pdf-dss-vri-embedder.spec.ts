import { PDFDocument } from 'pdf-lib';
import { PdfiumProcessingService } from '../pdf-processing/pdfium-processing.service';
import { PdfDssVriEmbedder } from './pdf-dss-vri-embedder';

describe('PdfDssVriEmbedder', () => {
  it('preserves prior VRI entries and reuses identical evidence streams', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);

    const embedder = new PdfDssVriEmbedder();
    // DER is binary: embedded delimiters and a trailing CR must be preserved.
    const certificate = Buffer.from('shared-certificate\nendstream\r');
    const first = embedder.embed({
      evidences: [
        {
          certificateDer: [certificate],
          crlResponses: [Buffer.from('first-crl')],
          ocspResponses: [],
          vriKey: 'A1',
        },
      ],
      pdfBuffer: Buffer.from(await pdf.save({ useObjectStreams: false })),
    });
    const second = embedder.embed({
      evidences: [
        {
          certificateDer: [certificate],
          crlResponses: [],
          ocspResponses: [Buffer.from('second-ocsp')],
          vriKey: 'B2',
        },
      ],
      pdfBuffer: first,
    });
    const context = embedder.prepareRead(second);

    expect(embedder.read({ context, vriKey: 'A1' })).toMatchObject({
      certificateDer: [certificate],
      crlResponses: [Buffer.from('first-crl')],
      hasMatchingVri: true,
    });
    expect(embedder.read({ context, vriKey: 'B2' })).toMatchObject({
      certificateDer: [certificate],
      hasMatchingVri: true,
      ocspResponses: [Buffer.from('second-ocsp')],
    });
    expect(countOccurrences(second, certificate)).toBe(1);
  });

  it('matches the exact catalog object when later object numbers share its suffix', async () => {
    const pdf = await PDFDocument.create();

    for (let page = 0; page < 30; page += 1) {
      pdf.addPage([200, 200]);
    }

    const source = Buffer.from(await pdf.save({ useObjectStreams: false }));

    expect(source.toString('latin1')).toContain('\n31 0 obj');

    const embedded = new PdfDssVriEmbedder().embed({
      evidences: [
        {
          certificateDer: [Buffer.from('certificate-evidence')],
          crlResponses: [Buffer.from('crl-evidence')],
          ocspResponses: [],
          vriKey: 'A1',
        },
      ],
      pdfBuffer: source,
    });

    await expect(PDFDocument.load(embedded)).resolves.toBeDefined();
    await expect(
      new PdfiumProcessingService().inspectPdf(embedded),
    ).resolves.toBeDefined();
  });
});

function countOccurrences(haystack: Buffer, needle: Buffer): number {
  let count = 0;
  let offset = 0;

  while ((offset = haystack.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }

  return count;
}
