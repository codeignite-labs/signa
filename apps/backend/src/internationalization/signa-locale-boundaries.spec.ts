import { ExecutionContext } from '@nestjs/common';
import { I18nContext, I18nService } from 'nestjs-i18n';
import { I18nMessageFormat } from 'nestjs-i18n/dist/utils/i18n-messageformat';
import { Account } from '../accounts/entities/account.entity';
import { normalizeSignaLocale } from './signa-locale';
import { SignaLocaleResolver } from './signa-locale.resolver';
import { SignaI18nService } from './signa-i18n.service';
afterEach(() => jest.restoreAllMocks());
it.each([
  [undefined, 'en'],
  [null, 'en'],
  ['', 'en'],
  [' fr-FR ', 'fr'],
  ['FR', 'fr'],
  ['sw-KE', 'sw'],
  ['ki', 'sw'],
  ['en-US', 'en'],
  ['de-DE', 'en'],
] as const)(
  'normalizes locale %p into supported locale %s',
  (input, expected) => {
    expect(normalizeSignaLocale(input)).toBe(expected);
  },
);
it('resolves account locales only for HTTP requests with an account', () => {
  const resolver = new SignaLocaleResolver();
  const context = (type: string, account?: Account) =>
    ({
      getType: () => type,
      switchToHttp: () => ({ getRequest: () => ({ account }) }),
    }) as ExecutionContext;
  expect(resolver.resolve(context('rpc'))).toBeUndefined();
  expect(resolver.resolve(context('http'))).toBeUndefined();
  expect(
    resolver.resolve(
      context('http', Object.assign(new Account(), { locale: 'fr-FR' })),
    ),
  ).toBe('fr');
});
it('uses an explicit translation locale or the current context and preserves fallback text', () => {
  const translate = jest.fn().mockReturnValue('translated');
  const underlying = { translate } as unknown as I18nService;
  const service = new SignaI18nService(underlying);
  jest
    .spyOn(I18nContext, 'current')
    .mockReturnValue(
      new I18nContext(
        'sw',
        underlying,
        new I18nMessageFormat({ fallbackLanguage: 'en' }),
      ),
    );
  expect(service.currentLocale()).toBe('sw');
  expect(
    service.translate('mail.subject', {
      lang: 'fr-FR',
      args: { name: 'Ada' },
      defaultValue: 'Hello',
    }),
  ).toBe('translated');
  expect(translate).toHaveBeenLastCalledWith('mail.subject', {
    lang: 'fr',
    args: { name: 'Ada' },
    defaultValue: 'Hello',
  });
  service.translate('mail.subject');
  expect(translate).toHaveBeenLastCalledWith('mail.subject', {
    lang: 'sw',
    args: undefined,
    defaultValue: 'mail.subject',
  });
  expect(service.snapshotLocale()).toBe('sw');
  expect(service.snapshotLocale('fr')).toBe('fr');
  expect(service.normalizeLocale('sw-KE')).toBe('sw');
  expect(service.fallbackLocale()).toBe('en');
});
it('falls back safely outside a request context and snapshots the account locale', () => {
  const underlying = { translate: jest.fn() } as unknown as I18nService;
  const service = new SignaI18nService(underlying);
  expect(service.currentLocale()).toBe('en');
  expect(service.snapshotLocale()).toBe('en');
  expect(service.localeFromRequest()).toBe('en');
  expect(
    service.localeFromRequest({
      account: Object.assign(new Account(), { locale: 'fr-FR' }),
    }),
  ).toBe('fr');
});
