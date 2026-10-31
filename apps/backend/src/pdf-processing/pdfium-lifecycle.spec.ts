import { init } from '@embedpdf/pdfium';
import { createPdfiumModuleFixture } from '../../test/support/pdfium-module.fixture';
import { PdfiumProcessingService } from './pdfium-processing.service';
jest.mock('@embedpdf/pdfium', () => ({ init: jest.fn() }));
function setup() {
  const fixture = createPdfiumModuleFixture();
  jest
    .mocked(init)
    .mockResolvedValue(
      fixture.module as unknown as Awaited<ReturnType<typeof init>>,
    );
  return { ...fixture, service: new PdfiumProcessingService() };
}
beforeEach(() => jest.resetAllMocks());
it('reuses initialization, copies PDF input/output and frees native documents, form handles and writer memory', async () => {
  const { service, module, heap, free, output } = setup();
  const source = Buffer.from('source document bytes');
  expect(await service.flattenPdf(source)).toMatchObject({
    buffer: output,
    pageCount: 1,
    flattenedPages: 1,
  });
  expect(Buffer.from(heap.subarray(1024, 1024 + source.length))).toEqual(
    source,
  );
  expect(module.PDFiumExt_CloseFileWriter).toHaveBeenCalledWith(5);
  expect(module.FORM_OnBeforeClosePage).toHaveBeenCalledWith(4, 3);
  expect(module.PDFiumExt_ExitFormFillEnvironment).toHaveBeenCalledWith(3);
  expect(module.PDFiumExt_CloseFormFillInfo).toHaveBeenCalledWith(2);
  expect(module.FPDF_CloseDocument).toHaveBeenCalledWith(1);
  expect(free).toHaveBeenCalledWith(1024);
  await service.inspectPdf(source);
  expect(init).toHaveBeenCalledTimes(1);
  expect(module.PDFiumExt_Init).toHaveBeenCalledTimes(1);
});
it('renders BGRA pixels into RGBA without stride padding and bounds page previews', async () => {
  const { service, module } = setup();
  module.FPDF_GetPageCount.mockReturnValue(3);
  const pages = await service.renderPagePreviews(Buffer.from('pdf'), {
    maxPages: 1,
    maxWidth: 2,
  });
  expect(pages).toEqual([
    {
      width: 2,
      height: 2,
      data: Buffer.from([
        3, 2, 1, 255, 6, 5, 4, 254, 9, 8, 7, 253, 12, 11, 10, 252,
      ]),
    },
  ]);
  expect(module.FPDF_LoadPage).toHaveBeenCalledTimes(1);
  expect(module.FPDFBitmap_Destroy).toHaveBeenCalledWith(6);
  expect(module.FPDF_ClosePage).toHaveBeenCalledWith(4);
  expect(module.FPDF_CloseDocument).toHaveBeenCalledWith(1);
});
it.each([
  ['form information', 'PDFiumExt_OpenFormFillInfo', 0],
  ['form environment', 'PDFiumExt_InitFormFillEnvironment', 0],
  ['page loading', 'FPDF_LoadPage', 0],
  ['content generation', 'FPDFPage_GenerateContent', false],
  ['flattening', 'FPDFPage_Flatten', 0],
  ['writer allocation', 'PDFiumExt_OpenFileWriter', 0],
  ['saving', 'PDFiumExt_SaveAsCopy', false],
  ['empty output', 'PDFiumExt_GetFileWriterSize', 0],
  ['output read', 'PDFiumExt_GetFileWriterData', 0],
] as const)(
  'releases document memory when native %s fails',
  async (_name, method, value) => {
    const { service, module, free } = setup();
    module[method].mockReturnValue(value as never);
    await expect(service.flattenPdf(Buffer.from('pdf'))).rejects.toThrow(
      'PDFium',
    );
    expect(module.FPDF_CloseDocument).toHaveBeenCalledWith(1);
    expect(free).toHaveBeenCalledWith(1024);
    if (['saving', 'empty output', 'output read'].includes(_name))
      expect(module.PDFiumExt_CloseFileWriter).toHaveBeenCalledWith(5);
  },
);
it('frees input memory when PDF parsing fails before document creation', async () => {
  const { service, module, free } = setup();
  module.FPDF_LoadMemDocument.mockReturnValue(0);
  await expect(service.inspectPdf(Buffer.from('invalid'))).rejects.toThrow(
    'load PDF bytes',
  );
  expect(free).toHaveBeenCalledWith(1024);
  expect(module.FPDF_CloseDocument).not.toHaveBeenCalled();
});
it.each(['load page', 'allocate bitmap', 'render bitmap'])(
  'releases allocated preview resources when native rendering fails to %s',
  async (failure) => {
    const { service, module } = setup();
    if (failure === 'load page') module.FPDF_LoadPage.mockReturnValue(0);
    if (failure === 'allocate bitmap')
      module.FPDFBitmap_Create.mockReturnValue(0);
    if (failure === 'render bitmap')
      module.FPDF_RenderPageBitmap.mockImplementation(() => {
        throw new Error('render bitmap');
      });
    await expect(
      service.renderPagePreviews(Buffer.from('pdf'), {
        maxPages: 1,
        maxWidth: 2,
      }),
    ).rejects.toThrow();
    expect(module.FPDF_CloseDocument).toHaveBeenCalledWith(1);
    if (failure === 'render bitmap')
      expect(module.FPDFBitmap_Destroy).toHaveBeenCalledWith(6);
    else expect(module.FPDFBitmap_Destroy).not.toHaveBeenCalled();
  },
);
it.each([0, 1, 2, 3, 99])(
  'reports form type %s and probes XFA support only when needed',
  async (formType) => {
    const { service, module } = setup();
    module.FPDF_GetFormType.mockReturnValue(formType);
    const metadata = await service.inspectPdf(Buffer.from('pdf'));
    const xfa = [2, 3].includes(formType);
    expect(metadata).toMatchObject({
      formType:
        ['none', 'acro_form', 'xfa_full', 'xfa_foreground'][formType] ??
        'unknown',
      processingMode: xfa
        ? 'xfa'
        : formType === 1
          ? 'acro_form'
          : 'standard_pdf',
      xfaLoaded: xfa,
      xfaLoadStatus: xfa ? 'loaded' : 'not_applicable',
    });
    expect(module.FPDF_LoadXFA).toHaveBeenCalledTimes(xfa ? 1 : 0);
  },
);
it.each([true, false])(
  'records XFA packets and prepares its native form context (supported=%s)',
  async (supported) => {
    const { service, module, free } = setup();
    module.FPDF_GetXFAPacketCount.mockReturnValue(2);
    module.FPDF_LoadXFA.mockReturnValue(supported);
    const result = await service.flattenPdf(Buffer.from('pdf'));
    expect(result.metadata).toMatchObject({
      hasXfa: true,
      xfaPacketNames: ['template', 'datasets'],
      xfaLoaded: supported,
      xfaLoadStatus: supported ? 'loaded' : 'unsupported',
    });
    expect(free).toHaveBeenCalledTimes(4);
  },
);
it('skips empty or failed XFA packet names and handles pages without flattenable annotations', async () => {
  const { service, module } = setup();
  module.FPDF_GetXFAPacketCount.mockReturnValue(2);
  module.FPDF_GetXFAPacketName.mockReturnValueOnce(2)
    .mockReturnValueOnce(10)
    .mockReturnValueOnce(0);
  module.FPDFPage_Flatten.mockReturnValue(2);
  expect(await service.flattenPdf(Buffer.from('pdf'))).toMatchObject({
    flattenedPages: 0,
    metadata: { xfaPacketNames: [] },
  });
});
it('reports unsupported XFA inspection without allocating form or page resources', async () => {
  const { service, module, free } = setup();
  module.FPDF_GetFormType.mockReturnValue(2);
  module.FPDF_LoadXFA.mockReturnValue(false);
  await expect(
    service.inspectPdf(Buffer.from('unsupported XFA')),
  ).resolves.toMatchObject({
    formType: 'xfa_full',
    hasXfa: true,
    processingMode: 'xfa',
    xfaLoaded: false,
    xfaLoadStatus: 'unsupported',
  });
  expect(module.PDFiumExt_OpenFormFillInfo).not.toHaveBeenCalled();
  expect(module.FPDF_LoadPage).not.toHaveBeenCalled();
  expect(module.FPDF_CloseDocument).toHaveBeenCalledWith(1);
  expect(free).toHaveBeenCalledWith(1024);
});
