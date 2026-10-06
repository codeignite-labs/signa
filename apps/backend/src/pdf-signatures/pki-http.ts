import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

const denied = new BlockList();
for (const [network, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['192.0.0.0', 24],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  denied.addSubnet(network, bits, 'ipv4');
for (const [network, bits] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  denied.addSubnet(network, bits, 'ipv6');

export function isPublicPkiAddress(address: string): boolean {
  const family = isIP(address);
  return (
    !!family &&
    (family !== 6 || /^[23][a-f\d]{3}:/i.test(address)) &&
    !denied.check(address, family === 4 ? 'ipv4' : 'ipv6')
  );
}

// Pin the checked DNS address into the connection to avoid DNS rebinding.
// PKI endpoints can originate in uploaded, untrusted certificates.
export async function fetchPki(
  urlValue: string | URL,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: Uint8Array;
    timeoutMs: number;
    maxBytes?: number;
  },
): Promise<Response> {
  const url = new URL(urlValue);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('Invalid PKI endpoint');
  const started = Date.now();
  let dnsTimer: NodeJS.Timeout | undefined;
  const addresses = await Promise.race([
    lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true }),
    new Promise<never>((_resolve, reject) => {
      dnsTimer = setTimeout(
        () => reject(new Error('PKI DNS lookup timed out')),
        options.timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicPkiAddress(address))
  )
    throw new Error('PKI endpoints must resolve to public addresses');
  const target = addresses[0];
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: options.method ?? 'GET',
        headers: options.headers,
        lookup: (_hostname, _options, callback) =>
          callback(null, target.address, target.family),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > (options.maxBytes ?? 10 * 1024 * 1024))
            request.destroy(new Error('PKI response exceeds size limit'));
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          const status = response.statusCode ?? 502;
          if (status >= 300 && status < 400) {
            reject(new Error('PKI redirects are not allowed'));
            return;
          }
          if (status < 200 || status > 599) {
            reject(new Error('Invalid PKI response status'));
            return;
          }
          resolve(
            new Response(
              [204, 205, 304].includes(status)
                ? null
                : new Uint8Array(Buffer.concat(chunks)),
              { status },
            ),
          );
        });
      },
    );
    const timeout = setTimeout(
      () => request.destroy(new Error('PKI request timed out')),
      Math.max(1, options.timeoutMs - (Date.now() - started)),
    );
    request.on('close', () => clearTimeout(timeout));
    request.on('error', reject);
    request.end(options.body);
  });
}
