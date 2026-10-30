import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'node:fs';
import { MailTemplateResolver } from './mail-template-resolver.service';
jest.mock('node:fs', () => ({
  ...jest.requireActual<typeof import('node:fs')>('node:fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(existsSync).mockReturnValue(true);
  jest.mocked(readFileSync).mockReturnValue('Plain body');
});
function resolver(values: Record<string, string> = {}) {
  return new MailTemplateResolver(new ConfigService(values));
}

it('caches both available and missing template checks', () => {
  const templates = resolver();
  templates.assertTemplateExists('submitter-invitation');
  const checks = jest.mocked(existsSync).mock.calls.length;
  templates.assertTemplateExists('submitter-invitation');
  expect(existsSync).toHaveBeenCalledTimes(checks);
  jest.mocked(existsSync).mockReturnValue(false);
  expect(() => templates.assertTemplateExists('password-reset')).toThrow();
  const missingChecks = jest.mocked(existsSync).mock.calls.length;
  expect(() => templates.assertTemplateExists('password-reset')).toThrow();
  expect(existsSync).toHaveBeenCalledTimes(missingChecks);
});
it('compiles and caches real Handlebars templates from a configured directory', () => {
  jest.mocked(readFileSync).mockReturnValue('<p>Hello {{name}}</p>');
  const templates = resolver({ MAIL_TEMPLATE_DIR: '/custom/mail' });
  expect(templates.renderHtml('password-reset', { name: 'Ada' })).toBe(
    '<p>Hello Ada</p>',
  );
  expect(templates.renderHtml('password-reset', { name: 'Grace' })).toBe(
    '<p>Hello Grace</p>',
  );
  expect(readFileSync).toHaveBeenCalledTimes(1);
  expect(readFileSync).toHaveBeenCalledWith(
    '/custom/mail/password-reset.hbs',
    'utf8',
  );
});
it('reports missing HTML and Markdown templates before delivery', () => {
  jest.mocked(existsSync).mockReturnValue(false);
  const templates = resolver();
  expect(() => templates.renderHtml('password-reset', {})).toThrow();
  expect(() => templates.renderDefault('submitter-invitation', {})).toThrow();
});
it.each([
  'Hello {template.name}',
  '---\nother: value\n---\nHello {template.name}',
  '---\nsubject: ""\n---\nHello {template.name}',
])(
  'uses the standard subject for Markdown without a configured subject %#',
  (markdown) => {
    jest.mocked(readFileSync).mockReturnValue(markdown);
    const result = resolver().renderDefault('submitter-invitation', {
      templateName: 'Agreement',
    });
    expect(result.subject).toBe('Signa notification');
    expect(result.contentHtml).toContain('Hello Agreement');
  },
);
