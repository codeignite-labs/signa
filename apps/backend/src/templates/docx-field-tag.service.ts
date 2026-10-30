import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { TemplateField } from './types/template-json';

const execFileAsync = promisify(execFile);
const documentXmlPath = 'word/document.xml';
const markerPrefix = 'SIGNATAG';
const fieldTagPattern = /\{\{([^{}]+)\}\}/g;

@Injectable()
export class DocxFieldTagService {
  prepareDocument(input: Buffer): PreparedDocxDocument {
    const zipEntries = unzipSync(new Uint8Array(input));
    const documentXml = zipEntries[documentXmlPath];

    if (!documentXml) {
      throw new UnprocessableEntityException({
        error: 'Invalid DOCX document',
      });
    }

    const xml = strFromU8(documentXml);
    const markers: DocxFieldMarker[] = [];
    const nextXml = xml.replace(
      fieldTagPattern,
      (_match: string, rawTag: string) => {
        const field = parseFieldTag(rawTag);
        const marker = `${markerPrefix}${String(markers.length + 1).padStart(4, '0')}`;

        markers.push({ field, marker });
        return marker;
      },
    );

    if (!markers.length) {
      return {
        buffer: input,
        markers,
      };
    }

    return {
      buffer: Buffer.from(
        zipSync({
          ...zipEntries,
          [documentXmlPath]: strToU8(nextXml),
        }),
      ),
      markers,
    };
  }

  async extractMarkerFields(input: {
    markers: DocxFieldMarker[];
    pdf: Buffer;
  }): Promise<TemplateField[]> {
    if (!input.markers.length) {
      return [];
    }

    const words = await this.extractPdfWords(input.pdf);

    return input.markers.flatMap(({ field, marker }) => {
      const word = words.find((item) => item.text.includes(marker));

      if (!word) {
        return [];
      }

      return [
        {
          ...field,
          areas: [
            {
              h: word.height / word.pageHeight,
              page: word.page - 1,
              w: Math.max(word.width / word.pageWidth, defaultWidth(field)),
              x: word.xMin / word.pageWidth,
              y: word.yMin / word.pageHeight,
            },
          ],
        },
      ];
    });
  }

  private async extractPdfWords(pdf: Buffer): Promise<PdfWord[]> {
    const directory = await mkdtemp(join(tmpdir(), 'signa-pdf-geometry-'));
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
        error: `Unable to extract DOCX field geometry: ${getErrorMessage(error)}`,
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
}

export type PreparedDocxDocument = {
  buffer: Buffer;
  markers: DocxFieldMarker[];
};

export type DocxFieldMarker = {
  field: TemplateField;
  marker: string;
};

type PdfWord = {
  height: number;
  page: number;
  pageHeight: number;
  pageWidth: number;
  text: string;
  width: number;
  xMin: number;
  yMin: number;
};

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
        xMin,
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
