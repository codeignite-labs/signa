import { Injectable } from '@nestjs/common';
import { brandPalette, defaultBrandColor } from '@repo/shared/branding';
import { BrandingService } from '../branding/branding.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailBrandingService {
  constructor(
    private readonly config: ConfigService,
    private readonly branding: BrandingService,
  ) {}

  getBaseContext(): Record<string, unknown> {
    return {
      locale: 'en',
      logoUrl: this.getLogoUrl(),
      assetBaseUrl: this.config.get<string>('MAIL_ASSET_BASE_URL') || null,
      productName: 'Signa',
      showBusinessName: true,
    };
  }

  async getAccountContext(
    accountId?: string | null,
  ): Promise<Record<string, unknown>> {
    const brand = accountId ? await this.branding.get(accountId) : null;
    const palette = brandPalette(brand?.primary_color ?? defaultBrandColor);
    return {
      assetBaseUrl: this.config.get<string>('MAIL_ASSET_BASE_URL') || null,
      productName: brand?.account_name ?? 'Signa',
      showBusinessName: brand?.show_business_name !== false,
      logoUrl:
        brand?.logo?.url ?? (brand?.white_label ? null : this.getLogoUrl()),
      logoBackground: 'transparent',
      whiteLabel: brand?.white_label ?? false,
      brandBackground: palette['--background'],
      brandForeground: palette['--foreground'],
      brandMutedForeground: palette['--muted-foreground'],
      brandMuted: palette['--muted'],
      brandBorder: palette['--border'],
      brandPrimary: palette['--primary'],
      brandPrimaryForeground: palette['--primary-foreground'],
    };
  }

  getFrontendUrl(path = ''): string {
    const origin = this.config
      .get<string>('FRONTEND_ORIGIN', 'http://localhost:3000')
      .replace(/\/$/, '');

    return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private getLogoUrl(): string {
    const configuredLogo = this.config.get<string>('MAIL_LOGO_URL');

    if (configuredLogo) {
      return configuredLogo;
    }

    return this.getFrontendUrl('/images/logo.png');
  }
}
