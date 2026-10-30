import { createServer, type Server } from 'node:http';
import {
  PdfjsProcessingService,
  type PdfjsXfaNode,
} from './pdfjs-processing.service';
import * as pki from '../pdf-signatures/pki-http';
import sharp from 'sharp';

const esmJest = jest as typeof jest & {
  unstable_mockModule(name: string, factory: () => unknown): void;
};
const getDocument = jest.fn();
esmJest.unstable_mockModule('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument,
}));
let server: Server;
let origin: string;
let requests = 0;
beforeAll(async () => {
  server = createServer((_request, response) => {
    requests++;
    response.end('synthetic private data');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing test listener');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);
afterEach(() => {
  jest.restoreAllMocks();
  getDocument.mockReset();
});
function document(src: string) {
  const xfa: PdfjsXfaNode = {
    name: 'div',
    attributes: { style: { width: '200px', height: '100px' } },
    children: [{ name: 'img', attributes: { src, width: 20, height: 20 } }],
  };
  const destroy = jest.fn().mockResolvedValue(undefined);
  getDocument.mockReturnValue({
    destroy,
    promise: Promise.resolve({
      numPages: 1,
      getPage: () =>
        Promise.resolve({
          getXfa: () => Promise.resolve(xfa),
          getViewport: () => ({ width: 200, height: 100 }),
          cleanup: jest.fn(),
        }),
    }),
  });
  return { service: new PdfjsProcessingService(), destroy };
}
it('blocks private XFA image URLs without requesting the synthetic loopback server', async () => {
  const { service, destroy } = document(`${origin}/private`);
  try {
    await expect(
      service.renderPagePreviews(Buffer.from('engine fixture'), {
        maxPages: 1,
        maxWidth: 200,
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(requests).toBe(0);
    expect(destroy).toHaveBeenCalledTimes(1);
  } finally {
    await service.onModuleDestroy();
  }
});
it.each(['public HTTPS', 'data URI'])(
  'renders a valid XFA %s image through the isolated browser context',
  async (source) => {
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#00ff00' },
    })
      .png()
      .toBuffer();
    const fetch = jest.spyOn(pki, 'fetchPki').mockResolvedValue(
      new Response(new Uint8Array(image), {
        headers: { 'content-type': 'image/png' },
      }),
    );
    const { service, destroy } = document(
      source === 'public HTTPS'
        ? 'https://assets.example.com/xfa.png'
        : `data:image/png;base64,${image.toString('base64')}`,
    );
    try {
      const pages = await service.renderPagePreviews(
        Buffer.from('engine fixture'),
        { maxPages: 1, maxWidth: 200 },
      );
      expect(pages).toMatchObject([{ width: 200, height: 100 }]);
      expect(pages[0].data).toHaveLength(200 * 100 * 4);
      expect(fetch).toHaveBeenCalledTimes(source === 'public HTTPS' ? 1 : 0);
      expect(destroy).toHaveBeenCalledTimes(1);
    } finally {
      await service.onModuleDestroy();
    }
  },
);
