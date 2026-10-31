import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { fetchPki } from '../pdf-signatures/pki-http';
import {
  buildAttachmentFromRawValue,
  buildPendingAttachment,
} from './submitter-attachment-ingestion';
jest.mock('../pdf-signatures/pki-http', () => ({ fetchPki: jest.fn() }));
const transport = jest.mocked(fetchPki);
beforeEach(() => jest.resetAllMocks());
it.each(['jpeg', 'gif'] as const)(
  'identifies a real %s image from base64 and records its dimensions',
  async (format) => {
    const image = sharp({
      create: { width: 3, height: 2, channels: 4, background: '#00aa77' },
    });
    const buffer = await (
      format === 'jpeg' ? image.jpeg() : image.gif()
    ).toBuffer();
    const result = await buildAttachmentFromRawValue({
      value: buffer.toString('base64'),
      type: 'image',
      maxDownloadBytes: 1024,
    });
    expect(result).toMatchObject({
      buffer,
      filename: format === 'jpeg' ? 'image.jpg' : 'image.gif',
      contentType: `image/${format}`,
      metadata: { width: 3, height: 2, signing_type: 'image' },
    });
    expect(transport).not.toHaveBeenCalled();
  },
);
it('identifies a real PDF and ignores permitted base64 whitespace', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const buffer = Buffer.from(await pdf.save());
  const encoded = buffer.toString('base64').replace(/(.{20})/g, '$1\n');
  const result = await buildAttachmentFromRawValue({
    value: encoded,
    type: 'file',
    maxDownloadBytes: 10000,
  });
  expect(result).toMatchObject({
    buffer,
    filename: 'file.pdf',
    contentType: 'application/pdf',
    metadata: { analyzed: true, identified: true },
  });
  expect(result.metadata).not.toHaveProperty('width');
});
it.each(['504b0304', '504b0506', '504b0708'])(
  'recognizes the supported ZIP header variant %s without treating it as an image',
  async (signature) => {
    const buffer = Buffer.concat([
      Buffer.from(signature, 'hex'),
      Buffer.alloc(30),
    ]);
    const result = await buildAttachmentFromRawValue({
      value: buffer.toString('base64'),
      type: 'file',
      maxDownloadBytes: 1000,
    });
    expect(result).toMatchObject({
      buffer,
      filename: 'file.zip',
      contentType: 'application/zip',
    });
    expect(result.metadata).not.toHaveProperty('width');
  },
);
it.each([
  '',
  'invalid%%%%',
  'QQ***',
  Buffer.from('unknown file format').toString('base64'),
])(
  'rejects blank, invalid or unrecognized attachment content %s',
  async (value) => {
    await expect(
      buildAttachmentFromRawValue({
        value,
        type: 'file',
        maxDownloadBytes: 1000,
      }),
    ).rejects.toMatchObject({
      response: {
        error: expect.stringContaining(
          'Invalid value, url, base64 or text',
        ) as unknown,
      },
    });
  },
);
it('renders short XML-sensitive initials as an actual PNG without interpreting their markup', async () => {
  const result = await buildAttachmentFromRawValue({
    value: 'A<&>"\'B',
    type: 'initials',
    maxDownloadBytes: 1000,
  });
  expect(result).toMatchObject({
    filename: 'initials.png',
    contentType: 'image/png',
    metadata: { generated_from_text: true, width: 720, height: 240 },
  });
  expect((await sharp(result.buffer).metadata()).format).toBe('png');
});
it('does not reinterpret long arbitrary text as a typed signature', async () => {
  await expect(
    buildAttachmentFromRawValue({
      value: 'Signature '.repeat(10),
      type: 'signature',
      maxDownloadBytes: 1000,
    }),
  ).rejects.toMatchObject({ status: 422 });
});
it('uses a safe fallback filename and default MIME type when a valid HTTPS response omits both', async () => {
  transport.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
  const result = await buildAttachmentFromRawValue({
    value: 'https://files.example/',
    type: 'file',
    maxDownloadBytes: 100,
  });
  expect(result).toMatchObject({
    filename: 'file',
    contentType: 'application/octet-stream',
  });
  expect(transport).toHaveBeenCalledWith(expect.any(URL), {
    timeoutMs: 15000,
    maxBytes: 100,
  });
});
it.each([
  'http://files.example/file.pdf',
  'https://user:secret@files.example/file.pdf',
  'https://files.example:8443/file.pdf',
])('rejects an unsafe URL before transport %s', async (value) => {
  await expect(
    buildAttachmentFromRawValue({ value, type: 'file', maxDownloadBytes: 100 }),
  ).rejects.toMatchObject({ status: 422 });
  expect(transport).not.toHaveBeenCalled();
});
it.each(['file.EXE', 'install%2Eps1'])(
  'rejects dangerous remote extensions after URL decoding %s',
  async (name) => {
    transport.mockResolvedValue(new Response(new Uint8Array([1])));
    await expect(
      buildAttachmentFromRawValue({
        value: `https://files.example/${name}`,
        type: 'file',
        maxDownloadBytes: 100,
      }),
    ).rejects.toMatchObject({
      response: { error: expect.stringContaining('not allowed') as unknown },
    });
  },
);
it('keeps provider failures distinct from a successful attachment import', async () => {
  transport.mockRejectedValue(new Error('TLS certificate invalid'));
  await expect(
    buildAttachmentFromRawValue({
      value: 'https://files.example/file.pdf',
      type: 'file',
      maxDownloadBytes: 100,
    }),
  ).rejects.toMatchObject({
    response: {
      error: expect.stringContaining('Unable to download') as unknown,
    },
  });
});
it('retains explicitly supplied MIME metadata for non-image pending attachments', async () => {
  expect(
    await buildPendingAttachment({
      buffer: Buffer.from('plain text'),
      filename: 'notes.txt',
      contentType: 'text/plain',
      type: 'file',
    }),
  ).toMatchObject({
    contentType: 'text/plain',
    metadata: { analyzed: true, identified: true, signing_type: 'file' },
  });
});
