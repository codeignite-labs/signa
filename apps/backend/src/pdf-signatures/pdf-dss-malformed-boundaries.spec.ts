import { Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { PdfDssVriEmbedder, type PdfDssEvidence } from './pdf-dss-vri-embedder';
const evidence = (overrides: Partial<PdfDssEvidence> = {}): PdfDssEvidence => ({
  certificateDer: [Buffer.from('certificate')],
  crlResponses: [],
  ocspResponses: [],
  vriKey: 'A1',
  ...overrides,
});
async function source() {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
function damagedDss(stream: string, ref = '4 0 R') {
  return Buffer.from(
    `%PDF-1.7\n1 0 obj\n<< /Type /Catalog /DSS 2 0 R >>\nendobj\n2 0 obj\n<< /Certs [${ref}] /VRI << /A1 3 0 R >> >>\nendobj\n3 0 obj\n<< /Cert [${ref}] >>\nendobj\n4 0 obj\n${stream}\nendobj\ntrailer\n<< /Root 1 0 R /Size 5 >>\nstartxref\n0\n%%EOF`,
    'latin1',
  );
}
afterEach(() => jest.restoreAllMocks());
it('preserves the PDF when evidence is empty and returns empty evidence when DSS is absent', async () => {
  const pdf = await source();
  const embedder = new PdfDssVriEmbedder();
  expect(
    embedder.embed({
      pdfBuffer: pdf,
      evidences: [evidence({ certificateDer: [] })],
    }),
  ).toBe(pdf);
  expect(embedder.read({ pdfBuffer: pdf, vriKey: 'A1' })).toEqual({
    certificateDer: [],
    crlResponses: [],
    ocspResponses: [],
    hasMatchingVri: false,
  });
  expect(embedder.read({ vriKey: 'A1' }).hasMatchingVri).toBe(false);
});
it.each(['ocsp', 'crl'])(
  'embeds %s-only evidence and leaves unrelated VRI keys unmatched',
  async (kind) => {
    const embedder = new PdfDssVriEmbedder();
    const item = evidence({
      certificateDer: [],
      ocspResponses: kind === 'ocsp' ? [Buffer.from('ocsp')] : [],
      crlResponses: kind === 'crl' ? [Buffer.from('crl')] : [],
    });
    const result = embedder.embed({
      pdfBuffer: await source(),
      evidences: [item],
    });
    await expect(PDFDocument.load(result)).resolves.toBeDefined();
    expect(embedder.read({ pdfBuffer: result, vriKey: 'A1' })).toMatchObject({
      certificateDer: [],
      ocspResponses: item.ocspResponses,
      crlResponses: item.crlResponses,
      hasMatchingVri: true,
    });
    expect(
      embedder.read({ pdfBuffer: result, vriKey: 'B2' }).hasMatchingVri,
    ).toBe(false);
  },
);
it('replaces a VRI entry for the same signature and keeps its latest evidence', async () => {
  const embedder = new PdfDssVriEmbedder();
  const first = embedder.embed({
    pdfBuffer: await source(),
    evidences: [evidence()],
  });
  const second = embedder.embed({
    pdfBuffer: first,
    evidences: [evidence({ certificateDer: [Buffer.from('replacement')] })],
  });
  expect(
    embedder.read({ pdfBuffer: second, vriKey: 'A1' }).certificateDer,
  ).toEqual([Buffer.from('replacement')]);
  await expect(PDFDocument.load(second)).resolves.toBeDefined();
});
it.each(['trailer', 'root', 'size', 'catalog-reference', 'catalog-dictionary'])(
  'preserves original bytes and records the reason for malformed %s',
  async (kind) => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const original = (await source()).toString('latin1');
    const damaged =
      kind === 'trailer'
        ? original.replace('trailer', 'missing')
        : kind === 'root'
          ? original.replace(/\/Root \d+ 0 R/, '/MissingRoot 1 0 R')
          : kind === 'size'
            ? original.replace(/\/Size \d+/, '/MissingSize 5')
            : kind === 'catalog-reference'
              ? original.replace(/\/Root \d+ 0 R/, '/Root 999 0 R')
              : original.replace(/(\/Type \/Catalog[\s\S]*?)>>/, '$1');
    const pdf = Buffer.from(damaged, 'latin1');
    expect(
      new PdfDssVriEmbedder().embed({
        pdfBuffer: pdf,
        evidences: [evidence()],
      }),
    ).toBe(pdf);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping DSS/VRI embedding:'),
    );
  },
);
it.each([
  '<< /Length 3 /Filter /FlateDecode >>\nstream\nabc\nendstream',
  '<< /Other 3 >>\nstream\nabc\nendstream',
  '<< /Length 999999 >>\nstream\nabc\nendstream',
  '<< /Length 3 >>\nstream\nabc BROKEN',
  '<< /Length 3 >>',
])('refuses unsafe or unsupported evidence streams %s', (stream) => {
  expect(
    new PdfDssVriEmbedder().read({
      pdfBuffer: damagedDss(stream),
      vriKey: 'A1',
    }),
  ).toEqual({
    certificateDer: [],
    crlResponses: [],
    ocspResponses: [],
    hasMatchingVri: true,
  });
});
it('ignores dangling stream references when reading malformed evidence', () => {
  expect(
    new PdfDssVriEmbedder().read({
      pdfBuffer: damagedDss(
        '<< /Length 3 >>\nstream\nabc\nendstream',
        '999 0 R',
      ),
      vriKey: 'A1',
    }).certificateDer,
  ).toEqual([]);
});
it('rebuilds a DSS dictionary whose prior global evidence reference is not a stream', () => {
  const embedder = new PdfDssVriEmbedder();
  const source = damagedDss('<< /NotAStream true >>');
  const result = embedder.embed({ pdfBuffer: source, evidences: [evidence()] });
  expect(result).not.toBe(source);
  expect(
    embedder.read({ pdfBuffer: result, vriKey: 'A1' }).certificateDer,
  ).toEqual([Buffer.from('certificate')]);
});
