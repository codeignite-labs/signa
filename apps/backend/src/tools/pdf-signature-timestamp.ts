import { Sequence } from 'asn1js';
import { createHash } from 'node:crypto';
import { Certificate, SignedData } from 'pkijs';
import {
  assertSigningCertificateReference,
  cmsSignerCertificate,
  validateTimestampToken,
} from '../pdf-signatures/timestamp-validation';

export async function verifySignatureTimestamp(
  cms: SignedData,
  trustedCertificates: Certificate[],
) {
  const tokens =
    cms.signerInfos[0]?.unsignedAttrs?.attributes.filter(
      (attr) => attr.type === '1.2.840.113549.1.9.16.2.14',
    ) ?? [];
  if (!tokens.length)
    return {
      valid: null,
      time: null,
      message: 'signature_timestamp_missing: no CMS signature timestamp',
    };
  try {
    if (tokens.length !== 1 || tokens[0].values.length !== 1)
      throw new Error('Ambiguous timestamp');
    const token: unknown = tokens[0].values[0];
    if (!(token instanceof Sequence)) throw new Error('Malformed timestamp');
    const result = await validateTimestampToken({
      token: Buffer.from(token.toBER(false)),
      digest: createHash('sha256')
        .update(Buffer.from(cms.signerInfos[0].signature.getValue()))
        .digest(),
      trustedCertificates,
    });
    return {
      valid: true,
      time: result.info.genTime,
      message:
        'signature_timestamp_valid: trusted CMS signature timestamp verified',
    };
  } catch {
    return {
      valid: false,
      time: null,
      message:
        'signature_timestamp_invalid: timestamp could not be validated against configured trust',
    };
  }
}

export function hasPadesAttributes(cms: SignedData): boolean {
  try {
    assertSigningCertificateReference(cms, cmsSignerCertificate(cms));
    return !cms.signerInfos[0].signedAttrs?.attributes.some(
      (attr) => attr.type === '1.2.840.113549.1.9.5',
    );
  } catch {
    return false;
  }
}
