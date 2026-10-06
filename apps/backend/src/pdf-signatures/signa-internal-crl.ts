import { createSign } from 'node:crypto';
import * as asn1js from 'asn1js';
import { Certificate, Extension, Extensions } from 'pkijs';

export type SignaInternalCrlInput = {
  issuer: Certificate;
  issuerPrivateKeyPem: string;
  nextUpdate: Date;
  thisUpdate: Date;
};

const sha256WithRsaEncryptionOid = '1.2.840.113549.1.1.11';

/**
 * Build a minimal X.509 v2 CRL for Signa-managed self-hosted certificates.
 * The CRL is intentionally empty: an empty, issuer-signed CRL means every
 * certificate absent from revokedCertificates is good at thisUpdate.
 */
export function buildSignaInternalCrl(input: SignaInternalCrlInput): Buffer {
  const signatureAlgorithm = buildSha256RsaAlgorithmIdentifier();
  const tbsCertList = new asn1js.Sequence({
    value: [
      new asn1js.Integer({ value: 1 }),
      signatureAlgorithm,
      input.issuer.subject.toSchema(),
      crlTime(input.thisUpdate),
      crlTime(input.nextUpdate),
      crlExtensions(input),
    ],
  });
  const tbsDer = Buffer.from(tbsCertList.toBER(false));
  const signature = createSign('RSA-SHA256')
    .update(tbsDer)
    .sign(input.issuerPrivateKeyPem);
  const certificateList = new asn1js.Sequence({
    value: [
      tbsCertList,
      signatureAlgorithm,
      new asn1js.BitString({ valueHex: toExactArrayBuffer(signature) }),
    ],
  });

  return Buffer.from(certificateList.toBER(false));
}

function crlTime(date: Date) {
  const valueDate = new Date(Math.floor(date.getTime() / 1000) * 1000);
  return valueDate.getUTCFullYear() < 2050
    ? new asn1js.UTCTime({ valueDate })
    : new asn1js.GeneralizedTime({ valueDate });
}

function crlExtensions(input: SignaInternalCrlInput) {
  const subjectKey = input.issuer.extensions?.find(
    (ext) => ext.extnID === '2.5.29.14',
  )?.parsedValue as asn1js.OctetString | undefined;
  if (!subjectKey)
    throw new Error('Internal CRL issuer requires a subject key identifier');
  const authorityKey = new asn1js.Sequence({
    value: [
      new asn1js.Primitive({
        idBlock: { tagClass: 3, tagNumber: 0 },
        valueHex: subjectKey.getValue(),
      }),
    ],
  });
  const number = new asn1js.Integer({ value: input.thisUpdate.getTime() });
  const extensions = new Extensions({
    extensions: [
      new Extension({
        extnID: '2.5.29.35',
        extnValue: authorityKey.toBER(false),
      }),
      new Extension({ extnID: '2.5.29.20', extnValue: number.toBER(false) }),
    ],
  });
  return new asn1js.Constructed({
    idBlock: { tagClass: 3, tagNumber: 0 },
    value: [extensions.toSchema()],
  });
}

function toExactArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function buildSha256RsaAlgorithmIdentifier(): asn1js.Sequence {
  return new asn1js.Sequence({
    value: [
      new asn1js.ObjectIdentifier({ value: sha256WithRsaEncryptionOid }),
      new asn1js.Null(),
    ],
  });
}
