import { ConfigService } from '@nestjs/config';
import { createRevocationPkiFixture } from '../../test/support/revocation-pki.fixture';
import { PdfRevocationEvidence } from './entities/pdf-revocation-evidence.entity';
import { PdfRevocationEvidenceService } from './pdf-revocation-evidence.service';
import { PdfRevocationCollectorService } from './pdf-revocation-collector.service';
import { fetchPki } from './pki-http';
import { detectPdfSignatures } from './pdf-signature-detection';
import { certificateToDer, parsePdfCmsSignature } from './pdf-cms-utils';
jest.mock('./pki-http', () => ({ fetchPki: jest.fn() }));
let pki: ReturnType<typeof createRevocationPkiFixture>;
let pdf: Buffer;
beforeAll(async () => {
  pki = createRevocationPkiFixture();
  pdf = await pki.signedPdf();
}, 30000);
beforeEach(() => jest.resetAllMocks());
function setup() {
  const cache = {
    findFresh: jest
      .fn<
        ReturnType<PdfRevocationEvidenceService['findFresh']>,
        Parameters<PdfRevocationEvidenceService['findFresh']>
      >()
      .mockResolvedValue(null),
    store: jest
      .fn<
        ReturnType<PdfRevocationEvidenceService['store']>,
        Parameters<PdfRevocationEvidenceService['store']>
      >()
      .mockResolvedValue(new PdfRevocationEvidence()),
  };
  const service = new PdfRevocationCollectorService(
    new ConfigService({ PDF_LTV_REQUIRED: true }),
    cache as unknown as PdfRevocationEvidenceService,
  );
  const collect = (input: Buffer = pdf) =>
    service.collectForSignedPdf({
      accountId: 'tenant',
      internalRevocation: null,
      pdfBuffer: input,
    });
  return { service, cache, collect };
}
it.each([false, true])(
  'collects authenticated OCSP good/revoked evidence and serializes its validity window (revoked=%s)',
  async (revoked) => {
    const { cache, collect } = setup();
    const data = await pki.ocsp({ revoked });
    jest.mocked(fetchPki).mockResolvedValue(new Response(new Uint8Array(data)));
    const result = await collect();
    expect(result.metadata).toEqual({
      evidenceStatus: revoked ? 'revoked' : 'good',
      ltvRequired: true,
    });
    expect(result.evidences[0].ocspResponses).toEqual([data]);
    expect(cache.store).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'tenant',
        evidenceType: 'ocsp',
        status: revoked ? 'revoked' : 'good',
        thisUpdate: expect.any(Date) as unknown,
        nextUpdate: expect.any(Date) as unknown,
      }),
    );
  },
);
it('tries the next OCSP endpoint after HTTP rejection and falls back to a signed CRL for unknown status', async () => {
  const { collect } = setup();
  const unknown = await pki.ocsp({ unknown: true });
  const crl = await pki.crl();
  jest
    .mocked(fetchPki)
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(new Response(new Uint8Array(unknown)))
    .mockResolvedValueOnce(new Response(new Uint8Array(crl)));
  const result = await collect();
  expect(result.metadata.evidenceStatus).toBe('good');
  expect(result.evidences[0]).toMatchObject({
    ocspResponses: [unknown],
    crlResponses: [crl],
  });
  expect(jest.mocked(fetchPki).mock.calls.map(([url]) => String(url))).toEqual([
    'https://ocsp.example/first',
    'https://ocsp.example/second',
    'https://crl.example/list.crl',
  ]);
});
it('records unavailable endpoints after network/HTTP failures without treating transport errors as good evidence', async () => {
  const { collect, cache } = setup();
  jest
    .mocked(fetchPki)
    .mockRejectedValueOnce('network failure')
    .mockResolvedValue(new Response('', { status: 503 }));
  expect((await collect()).metadata.evidenceStatus).toBe('unavailable');
  expect(cache.store).toHaveBeenCalledWith(
    expect.objectContaining({
      evidenceType: 'ocsp',
      data: null,
      status: 'unavailable',
    }),
  );
  expect(cache.store).toHaveBeenCalledWith(
    expect.objectContaining({
      evidenceType: 'crl',
      data: null,
      status: 'unavailable',
    }),
  );
});
it('retains unknown status when invalid/empty responder data cannot establish revocation state', async () => {
  const { collect } = setup();
  jest
    .mocked(fetchPki)
    .mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
  expect((await collect()).metadata.evidenceStatus).toBe('unknown');
});
it('revalidates cached OCSP bytes rather than trusting a good status flag', async () => {
  const { collect, cache } = setup();
  cache.findFresh.mockResolvedValue(
    Object.assign(new PdfRevocationEvidence(), {
      status: 'good',
      dataBase64: Buffer.from('invalid DER').toString('base64'),
    }),
  );
  expect((await collect()).metadata.evidenceStatus).toBe('unknown');
  expect(fetchPki).not.toHaveBeenCalled();
});
it('uses cached signed CRLs when OCSP has a cached unavailable result', async () => {
  const { collect, cache } = setup();
  const data = await pki.crl();
  cache.findFresh.mockImplementation((input) =>
    Promise.resolve(
      Object.assign(
        new PdfRevocationEvidence(),
        input.evidenceType === 'ocsp'
          ? { dataBase64: null, status: 'unavailable' }
          : { dataBase64: data.toString('base64'), status: 'good' },
      ),
    ),
  );
  expect((await collect()).metadata.evidenceStatus).toBe('good');
  expect(fetchPki).not.toHaveBeenCalled();
});
it('rejects streaming OCSP size overruns and cancels the response before trying the fallback', async () => {
  const { collect } = setup();
  const cancel = jest.fn();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024 + 1));
    },
    cancel,
  });
  jest
    .mocked(fetchPki)
    .mockResolvedValueOnce(new Response(body))
    .mockRejectedValue(new Error('remaining endpoints down'));
  expect((await collect()).metadata.evidenceStatus).toBe('unavailable');
  expect(cancel).toHaveBeenCalledTimes(1);
});
it('handles unsigned documents, invalid CMS and absent certificate paths without publishing valid LTV', async () => {
  const { collect, service } = setup();
  expect(
    (await collect(Buffer.from('%PDF no signature'))).metadata.evidenceStatus,
  ).toBe('missing');
  expect(
    (
      await collect(
        Buffer.from(
          '%PDF\n1 0 obj << /Contents <010203> /ByteRange [0 0 0 0] >> endobj',
        ),
      )
    ).metadata.evidenceStatus,
  ).toBe('missing');
  const parsed = parsePdfCmsSignature(detectPdfSignatures(pdf)[0].contents)!;
  expect(
    await service.validateEmbeddedEvidence({
      parsed,
      evidence: {
        certificateDer: [],
        ocspResponses: [],
        crlResponses: [],
        hasMatchingVri: false,
      },
    }),
  ).toBe('missing');
  expect(
    await service.validateEmbeddedEvidence({
      parsed,
      evidence: {
        certificateDer: [Buffer.from('invalid DER')],
        ocspResponses: [],
        crlResponses: [],
        hasMatchingVri: true,
      },
    }),
  ).toBe('missing');
});
it('validates embedded OCSP/CRL data and treats unrelated or absent evidence distinctly', async () => {
  const { service } = setup();
  const parsed = parsePdfCmsSignature(detectPdfSignatures(pdf)[0].contents)!;
  const evidence = {
    certificateDer: [certificateToDer(pki.issuer)],
    ocspResponses: [] as Buffer[],
    crlResponses: [] as Buffer[],
    hasMatchingVri: true,
  };
  expect(await service.validateEmbeddedEvidence({ parsed, evidence })).toBe(
    'missing',
  );
  evidence.ocspResponses = [Buffer.from('invalid')];
  expect(await service.validateEmbeddedEvidence({ parsed, evidence })).toBe(
    'unknown',
  );
  evidence.ocspResponses = [await pki.ocsp({ revoked: true })];
  expect(await service.validateEmbeddedEvidence({ parsed, evidence })).toBe(
    'revoked',
  );
  evidence.ocspResponses = [];
  evidence.crlResponses = [await pki.crl()];
  expect(await service.validateEmbeddedEvidence({ parsed, evidence })).toBe(
    'good',
  );
});
it('generates internal CRLs only with the issuer private key and fails closed on key errors', async () => {
  const { service, cache } = setup();
  const input = {
    accountId: 'tenant',
    pdfBuffer: pdf,
    internalRevocation: { crl_issuer_private_key_pem: pki.rootKeyPem },
  };
  expect(
    (await service.collectForSignedPdf(input)).metadata.evidenceStatus,
  ).toBe('good');
  expect(cache.store).toHaveBeenCalledWith(
    expect.objectContaining({ url: 'signa:internal-crl', status: 'good' }),
  );
  input.internalRevocation.crl_issuer_private_key_pem = 'invalid key';
  expect(
    (await service.collectForSignedPdf(input)).metadata.evidenceStatus,
  ).toBe('unavailable');
});

it('uses cached internal CRL evidence after validating it, and keeps negative cache entries unavailable', async () => {
  const { service, cache, collect } = setup();
  const data = await pki.crl();
  cache.findFresh.mockImplementation((input) =>
    Promise.resolve(
      input.evidenceType === 'crl'
        ? Object.assign(new PdfRevocationEvidence(), {
            dataBase64: data.toString('base64'),
            status: 'good',
          })
        : null,
    ),
  );
  expect(
    (
      await service.collectForSignedPdf({
        accountId: 'tenant',
        pdfBuffer: pdf,
        internalRevocation: { crl_issuer_private_key_pem: pki.rootKeyPem },
      })
    ).metadata.evidenceStatus,
  ).toBe('good');
  cache.findFresh.mockResolvedValue(
    Object.assign(new PdfRevocationEvidence(), {
      dataBase64: null,
      status: 'unavailable',
    }),
  );
  expect((await collect()).metadata.evidenceStatus).toBe('unavailable');
  expect(fetchPki).not.toHaveBeenCalled();
});
it('handles certificates that publish neither OCSP nor CRL endpoints without issuing HTTP requests', async () => {
  const { collect, cache } = setup();
  expect(
    (await collect(await pki.signedPdf({ ocsp: false, crl: false }))).metadata
      .evidenceStatus,
  ).toBe('unavailable');
  expect(fetchPki).not.toHaveBeenCalled();
  expect(cache.store).not.toHaveBeenCalled();
});
