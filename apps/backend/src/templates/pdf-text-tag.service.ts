import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PDFDocument, rgb } from 'pdf-lib';
import { TemplateField } from './types/template-json';

const execFileAsync = promisify(execFile);
const fieldTagPattern = /\{\{([^{}]+)\}\}/g;

@Injectable()
export class PdfTextTagService {
  async extractAndMaybeRemoveTags(input: {
    pdf: Buffer;
    removeTags: boolean;
  }): Promise<{ pdf: Buffer; fields: TemplateField[] }> {
    const words = await this.extractPdfWords(input.pdf);
    const tags = collectTags(words);
    const fields = tags.map((tag) => ({
      ...tag.field,
      areas: [
        {
          h: tag.height / tag.pageHeight,
          page: tag.page - 1,
          w: Math.max(tag.width / tag.pageWidth, defaultWidth(tag.field)),
          x: tag.xMin / tag.pageWidth,
          y: tag.yMin / tag.pageHeight,
        },
      ],
    }));

    if (!input.removeTags || !tags.length) {
      return { fields, pdf: input.pdf };
    }

    return {
      fields,
      pdf: await visuallyRemoveTags(input.pdf, tags),
    };
  }

  private async extractPdfWords(pdf: Buffer): Promise<PdfWord[]> {
    const directory = await mkdtemp(join(tmpdir(), 'signa-pdf-tags-'));
    const pdfPath = join(directory, 'document.pdf');
    const outputPath = join(directory, 'document.html');

    try {
      await writeFile(pdfPath, pdf);
      await execFileAsync('pdftotext', ['-bbox', pdfPath, outputPath], {
        timeout: 15_000,
      });

      return parsePdfTextBbox(await readFile(outputPath, 'utf8'));
    } catch (error) {
      throw new UnprocessableEntityException({
        error: `Unable to extract PDF text tags: ${getErrorMessage(error)}`,
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
}

type PdfWord = {
  height: number;
  page: number;
  pageHeight: number;
  pageWidth: number;
  text: string;
  width: number;
  xMax: number;
  xMin: number;
  yMax: number;
  yMin: number;
};

type PdfTextTag = {
  field: TemplateField;
  height: number;
  page: number;
  pageHeight: number;
  pageWidth: number;
  width: number;
  xMax: number;
  xMin: number;
  yMax: number;
  yMin: number;
};

function collectTags(words: PdfWord[]): PdfTextTag[] {
  const tags: PdfTextTag[] = [];

  for (let index = 0; index < words.length; index += 1) {
    const start = words[index];

    if (!start.text.includes('{{')) {
      continue;
    }

    const group = [start];
    let text = start.text;
    let cursor = index + 1;

    while (!text.includes('}}') && cursor < words.length) {
      const next = words[cursor];

      if (next.page !== start.page) {
        break;
      }

      group.push(next);
      text += ` ${next.text}`;
      cursor += 1;
    }

    for (const match of text.matchAll(fieldTagPattern)) {
      tags.push(buildTag(match[1], group));
    }
  }

  return tags;
}

function buildTag(rawTag: string, words: PdfWord[]): PdfTextTag {
  const first = words[0];
  const xMin = Math.min(...words.map((word) => word.xMin));
  const yMin = Math.min(...words.map((word) => word.yMin));
  const xMax = Math.max(...words.map((word) => word.xMax));
  const yMax = Math.max(...words.map((word) => word.yMax));

  return {
    field: parseFieldTag(rawTag),
    height: Math.max(yMax - yMin, 1),
    page: first.page,
    pageHeight: first.pageHeight,
    pageWidth: first.pageWidth,
    width: Math.max(xMax - xMin, 1),
    xMax,
    xMin,
    yMax,
    yMin,
  };
}

async function visuallyRemoveTags(
  pdf: Buffer,
  tags: PdfTextTag[],
): Promise<Buffer> {
  const document = await PDFDocument.load(pdf);
  const pages = document.getPages();

  for (const tag of tags) {
    const page = pages[tag.page - 1];

    if (!page) {
      continue;
    }

    const height = page.getHeight();

    page.drawRectangle({
      color: rgb(1, 1, 1),
      height: tag.height + 2,
      width: tag.width + 2,
      x: Math.max(tag.xMin - 1, 0),
      y: Math.max(height - tag.yMax - 1, 0),
    });
  }

  return Buffer.from(await document.save());
}

function parseFieldTag(rawTag: string): TemplateField {
  const parts = rawTag
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  const [name = 'Field', ...attributes] = parts;
  const field: TemplateField = {
    name,
    preferences: {},
    required: false,
    type: 'text',
  };

  for (const attribute of attributes) {
    const [rawKey, ...rawValue] = attribute.split('=');
    const key = rawKey?.trim();
    const value = rawValue.join('=').trim();

    if (!key) {
      continue;
    }

    applyFieldAttribute(field, key, value);
  }

  return field;
}

function applyFieldAttribute(
  field: TemplateField,
  key: string,
  value: string,
): void {
  if (key === 'role') {
    field.role = value;
    return;
  }

  if (key === 'type') {
    field.type = value || 'text';
    return;
  }

  if (key === 'required') {
    field.required = value !== 'false';
    return;
  }

  if (key === 'title') {
    field.title = value;
    return;
  }

  if (key === 'description') {
    field.description = value;
    return;
  }

  if (key === 'options') {
    field.preferences = {
      ...field.preferences,
      options: value
        .split(',')
        .map((option) => option.trim())
        .filter(Boolean),
    };
    return;
  }

  field.preferences = {
    ...field.preferences,
    [key]: value,
  };
}

function parsePdfTextBbox(html: string): PdfWord[] {
  const pagePattern =
    /<page[^>]*width="(?<width>[\d.]+)"[^>]*height="(?<height>[\d.]+)"[^>]*>(?<body>[\s\S]*?)<\/page>/g;
  const wordPattern =
    /<word[^>]*xMin="(?<xMin>[\d.]+)"[^>]*yMin="(?<yMin>[\d.]+)"[^>]*xMax="(?<xMax>[\d.]+)"[^>]*yMax="(?<yMax>[\d.]+)"[^>]*>(?<text>[\s\S]*?)<\/word>/g;
  const words: PdfWord[] = [];

  let page = 0;
  for (const pageMatch of html.matchAll(pagePattern)) {
    page += 1;
    const pageWidth = Number(pageMatch.groups?.width ?? '1');
    const pageHeight = Number(pageMatch.groups?.height ?? '1');
    const body = pageMatch.groups?.body ?? '';

    for (const wordMatch of body.matchAll(wordPattern)) {
      const xMin = Number(wordMatch.groups?.xMin ?? '0');
      const yMin = Number(wordMatch.groups?.yMin ?? '0');
      const xMax = Number(wordMatch.groups?.xMax ?? '0');
      const yMax = Number(wordMatch.groups?.yMax ?? '0');

      words.push({
        height: Math.max(yMax - yMin, 1),
        page,
        pageHeight,
        pageWidth,
        text: decodeHtml(wordMatch.groups?.text ?? ''),
        width: Math.max(xMax - xMin, 1),
        xMax,
        xMin,
        yMax,
        yMin,
      });
    }
  }

  return words;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function defaultWidth(field: TemplateField): number {
  if (field.type === 'signature' || field.type === 'initials') {
    return 0.16;
  }

  if (field.type === 'checkbox') {
    return 0.018;
  }

  return 0.08;
}

function getErrorMessage(error: unknown): string {
  const details = error as
    | (Error & { code?: string; stderr?: string })
    | undefined;
  const stderr = details?.stderr ?? '';

  if (details?.code === 'ENOENT') {
    return 'pdftotext is not installed. Install poppler-utils on the server or rebuild the Docker image.';
  }

  if (/password|encrypt|permission/i.test(stderr)) {
    return 'This PDF is password protected or encrypted. Password-protected PDFs are not supported yet.';
  }

  return error instanceof Error ? error.message : 'Unknown error';
}
