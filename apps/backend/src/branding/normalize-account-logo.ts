import { UnprocessableEntityException } from '@nestjs/common';
import sharp from 'sharp';

const invalidLogo = () =>
  new UnprocessableEntityException(
    'Upload a static PNG, JPEG or WebP logo up to 2 MB and 16 megapixels.',
  );

export async function normalizeAccountLogo(
  input: Buffer,
): Promise<{ buffer: Buffer; background: string }> {
  if (!input.length || input.length > 2 * 1024 * 1024) throw invalidLogo();
  try {
    const image = sharp(input, {
      limitInputPixels: 16_000_000,
      failOn: 'warning',
    });
    const metadata = await image.metadata();
    if (
      !['png', 'jpeg', 'webp'].includes(metadata.format ?? '') ||
      (metadata.pages ?? 1) > 1
    )
      throw invalidLogo();
    const buffer = await image
      .rotate()
      .resize({
        width: 1024,
        height: 512,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    await assertVisibleLogo(buffer);
    return { buffer, background: 'transparent' };
  } catch {
    throw invalidLogo();
  }
}

async function assertVisibleLogo(buffer: Buffer): Promise<void> {
  const { hasAlpha } = await sharp(buffer).metadata();
  if (!hasAlpha) return;
  const alpha = await sharp(buffer).extractChannel('alpha').raw().toBuffer();
  if (!alpha.some((value) => value > 0)) throw invalidLogo();
}
