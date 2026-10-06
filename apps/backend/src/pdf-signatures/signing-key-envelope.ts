import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const prefix = 'signing-key:v1:';

function encryptionKey(): Buffer {
  const value = process.env.SIGNING_KEY_ENCRYPTION_KEY ?? '';
  if (!/^[a-f\d]{64}$/i.test(value)) {
    throw new Error(
      'SIGNING_KEY_ENCRYPTION_KEY must contain 32 random bytes encoded as 64 hex characters',
    );
  }
  return Buffer.from(value, 'hex');
}

export function encryptSigningKey(value: string, accountId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`signa-signing:${accountId}`));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return (
    prefix +
    [iv, cipher.getAuthTag(), data]
      .map((part) => part.toString('base64url'))
      .join(':')
  );
}

export function decryptSigningKey(value: string, accountId: string): string {
  // Existing plaintext records are read for migration, and encrypted on their next use.
  if (!value.startsWith(prefix)) return value;
  const parts = value
    .slice(prefix.length)
    .split(':')
    .map((part) => Buffer.from(part, 'base64url'));
  if (parts.length !== 3 || parts[0].length !== 12 || parts[1].length !== 16) {
    throw new Error('Invalid signing key envelope');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), parts[0]);
  decipher.setAAD(Buffer.from(`signa-signing:${accountId}`));
  decipher.setAuthTag(parts[1]);
  return Buffer.concat([decipher.update(parts[2]), decipher.final()]).toString(
    'utf8',
  );
}

export function isEncryptedSigningKey(value: string): boolean {
  return value.startsWith(prefix);
}
