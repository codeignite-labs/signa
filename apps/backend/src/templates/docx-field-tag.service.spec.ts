import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { DocxFieldTagService } from './docx-field-tag.service';
jest.mock('node:child_process', () => ({
  ...jest.requireActual<typeof import('node:child_process')>(
    'node:child_process',
  ),
  execFile: jest.fn((...args: unknown[]) => {
    const callback = args.at(-1) as (
      error: unknown,
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
function document(xml: string) {
  return Buffer.from(
    zipSync({
      'word/document.xml': strToU8(xml),
      'word/styles.xml': strToU8('<styles/>'),
    }),
  );
}
function page(marker: string) {
  return `<page width="1000" height="1000"><word xMin="100" yMin="200" xMax="120" yMax="220">${marker}</word></page>`;
}
beforeEach(() => {
  jest.clearAllMocks();
});
it('replaces DOCX tags with unique markers while preserving other entries and all supported field attributes', () => {
  const source = document(
    '<w:document><w:t>{{Full name;role=Signer;type=text;required=true;title=Title;description=Description;options=One,Two,,;format=custom;=ignore}}</w:t><w:t>{{Approval;type=signature;required=false}}</w:t><w:t>{{Text;type=}}</w:t><w:t>{{;;;}}</w:t></w:document>',
  );
  const result = new DocxFieldTagService().prepareDocument(source);
  expect(result.markers).toMatchObject([
    {
      marker: 'SIGNATAG0001',
      field: {
        name: 'Full name',
        role: 'Signer',
        type: 'text',
        required: true,
        title: 'Title',
        description: 'Description',
        preferences: { options: ['One', 'Two'], format: 'custom' },
      },
    },
    {
      marker: 'SIGNATAG0002',
      field: { name: 'Approval', type: 'signature', required: false },
    },
    { marker: 'SIGNATAG0003', field: { type: 'text' } },
    { marker: 'SIGNATAG0004', field: { name: 'Field' } },
  ]);
  const files = unzipSync(result.buffer);
  expect(strFromU8(files['word/document.xml'])).not.toContain('{{');
  expect(strFromU8(files['word/document.xml'])).toContain('SIGNATAG0004');
  expect(strFromU8(files['word/styles.xml'])).toBe('<styles/>');
});
it('retains untagged DOCX bytes and rejects ZIPs without the document XML entry', () => {
  const service = new DocxFieldTagService();
  const source = document('<w:document>Plain text</w:document>');
  expect(service.prepareDocument(source)).toEqual({
    buffer: source,
    markers: [],
  });
  expect(() =>
    service.prepareDocument(
      Buffer.from(zipSync({ 'word/styles.xml': strToU8('<styles/>') })),
    ),
  ).toThrow();
});
it('extracts marker fields on sequential unnumbered Poppler pages, skips missing markers and decodes XML entities', async () => {
  const service = new DocxFieldTagService();
  const prepared = service.prepareDocument(
    document(
      '{{Name;type=text}}{{Sign;type=signature}}{{Initial;type=initials}}{{Accepted;type=checkbox}}',
    ),
  );
  jest
    .mocked(readFile)
    .mockResolvedValue(
      page('ordinary') +
        page(
          'SIGNATAG0001&amp;SIGNATAG0002&lt;SIGNATAG0003&gt;&quot;SIGNATAG0004&#39;',
        ),
    );
  const fields = await service.extractMarkerFields({
    markers: [
      ...prepared.markers,
      { marker: 'missing', field: { name: 'Missing' } },
    ],
    pdf: Buffer.from('pdf fixture'),
  });
  expect(fields).toHaveLength(4);
  expect(fields[0]).toMatchObject({
    name: 'Name',
    areas: [{ x: 0.1, y: 0.2, h: 0.02, w: 0.08, page: 1 }],
  });
  expect(fields[1].areas?.[0].w).toBe(0.16);
  expect(fields[2].areas?.[0].w).toBe(0.16);
  expect(fields[3].areas?.[0].w).toBe(0.02);
});
it('returns early for an untagged document and does not spawn a geometry process', async () => {
  expect(
    await new DocxFieldTagService().extractMarkerFields({
      markers: [],
      pdf: Buffer.from('fixture'),
    }),
  ).toEqual([]);
  expect(execFile).not.toHaveBeenCalled();
});
it.each([
  [
    Object.assign(new Error('missing'), { code: 'ENOENT' }),
    'pdftotext is not installed',
  ],
  [
    Object.assign(new Error('encrypted'), { stderr: 'Password protected' }),
    'password protected or encrypted',
  ],
  [new Error('timed out'), 'timed out'],
  ['unknown', 'Unknown error'],
])(
  'reports actionable marker-geometry process failures (%s)',
  async (error, message) => {
    jest.mocked(execFile).mockImplementationOnce(((...args: unknown[]) => {
      const callback = args.at(-1) as (error: unknown) => void;
      callback(error);
      return {};
    }) as unknown as typeof execFile);
    await expect(
      new DocxFieldTagService().extractMarkerFields({
        markers: [{ marker: 'SIGNATAG0001', field: {} }],
        pdf: Buffer.from('fixture'),
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: { error: expect.stringContaining(message) as unknown },
    });
  },
);
