export type AccountBranding = {
  account_name: string;
  primary_color: string | null;
  white_label: boolean;
  show_business_name?: boolean;
  logo: { url: string; background: string } | null;
};

export const defaultBrandColor = "#27639d";

export function normalizeBrandColor(value: string): string | null {
  const hex = value.trim();
  if (/^#[a-f\d]{6}$/i.test(hex)) return hex.toLowerCase();
  if (/^#[a-f\d]{3}$/i.test(hex))
    return (
      "#" +
      [...hex.slice(1)]
        .map((v) => v + v)
        .join("")
        .toLowerCase()
    );
  return null;
}

function channels(hex: string): number[] {
  const color = normalizeBrandColor(hex);
  if (!color) throw new Error("Invalid brand color");
  return [1, 3, 5].map((offset) =>
    parseInt(color.slice(offset, offset + 2), 16),
  );
}

function luminance(hex: string): number {
  const linear = channels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function contrastRatio(first: string, second: string): number {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function mix(color: string, target: string, amount: number): string {
  const other = channels(target);
  return (
    "#" +
    channels(color)
      .map((v, index) =>
        Math.round(v + (other[index] - v) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function accessibleColor(
  color: string,
  surfaces: string[],
  target: string,
  minimum: number,
): string {
  for (let step = 0; step <= 100; step++) {
    const candidate = mix(color, target, step / 100);
    if (
      surfaces.every((surface) => contrastRatio(candidate, surface) >= minimum)
    )
      return candidate;
  }
  return target;
}

// Keep the submitted color intact for identity; derive UI colors from it.
// Thresholds include a margin above WCAG AA, calculated on rounded sRGB values.
export function brandPalette(
  value: string,
  dark = false,
): Record<string, string> {
  const color = normalizeBrandColor(value) ?? defaultBrandColor;
  const paper = dark ? "#1b1e25" : "#ffffff";
  const ink = dark ? "#ffffff" : "#000000";
  const background = mix(color, dark ? "#101114" : paper, 0.97);
  const muted = mix(color, dark ? "#242832" : paper, 0.92);
  const accent = mix(color, dark ? "#303745" : paper, 0.85);
  const surfaces = [background, paper, muted, accent];
  const primary = accessibleColor(color, surfaces, ink, dark ? 7 : 4.6);
  const primaryText = dark ? "#000000" : "#ffffff";
  const hover = mix(primary, ink, 0.12);
  const foreground = dark ? "#fafafa" : "#171717";
  const secondaryText = accessibleColor(
    mix(color, dark ? "#ced3dd" : "#595959", 0.92),
    surfaces,
    ink,
    dark ? 7 : 5,
  );
  // Decorative dividers are subtle; interactive boundaries keep their own contrast.
  const border = mix(foreground, paper, dark ? 0.78 : 0.88);
  const controlBorder = accessibleColor(
    dark ? "#737373" : "#a3a3a3",
    surfaces,
    ink,
    3.1,
  );
  return {
    "--brand-original": color,
    "--background": background,
    "--foreground": foreground,
    "--card": paper,
    "--card-foreground": foreground,
    "--popover": paper,
    "--popover-foreground": foreground,
    "--primary": primary,
    "--primary-foreground": primaryText,
    "--primary-hover": hover,
    "--secondary": muted,
    "--secondary-foreground": secondaryText,
    "--muted": muted,
    "--muted-foreground": secondaryText,
    "--accent": accent,
    "--accent-foreground": foreground,
    "--border": border,
    "--input": controlBorder,
    "--ring": primary,
    "--sidebar": muted,
    "--sidebar-foreground": foreground,
    "--sidebar-primary": primary,
    "--sidebar-primary-foreground": primaryText,
    "--sidebar-accent": accent,
    "--sidebar-accent-foreground": foreground,
    "--sidebar-border": border,
    "--sidebar-ring": primary,
    "--auth-background": background,
    "--auth-foreground": foreground,
    "--auth-primary": primary,
    "--auth-primary-foreground": primaryText,
    "--auth-primary-hover": hover,
    "--auth-brand": primary,
    "--auth-muted": muted,
    "--auth-label": secondaryText,
    "--auth-muted-foreground": secondaryText,
    "--auth-input-border": controlBorder,
    "--auth-upgrade": accent,
    "--auth-upgrade-hover": muted,
    "--chart-1": primary,
    "--chart-2": secondaryText,
    "--chart-3": controlBorder,
  };
}
