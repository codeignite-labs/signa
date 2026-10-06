import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSignaDefaultCertificate } from './pdf-signature-certificate';
import { p12SigningIdentity, PadesSigner } from './pades-signer';
import { parsePdfCmsSignature, toArrayBuffer } from './pdf-cms-utils';
import { assertSigningCertificateReference } from './timestamp-validation';

describe('PAdES CMS signer', () => {
  it('binds the signing certificate and verifies independently with OpenSSL', async () => {
    const stored = generateSignaDefaultCertificate();
    const identity = p12SigningIdentity(Buffer.from(stored.data, 'base64'), '');
    const data = Buffer.from('document byte ranges');
    const cms = await new PadesSigner(identity).sign(data);
    const parsed = parsePdfCmsSignature(cms)!;
    expect(() =>
      assertSigningCertificateReference(
        parsed.signedData,
        identity.certificates[0],
      ),
    ).not.toThrow();
    expect(
      parsed.signedData.signerInfos[0].signedAttrs?.attributes.map(
        (attr) => attr.type,
      ),
    ).not.toContain('1.2.840.113549.1.9.5');
    await expect(
      parsed.signedData.verify({
        signer: 0,
        data: toArrayBuffer(data),
        checkChain: false,
      }),
    ).resolves.toBe(true);
    const directory = mkdtempSync(join(tmpdir(), 'signa-cms-'));
    try {
      writeFileSync(join(directory, 'signature.der'), cms);
      writeFileSync(join(directory, 'content'), data);
      execFileSync(
        'openssl',
        [
          'cms',
          '-verify',
          '-binary',
          '-inform',
          'DER',
          '-in',
          join(directory, 'signature.der'),
          '-content',
          join(directory, 'content'),
          '-noverify',
          '-out',
          join(directory, 'verified'),
        ],
        { stdio: 'pipe' },
      );
      expect(readFileSync(join(directory, 'verified'))).toEqual(data);
      writeFileSync(
        join(directory, 'content'),
        Buffer.from('tampered document'),
      );
      expect(() =>
        execFileSync(
          'openssl',
          [
            'cms',
            '-verify',
            '-binary',
            '-inform',
            'DER',
            '-in',
            join(directory, 'signature.der'),
            '-content',
            join(directory, 'content'),
            '-noverify',
          ],
          { stdio: 'pipe' },
        ),
      ).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
