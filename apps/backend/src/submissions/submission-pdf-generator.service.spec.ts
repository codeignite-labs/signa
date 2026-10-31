import { Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { PdfiumProcessingService } from '../pdf-processing/pdfium-processing.service';
import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageBlob } from '../storage/entities/storage-blob.entity';
import { StorageService } from '../storage/storage.service';
import { Submitter } from '../submitters/entities/submitter.entity';
import { Template } from '../templates/entities/template.entity';
import { TemplateField } from '../templates/types/template-json';
import { SubmissionEvent } from './entities/submission-event.entity';
import { Submission } from './entities/submission.entity';
import {
  SourceDocument,
  SubmissionPdfGeneratorService,
} from './submission-pdf-generator.service';
async function createSource(pageCount = 1) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index++) pdf.addPage([612, 792]);
  return Buffer.from(await pdf.save());
}
function setup(source: Buffer) {
  const blob = Object.assign(new StorageBlob(), {
    key: 'source',
    filename: 'source.pdf',
  });
  const attachment = Object.assign(new StorageAttachment(), {
    uuid: 'document',
    blob,
  });
  const storage = {
    readBlob: jest
      .fn<Promise<Buffer>, [StorageBlob]>()
      .mockResolvedValue(source),
  };
  const pdfium = {
    flattenPdf: jest.fn().mockResolvedValue({ buffer: source }),
  };
  const service = new SubmissionPdfGeneratorService(
    storage as unknown as StorageService,
    pdfium as unknown as PdfiumProcessingService,
  );
  const document: SourceDocument = {
    uuid: attachment.uuid,
    attachment,
    blob,
    filename: blob.filename,
  };
  return { service, document, storage, pdfium };
}
const area = {
  attachment_uuid: 'document',
  x: 0.1,
  y: 0.1,
  w: 0.5,
  h: 0.05,
  page: 0,
};
async function extractText(buffer: Buffer) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  });
  const document = await loading.promise;
  const pages: string[] = [];
  for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex++) {
    const content = await (await document.getPage(pageIndex)).getTextContent();
    pages.push(
      content.items
        .flatMap((item) => ('str' in item ? [item.str] : []))
        .join(' '),
    );
  }
  await loading.destroy();
  return pages.join('\n');
}
beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());
it('stamps explicit/default scalar values, objects and dates while skipping blank values and other documents', async () => {
  const { service, document } = setup(await createSource());
  const fields: TemplateField[] = [
    { uuid: 'name', type: 'text', areas: [area] },
    {
      uuid: 'default',
      default_value: 'Default text',
      areas: [{ ...area, y: 0.2 }],
    },
    { uuid: 'date', areas: [{ ...area, y: 0.3 }] },
    { uuid: 'object', areas: [{ ...area, y: 0.4 }] },
    { uuid: 'array', areas: [{ ...area, y: 0.5 }] },
    { uuid: 'blank', default_value: 'Do not use default', areas: [area] },
    { uuid: 'empty', areas: [area] },
    { uuid: 'nil', areas: [area] },
    { uuid: 'missing', areas: [area] },
    { uuid: 'other', areas: [{ ...area, attachment_uuid: 'other' }] },
    { uuid: 'no-areas', default_value: 'No area' },
  ];
  const result = await service.stampPdfDocument({
    document,
    fields,
    values: {
      name: 'Signed Person',
      date: new Date('2026-01-01'),
      object: { status: 'approved' },
      array: ['One', 2, true],
      blank: '',
      empty: [],
      nil: null,
      other: 'Other document',
    },
    attachmentsByUuid: new Map(),
  });
  const text = await extractText(result);
  expect(text).toContain('Signed Person');
  expect(text).toContain('Default text');
  expect(text).toContain('2026-01-01T00:00:00.000Z');
  expect(text).toContain('{"status":"approved"}');
  expect(text).toContain('One, 2, true');
  expect(text).not.toContain('Do not use default');
  expect(text).not.toContain('Other document');
});
it('stamps checked/unchecked boxes, normalized coordinates, test footers and document IDs on every page', async () => {
  const { service, document, pdfium } = setup(await createSource(2));
  const result = await service.stampPdfDocument({
    document,
    fields: [
      { uuid: 'yes', type: 'checkbox', areas: [area] },
      { uuid: 'no', type: 'checkbox', areas: [{ ...area, y: 0.3 }] },
      {
        default_value: 'Zero',
        areas: [
          { attachment_uuid: 'document', x: NaN, y: Infinity, w: NaN, h: NaN },
        ],
      },
    ],
    values: { yes: true, no: false },
    attachmentsByUuid: new Map(),
    options: {
      flatten: false,
      withSignatureId: true,
      isTestMode: true,
      documentId: 'TEST-DOCUMENT-ID',
    },
  });
  expect(pdfium.flattenPdf).not.toHaveBeenCalled();
  const text = await extractText(result);
  expect(text.match(/TEST MODE - NOT FOR PRODUCTION USE/g)).toHaveLength(2);
  expect(text.match(/Document ID: TEST-DOCUMENT-ID/g)).toHaveLength(2);
  expect(text).toContain('X');
  expect(text).toContain('Zero');
});
it.each([new Error('PDFium unavailable'), 'PDFium unavailable'])(
  'falls back to real AcroForm flattening when PDFium fails (%s)',
  async (failure) => {
    const source = await PDFDocument.create();
    const page = source.addPage([612, 792]);
    const field = source.getForm().createTextField('legacy');
    field.setText('Existing form value');
    field.addToPage(page, { x: 10, y: 700, width: 200, height: 30 });
    const { service, document, pdfium } = setup(
      Buffer.from(await source.save()),
    );
    pdfium.flattenPdf.mockRejectedValue(failure);
    const result = await service.stampPdfDocument({
      document,
      fields: [],
      values: {},
      attachmentsByUuid: new Map(),
    });
    expect((await PDFDocument.load(result)).getForm().getFields()).toHaveLength(
      0,
    );
    expect(await extractText(result)).toContain('Existing form value');
  },
);
it('draws opaque JPEG and transparent PNG image inputs plus unresolved attachment text without crashing', async () => {
  const { service, document, storage } = setup(await createSource());
  const opaque = await sharp({
    create: { width: 10, height: 10, channels: 3, background: 'red' },
  })
    .jpeg()
    .toBuffer();
  const transparent = await sharp({
    create: {
      width: 10,
      height: 10,
      channels: 4,
      background: { r: 0, g: 0, b: 255, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const photo = Object.assign(new StorageAttachment(), {
    uuid: 'photo',
    blob: Object.assign(new StorageBlob(), {
      key: 'photo',
      filename: 'photo.jpg',
    }),
  });
  const alpha = Object.assign(new StorageAttachment(), {
    uuid: 'alpha',
    blob: Object.assign(new StorageBlob(), {
      key: 'alpha',
      filename: 'alpha.png',
    }),
  });
  const source = await createSource();
  storage.readBlob.mockImplementation((blob) =>
    Promise.resolve(
      blob.key === 'source'
        ? source
        : blob.key === 'photo'
          ? opaque
          : transparent,
    ),
  );
  const fields: TemplateField[] = [
    { uuid: 'photo', type: 'image', areas: [area] },
    { uuid: 'alpha', type: 'image', areas: [{ ...area, y: 0.3 }] },
    { uuid: 'missing', type: 'stamp', areas: [{ ...area, y: 0.5 }] },
    { uuid: 'invalid', type: 'signature', areas: [area] },
  ];
  const result = await service.stampPdfDocument({
    document,
    fields,
    values: {
      photo: ['photo'],
      alpha: 'alpha',
      missing: 'missing-asset',
      invalid: 123,
    },
    attachmentsByUuid: new Map([
      ['photo', photo],
      ['alpha', alpha],
    ]),
    options: { flatten: false, withSignatureId: false },
  });
  expect(await extractText(result)).toContain('missing-asset');
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({ data: new Uint8Array(result) });
  const loaded = await loading.promise;
  expect(
    (await (await loaded.getPage(1)).getOperatorList()).fnArray.filter(
      (value) => value === OPS.paintImageXObject,
    ),
  ).toHaveLength(2);
  await loading.destroy();
});
it('adds signature metadata with a reason, signer and timestamp in wide and stacked layouts', async () => {
  const source = await createSource();
  const { service, document, storage } = setup(source);
  const image = await sharp({
    create: { width: 100, height: 30, channels: 4, background: 'black' },
  })
    .png()
    .toBuffer();
  const typed = Object.assign(new StorageAttachment(), {
    uuid: 'typed',
    blob: Object.assign(new StorageBlob(), {
      key: 'typed',
      filename: 'typed-signature.png',
    }),
  });
  const drawn = Object.assign(new StorageAttachment(), {
    uuid: 'drawn',
    blob: Object.assign(new StorageBlob(), {
      key: 'drawn',
      filename: 'drawn-signature.png',
    }),
  });
  storage.readBlob.mockImplementation((blob) =>
    Promise.resolve(blob.key === 'source' ? source : image),
  );
  const fields: TemplateField[] = [
    { uuid: 'wide', type: 'signature', areas: [{ ...area, w: 0.8, h: 0.03 }] },
    {
      uuid: 'narrow',
      type: 'initials',
      areas: [{ ...area, w: 0.3, h: 0.2, y: 0.3 }],
    },
    {
      default_value: 'drawn',
      type: 'signature',
      areas: [{ ...area, y: 0.6, w: 0.3, h: 0.1 }],
    },
  ];
  const result = await service.stampPdfDocument({
    document,
    fields,
    values: {
      wide: 'typed',
      wide_reason: 'Approved',
      narrow: 'drawn',
      narrow_reason: ' ',
    },
    attachmentsByUuid: new Map([
      ['typed', typed],
      ['drawn', drawn],
    ]),
    signatureMetadataByUuid: new Map([
      [
        'typed',
        {
          signedAt: new Date('2026-01-01T12:00:00Z'),
          signerName: 'Signer',
          signerEmail: 'signer@example.test',
        },
      ],
    ]),
    options: { flatten: false, withSignatureId: true },
  });
  const text = await extractText(result);
  expect(text).toContain('ID: TYPED');
  expect(text).toContain('Reason: Approved Signer signer@example.test');
  expect(text).toContain('2026');
  expect(text).toContain('ID: DRAWN');
  expect(text).toContain('Digitally signed by signer');
});
it('merges document attachments preserving page order and ignores an empty attachment set', async () => {
  const source = await createSource(2);
  const { service, document, storage } = setup(source);
  storage.readBlob
    .mockResolvedValueOnce(await createSource())
    .mockResolvedValueOnce(source);
  expect(
    (
      await PDFDocument.load(
        await service.mergePdfAttachments([
          document.attachment,
          document.attachment,
        ]),
      )
    ).getPageCount(),
  ).toBe(3);
  expect(
    (
      await PDFDocument.load(await service.mergePdfAttachments([]))
    ).getPageCount(),
  ).toBe(0);
});
it('builds audit trail summaries, document hashes and ordered completion events', async () => {
  const { service } = setup(await createSource());
  const submission: Submission = Object.assign(new Submission(), {
    id: 'submission',
    slug: 'slug',
    name: 'Agreement',
    template: null,
    submitters: [
      Object.assign(new Submitter(), { completedAt: new Date('2026-01-02') }),
      Object.assign(new Submitter(), { completedAt: new Date('2026-01-01') }),
      Object.assign(new Submitter(), { completedAt: null }),
    ],
    submissionEvents: [
      Object.assign(new SubmissionEvent(), {
        eventTimestamp: new Date('2026-01-02'),
        eventType: 'form.completed',
      }),
      Object.assign(new SubmissionEvent(), {
        eventTimestamp: new Date('2026-01-01'),
        eventType: 'form.viewed',
      }),
    ],
  });
  const result = await service.buildAuditTrail(submission, [
    {
      filename: 'Agreement.pdf',
      originalSha256: 'original-hash',
      resultSha256: 'result-hash',
    },
  ]);
  const text = await extractText(result);
  expect(text).toContain('Audit Trail');
  expect(text).toContain('Submission: Agreement');
  expect(text).toContain('Completed at: 2026-01-02');
  expect(text).toContain('Original SHA-256: original-hash');
  expect(text.indexOf('form.viewed')).toBeLessThan(
    text.indexOf('form.completed'),
  );
});
it('bounds long audit lists to one page, labels test logs and uses missing-value/name fallbacks', async () => {
  const { service } = setup(await createSource());
  const submission: Submission = Object.assign(new Submission(), {
    id: 'submission',
    slug: 'slug',
    name: null,
    template: Object.assign(new Template(), { name: 'Template fallback' }),
    submitters: undefined,
    submissionEvents: Array.from({ length: 60 }, (_, index) =>
      Object.assign(new SubmissionEvent(), {
        eventTimestamp: new Date(2026, 0, 1, 0, index),
        eventType: `event-${index}`,
      }),
    ),
  });
  const documents = Array.from({ length: 30 }, (_, index) => ({
    filename: `Document-${index}.pdf`,
    originalSha256: null,
    resultSha256: null,
  }));
  const text = await extractText(
    await service.buildAuditTrail(submission, documents, { isTestMode: true }),
  );
  expect(text).toContain('Testing Log - Not for Production Use');
  expect(text).toContain('Submission: Template fallback');
  expect(text).toContain('Original SHA-256: n/a');
  expect(text).not.toContain('Document-29.pdf');
  submission.template = null;
  submission.submissionEvents = undefined as unknown as SubmissionEvent[];
  expect(
    await extractText(await service.buildAuditTrail(submission)),
  ).toContain('Submission: submission');
});
