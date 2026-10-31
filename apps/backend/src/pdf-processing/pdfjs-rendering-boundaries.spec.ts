import { Browser, chromium } from 'playwright';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import {
  PdfjsProcessingService,
  PdfjsXfaNode,
} from './pdfjs-processing.service';
const esmJest = jest as typeof jest & {
  unstable_mockModule(name: string, factory: () => unknown): void;
};
const getDocument = jest.fn();
esmJest.unstable_mockModule('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument,
}));
function setup(roots: Array<PdfjsXfaNode | null>) {
  const pages = roots.map((root) => ({
    getXfa: jest.fn().mockResolvedValue(root),
    getViewport: jest.fn(({ scale }: { scale: number }) => ({
      width: 200 * scale,
      height: 100 * scale,
    })),
    cleanup: jest.fn(),
    render: jest.fn().mockReturnValue({ promise: Promise.resolve() }),
  }));
  const destroy = jest.fn().mockResolvedValue(undefined);
  getDocument.mockReturnValue({
    destroy,
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: (number: number) => Promise.resolve(pages[number - 1]),
    }),
  });
  const browserContexts: Array<{ close: jest.Mock }> = [];
  const html: string[] = [];
  const setContent = jest.fn((value: string) => {
    html.push(value);
    return Promise.resolve();
  });
  const browser = {
    close: jest.fn().mockResolvedValue(undefined),
    newContext: jest.fn(
      ({
        viewport,
        deviceScaleFactor,
      }: {
        viewport: { width: number; height: number };
        deviceScaleFactor: number;
      }) => {
        const screenshot = () =>
          sharp({
            create: {
              width: Math.max(
                1,
                Math.round(viewport.width * deviceScaleFactor),
              ),
              height: Math.max(
                1,
                Math.round(viewport.height * deviceScaleFactor),
              ),
              channels: 4,
              background: '#123456',
            },
          })
            .png()
            .toBuffer();
        const page = {
          setContent,
          locator: jest.fn().mockReturnValue({ screenshot }),
        };
        const context = {
          on: jest.fn(),
          route: jest.fn().mockResolvedValue(undefined),
          close: jest.fn().mockResolvedValue(undefined),
          newPage: jest.fn().mockResolvedValue(page),
        };
        browserContexts.push(context);
        return Promise.resolve(context);
      },
    ),
  };
  const launch = jest
    .spyOn(chromium, 'launch')
    .mockResolvedValue(browser as unknown as Browser);
  return {
    service: new PdfjsProcessingService(),
    pages,
    destroy,
    browser,
    browserContexts,
    html,
    setContent,
    launch,
  };
}
afterEach(() => {
  jest.restoreAllMocks();
  getDocument.mockReset();
});
it('escapes XFA text/attributes, retains boolean/default values and filters unsupported attribute objects', async () => {
  const root: PdfjsXfaNode = {
    name: 'div',
    attributes: {
      style: {
        width: '200px',
        height: '100px',
        marginTop: '2px',
        ignored: null,
      },
      class: ['xfa', 'safe'],
      xmlns: 'ignore',
      absent: null,
    },
    children: [
      { name: 'script', value: '<script>alert("x")</script>' },
      { name: 'span', children: [{ name: '#text', value: '<&>' }] },
      {
        name: 'input',
        attributes: {
          textContent: 'A & "B"',
          disabled: true,
          hidden: false,
          count: 2,
          ignored: { arbitrary: true },
          'data@key': 'safe',
        },
      },
      { name: 'textarea', value: 'Saved text' },
      { name: 'p' },
      { name: '#text', value: 42 },
    ],
  };
  const { service, html, destroy, pages, browserContexts, browser } = setup([
    root,
  ]);
  const result = await service.renderPagePreviews(
    Buffer.from('XFA engine input'),
    { maxPages: 1, maxWidth: 100 },
  );
  expect(result[0]).toMatchObject({ width: 100, height: 50 });
  expect(html[0]).toContain('&lt;script&gt;');
  expect(html[0]).not.toContain('<script>');
  expect(html[0]).toContain('margin-top:2px');
  expect(html[0]).toContain('disabled');
  expect(html[0]).not.toContain(' hidden');
  expect(html[0]).toContain('value="A &amp; &quot;B&quot;"');
  expect(html[0]).toContain('value="Saved text"');
  expect(html[0]).toContain('datakey="safe"');
  expect(html[0]).not.toContain('[object Object]');
  expect(pages[0].cleanup).toHaveBeenCalledTimes(1);
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(browserContexts[0].close).toHaveBeenCalledTimes(1);
  await service.onModuleDestroy();
  expect(browser.close).toHaveBeenCalledTimes(1);
});
it.each([
  { style: { width: 0, height: null } },
  { style: { width: 'invalid', height: '-2px' } },
  {},
])(
  'falls back to standard XFA page dimensions for unusable style metadata (%j)',
  async (attributes) => {
    const { service, destroy } = setup([{ name: 'div', attributes }]);
    expect(
      await service.extractXfaPages(Buffer.from('XFA engine input')),
    ).toMatchObject([{ width: 612, height: 792 }]);
    expect(destroy).toHaveBeenCalledTimes(1);
  },
);
it('keeps the loading task alive until all pages are extracted and skips ordinary pages', async () => {
  const { service, pages, destroy } = setup([
    null,
    {
      name: 'div',
      attributes: { style: { width: '200px', height: '100px' } },
      children: [],
    },
  ]);
  expect(
    await service.extractXfaPages(Buffer.from('PDF engine input')),
  ).toMatchObject([{ page: 1, width: 200, height: 100 }]);
  expect(pages.every((page) => page.cleanup.mock.calls.length === 1)).toBe(
    true,
  );
  expect(destroy).toHaveBeenCalledTimes(1);
});
it('reuses its XFA browser across pages and closes document/context resources on rendering failure', async () => {
  const root = {
    name: 'div',
    attributes: { style: { width: '200px', height: '100px' } },
  };
  const { service, browser, browserContexts, setContent, destroy, launch } =
    setup([root, root]);
  const result = await service.rasterizePdf(Buffer.from('XFA engine input'), {
    scale: 1,
  });
  expect((await PDFDocument.load(result.buffer)).getPageCount()).toBe(2);
  expect(launch).toHaveBeenCalledTimes(1);
  expect(
    browserContexts.every((context) => context.close.mock.calls.length === 1),
  ).toBe(true);
  setContent.mockRejectedValueOnce(new Error('rendering failed'));
  await expect(
    service.renderPagePreviews(Buffer.from('same document'), {
      maxPages: 1,
      maxWidth: 200,
    }),
  ).rejects.toThrow('rendering failed');
  expect(browserContexts[2].close).toHaveBeenCalledTimes(1);
  expect(destroy).toHaveBeenCalledTimes(2);
  await service.onModuleDestroy();
  expect(browser.close).toHaveBeenCalledTimes(1);
});
it('uses the supported preview scale fallback for a nonpositive requested width without upscaling the PDF', async () => {
  const { service, pages, destroy } = setup([null]);
  const result = await service.renderPagePreviews(
    Buffer.from('PDF engine input'),
    { maxPages: 1, maxWidth: 0 },
  );
  expect(result[0]).toMatchObject({ width: 200, height: 100 });
  expect(pages[0].getViewport).toHaveBeenCalledWith({ scale: 1 });
  expect(destroy).toHaveBeenCalledTimes(1);
});
