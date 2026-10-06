import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Handlebars from 'handlebars';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderEmailTemplate } from '../submissions/email-templates/render-email-template';
import type { EmailTemplateRenderContext } from '../submissions/email-templates/email-template-variables';
import type { MailTemplateKey, MailTemplateName } from './mail.types';

type DefaultMailTemplate = {
  body: string;
  subject: string;
};

@Injectable()
export class MailTemplateResolver {
  private readonly defaultCache = new Map<
    MailTemplateKey,
    DefaultMailTemplate
  >();
  private readonly htmlCache = new Map<
    MailTemplateName,
    Handlebars.TemplateDelegate
  >();
  private readonly templateExistsCache = new Map<string, boolean>();

  constructor(private readonly config: ConfigService) {}

  assertTemplateExists(template: MailTemplateName): void {
    const fileName = `${template}.hbs`;
    const cached = this.templateExistsCache.get(fileName);

    if (cached === true) {
      return;
    }

    if (cached === false) {
      this.throwMissingTemplate(fileName);
    }

    const exists = this.getTemplateDirectories().some((directory) =>
      existsSync(join(directory, fileName)),
    );

    this.templateExistsCache.set(fileName, exists);

    if (!exists) {
      this.throwMissingTemplate(fileName);
    }
  }

  renderHtml(
    template: MailTemplateName,
    context: Record<string, unknown>,
  ): string {
    let render = this.htmlCache.get(template);
    if (!render) {
      const filename = `${template}.hbs`;
      const path = this.getTemplateDirectories()
        .map((directory) => join(directory, filename))
        .find((candidate) => existsSync(candidate));
      if (!path) this.throwMissingTemplate(filename);
      render = Handlebars.compile(readFileSync(path, 'utf8'));
      this.htmlCache.set(template, render);
    }
    return render(context);
  }

  renderDefault(
    key: MailTemplateKey,
    context: EmailTemplateRenderContext,
  ): { contentHtml: string; markdown: string; subject: string } {
    const template = this.getDefaultTemplate(key);
    const subject = replaceTemplateVariables(template.subject, context);
    const rendered = renderEmailTemplate(template.body, context);

    return {
      contentHtml: rendered.html,
      markdown: rendered.markdown,
      subject,
    };
  }

  renderCustom(
    markdown: string | null | undefined,
    context: EmailTemplateRenderContext,
  ): { contentHtml: string; markdown: string } | null {
    if (!markdown?.trim()) {
      return null;
    }

    const rendered = renderEmailTemplate(markdown, context);

    return {
      contentHtml: rendered.html,
      markdown: rendered.markdown,
    };
  }

  private getDefaultTemplate(key: MailTemplateKey): DefaultMailTemplate {
    const cached = this.defaultCache.get(key);

    if (cached) {
      return cached;
    }

    const path = this.findDefaultTemplatePath(key);
    const parsed = parseDefaultTemplate(readFileSync(path, 'utf8'));

    this.defaultCache.set(key, parsed);

    return parsed;
  }

  private findDefaultTemplatePath(key: MailTemplateKey): string {
    const fileName = `${key}.md`;
    const path = this.getDefaultTemplateDirectories()
      .map((directory) => join(directory, fileName))
      .find((candidate) => existsSync(candidate));

    if (!path) {
      throw new InternalServerErrorException({
        error: `Email default "${fileName}" is not available.`,
      });
    }

    return path;
  }

  private getTemplateDirectories(): string[] {
    const configuredDirectory = this.config.get<string>('MAIL_TEMPLATE_DIR');

    return [
      ...(configuredDirectory ? [configuredDirectory] : []),
      join(__dirname, 'templates'),
      join(process.cwd(), 'dist', 'src', 'mail', 'templates'),
      join(process.cwd(), 'dist', 'mail', 'templates'),
      join(process.cwd(), 'src', 'mail', 'templates'),
      join(process.cwd(), 'apps', 'backend', 'src', 'mail', 'templates'),
    ];
  }

  private getDefaultTemplateDirectories(): string[] {
    return [
      join(__dirname, 'defaults'),
      join(process.cwd(), 'dist', 'src', 'mail', 'defaults'),
      join(process.cwd(), 'dist', 'mail', 'defaults'),
      join(process.cwd(), 'src', 'mail', 'defaults'),
      join(process.cwd(), 'apps', 'backend', 'src', 'mail', 'defaults'),
    ];
  }

  private throwMissingTemplate(fileName: string): never {
    throw new InternalServerErrorException({
      error: `Email template "${fileName}" is not available.`,
    });
  }
}

function parseDefaultTemplate(markdown: string): DefaultMailTemplate {
  const match = markdown.match(
    /^---\n(?<frontmatter>[\s\S]*?)\n---\n(?<body>[\s\S]*)$/,
  );
  const frontmatter = match?.groups?.frontmatter ?? '';
  const body = match?.groups?.body ?? markdown;
  const subject = frontmatter.match(/^subject:\s*(?<subject>.*)$/m)?.groups
    ?.subject;

  return {
    body: body.trim(),
    subject: subject?.replace(/^"|"$/g, '') || 'Signa notification',
  };
}

function replaceTemplateVariables(
  value: string,
  context: EmailTemplateRenderContext,
): string {
  return renderEmailTemplate(value, context).markdown;
}
