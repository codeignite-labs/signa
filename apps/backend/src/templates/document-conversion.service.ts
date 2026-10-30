import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { convert } from 'libreoffice-convert';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import {
  printTemplateCsp,
  protectRendererNetwork,
  rendererContextOptions,
  rendererCsp,
} from '../common/rendering/renderer-network';
import { TemplateField } from './types/template-json';

const convertOfficeDocument = promisify(convert);

const pageSizes: Record<string, { width: number; height: number }> = {
  Letter: { width: 816, height: 1056 },
  Legal: { width: 816, height: 1344 },
  Tabloid: { width: 1056, height: 1632 },
  Ledger: { width: 1632, height: 1056 },
  A0: { width: 3179, height: 4494 },
  A1: { width: 2245, height: 3179 },
  A2: { width: 1587, height: 2245 },
  A3: { width: 1123, height: 1587 },
  A4: { width: 794, height: 1123 },
  A5: { width: 559, height: 794 },
  A6: { width: 397, height: 559 },
};

const fieldTags: Record<string, string> = {
  'cells-field': 'cells',
  'checkbox-field': 'checkbox',
  'date-field': 'date',
  'file-field': 'file',
  'image-field': 'image',
  'initials-field': 'initials',
  'multiple-field': 'multiple',
  'number-field': 'number',
  'payment-field': 'payment',
  'phone-field': 'phone',
  'radio-field': 'radio',
  'select-field': 'select',
  'signature-field': 'signature',
  'stamp-field': 'stamp',
  'strikethrough-field': 'strikethrough',
  'text-field': 'text',
  'verification-field': 'verification',
};

export type HtmlRenderInput = {
  name: string;
  html: string;
  htmlHeader?: string;
  htmlFooter?: string;
  size?: string;
};

export type HtmlRenderOutput = {
  filename: string;
  buffer: Buffer;
  fields: TemplateField[];
  body: string;
  head: string | null;
};

@Injectable()
export class DocumentConversionService {
  constructor(private readonly config: ConfigService) {}

  async renderHtmlDocument(input: HtmlRenderInput): Promise<HtmlRenderOutput> {
    this.assertStringSize(input.html, 'HTML');
    const size = pageSizes[input.size ?? 'Letter'] ?? pageSizes.Letter;
    const browser = await this.launchBrowser();

    try {
      const context = await browser.newContext({
        ...rendererContextOptions,
        viewport: {
          width: size.width,
          height: size.height,
        },
      });
      const resources = await protectRendererNetwork(context);
      const page = await context.newPage();
      await page.emulateMedia({ media: 'print' });
      await this.validatePrintTemplates(
        context,
        input,
        resources.assertAllowed,
      );
      await page.setContent(this.wrapHtml(input.html), {
        waitUntil: 'networkidle',
        timeout: this.config.get<number>('HTML_TO_PDF_TIMEOUT_MS', 30_000),
      });

      resources.assertAllowed();
      const fields = await page.evaluate(
        ({ pageHeight, pageWidth, tags }) => {
          const entries = Object.entries(tags);

          return entries.flatMap(([tagName, fieldType]) =>
            Array.from(document.querySelectorAll(tagName)).map((element) => {
              const rect = element.getBoundingClientRect();
              const pageIndex = Math.max(
                Math.floor((rect.top + window.scrollY) / pageHeight),
                0,
              );
              const topOnPage =
                rect.top + window.scrollY - pageIndex * pageHeight;
              const attributes = Object.fromEntries(
                Array.from(element.attributes).map((attribute) => [
                  attribute.name,
                  attribute.value,
                ]),
              );

              return {
                name: attributes.name || fieldType,
                role: attributes.role || undefined,
                type: attributes.type || fieldType,
                required: parseBoolean(attributes.required),
                title: attributes.title || undefined,
                description: attributes.description || undefined,
                preferences: buildPreferences(attributes),
                areas: [
                  {
                    x: clamp(rect.left / pageWidth),
                    y: clamp(topOnPage / pageHeight),
                    w: clamp(rect.width / pageWidth),
                    h: clamp(rect.height / pageHeight),
                    page: pageIndex,
                  },
                ],
              };
            }),
          );

          function parseBoolean(value: string | undefined): boolean {
            return value === 'true' || value === '1' || value === '';
          }

          function buildPreferences(attributes: Record<string, string>) {
            const preferences: Record<string, unknown> = {};

            for (const key of [
              'format',
              'font',
              'font_size',
              'font_type',
              'color',
              'background',
              'align',
              'valign',
              'price',
              'currency',
              'mask',
            ]) {
              if (attributes[key] !== undefined) {
                preferences[key] = attributes[key];
              }
            }

            if (attributes.options) {
              preferences.options = attributes.options
                .split(',')
                .map((option) => option.trim())
                .filter(Boolean);
            }

            return preferences;
          }

          function clamp(value: number): number {
            if (!Number.isFinite(value)) {
              return 0;
            }

            return Math.min(Math.max(value, 0), 1);
          }
        },
        { pageHeight: size.height, pageWidth: size.width, tags: fieldTags },
      );

      const buffer = await page.pdf({
        displayHeaderFooter: Boolean(input.htmlHeader || input.htmlFooter),
        footerTemplate: input.htmlFooter ?? '<span></span>',
        format: input.size ?? 'Letter',
        headerTemplate: input.htmlHeader ?? '<span></span>',
        margin: { bottom: '0px', left: '0px', right: '0px', top: '0px' },
        printBackground: true,
      });

      resources.assertAllowed();
      return {
        filename: ensurePdfFilename(input.name),
        buffer: Buffer.from(buffer),
        fields: fields.map((field) => ({
          ...field,
          uuid: randomUUID(),
          areas: field.areas.map((area) => ({ ...area, uuid: randomUUID() })),
        })),
        body: input.html,
        head: input.htmlHeader ?? input.htmlFooter ?? null,
      };
    } catch (error) {
      if (error instanceof UnprocessableEntityException) throw error;
      throw new UnprocessableEntityException({
        error: `Unable to render HTML document: ${getErrorMessage(error)}`,
      });
    } finally {
      await browser.close();
    }
  }

  async convertDocxToPdf(input: {
    name: string;
    buffer: Buffer;
  }): Promise<Buffer> {
    this.assertBufferSize(input.buffer, input.name);

    try {
      const converted = await convertOfficeDocument(
        input.buffer,
        '.pdf',
        undefined,
      );

      return Buffer.from(converted);
    } catch (error) {
      throw new UnprocessableEntityException({
        error: `Unable to convert DOCX document: ${getErrorMessage(error)}`,
      });
    }
  }

  hashSource(buffer: Buffer): string {
    return createHash('sha1').update(buffer).digest('hex');
  }

  private async launchBrowser(): Promise<Browser> {
    return chromium.launch({
      headless: true,
    });
  }

  private async validatePrintTemplates(
    context: BrowserContext,
    input: HtmlRenderInput,
    assertAllowed: () => void,
  ) {
    for (const template of [input.htmlHeader, input.htmlFooter]) {
      if (!template) continue;
      const page = await context.newPage();
      try {
        await page.emulateMedia({ media: 'print' });
        await page.setContent(this.wrapHtml(template, printTemplateCsp), {
          waitUntil: 'load',
        });
        assertAllowed();
      } finally {
        await page.close();
      }
    }
  }

  private wrapHtml(html: string, contentPolicy = rendererCsp): string {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${contentPolicy}">
<style>
  @page { margin: 0; }
  html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  ${Object.keys(fieldTags).join(',')} {
    display: inline-block;
    min-width: 96px;
    min-height: 18px;
    vertical-align: baseline;
  }
</style>
</head>
<body>${html}</body>
</html>`;
  }

  private assertStringSize(value: string, label: string): void {
    this.assertBufferSize(Buffer.byteLength(value, 'utf8'), label);
  }

  private assertBufferSize(value: Buffer | number, label: string): void {
    const size = typeof value === 'number' ? value : value.byteLength;
    const maxBytes = this.config.get<number>(
      'DOCUMENT_CONVERSION_MAX_BYTES',
      15 * 1024 * 1024,
    );

    if (size > maxBytes) {
      throw new UnprocessableEntityException({
        error: `${label} is too large`,
      });
    }
  }
}

function ensurePdfFilename(filename: string): string {
  return filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
