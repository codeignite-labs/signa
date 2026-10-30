import { UnprocessableEntityException } from '@nestjs/common';
import { fetchPki } from '../../pdf-signatures/pki-http';

/** Untrusted document URLs share the DNS-pinned, bounded PKI transport. */
export async function downloadPublicDocument(
  urlValue: string,
  maxBytes: number,
): Promise<Response> {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new UnprocessableEntityException({ error: 'Invalid document URL' });
  }
  if (
    url.protocol !== 'https:' ||
    !['', '443'].includes(url.port) ||
    url.username ||
    url.password
  ) {
    throw new UnprocessableEntityException({
      error:
        'Only HTTPS document URLs without credentials on port 443 are supported',
    });
  }
  try {
    const response = await fetchPki(url, { timeoutMs: 15000, maxBytes });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } catch {
    throw new UnprocessableEntityException({
      error:
        'Unable to download document from a public HTTPS endpoint within the size and time limits',
    });
  }
}
