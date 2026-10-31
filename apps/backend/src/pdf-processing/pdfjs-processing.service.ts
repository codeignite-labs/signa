import {
  protectRendererNetwork,
  rendererContextOptions,
  rendererCsp,
} from '../common/rendering/renderer-network';
import { createCanvas } from '@napi-rs/canvas';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import sharp from 'sharp';
import type { PdfiumRenderedPage } from './pdfium-processing.service';
import type { Canvas, SKRSContext2D } from '@napi-rs/canvas';
import type { Browser } from 'playwright';
import type {
  PDFDocumentLoadingTask as PdfjsLoadingTask,
  PDFDocumentProxy as PdfjsDocumentProxy,
  PDFPageProxy as PdfjsPageProxy,
  PageViewport as PdfjsPageViewport,
} from 'pdfjs-dist';

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

type PdfjsRenderParameters = {
  canvas: HTMLCanvasElement;
  canvasContext: CanvasRenderingContext2D;
  viewport: PdfjsPageViewport;
};

type LoadedPdfjsDocument = {
  destroy: () => Promise<void>;
  document: PdfjsDocumentProxy;
};

export type PdfjsXfaNode = {
  attributes?: Record<string, unknown>;
  children?: unknown[];
  name: string;
  value?: unknown;
};

export type PdfjsXfaPage = {
  height: number;
  page: number;
  root: PdfjsXfaNode;
  width: number;
};

type RenderedPngPage = {
  height: number;
  png: Buffer;
  width: number;
};

export type PdfjsRasterizeResult = {
  buffer: Buffer;
  pageCount: number;
};

@Injectable()
export class PdfjsProcessingService implements OnModuleDestroy {
  private browserPromise: Promise<Browser> | null = null;
  private pdfjsPromise: Promise<PdfjsModule> | null = null;
  private xfaCssPromise: Promise<string> | null = null;

  async onModuleDestroy(): Promise<void> {
    if (this.browserPromise) {
      await (await this.browserPromise).close();
      this.browserPromise = null;
    }
  }

  async rasterizePdf(
    buffer: Buffer,
    options: { scale: number },
  ): Promise<PdfjsRasterizeResult> {
    const loaded = await this.loadDocument(buffer);
    const { document } = loaded;

    try {
      const output = await PDFDocument.create();

      for (
        let pageNumber = 1;
        pageNumber <= document.numPages;
        pageNumber += 1
      ) {
        const page = await document.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const image = await this.renderPageToPng(page, options.scale);
        const embeddedImage = await output.embedPng(image.png);
        const outputPage = output.addPage([
          image.width || baseViewport.width,
          image.height || baseViewport.height,
        ]);

        outputPage.drawImage(embeddedImage, {
          height: image.height || baseViewport.height,
          width: image.width || baseViewport.width,
          x: 0,
          y: 0,
        });
        page.cleanup();
      }

      return {
        buffer: Buffer.from(await output.save({ useObjectStreams: false })),
        pageCount: document.numPages,
      };
    } finally {
      await loaded.destroy();
    }
  }

  async renderPagePreviews(
    buffer: Buffer,
    options: { maxPages: number; maxWidth: number },
  ): Promise<PdfiumRenderedPage[]> {
    const loaded = await this.loadDocument(buffer);
    const { document } = loaded;

    try {
      const renderCount = Math.min(document.numPages, options.maxPages);
      const pages: PdfiumRenderedPage[] = [];

      for (let pageNumber = 1; pageNumber <= renderCount; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = options.maxWidth / baseViewport.width;
        const rendered = await this.renderPageToPng(
          page,
          Math.min(1, scale > 0 ? scale : 1),
        );
        const image = await sharp(rendered.png)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        pages.push({
          data: image.data,
          height: image.info.height,
          width: image.info.width,
        });
        page.cleanup();
      }

      return pages;
    } finally {
      await loaded.destroy();
    }
  }

  async extractXfaPages(buffer: Buffer): Promise<PdfjsXfaPage[]> {
    const loaded = await this.loadDocument(buffer);
    const { document } = loaded;

    try {
      const pages: PdfjsXfaPage[] = [];

      for (
        let pageNumber = 1;
        pageNumber <= document.numPages;
        pageNumber += 1
      ) {
        const page = await document.getPage(pageNumber);
        const xfa = await page.getXfa();

        if (isXfaNode(xfa)) {
          const { height, width } = this.getXfaPageSize(xfa);

          pages.push({
            height,
            page: pageNumber - 1,
            root: xfa,
            width,
          });
        }

        page.cleanup();
      }

      return pages;
    } finally {
      await loaded.destroy();
    }
  }

  private async renderPageToPng(
    page: PdfjsPageProxy,
    scale: number,
  ): Promise<RenderedPngPage> {
    const xfa = await page.getXfa();

    if (isXfaNode(xfa)) {
      return this.renderXfaPageToPng(xfa, scale);
    }

    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(
      Math.max(1, Math.round(viewport.width)),
      Math.max(1, Math.round(viewport.height)),
    );
    const context = canvas.getContext('2d');

    await this.renderPage(page, canvas, context, viewport);

    return {
      height: page.getViewport({ scale: 1 }).height,
      png: canvas.encodeSync('png'),
      width: page.getViewport({ scale: 1 }).width,
    };
  }

  private async getPdfjs(): Promise<PdfjsModule> {
    this.pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');

    return this.pdfjsPromise;
  }

  private async loadDocument(buffer: Buffer): Promise<LoadedPdfjsDocument> {
    const pdfjs = await this.getPdfjs();
    const task: PdfjsLoadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      enableXfa: true,
      useSystemFonts: true,
    });

    return {
      destroy: () => task.destroy(),
      document: await task.promise,
    };
  }

  private async renderPage(
    page: PdfjsPageProxy,
    canvas: Canvas,
    context: SKRSContext2D,
    viewport: PdfjsPageViewport,
  ): Promise<void> {
    const renderParameters: PdfjsRenderParameters = {
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    };

    await page.render(renderParameters).promise;
  }

  private async renderXfaPageToPng(
    xfa: PdfjsXfaNode,
    scale: number,
  ): Promise<RenderedPngPage> {
    const { height, width } = this.getXfaPageSize(xfa);
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      ...rendererContextOptions,
      deviceScaleFactor: scale,
      viewport: {
        height: Math.ceil(height),
        width: Math.ceil(width),
      },
    });
    try {
      const resources = await protectRendererNetwork(context);
      const page = await context.newPage();
      await page.setContent(await this.buildXfaHtml(xfa, { height, width }), {
        waitUntil: 'load',
      });

      resources.assertAllowed();
      const root = page.locator('#xfa-root');
      const png = await root.screenshot({ type: 'png' });
      resources.assertAllowed();

      return {
        height,
        png,
        width,
      };
    } finally {
      await context.close();
    }
  }

  private async buildXfaHtml(
    xfa: PdfjsXfaNode,
    dimensions: { height: number; width: number },
  ): Promise<string> {
    const css = await this.getXfaCss();

    return [
      '<!doctype html>',
      '<html>',
      '<head>',
      '<meta charset="utf-8" />',
      `<meta http-equiv="Content-Security-Policy" content="${rendererCsp}">`,
      '<style>',
      css,
      'html,body{margin:0;padding:0;background:white;}',
      `#xfa-root{position:relative;overflow:hidden;background:white;width:${dimensions.width}px;height:${dimensions.height}px;}`,
      `#xfa-root>.xfaLayer{width:${dimensions.width}px;height:${dimensions.height}px;}`,
      '</style>',
      '</head>',
      '<body>',
      `<main id="xfa-root" class="xfaLayer xfaFont">${this.renderXfaNodeToHtml(xfa)}</main>`,
      '</body>',
      '</html>',
    ].join('');
  }

  private renderXfaNodeToHtml(node: PdfjsXfaNode): string {
    if (node.name === '#text') {
      return escapeHtml(toTextValue(node.value));
    }

    const tagName = this.getSafeTagName(node.name);
    const attributes = this.renderXfaAttributes(node, tagName);

    if (tagName === 'input' || tagName === 'img') {
      return `<${tagName}${attributes}>`;
    }

    const children = (node.children ?? [])
      .filter(isXfaNode)
      .map((child) => this.renderXfaNodeToHtml(child))
      .join('');
    const value =
      typeof node.value === 'string' && node.value.length > 0
        ? escapeHtml(node.value)
        : '';

    return `<${tagName}${attributes}>${value}${children}</${tagName}>`;
  }

  private renderXfaAttributes(node: PdfjsXfaNode, tagName: string): string {
    const attributes = node.attributes ?? {};
    const output: string[] = [];

    for (const [name, value] of Object.entries(attributes)) {
      if (value === null || value === undefined || name === 'xmlns') {
        continue;
      }

      if (name === 'class' && Array.isArray(value)) {
        output.push(`class="${escapeAttribute(value.join(' '))}"`);
        continue;
      }

      if (name === 'style' && isRecord(value)) {
        output.push(`style="${escapeAttribute(renderStyle(value))}"`);
        continue;
      }

      if (name === 'textContent') {
        continue;
      }

      if (typeof value === 'boolean') {
        if (value) {
          output.push(escapeAttributeName(name));
        }
        continue;
      }

      const attributeValue = toAttributeValue(value);

      if (attributeValue !== null) {
        output.push(
          `${escapeAttributeName(name)}="${escapeAttribute(attributeValue)}"`,
        );
      }
    }

    const textValue =
      typeof attributes.textContent === 'string'
        ? attributes.textContent
        : typeof node.value === 'string'
          ? node.value
          : '';

    if ((tagName === 'input' || tagName === 'textarea') && textValue) {
      output.push(`value="${escapeAttribute(textValue)}"`);
    }

    return output.length > 0 ? ` ${output.join(' ')}` : '';
  }

  private getSafeTagName(name: string): string {
    if (
      [
        'a',
        'button',
        'div',
        'img',
        'input',
        'label',
        'option',
        'p',
        'select',
        'span',
        'textarea',
      ].includes(name)
    ) {
      return name;
    }

    return 'div';
  }

  private getXfaPageSize(xfa: PdfjsXfaNode): { height: number; width: number } {
    const style = isRecord(xfa.attributes?.style) ? xfa.attributes.style : {};

    return {
      height: parseCssPixelValue(style.height, 792),
      width: parseCssPixelValue(style.width, 612),
    };
  }

  private async getBrowser(): Promise<Browser> {
    this.browserPromise ??= chromium.launch({
      args: [
        '--disable-dev-shm-usage',
        '--disable-gpu-sandbox',
        '--disable-setuid-sandbox',
        '--no-sandbox',
        '--no-zygote',
      ],
      chromiumSandbox: false,
      headless: true,
    });

    return this.browserPromise;
  }

  private async getXfaCss(): Promise<string> {
    this.xfaCssPromise ??= readFile(getPdfjsViewerCssPath(), 'utf8');

    return this.xfaCssPromise;
  }
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}

function escapeAttributeName(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_:-]/g, '');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function getPdfjsViewerCssPath(): string {
  const nodeRequire = createRequire(__filename);

  return nodeRequire.resolve('pdfjs-dist/legacy/web/pdf_viewer.css');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isXfaNode(value: unknown): value is PdfjsXfaNode {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    (!('children' in value) || Array.isArray(value.children))
  );
}

function parseCssPixelValue(value: unknown, fallback: number): number {
  if (typeof value !== 'string') {
    return fallback;
  }

  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function renderStyle(style: Record<string, unknown>): string {
  return Object.entries(style)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([name, value]) => `${toKebabCase(name)}:${String(value)}`)
    .join(';');
}

function toKebabCase(value: string): string {
  return value.replaceAll(
    /[A-Z]/g,
    (character) => `-${character.toLowerCase()}`,
  );
}

function toAttributeValue(value: unknown): string | null {
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'string'
  ) {
    return String(value);
  }

  return null;
}

function toTextValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
