import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PdfTextTagService } from './pdf-text-tag.service';
jest.mock('node:child_process', () => ({
  ...jest.requireActual<typeof import('node:child_process')>(
    'node:child_process',
  ),
  execFile: jest.fn((...args: unknown[]) => {
    const callback = args.at(-1) as (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    callback(null, '', '');
    return {};
  }),
}));
jest.mock('node:fs/promises', () => ({
  ...jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises'),
  readFile: jest.fn(),
}));
const capturedBbox = readFileSync(
  join(__dirname, '../../test/fixtures/pdf-text-tags.html'),
  'utf8',
);
let source: Buffer;
beforeAll(async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 2; index++)
    pdf
      .addPage([612, 792])
      .drawText('{{Full name; role=Signer; required=true}}', {
        font,
        size: 12,
        x: 50,
        y: 700,
      });
  source = Buffer.from(await pdf.save());
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readFile).mockResolvedValue(capturedBbox);
});
function word(text: string, x = 50) {
  return `<word xMin="${x}" yMin="83" xMax="${x + 20}" yMax="95">${text}</word>`;
}
function page(words: string[]) {
  return `<page width="612" height="792">${words.map((text, index) => word(text, 50 + index * 25)).join('')}</page>`;
}
it('extracts named fields from captured actual Poppler output and removes its temporary directory', async () => {
  const result = await new PdfTextTagService().extractAndMaybeRemoveTags({
    pdf: source,
    removeTags: false,
  });
  expect(result.pdf).toBe(source);
  expect(result.fields).toHaveLength(1);
  expect(result.fields[0]).toMatchObject({
    name: 'Full name',
    role: 'Signer',
    required: true,
    type: 'text',
    preferences: {},
    areas: [{ page: 0 }],
  });
  expect(result.fields[0].areas?.[0].w).toBeGreaterThan(0);
  expect(execFile).toHaveBeenCalledWith(
    'pdftotext',
    [
      '-bbox',
      expect.stringMatching(/document\.pdf$/),
      expect.stringMatching(/document\.html$/),
    ],
    { timeout: 15000 },
    expect.any(Function),
  );
  const filePath = jest.mocked(readFile).mock.calls[0][0];
  expect(typeof filePath).toBe('string');
  if (typeof filePath !== 'string')
    throw new Error('Expected a filesystem path');
  await expect(access(dirname(filePath))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});
it('maps pages in order and retains spaces/HTML entities inside tag names and attributes', async () => {
  jest
    .mocked(readFile)
    .mockResolvedValue(
      page([
        'ordinary',
        '{{Approval;',
        'type=signature;',
        'role=Legal',
        'Reviewer;',
        'required;',
        'title=Review',
        '&amp;',
        'Sign;',
        'description=&lt;Please&gt;',
        '&quot;review&quot;',
        '&#39;now&#39;;',
        'custom=one=two}}',
      ]) +
        page([
          '{{Initials;type=initials}}',
          '{{Accepted;type=checkbox;required=false}}',
        ]),
    );
  const result = await new PdfTextTagService().extractAndMaybeRemoveTags({
    pdf: source,
    removeTags: false,
  });
  expect(result.fields).toHaveLength(3);
  expect(result.fields[0]).toMatchObject({
    name: 'Approval',
    role: 'Legal Reviewer',
    type: 'signature',
    required: true,
    title: 'Review & Sign',
    description: '<Please> "review" \'now\'',
    preferences: { custom: 'one=two' },
    areas: [{ page: 0 }],
  });
  expect(result.fields[1]).toMatchObject({
    type: 'initials',
    areas: [{ page: 1, w: 0.16 }],
  });
  expect(result.fields[2]).toMatchObject({
    type: 'checkbox',
    required: false,
    areas: [{ page: 1 }],
  });
});
it('parses options, fallback field/type defaults and ignores malformed attributes without crossing page boundaries', async () => {
  jest
    .mocked(readFile)
    .mockResolvedValue(
      page([
        '{{;;;}}',
        '{{Text;type=;options=One,Two,,;=ignore}}',
        '{{Unclosed',
      ]) + page(['{{Next;type=select;options=A,B}}']),
    );
  const result = await new PdfTextTagService().extractAndMaybeRemoveTags({
    pdf: source,
    removeTags: false,
  });
  expect(result.fields).toHaveLength(3);
  expect(result.fields[0]).toMatchObject({ name: 'Field', type: 'text' });
  expect(result.fields[1]).toMatchObject({
    name: 'Text',
    type: 'text',
    preferences: { options: ['One', 'Two'] },
  });
  expect(result.fields[2]).toMatchObject({
    name: 'Next',
    type: 'select',
    preferences: { options: ['A', 'B'] },
  });
});
it('visually removes extracted tags from an actual PDF while retaining valid pages', async () => {
  const result = await new PdfTextTagService().extractAndMaybeRemoveTags({
    pdf: source,
    removeTags: true,
  });
  expect(result.fields).toHaveLength(1);
  expect(result.pdf).not.toEqual(source);
  const loaded = await PDFDocument.load(result.pdf);
  expect(loaded.getPageCount()).toBe(2);
  expect(loaded.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
});
it('keeps original bytes when no tags are present and supports the no-word/empty-output case', async () => {
  jest
    .mocked(readFile)
    .mockResolvedValueOnce(page(['ordinary', 'document', 'words']))
    .mockResolvedValueOnce('');
  const service = new PdfTextTagService();
  expect(
    await service.extractAndMaybeRemoveTags({ pdf: source, removeTags: true }),
  ).toEqual({ pdf: source, fields: [] });
  expect(
    await service.extractAndMaybeRemoveTags({ pdf: source, removeTags: false }),
  ).toEqual({ pdf: source, fields: [] });
});
it.each([
  [
    Object.assign(new Error('missing binary'), { code: 'ENOENT' }),
    'pdftotext is not installed',
  ],
  [
    Object.assign(new Error('command failed'), {
      stderr: 'Incorrect password or encrypted PDF',
    }),
    'password protected or encrypted',
  ],
  [new Error('command timed out'), 'command timed out'],
  ['unexpected error', 'Unknown error'],
])(
  'returns actionable command failure details and cleans up after %s',
  async (error, message) => {
    jest.mocked(execFile).mockImplementationOnce(((...args: unknown[]) => {
      const callback = args.at(-1) as (error: unknown) => void;
      callback(error);
      return {};
    }) as unknown as typeof execFile);
    await expect(
      new PdfTextTagService().extractAndMaybeRemoveTags({
        pdf: source,
        removeTags: true,
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: { error: expect.stringContaining(message) as unknown },
    });
    expect(readFile).not.toHaveBeenCalled();
  },
);
