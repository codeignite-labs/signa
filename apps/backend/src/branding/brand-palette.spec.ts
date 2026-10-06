import {
  brandPalette,
  contrastRatio,
  normalizeBrandColor,
} from '@repo/shared/branding';

describe('brand color contrast', () => {
  it('uses the WCAG luminance calculation and rejects CSS injection', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(normalizeBrandColor('#ABC')).toBe('#aabbcc');
    expect(normalizeBrandColor('#fff;}</style>')).toBeNull();
  });

  it.each([false, true])(
    'keeps text and controls readable over the RGB cube (dark=%s)',
    (dark) => {
      const values = ['00', '33', '66', '99', 'cc', 'ff'];
      for (const r of values)
        for (const g of values)
          for (const b of values) {
            const color = `#${r}${g}${b}`;
            const p = brandPalette(color, dark);
            const surfaces = ['--background', '--card', '--muted', '--accent'];
            expect(p['--brand-original']).toBe(color);
            expect(contrastRatio(p['--border'], p['--card'])).toBeLessThan(dark ? 2.6 : 1.6);
            expect(p['--border']).not.toBe(p['--input']);
            for (const surface of surfaces) {
              for (const text of [
                '--foreground',
                '--primary',
                '--muted-foreground',
              ]) {
                expect(
                  contrastRatio(p[text], p[surface]),
                ).toBeGreaterThanOrEqual(dark ? 7 : 4.5);
              }
              for (const control of ['--input', '--ring'])
                expect(
                  contrastRatio(p[control], p[surface]),
                ).toBeGreaterThanOrEqual(3);
            }
            for (const button of ['--primary', '--primary-hover'])
              expect(
                contrastRatio(p[button], p['--primary-foreground']),
              ).toBeGreaterThanOrEqual(4.5);
          }
    },
  );
});
