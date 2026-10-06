import { createHash, createPrivateKey, webcrypto } from 'node:crypto';
import forge from 'node-forge';
import * as asn1js from 'asn1js';
import {
  AlgorithmIdentifier,
  Attribute,
  Certificate,
  ContentInfo,
  EncapsulatedContentInfo,
  IssuerAndSerialNumber,
  SignedAndUnsignedAttributes,
  SignedData,
  SignerInfo,
} from 'pkijs';
import { Signer } from '@signpdf/utils';
import { readSigningIdentity } from './signing-identity';
import { toArrayBuffer } from './pdf-cms-utils';

export type PdfSigningIdentity = {
  certificates: Certificate[];
  // The provider signs the DER signed-attributes with SHA-256/RSA PKCS#1 v1.5.
  // A remote provider can implement this without exporting its private key.
  sign: (data: Buffer) => Promise<Buffer>;
};

export function p12SigningIdentity(
  buffer: Buffer,
  password: string,
): PdfSigningIdentity {
  const identity = readSigningIdentity(buffer, password);
  const certificates = identity.certificates.map(
    (cert) =>
      new Certificate({
        schema: asn1js.fromBER(
          toArrayBuffer(
            Buffer.from(
              forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
              'binary',
            ),
          ),
        ).result,
      }),
  );
  const privateKey = createPrivateKey(forge.pki.privateKeyToPem(identity.key));
  return {
    certificates,
    sign: async (data) => {
      const key = await webcrypto.subtle.importKey(
        'pkcs8',
        privateKey.export({ format: 'der', type: 'pkcs8' }),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      return Buffer.from(
        await webcrypto.subtle.sign(
          'RSASSA-PKCS1-v1_5',
          key,
          new Uint8Array(data),
        ),
      );
    },
  };
}

export class PadesSigner extends Signer {
  constructor(
    private readonly identity: PdfSigningIdentity,
    private readonly timestamp?: (signature: Buffer) => Promise<Buffer | null>,
  ) {
    super();
  }

  async sign(pdfBuffer: Buffer): Promise<Buffer> {
    const certificate = this.identity.certificates[0];
    const attributes = signedAttributes(pdfBuffer, certificate);
    const signedBytes = Buffer.from(
      new asn1js.Set({
        value: attributes.map((attribute) => attribute.toSchema()),
      }).toBER(false),
    );
    const signature = await this.identity.sign(signedBytes);
    const info = new SignerInfo({
      version: 1,
      sid: new IssuerAndSerialNumber({
        issuer: certificate.issuer,
        serialNumber: certificate.serialNumber,
      }),
      digestAlgorithm: new AlgorithmIdentifier({
        algorithmId: '2.16.840.1.101.3.4.2.1',
      }),
      signatureAlgorithm: new AlgorithmIdentifier({
        algorithmId: '1.2.840.113549.1.1.1',
        algorithmParams: new asn1js.Null(),
      }),
      signedAttrs: new SignedAndUnsignedAttributes({ type: 0, attributes }),
      signature: new asn1js.OctetString({ valueHex: toArrayBuffer(signature) }),
    });
    const token = await this.timestamp?.(signature);
    if (token)
      info.unsignedAttrs = new SignedAndUnsignedAttributes({
        type: 1,
        attributes: [
          new Attribute({
            type: '1.2.840.113549.1.9.16.2.14',
            values: [asn1js.fromBER(toArrayBuffer(token)).result],
          }),
        ],
      });
    const cms = new SignedData({
      version: 1,
      digestAlgorithms: [info.digestAlgorithm],
      encapContentInfo: new EncapsulatedContentInfo({
        eContentType: ContentInfo.DATA,
      }),
      certificates: this.identity.certificates,
      signerInfos: [info],
    });
    return Buffer.from(
      new ContentInfo({
        contentType: ContentInfo.SIGNED_DATA,
        content: cms.toSchema(true),
      })
        .toSchema()
        .toBER(false),
    );
  }
}

function signedAttributes(data: Buffer, certificate: Certificate): Attribute[] {
  const digest = (bytes: Buffer) =>
    new asn1js.OctetString({
      valueHex: toArrayBuffer(createHash('sha256').update(bytes).digest()),
    });
  const attrs = [
    new Attribute({
      type: '1.2.840.113549.1.9.3',
      values: [new asn1js.ObjectIdentifier({ value: ContentInfo.DATA })],
    }),
    new Attribute({ type: '1.2.840.113549.1.9.4', values: [digest(data)] }),
    new Attribute({
      type: '1.2.840.113549.1.9.16.2.47',
      values: [
        new asn1js.Sequence({
          value: [
            new asn1js.Sequence({
              value: [
                new asn1js.Sequence({
                  value: [
                    digest(
                      Buffer.from(certificate.toSchema(true).toBER(false)),
                    ),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ];
  // DER SET OF ordering applies to the complete encodings, not the OID strings.
  return attrs.sort((a, b) =>
    Buffer.compare(
      Buffer.from(a.toSchema().toBER(false)),
      Buffer.from(b.toSchema().toBER(false)),
    ),
  );
}
