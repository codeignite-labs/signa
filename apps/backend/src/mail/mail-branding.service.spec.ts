import { MailTemplateResolver } from './mail-template-resolver.service';
import { mailTemplateNames } from './mail.types';
import { MailBrandingService } from './mail-branding.service';
import { contrastRatio } from '@repo/shared/branding';

describe('mail account branding', () => {
  const brand = {
    account_name: 'Acme <Org>',
    primary_color: '#ffff00',
    white_label: true,
    logo: null,
  };
  const get = jest.fn().mockResolvedValue(brand);
  const service = new MailBrandingService(
    { get: (_key: string, fallback: string) => fallback } as never,
    { get } as never,
  );

  it('resolves the sending account and leaves locale untouched', async () => {
    const context = await service.getAccountContext('17');
    expect(get).toHaveBeenCalledWith('17');
    expect(context).toMatchObject({
      logoUrl: null,
      productName: 'Acme <Org>',
      whiteLabel: true,
    });
    expect(context).not.toHaveProperty('locale');
    expect(
      contrastRatio(
        String(context.brandPrimary),
        String(context.brandPrimaryForeground),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });
  it('renders every email with white-label text fallback and escaped account name', async () => {
    const context = await service.getAccountContext('17');
    const resolver = new MailTemplateResolver({ get: jest.fn() } as never);
    for (const template of mailTemplateNames) {
      const html = resolver.renderHtml(template, { ...context, locale: 'fr' });
      expect(html).not.toContain('Signa');
      expect(html).not.toContain('src=""');
      expect(html).toContain('Acme &lt;Org&gt;');
      expect(html).toContain('lang="fr"');
    }
  });
  it.each([true, false])(
    'respects business title visibility (%s) in every email',
    async (showBusinessName) => {
      get.mockResolvedValueOnce({
        ...brand,
        show_business_name: showBusinessName,
        logo: { url: 'https://example.test/logo.png' },
      });
      const context = await service.getAccountContext('17');
      expect(context.showBusinessName).toBe(showBusinessName);
      const resolver = new MailTemplateResolver({ get: jest.fn() } as never);
      for (const template of mailTemplateNames) {
        const html = resolver.renderHtml(template, context);
        expect(html.includes('padding-left:16px')).toBe(showBusinessName);
        expect(html).toContain(
          showBusinessName ? 'alt=""' : 'alt="Acme &lt;Org&gt;"',
        );
      }
    },
  );
  it('keeps the platform fallback for mail without a tenant', async () => {
    expect(await service.getAccountContext()).toMatchObject({
      whiteLabel: false,
      productName: 'Signa',
      logoUrl: 'http://localhost:3000/images/logo.png',
    });
  });
});
