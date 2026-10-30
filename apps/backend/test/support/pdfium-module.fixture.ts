/** Native WASM boundary: service logic stays real; allocations share one heap. */
export function createPdfiumModuleFixture() {
  const heap = new Uint8Array(8192);
  let nextPointer = 1024;
  const free = jest.fn<void, [number]>();
  const output = Buffer.from('%PDF native output');
  const module = {
    pdfium: {
      HEAPU8: heap,
      wasmExports: {
        malloc: jest.fn((size: number) => {
          const pointer = nextPointer;
          nextPointer += size;
          return pointer;
        }),
        free,
      },
    },
    PDFiumExt_Init: jest.fn(),
    FPDF_LoadMemDocument: jest.fn().mockReturnValue(1),
    FPDF_CloseDocument: jest.fn(),
    FPDF_GetFormType: jest.fn().mockReturnValue(0),
    FPDF_GetXFAPacketCount: jest.fn().mockReturnValue(0),
    FPDF_GetXFAPacketName: jest.fn(
      (document: number, index: number, pointer: number, size: number) => {
        const name = Buffer.from(['template\0', 'datasets\0'][index] ?? '\0');
        if (size) heap.set(name, pointer);
        return name.length;
      },
    ),
    FPDF_LoadXFA: jest.fn().mockReturnValue(true),
    PDFiumExt_OpenFormFillInfo: jest.fn().mockReturnValue(2),
    PDFiumExt_CloseFormFillInfo: jest.fn(),
    PDFiumExt_InitFormFillEnvironment: jest.fn().mockReturnValue(3),
    PDFiumExt_ExitFormFillEnvironment: jest.fn(),
    FPDF_GetPageCount: jest.fn().mockReturnValue(1),
    FPDF_LoadPage: jest.fn().mockReturnValue(4),
    FPDF_ClosePage: jest.fn(),
    FORM_OnAfterLoadPage: jest.fn(),
    FORM_OnBeforeClosePage: jest.fn(),
    FPDFPage_GenerateContent: jest.fn().mockReturnValue(true),
    FPDFPage_Flatten: jest.fn().mockReturnValue(1),
    PDFiumExt_OpenFileWriter: jest.fn().mockReturnValue(5),
    PDFiumExt_SaveAsCopy: jest.fn().mockReturnValue(true),
    PDFiumExt_GetFileWriterSize: jest.fn().mockReturnValue(output.length),
    PDFiumExt_GetFileWriterData: jest.fn((_writer: number, pointer: number) => {
      heap.set(output, pointer);
      return output.length;
    }),
    PDFiumExt_CloseFileWriter: jest.fn(),
    FPDF_GetPageWidthF: jest.fn().mockReturnValue(2),
    FPDF_GetPageHeightF: jest.fn().mockReturnValue(2),
    FPDFBitmap_Create: jest.fn().mockReturnValue(6),
    FPDFBitmap_Destroy: jest.fn(),
    FPDFBitmap_FillRect: jest.fn(),
    FPDF_RenderPageBitmap: jest.fn(),
    FPDFBitmap_GetWidth: jest.fn().mockReturnValue(2),
    FPDFBitmap_GetHeight: jest.fn().mockReturnValue(2),
    FPDFBitmap_GetStride: jest.fn().mockReturnValue(12),
    FPDFBitmap_GetBuffer: jest.fn().mockReturnValue(64),
  };
  heap.set(
    [1, 2, 3, 255, 4, 5, 6, 254, 99, 99, 99, 99, 7, 8, 9, 253, 10, 11, 12, 252],
    64,
  );
  return { module, heap, free, output };
}
