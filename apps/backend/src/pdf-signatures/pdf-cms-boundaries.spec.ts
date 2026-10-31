import * as asn1js from 'asn1js';
import {
  ContentInfo,
  EncapsulatedContentInfo,
  OtherCertificateFormat,
  SignedData,
} from 'pkijs';
import {
  getPdfVriKey,
  parsePdfCmsSignature,
  toArrayBuffer,
  trimDerSequence,
} from './pdf-cms-utils';
it.each([
  [],
  [0x30],
  [0x31, 0],
  [0x30, 3, 0],
  [0x30, 0x80],
  [0x30, 0x85, 0, 0, 0, 0, 0],
  [0x30, 0x82, 1],
  [0x30, 0x81, 4, 0],
])('rejects malformed DER sequence lengths %j', (...bytes: number[]) => {
  expect(trimDerSequence(Buffer.from(bytes))).toBeNull();
});
it.each([
  [0x30, 0, 0, 0],
  [0x30, 0x81, 1, 0, 0],
  [0x30, 0x82, 0, 1, 0, 0],
])('trims padding after complete DER sequences %j', (...bytes: number[]) => {
  const input = Buffer.from(bytes);
  const result = trimDerSequence(input)!;
  expect(result.length).toBe(input.length - (bytes[1] === 0 ? 2 : 1));
});
it.each([
  null,
  Buffer.from([0x31, 0]),
  Buffer.from([0x30, 3, 0xff, 0xff, 0xff]),
  Buffer.from([0x30, 0]),
])(
  'returns no CMS structure for malformed or non-CMS inputs %j',
  (contents) => {
    expect(parsePdfCmsSignature(contents)).toBeNull();
  },
);
it('rejects a valid ASN.1 ContentInfo with a non-SignedData content type', () => {
  const info = new ContentInfo({
    contentType: '1.2.840.113549.1.7.1',
    content: new asn1js.OctetString({ valueHex: new Uint8Array([1]).buffer }),
  });
  expect(
    parsePdfCmsSignature(Buffer.from(info.toSchema().toBER(false))),
  ).toBeNull();
});
it.each([false, true])(
  'parses valid degenerate CMS SignedData and ignores unsupported certificate choices (%s)',
  (withOtherCertificate) => {
    const data = new SignedData({
      version: 1,
      encapContentInfo: new EncapsulatedContentInfo({
        eContentType: '1.2.840.113549.1.7.1',
      }),
      ...(withOtherCertificate
        ? {
            certificates: [
              new OtherCertificateFormat({
                otherCertFormat: '1.2.3',
                otherCert: new asn1js.Null(),
              }),
            ],
          }
        : {}),
    });
    const content = Buffer.from(
      new ContentInfo({
        contentType: ContentInfo.SIGNED_DATA,
        content: data.toSchema(true),
      })
        .toSchema()
        .toBER(false),
    );
    const result = parsePdfCmsSignature(
      Buffer.concat([content, Buffer.alloc(20)]),
    );
    expect(result?.certificates).toEqual([]);
    expect(result?.cmsContents).toEqual(content);
    expect(result?.vriKey).toBe(getPdfVriKey(content));
  },
);
it('copies exactly the exposed bytes of a sliced Node buffer into the ASN.1 ArrayBuffer', () => {
  const bytes = Buffer.from([9, 1, 2, 3, 9]).subarray(1, 4);
  expect([...new Uint8Array(toArrayBuffer(bytes))]).toEqual([1, 2, 3]);
});
