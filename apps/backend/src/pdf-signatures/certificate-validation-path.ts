import * as asn1js from 'asn1js';
import { Certificate, SignedData } from 'pkijs';
import { toArrayBuffer } from './pdf-cms-utils';
import {
  cmsSignerCertificate,
  parseTimestampToken,
} from './timestamp-validation';

export function parsePemCertificates(pem: string): Certificate[] {
  return (
    pem
      .replace(/\\n/g, '\n')
      .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ??
    []
  ).map(
    (value) =>
      new Certificate({
        schema: asn1js.fromBER(
          toArrayBuffer(
            Buffer.from(
              value.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''),
              'base64',
            ),
          ),
        ).result,
      }),
  );
}

export async function buildCertificatePath(
  leaf: Certificate,
  certificates: Certificate[],
): Promise<Certificate[]> {
  const path = [leaf];
  while (path.length <= 10) {
    const current = path.at(-1)!;
    if (
      current.subject.isEqual(current.issuer) &&
      (await current.verify(current))
    )
      return path;
    let issuer: Certificate | undefined;
    for (const candidate of certificates) {
      if (
        current.issuer.isEqual(candidate.subject) &&
        (await current.verify(candidate))
      ) {
        issuer = candidate;
        break;
      }
    }
    if (!issuer || path.includes(issuer))
      throw new Error('Incomplete or invalid certificate path');
    path.push(issuer);
  }
  throw new Error('Certificate path exceeds maximum length');
}

export async function signatureValidationPaths(
  cms: SignedData,
  additionalCertificates: Certificate[] = [],
) {
  const certificates = [
    ...(cms.certificates ?? []).filter(
      (cert): cert is Certificate => cert instanceof Certificate,
    ),
    ...additionalCertificates,
  ];
  const paths = [
    {
      isTimestamp: false,
      certificates: await buildCertificatePath(
        cmsSignerCertificate(cms),
        certificates,
      ),
    },
  ];
  const timestamps =
    cms.signerInfos[0].unsignedAttrs?.attributes.filter(
      (attr) => attr.type === '1.2.840.113549.1.9.16.2.14',
    ) ?? [];
  for (const attribute of timestamps) {
    for (const value of attribute.values as unknown[]) {
      if (!(value instanceof asn1js.Sequence))
        throw new Error('Malformed timestamp attribute');
      const token = parseTimestampToken(Buffer.from(value.toBER(false))).cms;
      const tokenCertificates = (token.certificates ?? []).filter(
        (cert): cert is Certificate => cert instanceof Certificate,
      );
      paths.push({
        isTimestamp: true,
        certificates: await buildCertificatePath(cmsSignerCertificate(token), [
          ...tokenCertificates,
          ...certificates,
        ]),
      });
    }
  }
  return paths;
}
