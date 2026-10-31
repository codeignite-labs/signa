import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { Certificate } from 'pkijs';
import { Repository } from 'typeorm';
import { PdfTrustRootService } from '../pdf-signatures/pdf-trust-root.service';
import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { CompletedDocument } from '../submissions/entities/completed-document.entity';
import {
  PdfSignatureVerifierService,
  type PdfCmsVerificationResult,
} from './pdf-signature-verifier.service';
import { ToolsService } from './tools.service';
function toolsFixture() {
  const completed = { exists: jest.fn().mockResolvedValue(false) };
  const attachments = { exists: jest.fn().mockResolvedValue(false) };
  const trust = { getTrustedCertificates: jest.fn().mockResolvedValue([]) };
  const result: PdfCmsVerificationResult = {
    certificateChain: [],
    certificateChainStatus: 'missing',
    certificatePolicyErrors: [],
    cmsMessageDigestValid: null,
    cmsSignatureValid: null,
    ltvStatus: 'missing',
    messages: [],
    revocationStatus: 'missing',
    timestampValid: null,
    trustAnchor: null,
    trustAnchorFingerprint: null,
  };
  const verifier = {
    prepareDssRead: jest.fn((pdfBuffer: Buffer) => ({
      pdfBuffer,
      text: pdfBuffer.toString('latin1'),
      dssObject: null,
    })),
    verify: jest.fn().mockImplementation(() => Promise.resolve(result)),
  };
  const service = new ToolsService(
    completed as unknown as Repository<CompletedDocument>,
    attachments as unknown as Repository<StorageAttachment>,
    verifier as unknown as PdfSignatureVerifierService,
    trust as unknown as PdfTrustRootService,
  );
  return { service, completed, attachments, trust, verifier, result };
}
async function pdfWithSignature(
  options: {
    timestamp?: boolean;
    time?: string | null;
    dss?: boolean;
    name?: string;
  } = {},
) {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 300]);
  const dictionary = pdf.context.obj({
    Type: PDFName.of(options.timestamp ? 'DocTimeStamp' : 'Sig'),
    SubFilter: PDFName.of(
      options.timestamp ? 'ETSI.RFC3161' : 'ETSI.CAdES.detached',
    ),
    ByteRange: [0, 0, 0, 0],
    Contents: PDFHexString.of('00'),
  });
  if (options.time !== null)
    dictionary.set(
      PDFName.of('M'),
      PDFString.of(options.time ?? 'D:20261031120000Z'),
    );
  if (options.name)
    dictionary.set(PDFName.of('Name'), PDFString.of(options.name));
  pdf.catalog.set(PDFName.of('Signature'), pdf.context.register(dictionary));
  if (options.dss) pdf.catalog.set(PDFName.of('DSS'), pdf.context.obj({}));
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
it('merges real PDF pages in source and page order', async () => {
  const first = await PDFDocument.create();
  first.addPage([100, 200]);
  first.addPage([150, 250]);
  const second = await PDFDocument.create();
  second.addPage([300, 400]);
  const result = await toolsFixture().service.merge({
    files: [
      Buffer.from(await first.save()).toString('base64'),
      Buffer.from(await second.save()).toString('base64'),
    ],
  });
  const merged = await PDFDocument.load(Buffer.from(result.data, 'base64'));
  expect(
    merged.getPages().map((page) => [page.getWidth(), page.getHeight()]),
  ).toEqual([
    [100, 200],
    [150, 250],
    [300, 400],
  ]);
});
it.each(['merge', 'verify'])(
  'rejects malformed PDF input through %s',
  async (operation) => {
    const fixture = toolsFixture();
    await expect(
      operation === 'merge'
        ? fixture.service.merge({ files: ['not-a-pdf'] })
        : fixture.service.verify(Buffer.from('invalid')),
    ).rejects.toMatchObject({ response: { error: 'Malformed PDF' } });
    expect(fixture.completed.exists).not.toHaveBeenCalled();
  },
);
it('uses the requesting account trust roots and serializes complete cryptographic evidence', async () => {
  const fixture = toolsFixture();
  const root = new Certificate();
  fixture.trust.getTrustedCertificates.mockResolvedValue([root]);
  fixture.completed.exists.mockResolvedValue(true);
  Object.assign(fixture.result, {
    certificateChain: [
      {
        issuer: 'CN=Issuer',
        serialNumber: '123',
        subject: 'CN=Signer',
        validFrom: '2026-01-01',
        validTo: '2027-01-01',
      },
    ],
    certificateChainStatus: 'trusted',
    cmsMessageDigestValid: true,
    cmsSignatureValid: true,
    ltvStatus: 'valid',
    revocationStatus: 'good',
    timestampValid: true,
    trustAnchor: 'CN=Root',
    trustAnchorFingerprint: 'fingerprint',
  });
  const file = await pdfWithSignature({ name: 'Casey', dss: true });
  const response = await fixture.service.verify({ accountId: 'tenant', file });
  expect(fixture.trust.getTrustedCertificates).toHaveBeenCalledWith('tenant');
  expect(fixture.verifier.verify).toHaveBeenCalledWith(
    expect.objectContaining({ trustedCertificates: [root], pdfBuffer: file }),
  );
  expect(response).toMatchObject({
    cryptographic_verification: true,
    checksum_status: 'verified',
    signatures: [
      {
        signer_name: 'Casey',
        cms_signature_valid: true,
        certificate_chain: [
          {
            issuer: 'CN=Issuer',
            serial_number: '123',
            subject: 'CN=Signer',
            valid_from: '2026-01-01',
            valid_to: '2027-01-01',
          },
        ],
        signature_timestamp_valid: true,
      },
    ],
  });
  expect(response.signatures[0].verification_result).toContain(
    'dss_present: PDF contains a DSS dictionary for long-term validation evidence',
  );
});
it.each([
  ['CN=Primary TSA, O=Example', 'CN=Issuer', 'Primary TSA'],
  [null, 'CN=Issuer TSA', 'Issuer TSA'],
  [
    'Organization without a common name',
    null,
    'Organization without a common name',
  ],
  ['CN=   ', 'CN=Issuer TSA', 'CN=   '],
])(
  'derives timestamp authority labels from verified certificates %s / %s',
  async (subject, issuer, name) => {
    const fixture = toolsFixture();
    fixture.result.certificateChain = [
      { subject, issuer, serialNumber: null, validFrom: null, validTo: null },
    ];
    const response = await fixture.service.verify(
      await pdfWithSignature({ timestamp: true }),
    );
    expect(response.signatures[0].signer_name).toBe(name);
  },
);
it.each([
  ['20261031T123045Z', '2026-10-31T12:30:45.000Z'],
  ['D:20261031', '2026-10-31T00:00:00.000Z'],
  ['D:2026103112', '2026-10-31T12:00:00.000Z'],
  ['D:202610311230', '2026-10-31T12:30:00.000Z'],
  ['D:20261031123045', '2026-10-31T12:30:45.000Z'],
  ['not-a-date', 'not-a-date'],
  ['D:20269931123045Z', '20269931123045Z'],
  [null, null],
])(
  'normalizes supported PDF times while preserving invalid source metadata %s',
  async (time, expected) => {
    const response = await toolsFixture().service.verify(
      await pdfWithSignature({ time }),
    );
    expect(response.signatures[0].signing_time).toBe(expected);
  },
);
it('normalizes an optional account wrapper without applying another tenant trust store', async () => {
  const fixture = toolsFixture();
  const file = await pdfWithSignature();
  await fixture.service.verify({
    accountId: null,
    file: { file: file.toString('base64') },
  });
  expect(fixture.trust.getTrustedCertificates).not.toHaveBeenCalled();
  expect(fixture.verifier.verify).toHaveBeenCalledWith(
    expect.objectContaining({ trustedCertificates: [] }),
  );
});
