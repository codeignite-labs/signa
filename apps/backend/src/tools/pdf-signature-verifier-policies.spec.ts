import { ConfigService } from '@nestjs/config';
import * as asn1js from 'asn1js';
import { BasicConstraints, Certificate, ContentInfo, SignedData } from 'pkijs';
import { createRevocationPkiFixture } from '../../test/support/revocation-pki.fixture';
import { PdfDssVriEmbedder } from '../pdf-signatures/pdf-dss-vri-embedder';
import { PdfRevocationCollectorService } from '../pdf-signatures/pdf-revocation-collector.service';
import { PdfRevocationEvidenceService } from '../pdf-signatures/pdf-revocation-evidence.service';
import {
  certificateToDer,
  parsePdfCmsSignature,
} from '../pdf-signatures/pdf-cms-utils';
import { detectPdfSignatures } from '../pdf-signatures/pdf-signature-detection';
import { parseCrl } from '../pdf-signatures/revocation-evidence-validation';
import { PdfSignatureVerifierService } from './pdf-signature-verifier.service';
let pki: ReturnType<typeof createRevocationPkiFixture>;
let pdf: Buffer;
const dss = new PdfDssVriEmbedder();
const service = new PdfSignatureVerifierService(
  dss,
  new PdfRevocationCollectorService(
    new ConfigService(),
    {} as PdfRevocationEvidenceService,
  ),
  new ConfigService(),
);
beforeAll(async () => {
  pki = createRevocationPkiFixture();
  pdf = await pki.signedPdf();
}, 30000);
function input(pdfBuffer = pdf) {
  const signature = detectPdfSignatures(pdfBuffer)[0];
  return {
    pdfBuffer,
    cmsContents: signature.contents,
    signedByteRanges: signature.byteRange.ranges,
    trustedCertificates: [pki.issuer],
  };
}
function changedCms(change: (cms: SignedData) => void): Buffer {
  const cms = parsePdfCmsSignature(input().cmsContents)!.signedData;
  change(cms);
  return Buffer.from(
    new ContentInfo({
      contentType: ContentInfo.SIGNED_DATA,
      content: cms.toSchema(true),
    })
      .toSchema()
      .toBER(false),
  );
}
function replaceCertificate(cms: SignedData, certificate: Certificate): void {
  cms.certificates![cms.certificates!.indexOf(certificate)] = new Certificate({
    schema: asn1js.fromBER(certificate.toSchema(true).toBER(false)).result,
  });
}
it('returns explicit missing CMS state for absent Contents, ranges or malformed ASN.1', async () => {
  expect(
    await service.verify({ pdfBuffer: pdf, cmsContents: null }),
  ).toMatchObject({
    certificateChainStatus: 'missing',
    cmsSignatureValid: null,
  });
  expect(
    await service.verify({ ...input(), signedByteRanges: null }),
  ).toMatchObject({ certificateChainStatus: 'missing' });
  expect(
    (
      await service.verify({
        ...input(),
        cmsContents: Buffer.from('malformed'),
      })
    ).messages[0],
  ).toContain('cms_parse_failed');
});
it('validates a trusted CMS chain using ByteRange extraction and prepared DSS context', async () => {
  const context = service.prepareDssRead(pdf);
  const result = await service.verify({ ...input(), dssContext: context });
  expect(result).toMatchObject({
    cmsSignatureValid: true,
    certificateChainStatus: 'trusted',
    revocationStatus: 'missing',
    timestampValid: null,
    ltvStatus: 'missing',
  });
  expect(result.trustAnchor).toContain('CN=');
  expect(result.trustAnchorFingerprint).toMatch(/^[a-f0-9]{64}$/);
});
it.each([false, true])(
  'validates signed embedded CRLs but refuses to label LT without a trusted timestamp (revoked=%s)',
  async (revoked) => {
    const parsed = parsePdfCmsSignature(input().cmsContents)!;
    const withDss = dss.embed({
      pdfBuffer: pdf,
      evidences: [
        {
          vriKey: parsed.vriKey,
          certificateDer: [
            certificateToDer(pki.signer),
            certificateToDer(pki.issuer),
          ],
          ocspResponses: [],
          crlResponses: [await pki.crl({ revoked })],
        },
      ],
    });
    const result = await service.verify(input(withDss));
    expect(result.revocationStatus).toBe(revoked ? 'revoked' : 'good');
    expect(result.ltvStatus).toBe('invalid');
    expect(result.messages.join(' ')).toContain(
      revoked ? 'revocation_evidence_revoked' : 'revocation_evidence_present',
    );
  },
);
it('classifies malformed matching DSS evidence as unknown and invalid LT', async () => {
  const parsed = parsePdfCmsSignature(input().cmsContents)!;
  const withDss = dss.embed({
    pdfBuffer: pdf,
    evidences: [
      {
        vriKey: parsed.vriKey,
        certificateDer: [],
        ocspResponses: [Buffer.from('invalid OCSP')],
        crlResponses: [],
      },
    ],
  });
  expect(await service.verify(input(withDss))).toMatchObject({
    revocationStatus: 'unknown',
    ltvStatus: 'invalid',
    cmsSignatureValid: true,
  });
});
it('does not treat legacy CMS-attached CRLs alone as verified revocation evidence', async () => {
  const crl = parseCrl(await pki.crl())!;
  const cmsContents = changedCms((cms) => {
    cms.crls = [crl];
  });
  expect(await service.verify({ ...input(), cmsContents })).toMatchObject({
    revocationStatus: 'unknown',
    ltvStatus: 'missing',
  });
});
it.each(['missing-signers', 'missing-certificates'])(
  'rejects a CMS envelope with %s and reports missing signer policy',
  async (failure) => {
    const cmsContents = changedCms((cms) => {
      if (failure === 'missing-signers') cms.signerInfos = [];
      else cms.certificates = [];
    });
    const result = await service.verify({ ...input(), cmsContents });
    expect(result.cmsSignatureValid).toBe(false);
    expect(result.certificatePolicyErrors).toContain(
      'certificate_signer_missing',
    );
    expect(result.certificateChainStatus).toBe(
      failure === 'missing-signers' ? 'invalid' : 'missing',
    );
  },
);
it('rejects expired certificate policy even if certificate bytes are otherwise parseable', async () => {
  const cmsContents = changedCms((cms) => {
    const root = cms.certificates!.at(-1) as Certificate;
    root.notAfter.value = new Date(Date.now() - 86400000);
    replaceCertificate(cms, root);
  });
  const result = await service.verify({ ...input(), cmsContents });
  expect(result.certificateChainStatus).toBe('expired');
  expect(result.certificatePolicyErrors.join(' ')).toContain(
    'certificate_expired',
  );
  expect(result.cmsSignatureValid).toBe(false);
});
it('rejects certificate chains whose issuing certificate lacks CA constraints', async () => {
  const cmsContents = changedCms((cms) => {
    const root = cms.certificates!.at(-1) as Certificate;
    const constraints = root.extensions!.find(
      (extension) => extension.extnID === '2.5.29.19',
    )!;
    constraints.extnValue = new asn1js.OctetString({
      valueHex: new BasicConstraints({ cA: false }).toSchema().toBER(false),
    });
    replaceCertificate(cms, root);
  });
  const result = await service.verify({ ...input(), cmsContents });
  expect(result.certificateChainStatus).toBe('invalid');
  expect(result.certificatePolicyErrors.join(' ')).toContain(
    'certificate_not_ca',
  );
});
it('keeps certificate-chain trust separate from document signature validity', async () => {
  const cmsContents = changedCms((cms) => {
    cms.signerInfos[0].signature = new asn1js.OctetString({
      valueHex: new Uint8Array(256).buffer,
    });
  });
  expect(await service.verify({ ...input(), cmsContents })).toMatchObject({
    cmsSignatureValid: false,
    certificateChainStatus: 'trusted',
    ltvStatus: 'missing',
  });
});
