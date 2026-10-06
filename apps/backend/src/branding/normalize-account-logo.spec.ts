import sharp from 'sharp';
import { normalizeAccountLogo } from './normalize-account-logo';

describe('account logo processing', () => {
  it.each(['png', 'jpeg', 'webp'] as const)(
    'normalizes %s and bounds dimensions without stretching',
    async (format) => {
      const input = await sharp({
        create: {
          width: 2048,
          height: 512,
          channels: 3,
          background: '#123456',
        },
      })
        .toFormat(format)
        .toBuffer();
      const result = await normalizeAccountLogo(input);
      expect(await sharp(result.buffer).metadata()).toMatchObject({
        format: 'png',
        width: 1024,
        height: 256,
      });
      expect(result.background).toBe('transparent');
    },
  );
  it('preserves transparency without assigning a backdrop', async () => {
    const input = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const result = await normalizeAccountLogo(input);
    expect(result.background).toBe('transparent');
    const pixels = await sharp(result.buffer).ensureAlpha().raw().toBuffer();
    expect(pixels[3]).toBeGreaterThan(0);
    expect(pixels[3]).toBeLessThan(255);
  });
  it.each([
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
    ),
    Buffer.from('not an image'),
    Buffer.alloc(2 * 1024 * 1024 + 1),
  ])('rejects unsafe or oversized input', async (input) => {
    await expect(normalizeAccountLogo(input)).rejects.toThrow(
      'Upload a static',
    );
  });
  it('rejects decoded dimensions above the limit', async () => {
    const input = await sharp({
      create: { width: 4001, height: 4000, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(normalizeAccountLogo(input)).rejects.toThrow(
      'Upload a static',
    );
  });
  it('rejects fully invisible logos', async () => {
    const input = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    await expect(normalizeAccountLogo(input)).rejects.toThrow(
      'Upload a static',
    );
  });
});
