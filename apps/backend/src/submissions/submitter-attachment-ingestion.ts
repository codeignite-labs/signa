import { UnprocessableEntityException } from '@nestjs/common';
import { basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { downloadPublicDocument } from '../common/http/public-download';

const dangerousExtensions = new Set([
  'ade',
  'adp',
  'apk',
  'app',
  'bat',
  'bin',
  'cmd',
  'com',
  'cpl',
  'dll',
  'dmg',
  'exe',
  'gadget',
  'hta',
  'ins',
  'iso',
  'jar',
  'js',
  'jse',
  'lib',
  'lnk',
  'mde',
  'msc',
  'msi',
  'msp',
  'mst',
  'nsh',
  'pif',
  'ps1',
  'scr',
  'sct',
  'sh',
  'sys',
  'vb',
  'vbe',
  'vbs',
  'vxd',
  'wsc',
  'wsf',
  'wsh',
]);

export type PendingSubmitterAttachment = {
  uuid: string;
  buffer: Buffer;
  filename: string;
  contentType: string;
  metadata: Record<string, unknown>;
};

export async function buildAttachmentFromRawValue(options: {
  value: string;
  type: string;
  maxDownloadBytes: number;
}): Promise<PendingSubmitterAttachment> {
  if (isHttpUrl(options.value)) {
    return buildAttachmentFromUrl(
      options.value,
      options.type,
      options.maxDownloadBytes,
    );
  }

  if (isTypedSignatureValue(options.value, options.type)) {
    return buildTypedSignatureAttachment(options.value, options.type);
  }

  const decoded = await decodeAttachmentBase64(options.value, options.type);

  if (decoded) {
    return decoded;
  }

  throw new UnprocessableEntityException({
    error: `Invalid value, url, base64 or text < 60 chars is expected: ${options.value.slice(0, 200)}...`,
  });
}

async function buildAttachmentFromUrl(
  url: string,
  type: string,
  maxDownloadBytes: number,
): Promise<PendingSubmitterAttachment> {
  const response = await downloadPublicDocument(url, maxDownloadBytes);

  const buffer = Buffer.from(await response.arrayBuffer());
  assertDownloadSize(buffer, maxDownloadBytes);

  const filename = safeRemoteFilename(url, type);
  assertSafeExtension(filename);

  return buildPendingAttachment({
    buffer,
    filename,
    contentType: response.headers.get('content-type') ?? undefined,
    type,
  });
}

async function decodeAttachmentBase64(
  value: string,
  type: string,
): Promise<PendingSubmitterAttachment | null> {
  const base64 = value.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');

  if (!isValidBase64(buffer, base64)) {
    return null;
  }

  const detected = detectFileType(buffer);

  if (!detected?.mime || detected.mime === 'application/octet-stream') {
    return null;
  }

  const filename = `${type}.${detected.ext || defaultAttachmentExtension(type)}`;
  assertSafeExtension(filename);

  return buildPendingAttachment({
    buffer,
    filename,
    contentType: detected.mime,
    type,
  });
}

async function buildTypedSignatureAttachment(
  text: string,
  type: string,
): Promise<PendingSubmitterAttachment> {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="240" viewBox="0 0 720 240"><rect width="720" height="240" fill="transparent"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Brush Script MT, Segoe Script, cursive" font-size="96" fill="#111827">${escapeXml(text)}</text></svg>`,
  );
  const image = sharp(svg).png();
  const metadata = await image.metadata();
  const buffer = await image.toBuffer();

  return {
    uuid: randomUUID(),
    buffer,
    filename: `${type}.png`,
    contentType: 'image/png',
    metadata: {
      analyzed: true,
      identified: true,
      width: metadata.width,
      height: metadata.height,
      signing_type: type,
      generated_from_text: true,
    },
  };
}

export async function buildPendingAttachment(input: {
  buffer: Buffer;
  filename: string;
  contentType?: string;
  type: string;
}): Promise<PendingSubmitterAttachment> {
  assertSafeExtension(input.filename);
  const metadata = await buildAttachmentMetadata(input.buffer, input.type);

  return {
    uuid: randomUUID(),
    buffer: input.buffer,
    filename: input.filename,
    contentType: input.contentType ?? 'application/octet-stream',
    metadata,
  };
}

async function buildAttachmentMetadata(
  buffer: Buffer,
  type: string,
): Promise<Record<string, unknown>> {
  const image = await sharp(buffer)
    .metadata()
    .catch(() => null);

  return {
    analyzed: true,
    identified: true,
    signing_type: type,
    ...(image?.width ? { width: image.width } : {}),
    ...(image?.height ? { height: image.height } : {}),
  };
}

function isValidBase64(buffer: Buffer, base64: string): boolean {
  return (
    buffer.byteLength > 0 &&
    buffer.toString('base64').replace(/=+$/, '') ===
      base64.replace(/\s/g, '').replace(/=+$/, '')
  );
}

function isTypedSignatureValue(value: string, type: string): boolean {
  return (type === 'signature' || type === 'initials') && value.length < 60;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function safeRemoteFilename(url: string, type: string): string {
  const parsed = new URL(url);
  const filename = basename(decodeURIComponent(parsed.pathname));

  return filename || `${type}`;
}

function assertDownloadSize(buffer: Buffer, maxBytes: number): void {
  if (buffer.byteLength > maxBytes) {
    throw new UnprocessableEntityException({
      error: `Attachment is too large. Maximum size is ${maxBytes} bytes.`,
    });
  }
}

function assertSafeExtension(filename: string): void {
  const extension = extname(filename).replace('.', '').toLowerCase();

  if (extension && dangerousExtensions.has(extension)) {
    throw new UnprocessableEntityException({
      error: `File type '.${extension}' is not allowed.`,
    });
  }
}

function defaultAttachmentExtension(type: string): string {
  return ['signature', 'initials', 'stamp', 'image'].includes(type)
    ? 'png'
    : 'bin';
}

function detectFileType(buffer: Buffer): { ext: string; mime: string } | null {
  if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return { ext: 'png', mime: 'image/png' };
  }

  if (buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }

  if (buffer.subarray(0, 4).toString('ascii') === '%PDF') {
    return { ext: 'pdf', mime: 'application/pdf' };
  }

  if (buffer.subarray(0, 4).toString('ascii') === 'GIF8') {
    return { ext: 'gif', mime: 'image/gif' };
  }

  if (
    buffer.subarray(0, 4).equals(Buffer.from('504b0304', 'hex')) ||
    buffer.subarray(0, 4).equals(Buffer.from('504b0506', 'hex')) ||
    buffer.subarray(0, 4).equals(Buffer.from('504b0708', 'hex'))
  ) {
    return { ext: 'zip', mime: 'application/zip' };
  }

  return null;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
