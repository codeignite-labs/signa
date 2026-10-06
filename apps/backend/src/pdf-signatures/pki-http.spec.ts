import { fetchPki, isPublicPkiAddress } from './pki-http';

describe('PKI endpoint isolation', () => {
  it.each([
    '127.0.0.1',
    '169.254.169.254',
    '10.2.3.4',
    '172.16.1.1',
    '192.168.1.1',
    '100.64.1.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    'not-an-ip',
  ])('rejects nonpublic address %s', (address) => {
    expect(isPublicPkiAddress(address)).toBe(false);
  });
  it('accepts public IPv4 and IPv6', () => {
    expect(isPublicPkiAddress('8.8.8.8')).toBe(true);
    expect(isPublicPkiAddress('2606:4700:4700::1111')).toBe(true);
  });
  it('refuses private endpoints and unsupported schemes before connecting', async () => {
    await expect(
      fetchPki('http://127.0.0.1/metadata', { timeoutMs: 1000 }),
    ).rejects.toThrow('public addresses');
    await expect(
      fetchPki('file:///etc/passwd', { timeoutMs: 1000 }),
    ).rejects.toThrow('Invalid PKI endpoint');
  });
});
