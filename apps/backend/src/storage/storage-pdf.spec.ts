import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { Repository } from 'typeorm';
import { PdfjsProcessingService } from '../pdf-processing/pdfjs-processing.service';
import {
  PdfiumPdfMetadata,
  PdfiumProcessingService,
} from '../pdf-processing/pdfium-processing.service';
import { StorageAttachment } from './entities/storage-attachment.entity';
import { StorageBlob } from './entities/storage-blob.entity';
import { StorageService } from './storage.service';
const standardMetadata: PdfiumPdfMetadata = {
  formType: 'none',
  hasXfa: false,
  processingMode: 'standard_pdf',
  xfaLoadStatus: 'not_applicable',
  xfaLoaded: false,
  xfaPacketCount: 0,
  xfaPacketNames: [],
};
const xfaMetadata: PdfiumPdfMetadata = {
  formType: 'xfa_full',
  hasXfa: true,
  processingMode: 'xfa',
  xfaLoadStatus: 'unsupported',
  xfaLoaded: false,
  xfaPacketCount: 2,
  xfaPacketNames: ['template', 'datasets'],
};
const page = { data: Buffer.from([255, 0, 0, 255]), width: 1, height: 1 };
let storageRoot: string;
let pdfBuffer: Buffer;
beforeEach(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'signa-storage-pdf-test-'));
  const pdf = await PDFDocument.create();
  pdf.addPage([100, 100]);
  pdfBuffer = Buffer.from(await pdf.save());
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(async () => {
  jest.restoreAllMocks();
  await rm(storageRoot, { recursive: true, force: true });
});
function setup() {
  const blobs = {
    create: jest.fn((input: Partial<StorageBlob>) =>
      Object.assign(new StorageBlob(), { id: 'blob' }, input),
    ),
    save: jest.fn((blob: StorageBlob) => Promise.resolve(blob)),
  };
  const saved: StorageAttachment[] = [];
  const attachments = {
    create: jest.fn((input: Partial<StorageAttachment>) =>
      Object.assign(
        new StorageAttachment(),
        { id: String(saved.length + 1) },
        input,
      ),
    ),
    save: jest.fn((attachment: StorageAttachment) => {
      saved.push(attachment);
      return Promise.resolve(attachment);
    }),
    findOne: jest
      .fn<Promise<StorageAttachment | null>, []>()
      .mockImplementation(() => Promise.resolve(saved.at(0) ?? null)),
  };
  const pdfium = {
    inspectPdf: jest
      .fn<Promise<PdfiumPdfMetadata>, [Buffer]>()
      .mockResolvedValue(standardMetadata),
    renderPagePreviews: jest.fn().mockResolvedValue([page]),
  };
  const pdfjs = {
    rasterizePdf: jest
      .fn()
      .mockResolvedValue({ buffer: pdfBuffer, pageCount: 1 }),
    renderPagePreviews: jest.fn().mockResolvedValue([page]),
  };
  const service = new StorageService(
    blobs as unknown as Repository<StorageBlob>,
    attachments as unknown as Repository<StorageAttachment>,
    new ConfigService({
      STORAGE_SERVICE: 'local',
      STORAGE_PATH: storageRoot,
      PDF_PREVIEW_MAX_PAGES: 2,
      PDF_PREVIEW_MAX_WIDTH: 500,
    }),
    pdfium as unknown as PdfiumProcessingService,
    pdfjs as unknown as PdfjsProcessingService,
  );
  const input = {
    buffer: pdfBuffer,
    filename: 'Agreement.pdf',
    name: 'documents',
    recordType: 'Template',
    recordId: 'template',
  };
  return { service, attachments, blobs, saved, pdfium, pdfjs, input };
}
it('analyzes PDF bytes and stores real PNG preview metadata without rasterizing ordinary PDFs', async () => {
  const { service, saved, pdfium, pdfjs, input } = setup();
  const result = await service.createPdfAttachment({
    ...input,
    metadata: { source: 'upload', pdf: { custom: 'retained' } },
  });
  expect(result.blob.metadata).toMatchObject({
    source: 'upload',
    identified: true,
    analyzed: true,
    pdf: {
      custom: 'retained',
      number_of_pages: 1,
      processing_mode: 'standard_pdf',
      has_xfa: false,
    },
  });
  expect(result.blob.sha256).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(pdfium.renderPagePreviews).toHaveBeenCalledWith(pdfBuffer, {
    maxPages: 2,
    maxWidth: 500,
  });
  expect(pdfjs.rasterizePdf).not.toHaveBeenCalled();
  expect(saved[1]).toMatchObject({
    recordType: 'ActiveStorage::Attachment',
    recordId: result.id,
    name: 'preview_images',
    blob: {
      filename: '0.png',
      contentType: 'image/png',
      metadata: { width: 1, height: 1 },
    },
  });
  const preview = await sharp(await service.readBlob(saved[1].blob)).metadata();
  expect(preview).toMatchObject({ format: 'png', width: 1, height: 1 });
});
it('rasterizes unsupported XFA and records the original form metadata alongside converted metadata', async () => {
  const { service, pdfium, pdfjs, input } = setup();
  pdfium.inspectPdf
    .mockResolvedValueOnce(xfaMetadata)
    .mockResolvedValueOnce(standardMetadata);
  const result = await service.createPdfAttachment({
    ...input,
    metadata: { pdf: [] },
  });
  expect(pdfjs.rasterizePdf).toHaveBeenCalledWith(pdfBuffer, { scale: 2 });
  expect(result.blob.metadata).toMatchObject({
    source_sha256: result.blob.sha256,
    pdf: {
      processing_mode: 'standard_pdf',
      source_form_type: 'xfa_full',
      source_has_xfa: true,
      source_xfa_packet_count: 2,
      source_xfa_packet_names: ['template', 'datasets'],
      xfa_converted_by: 'pdfjs',
      xfa_converted_page_count: 1,
      xfa_rasterized: true,
    },
  });
});
it('renders XFA previews through PDF.js when conversion metadata still identifies unsupported XFA', async () => {
  const { service, pdfium, pdfjs, input } = setup();
  pdfium.inspectPdf.mockResolvedValue(xfaMetadata);
  await service.createPdfAttachment(input);
  expect(pdfjs.renderPagePreviews).toHaveBeenCalledWith(pdfBuffer, {
    maxPages: 2,
    maxWidth: 500,
  });
  expect(pdfium.renderPagePreviews).not.toHaveBeenCalled();
});
it.each([new Error('renderer failed'), 'renderer failure', null])(
  'falls back to PDF.js after PDFium errors or empty previews',
  async (failure) => {
    const { service, pdfium, pdfjs, input } = setup();
    if (failure === null) pdfium.renderPagePreviews.mockResolvedValue([]);
    else pdfium.renderPagePreviews.mockRejectedValue(failure);
    expect(await service.createPdfAttachment(input)).toBeTruthy();
    expect(pdfjs.renderPagePreviews).toHaveBeenCalledTimes(1);
  },
);
it('fails explicitly when neither renderer produces pages and does not create empty preview attachments', async () => {
  const { service, pdfium, pdfjs, saved, input } = setup();
  pdfium.renderPagePreviews.mockResolvedValue([]);
  pdfjs.renderPagePreviews.mockResolvedValue([]);
  await expect(service.createPdfAttachment(input)).rejects.toThrow(
    'PDF preview generation returned no pages',
  );
  expect(saved).toHaveLength(1);
});
it('reports missing persisted PDF attachment instead of returning an incomplete response', async () => {
  const { service, attachments, input } = setup();
  attachments.findOne.mockResolvedValue(null);
  await expect(service.createPdfAttachment(input)).rejects.toMatchObject({
    status: 404,
  });
});
