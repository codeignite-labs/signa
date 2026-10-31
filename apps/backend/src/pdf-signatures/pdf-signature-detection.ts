import { createHash } from 'node:crypto';

export type DetectedPdfSignature = {
  byteRange: {
    ranges: readonly [number, number, number, number] | null;
    sha256: string | null;
    valid: boolean;
  };
  contents: Buffer | null;
  hasDss: boolean;
  isTimestampSignature: boolean;
  signerName: string | null;
  signingReason: string | null;
  signingTime: string | null;
  signatureType: string | null;
};

export function detectPdfSignatures(file: Buffer): DetectedPdfSignature[] {
  const text = file.toString('latin1');
  const matches = [...text.matchAll(/\/ByteRange\s*\[[^\]]+\]/g)];
  const hasDss = /\/DSS\b/.test(text);

  return matches.map((match) => {
    const signatureObject = extractPdfObjectContaining(text, match.index ?? 0);

    return {
      byteRange: inspectByteRange(file, match[0]),
      contents: extractPdfHexBuffer(signatureObject, 'Contents'),
      hasDss,
      isTimestampSignature:
        extractPdfName(signatureObject, 'Type') === 'DocTimeStamp' ||
        extractPdfName(signatureObject, 'SubFilter') === 'ETSI.RFC3161',
      signerName: extractPdfString(signatureObject, 'Name'),
      signingReason: extractPdfString(signatureObject, 'Reason'),
      signingTime: normalizePdfDate(extractPdfString(signatureObject, 'M')),
      signatureType: extractPdfName(signatureObject, 'SubFilter'),
    };
  });
}

export function materializePdfSignedBytes(
  file: Buffer,
  ranges: readonly [number, number, number, number] | null,
): Buffer | null {
  if (!ranges) {
    return null;
  }

  const [firstOffset, firstLength, secondOffset, secondLength] = ranges;

  return Buffer.concat([
    file.subarray(firstOffset, firstOffset + firstLength),
    file.subarray(secondOffset, secondOffset + secondLength),
  ]);
}

export function extractPdfObjectContaining(
  text: string,
  index: number,
): string {
  const objectStart = Math.max(
    0,
    text.lastIndexOf(' obj', index) === -1
      ? text.lastIndexOf('<<', index)
      : text.lastIndexOf('\n', text.lastIndexOf(' obj', index)),
  );
  const objectEndMarker = text.indexOf('endobj', index);
  const objectEnd =
    objectEndMarker === -1
      ? Math.min(text.length, index + 20_000)
      : objectEndMarker;

  return text.slice(objectStart, objectEnd);
}

export function extractPdfHexBuffer(text: string, key: string): Buffer | null {
  const match = new RegExp(`/${key}\\s*<([0-9A-Fa-f\\s]+)>`).exec(text);

  if (!match) {
    return null;
  }

  const hex = match[1].replace(/\s/g, '');

  return hex ? Buffer.from(hex, 'hex') : null;
}

export function extractPdfName(text: string, key: string): string | null {
  const match = new RegExp(`/${key}\\s*/([A-Za-z0-9_.-]+)`).exec(text);

  return match?.[1] ?? null;
}

function inspectByteRange(
  file: Buffer,
  byteRangeText: string,
): DetectedPdfSignature['byteRange'] {
  const values = byteRangeText.match(/-?\d+/g)?.map(Number) ?? [];

  if (
    values.length !== 4 ||
    values.some((value) => !Number.isSafeInteger(value))
  ) {
    return { ranges: null, sha256: null, valid: false };
  }

  const [firstOffset, firstLength, secondOffset, secondLength] = values;
  const firstEnd = firstOffset + firstLength;
  const secondEnd = secondOffset + secondLength;
  const isValid =
    firstOffset === 0 &&
    firstLength >= 0 &&
    secondOffset >= firstEnd &&
    secondLength >= 0 &&
    secondEnd <= file.byteLength;

  if (!isValid) {
    return { ranges: null, sha256: null, valid: false };
  }

  const ranges = [
    firstOffset,
    firstLength,
    secondOffset,
    secondLength,
  ] as const;
  const digest = createHash('sha256')
    .update(file.subarray(firstOffset, firstEnd))
    .update(file.subarray(secondOffset, secondEnd))
    .digest('base64url');

  return {
    ranges,
    sha256: digest,
    valid: true,
  };
}

function extractPdfString(text: string, key: string): string | null {
  return extractPdfLiteral(text, key) ?? extractPdfHexString(text, key);
}

function extractPdfLiteral(text: string, key: string): string | null {
  const keyMatch = new RegExp(`/${key}\\s*\\(`).exec(text);

  if (!keyMatch || keyMatch.index === undefined) {
    return null;
  }

  const valueStart = keyMatch.index + keyMatch[0].length;
  let escaped = false;

  for (let index = valueStart; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === ')') {
      return unescapePdfLiteral(text.slice(valueStart, index));
    }
  }

  return null;
}

function extractPdfHexString(text: string, key: string): string | null {
  const buffer = extractPdfHexBuffer(text, key);

  if (!buffer) {
    return null;
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  }

  return buffer.toString('utf8');
}

function normalizePdfDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.startsWith('D:') ? value.slice(2) : value;
}

function unescapePdfLiteral(value: string): string {
  return value
    .replaceAll('\\\\', '\\')
    .replaceAll('\\(', '(')
    .replaceAll('\\)', ')')
    .replaceAll('\\n', '\n')
    .replaceAll('\\r', '\r')
    .replaceAll('\\t', '\t')
    .replaceAll('\\b', '\b')
    .replaceAll('\\f', '\f');
}
