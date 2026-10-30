import signpdf from '@signpdf/signpdf';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import { createHash, createPrivateKey, webcrypto } from 'node:crypto';
import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import * as asn1js from 'asn1js';
import {
  BasicOCSPResponse,
  Certificate,
  CertificateRevocationList,
  Extension,
  Extensions,
  CertID,
  OCSPResponse,
  ResponseBytes,
  ResponseData,
  RevokedCertificate,
  SingleResponse,
  Time,
} from 'pkijs';
import { generateSignaDefaultCertificate } from '../../src/pdf-signatures/pdf-signature-certificate';
import {
  PadesSigner,
  p12SigningIdentity,
} from '../../src/pdf-signatures/pades-signer';
import { readSigningIdentity } from '../../src/pdf-signatures/signing-identity';
import { toArrayBuffer } from '../../src/pdf-signatures/pdf-cms-utils';

async function cryptoKey(pem: string) {
  return webcrypto.subtle.importKey(
    'pkcs8',
    createPrivateKey(pem).export({ format: 'der', type: 'pkcs8' }),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}
export function createRevocationPkiFixture() {
  const stored = generateSignaDefaultCertificate();
  const original = readSigningIdentity(Buffer.from(stored.data, 'base64'), '');
  const root = original.certificates.at(-1)!;
  const rootKeyPem =
    stored.internal_revocation!.root_crl_issuer_private_key_pem!;
  const rootKey = forge.pki.privateKeyFromPem(rootKeyPem);
  const rootPem = forge.pki.certificateToPem(root);
  const { Class: C, Type: T, create } = forge.asn1;
  const uri = (value: string) => create(C.CONTEXT_SPECIFIC, 6, false, value);
  function leaf(options: { ocsp?: boolean; crl?: boolean } = {}) {
    const certificate = forge.pki.certificateFromPem(
      forge.pki.certificateToPem(original.certificate),
    );
    certificate.setIssuer(root.subject.attributes);
    const extensions = (
      certificate.extensions as Array<{ id: string; value: string }>
    ).filter(
      (extension) =>
        !['2.5.29.35', '1.3.6.1.5.5.7.1.1', '2.5.29.31'].includes(extension.id),
    );
    if (options.ocsp !== false)
      extensions.push({
        id: '1.3.6.1.5.5.7.1.1',
        value: forge.asn1
          .toDer(
            create(
              C.UNIVERSAL,
              T.SEQUENCE,
              true,
              ['https://ocsp.example/first', 'https://ocsp.example/second'].map(
                (value) =>
                  create(C.UNIVERSAL, T.SEQUENCE, true, [
                    create(
                      C.UNIVERSAL,
                      T.OID,
                      false,
                      forge.asn1.oidToDer('1.3.6.1.5.5.7.48.1').getBytes(),
                    ),
                    uri(value),
                  ]),
              ),
            ),
          )
          .getBytes(),
      });
    if (options.crl !== false)
      extensions.push({
        id: '2.5.29.31',
        value: forge.asn1
          .toDer(
            create(C.UNIVERSAL, T.SEQUENCE, true, [
              create(C.UNIVERSAL, T.SEQUENCE, true, [
                create(C.CONTEXT_SPECIFIC, 0, true, [
                  create(C.CONTEXT_SPECIFIC, 0, true, [
                    uri('https://crl.example/list.crl'),
                  ]),
                ]),
              ]),
            ]),
          )
          .getBytes(),
      });
    certificate.setExtensions(extensions);
    certificate.sign(rootKey, forge.md.sha256.create());
    return certificate;
  }
  function parsedCertificate(certificate: forge.pki.Certificate): Certificate {
    return new Certificate({
      schema: asn1js.fromBER(
        toArrayBuffer(
          Buffer.from(
            forge.asn1
              .toDer(forge.pki.certificateToAsn1(certificate))
              .getBytes(),
            'binary',
          ),
        ),
      ).result,
    });
  }
  const signer = parsedCertificate(leaf());
  const issuer = parsedCertificate(root);
  async function signedPdf(
    options: { ocsp?: boolean; crl?: boolean } = {},
  ): Promise<Buffer> {
    const identityBuffer = Buffer.from(
      forge.asn1
        .toDer(
          forge.pkcs12.toPkcs12Asn1(original.key, [leaf(options), root], '', {
            algorithm: '3des',
          }),
        )
        .getBytes(),
      'binary',
    );
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);
    pdflibAddPlaceholder({
      pdfDoc: pdf,
      reason: 'Test fixture',
      contactInfo: '',
      location: '',
      name: 'Synthetic signer',
      subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    });
    return signpdf.sign(
      Buffer.from(await pdf.save({ useObjectStreams: false })),
      new PadesSigner(p12SigningIdentity(identityBuffer, '')),
    );
  }
  async function ocsp(
    options: {
      revoked?: boolean;
      unknown?: boolean;
      stale?: boolean;
      noNextUpdate?: boolean;
      byKey?: boolean;
      responder?:
        | 'delegated'
        | 'missing'
        | 'wrong-issuer'
        | 'missing-eku'
        | 'missing-no-check'
        | 'expired'
        | 'not-yet-valid'
        | 'forbidden-usage';
      old?: boolean;
      future?: boolean;
      weakSignature?: boolean;
      emptyResponses?: boolean;
      unsupportedHash?: boolean;
      wrongCertificate?: boolean;
    } = {},
  ): Promise<Buffer> {
    const id = new CertID();
    await id.createForCertificate(signer, {
      hashAlgorithm: 'SHA-256',
      issuerCertificate: issuer,
    });
    if (options.unsupportedHash) id.hashAlgorithm.algorithmId = '1.2.3';
    if (options.wrongCertificate)
      id.issuerKeyHash = new asn1js.OctetString({
        valueHex: new Uint8Array(32).buffer,
      });
    const status = options.revoked
      ? new asn1js.Constructed({
          idBlock: { tagClass: 3, tagNumber: 1 },
          value: [
            new asn1js.GeneralizedTime({
              valueDate: new Date(Date.now() - 60000),
            }),
          ],
        })
      : new asn1js.Primitive({
          idBlock: { tagClass: 3, tagNumber: options.unknown ? 2 : 0 },
        });
    let responder = issuer;
    let responderKeyPem = rootKeyPem;
    if (options.responder && options.responder !== 'missing') {
      const delegated = forge.pki.createCertificate();
      delegated.publicKey = original.certificate.publicKey;
      delegated.serialNumber = '01234567';
      delegated.setSubject([
        { name: 'commonName', value: 'Delegated OCSP fixture' },
      ]);
      delegated.setIssuer(root.subject.attributes);
      if (options.responder === 'wrong-issuer')
        delegated.setIssuer([
          { name: 'commonName', value: 'Unrelated issuer' },
        ]);
      delegated.validity.notBefore = new Date(
        Date.now() +
          (options.responder === 'not-yet-valid' ? 3600000 : -86400000),
      );
      delegated.validity.notAfter = new Date(
        Date.now() + (options.responder === 'expired' ? -1000 : 86400000),
      );
      delegated.setExtensions([
        { name: 'basicConstraints', cA: false },
        {
          name: 'keyUsage',
          digitalSignature: options.responder !== 'forbidden-usage',
          keyEncipherment: true,
        },
        ...(options.responder === 'missing-eku'
          ? []
          : [{ name: 'extKeyUsage', '1.3.6.1.5.5.7.3.9': true }]),
        ...(options.responder === 'missing-no-check'
          ? []
          : [
              {
                id: '1.3.6.1.5.5.7.48.1.5',
                value: forge.asn1
                  .toDer(create(C.UNIVERSAL, T.NULL, false, ''))
                  .getBytes(),
              },
            ]),
      ]);
      delegated.sign(rootKey, forge.md.sha256.create());
      responder = parsedCertificate(delegated);
      responderKeyPem = forge.pki.privateKeyToPem(original.key);
    }
    const responderId = options.byKey
      ? new asn1js.OctetString({
          valueHex: toArrayBuffer(
            createHash('sha1')
              .update(
                Buffer.from(
                  responder.subjectPublicKeyInfo.subjectPublicKey.valueBlock
                    .valueHexView,
                ),
              )
              .digest(),
          ),
        })
      : responder.subject;
    const basic = new BasicOCSPResponse({
      tbsResponseData: new ResponseData({
        responderID:
          options.responder === 'missing'
            ? new asn1js.OctetString({ valueHex: new Uint8Array(20).buffer })
            : responderId,
        producedAt: new Date(Date.now() + (options.future ? 120000 : 0)),
        responses: [
          new SingleResponse({
            certID: id,
            certStatus: status,
            thisUpdate: new Date(Date.now() - (options.old ? 600000 : 1000)),
            ...(options.noNextUpdate
              ? {}
              : {
                  nextUpdate: new Date(
                    Date.now() + (options.stale ? -1000 : 3600000),
                  ),
                }),
          }),
        ],
      }),
    });
    if (options.emptyResponses) basic.tbsResponseData.responses = [];
    if (responder !== issuer) basic.certs = [responder];
    await basic.sign(
      (await cryptoKey(responderKeyPem)) as CryptoKey,
      'SHA-256',
    );
    if (options.weakSignature)
      basic.signatureAlgorithm.algorithmId = '1.2.840.113549.1.1.5';
    return Buffer.from(
      new OCSPResponse({
        responseStatus: new asn1js.Enumerated({ value: 0 }),
        responseBytes: new ResponseBytes({
          responseType: '1.3.6.1.5.5.7.48.1.1',
          response: new asn1js.OctetString({
            valueHex: basic.toSchema().toBER(false),
          }),
        }),
      })
        .toSchema()
        .toBER(false),
    );
  }
  async function crl(
    options: {
      revoked?: boolean;
      stale?: boolean;
      noNextUpdate?: boolean;
      future?: boolean;
      old?: boolean;
      delta?: boolean;
      unsupportedSignature?: boolean;
    } = {},
  ): Promise<Buffer> {
    const list = new CertificateRevocationList({
      version: 1,
      issuer: issuer.subject,
      thisUpdate: new Time({
        type: 0,
        value: new Date(
          Date.now() +
            (options.future ? 120000 : options.old ? -600000 : -1000),
        ),
      }),
      ...(options.noNextUpdate
        ? {}
        : {
            nextUpdate: new Time({
              type: 0,
              value: new Date(Date.now() + (options.stale ? -1000 : 3600000)),
            }),
          }),
      ...(options.revoked
        ? {
            revokedCertificates: [
              new RevokedCertificate({
                userCertificate: signer.serialNumber,
                revocationDate: new Time({
                  type: 0,
                  value: new Date(Date.now() - 60000),
                }),
              }),
            ],
          }
        : {}),
    });
    if (options.delta)
      list.crlExtensions = new Extensions({
        extensions: [
          new Extension({
            extnID: '2.5.29.27',
            extnValue: new asn1js.Integer({ value: 1 }).toBER(false),
          }),
        ],
      });
    await list.sign((await cryptoKey(rootKeyPem)) as CryptoKey, 'SHA-256');
    if (options.unsupportedSignature)
      list.signatureAlgorithm.algorithmId = '1.2.3';
    return Buffer.from((list.toSchema(true) as asn1js.Sequence).toBER(false));
  }
  return { signedPdf, signer, issuer, rootPem, rootKeyPem, ocsp, crl };
}
