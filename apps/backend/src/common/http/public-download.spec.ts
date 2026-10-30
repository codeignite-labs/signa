import { fetchPki } from '../../pdf-signatures/pki-http';
import { downloadPublicDocument } from './public-download';
jest.mock('../../pdf-signatures/pki-http', () => ({ fetchPki: jest.fn() }));
const transport = jest.mocked(fetchPki);
beforeEach(() => jest.resetAllMocks());
it.each([
  'http://example.test/file',
  'https://example.test:8443/file',
  'https://user:secret@example.test/file',
  'file:///etc/passwd',
  'invalid',
])('rejects unsafe URL %s before transport', async (url) => {
  await expect(downloadPublicDocument(url, 10)).rejects.toMatchObject({
    status: 422,
  });
  expect(transport).not.toHaveBeenCalled();
});
it('passes a strict deadline and byte limit to the pinned transport', async () => {
  const response = new Response('PDF', {
    headers: { 'content-type': 'application/pdf' },
  });
  transport.mockResolvedValue(response);
  expect(await downloadPublicDocument('https://example.test/file', 12)).toBe(
    response,
  );
  expect(transport).toHaveBeenCalledWith(new URL('https://example.test/file'), {
    timeoutMs: 15000,
    maxBytes: 12,
  });
});
it.each([403, 500])(
  'converts download HTTP %s errors into a safe 422',
  async (status) => {
    transport.mockResolvedValue(new Response('', { status }));
    await expect(
      downloadPublicDocument('https://example.test/file', 10),
    ).rejects.toMatchObject({ status: 422 });
  },
);
it('converts DNS, redirect and streaming limit failures without leaking private addresses', async () => {
  transport.mockRejectedValue(new Error('private 127.0.0.1'));
  const failure: unknown = await downloadPublicDocument(
    'https://example.test/file',
    10,
  ).catch((error: unknown) => error);
  expect(failure).toMatchObject({ status: 422 });
  expect(JSON.stringify(failure)).not.toContain('127.0.0.1');
});
