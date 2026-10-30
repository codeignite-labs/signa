import { installRendererCoverageBridge } from '../../test/support/renderer-coverage.fixture';
import { ConfigService } from '@nestjs/config';
import { createServer, Server } from 'node:http';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { DocumentConversionService } from './document-conversion.service';
import * as pki from '../pdf-signatures/pki-http';

let server: Server;
let origin: string;
let requests = 0;
let image: Buffer;
beforeAll(async () => {
  image = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#123456' },
  })
    .png()
    .toBuffer();
  server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { 'content-type': 'image/png' });
    response.end(image);
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
beforeEach(() => {
  requests = 0;
  installRendererCoverageBridge();
});
afterEach(() => jest.restoreAllMocks());
function render(
  html: string,
  print: { htmlHeader?: string; htmlFooter?: string } = {},
) {
  return new DocumentConversionService(new ConfigService()).renderHtmlDocument({
    name: 'renderer network fixture',
    html,
    ...print,
  });
}
it('rejects private image loads without contacting the loopback listener', async () => {
  await expect(
    render(`<img src="${origin}/private.png">`),
  ).rejects.toMatchObject({ status: 422 });
  expect(requests).toBe(0);
});
it.each(['htmlHeader', 'htmlFooter'] as const)(
  'rejects external print resources in %s without contacting the listener',
  async (location) => {
    await expect(
      render('<p>body</p>', { [location]: `<img src="${origin}/print.png">` }),
    ).rejects.toMatchObject({ status: 422 });
    expect(requests).toBe(0);
  },
);
it('renders public assets through the pinned downloader, inline images and field geometry with page scripts disabled', async () => {
  const fetch = jest.spyOn(pki, 'fetchPki').mockImplementation(() =>
    Promise.resolve(
      new Response(new Uint8Array(image), {
        headers: { 'content-type': 'image/png' },
      }),
    ),
  );
  const data = `data:image/png;base64,${image.toString('base64')}`;
  const result = await render(
    `${Array.from({ length: 10 }, (_, index) => `<img src="https://assets.example.com/logo-${index}.png">`).join('')}<img src="${data}"><text-field name="Customer" required style="width:120px;height:30px"></text-field><script>document.querySelector('text-field').remove(); fetch('${origin}/script');</script>`,
    {
      htmlHeader: `<img src="${data}">`,
      htmlFooter: '<span class="pageNumber"></span>',
    },
  );
  expect((await PDFDocument.load(result.buffer)).getPageCount()).toBe(1);
  expect(result.fields).toMatchObject([
    { name: 'Customer', type: 'text', required: true, areas: [{ page: 0 }] },
  ]);
  expect(result.fields[0].areas?.[0].w).toBeGreaterThan(0);
  expect(result.fields[0].uuid).toMatch(/^[\da-f-]{36}$/);
  expect(result.fields[0].areas?.[0].uuid).toMatch(/^[\da-f-]{36}$/);
  expect(fetch).toHaveBeenCalledTimes(10);
  expect(fetch).toHaveBeenCalledWith(
    new URL('https://assets.example.com/logo-0.png'),
    expect.objectContaining({ maxBytes: 5 * 1024 * 1024 }),
  );
  expect(requests).toBe(0);
});
