import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { convert } from 'libreoffice-convert';
import { PDFDocument } from 'pdf-lib';
import { Browser, chromium } from 'playwright';
import { DocumentConversionService } from './document-conversion.service';
import { TemplateField } from './types/template-json';
jest.mock('libreoffice-convert', () => ({ convert: jest.fn() }));
type EvaluationInput = {
  pageHeight: number;
  pageWidth: number;
  tags: Record<string, string>;
};
let pdfBuffer: Buffer;
beforeAll(async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdfBuffer = Buffer.from(await pdf.save());
});
function setup(options: Record<string, unknown> = {}) {
  const context = {
    on: jest.fn(),
    route: jest.fn().mockResolvedValue(undefined),
  };
  const page = {
    close: jest.fn().mockResolvedValue(undefined),
    context: () => context,
    emulateMedia: jest.fn().mockResolvedValue(undefined),
    setContent: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn(
      (
        evaluate: (input: EvaluationInput) => TemplateField[],
        input: EvaluationInput,
      ) => Promise.resolve(evaluate(input)),
    ),
    pdf: jest.fn().mockImplementation(() => Promise.resolve(pdfBuffer)),
  };
  const contextPage = jest.fn().mockResolvedValue(page);
  Object.assign(context, { newPage: contextPage });
  const browser = {
    newContext: jest.fn().mockResolvedValue(context),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const launch = jest
    .spyOn(chromium, 'launch')
    .mockResolvedValue(browser as unknown as Browser);
  const service = new DocumentConversionService(new ConfigService(options));
  return { service, page, browser, launch };
}
function element(
  attributes: Record<string, string>,
  rect: { left: number; top: number; width: number; height: number },
) {
  return {
    attributes: Object.entries(attributes).map(([name, value]) => ({
      name,
      value,
    })),
    getBoundingClientRect: () => rect,
  };
}
beforeEach(() => {
  jest.mocked(convert).mockReset();
  Object.defineProperty(global, 'window', {
    value: { scrollY: 0 },
    configurable: true,
  });
  Object.defineProperty(global, 'document', {
    value: { querySelectorAll: () => [] },
    configurable: true,
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  Reflect.deleteProperty(global, 'window');
  Reflect.deleteProperty(global, 'document');
});
it('renders wrapped HTML and extracts field types/attributes/geometry through the browser port', async () => {
  const { service, page, browser, launch } = setup();
  const attributes = {
    name: 'Full name',
    role: 'Signer',
    type: 'text',
    required: 'true',
    title: 'Title',
    description: 'Description',
    format: 'custom',
    font: 'Helvetica',
    font_size: '12',
    font_type: 'bold',
    color: '#000000',
    background: '#ffffff',
    align: 'left',
    valign: 'middle',
    price: '2500',
    currency: 'usd',
    mask: 'mask',
    options: 'One, Two,,',
  };
  Object.defineProperty(global, 'document', {
    value: {
      querySelectorAll: (tag: string) =>
        tag === 'text-field'
          ? [
              element(attributes, {
                left: 81.6,
                top: 105.6,
                width: 163.2,
                height: 52.8,
              }),
            ]
          : [],
    },
    configurable: true,
  });
  const result = await service.renderHtmlDocument({
    name: 'Agreement',
    html: '<text-field name="Full name"></text-field>',
    htmlHeader: '<header>Header</header>',
    htmlFooter: '<footer>Footer</footer>',
  });
  expect(result.filename).toBe('Agreement.pdf');
  expect(result.buffer).toEqual(pdfBuffer);
  expect((await PDFDocument.load(result.buffer)).getPageCount()).toBe(1);
  expect(result.head).toBe('<header>Header</header>');
  expect(result.fields[0]).toMatchObject({
    name: 'Full name',
    role: 'Signer',
    type: 'text',
    required: true,
    title: 'Title',
    description: 'Description',
    preferences: {
      options: ['One', 'Two'],
      price: '2500',
      currency: 'usd',
      font_size: '12',
    },
    areas: [{ page: 0 }],
  });
  expect(result.fields[0].areas?.[0].x).toBeCloseTo(0.1);
  expect(result.fields[0].areas?.[0].y).toBeCloseTo(0.1);
  expect(result.fields[0].areas?.[0].w).toBeCloseTo(0.2);
  expect(result.fields[0].areas?.[0].h).toBeCloseTo(0.05);
  expect(result.fields[0].uuid).toMatch(/^[\da-f-]{36}$/);
  expect(page.emulateMedia).toHaveBeenCalledWith({ media: 'print' });
  expect(page.setContent).toHaveBeenCalledWith(
    expect.stringContaining('<!doctype html>'),
    { waitUntil: 'networkidle', timeout: 30000 },
  );
  expect(page.pdf).toHaveBeenCalledWith(
    expect.objectContaining({
      displayHeaderFooter: true,
      headerTemplate: '<header>Header</header>',
      footerTemplate: '<footer>Footer</footer>',
      format: 'Letter',
      printBackground: true,
    }),
  );
  expect(launch).toHaveBeenCalledWith({ headless: true });
  expect(browser.close).toHaveBeenCalledTimes(1);
});
it.each([undefined, '1', '', 'false'])(
  'normalizes required=%s and clamps browser geometry on later/negative pages',
  async (required) => {
    const { service } = setup();
    Object.defineProperty(global, 'window', {
      value: { scrollY: 1056 },
      configurable: true,
    });
    Object.defineProperty(global, 'document', {
      value: {
        querySelectorAll: (tag: string) =>
          tag === 'signature-field'
            ? [
                element(required === undefined ? {} : { required }, {
                  left: -10,
                  top: 100,
                  width: Infinity,
                  height: 5000,
                }),
              ]
            : [],
      },
      configurable: true,
    });
    const result = await service.renderHtmlDocument({
      name: 'Already.PDF',
      html: '<signature-field/>',
    });
    expect(result.filename).toBe('Already.PDF');
    expect(result.head).toBeNull();
    expect(result.fields[0]).toMatchObject({
      name: 'signature',
      type: 'signature',
      required: required === '1' || required === '',
      preferences: {},
      areas: [{ x: 0, w: 0, h: 1, page: 1 }],
    });
  },
);
it('uses configured A4 viewport/timeout and footer-only document metadata', async () => {
  const { service, browser, page } = setup({ HTML_TO_PDF_TIMEOUT_MS: 1234 });
  const result = await service.renderHtmlDocument({
    name: 'Agreement',
    html: '<p>Content</p>',
    size: 'A4',
    htmlFooter: '<footer>Footer only</footer>',
  });
  expect(result.head).toBe('<footer>Footer only</footer>');
  expect(browser.newContext).toHaveBeenCalledWith({
    javaScriptEnabled: false,
    serviceWorkers: 'block',
    viewport: { width: 794, height: 1123 },
  });
  expect(page.setContent).toHaveBeenCalledWith(expect.any(String), {
    waitUntil: 'networkidle',
    timeout: 1234,
  });
});
it.each([new Error('browser failure'), 'browser failure'])(
  'closes the browser after HTML rendering fails (%s)',
  async (failure) => {
    const { service, page, browser } = setup();
    page.setContent.mockRejectedValue(failure);
    await expect(
      service.renderHtmlDocument({ name: 'Agreement', html: '<p>Content</p>' }),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        error: expect.stringContaining(
          failure instanceof Error ? failure.message : 'Unknown error',
        ) as unknown,
      },
    });
    expect(browser.close).toHaveBeenCalledTimes(1);
  },
);
it('rejects oversized UTF-8 HTML and DOCX inputs before invoking browser/converter work', async () => {
  const { service, launch } = setup({ DOCUMENT_CONVERSION_MAX_BYTES: 1 });
  await expect(
    service.renderHtmlDocument({ name: 'Agreement', html: 'é' }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.convertDocxToPdf({
      name: 'file.docx',
      buffer: Buffer.from('large'),
    }),
  ).rejects.toMatchObject({ status: 422 });
  expect(launch).not.toHaveBeenCalled();
  expect(convert).not.toHaveBeenCalled();
});
it('converts DOCX through LibreOffice and hashes exact source bytes', async () => {
  const { service } = setup();
  const input = Buffer.from('DOCX source fixture');
  jest
    .mocked(convert)
    .mockImplementation((_buffer, _format, _filter, callback) =>
      callback(null, pdfBuffer),
    );
  expect(
    await service.convertDocxToPdf({ name: 'Agreement.docx', buffer: input }),
  ).toEqual(pdfBuffer);
  expect(convert).toHaveBeenCalledWith(
    input,
    '.pdf',
    undefined,
    expect.any(Function),
  );
  expect(service.hashSource(input)).toBe(
    createHash('sha1').update(input).digest('hex'),
  );
});
it('returns actionable DOCX conversion failures', async () => {
  const { service } = setup();
  jest
    .mocked(convert)
    .mockImplementation((_buffer, _format, _filter, callback) =>
      callback(new Error('LibreOffice unavailable'), Buffer.alloc(0)),
    );
  await expect(
    service.convertDocxToPdf({
      name: 'Agreement.docx',
      buffer: Buffer.from('input'),
    }),
  ).rejects.toMatchObject({
    status: 422,
    response: {
      error: 'Unable to convert DOCX document: LibreOffice unavailable',
    },
  });
});
