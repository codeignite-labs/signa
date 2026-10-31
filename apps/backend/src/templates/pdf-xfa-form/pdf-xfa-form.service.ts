import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  PdfjsProcessingService,
  PdfjsXfaNode,
  PdfjsXfaPage,
} from '../../pdf-processing/pdfjs-processing.service';
import { TemplateField, TemplateFieldArea } from '../types/template-json';

type XfaBox = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type XfaPathItem = {
  box: XfaBox;
  node: PdfjsXfaNode;
};

type XfaControl = {
  area: TemplateFieldArea;
  defaultValue?: unknown;
  fieldId: string;
  name: string;
  optionValue?: string;
  readonly: boolean;
  required: boolean;
  type: string;
};

@Injectable()
export class PdfXfaFormService {
  constructor(private readonly pdfjsProcessing: PdfjsProcessingService) {}

  async extractFields(
    buffer: Buffer,
    attachmentUuid: string,
  ): Promise<TemplateField[]> {
    const pages = await this.pdfjsProcessing.extractXfaPages(buffer);
    const controls = pages.flatMap((page) =>
      this.extractPageControls(page, attachmentUuid),
    );

    return [
      ...this.buildRadioFields(controls),
      ...controls
        .filter((control) => control.type !== 'radio')
        .map((control) => this.buildField(control)),
    ];
  }

  private extractPageControls(
    page: PdfjsXfaPage,
    attachmentUuid: string,
  ): XfaControl[] {
    const controls: XfaControl[] = [];

    this.walkNode(page.root, page, attachmentUuid, [], controls);

    return controls;
  }

  private walkNode(
    node: PdfjsXfaNode,
    page: PdfjsXfaPage,
    attachmentUuid: string,
    path: XfaPathItem[],
    controls: XfaControl[],
  ): void {
    const parentBox = path.at(-1)?.box ?? {
      height: page.height,
      width: page.width,
      x: 0,
      y: 0,
    };
    const box = this.resolveBox(node, parentBox);
    const nextPath = [...path, { box, node }];

    if (this.isControlNode(node)) {
      const control = this.buildControl(node, page, attachmentUuid, nextPath);

      if (control) {
        controls.push(control);
      }
    }

    for (const child of node.children ?? []) {
      if (isXfaNode(child)) {
        this.walkNode(child, page, attachmentUuid, nextPath, controls);
      }
    }
  }

  private buildControl(
    node: PdfjsXfaNode,
    page: PdfjsXfaPage,
    attachmentUuid: string,
    path: XfaPathItem[],
  ): XfaControl | null {
    const htmlType = this.getAttribute(node, 'type').toLowerCase();

    if (['button', 'hidden', 'reset', 'submit'].includes(htmlType)) {
      return null;
    }

    const type = this.resolveControlType(node, path);
    const fieldBox = this.resolveFieldBox(node, path);
    const area = this.toArea(fieldBox, page, attachmentUuid);

    if (!area) {
      return null;
    }

    const defaultValue = this.getDefaultValue(node);

    if (this.hasDefaultValue(defaultValue)) {
      return null;
    }

    return {
      area,
      defaultValue,
      fieldId: this.resolveFieldId(node, path),
      name: this.resolveFieldName(node, path, type),
      optionValue: this.resolveOptionValue(node, path),
      readonly: this.getBooleanAttribute(node, ['readonly', 'readOnly']),
      required: this.getBooleanAttribute(node, ['required', 'aria-required']),
      type,
    };
  }

  private buildField(control: XfaControl): TemplateField {
    const preferences =
      control.type === 'text' && control.area.h && control.area.h > 0.05
        ? { multiline: true }
        : {};

    const field: TemplateField = {
      uuid: randomUUID(),
      areas: [control.area],
      name: control.name,
      preferences,
      readonly: control.readonly,
      required: control.required,
      type: control.type,
    };

    if (control.type === 'multiple' || control.type === 'select') {
      const optionValue = control.optionValue || 'Option 1';
      field.options = [{ uuid: randomUUID(), value: optionValue }];
    }

    return field;
  }

  private buildRadioFields(controls: XfaControl[]): TemplateField[] {
    const radioGroups = new Map<string, XfaControl[]>();

    for (const control of controls) {
      if (control.type !== 'radio') {
        continue;
      }

      const group = radioGroups.get(control.fieldId) ?? [];
      group.push(control);
      radioGroups.set(control.fieldId, group);
    }

    return Array.from(radioGroups.values()).map((group) => {
      const options = group.map((control, index) => ({
        uuid: randomUUID(),
        value: control.optionValue || `Option ${index + 1}`,
      }));

      return {
        uuid: randomUUID(),
        areas: group.map((control, index) => ({
          ...control.area,
          option_uuid: options[index]?.uuid,
        })),
        name: group[0]?.name ?? '',
        options,
        preferences: {},
        readonly: group.some((control) => control.readonly),
        required: group.some((control) => control.required),
        type: 'radio',
      };
    });
  }

  private resolveControlType(node: PdfjsXfaNode, path: XfaPathItem[]): string {
    if (node.name === 'select') {
      return this.getBooleanAttribute(node, ['multiple'])
        ? 'multiple'
        : 'select';
    }

    if (node.name === 'textarea') {
      return 'text';
    }

    const htmlType = this.getAttribute(node, 'type').toLowerCase();

    if (htmlType === 'checkbox') {
      return 'checkbox';
    }

    if (htmlType === 'radio') {
      return 'radio';
    }

    const name = this.resolveFieldName(node, path, 'text');

    if (/\bdate\b/i.test(name)) {
      return 'date';
    }

    if (/\b(phone|mobile|telephone|tel)\b/i.test(name)) {
      return 'phone';
    }

    return 'text';
  }

  private resolveFieldBox(node: PdfjsXfaNode, path: XfaPathItem[]): XfaBox {
    const wrapper = findLastPathItem(path, (item) =>
      hasClass(item.node, 'xfaWrapper'),
    );
    const field = findLastPathItem(path, (item) =>
      hasClass(item.node, 'xfaField'),
    );
    const label = findLastPathItem(path, (item) =>
      hasClass(item.node, 'xfaLabel'),
    );
    const baseBox = wrapper?.box ?? field?.box ?? path.at(-1)?.box;

    if (!baseBox) {
      return { height: 0, width: 0, x: 0, y: 0 };
    }

    const caption = field
      ? findDescendant(field.node, (child) => hasClass(child, 'xfaCaption'))
      : null;
    const captionBox = caption
      ? this.resolveCaptionBox(caption, baseBox)
      : { height: 0, width: 0, x: baseBox.x, y: baseBox.y };

    if (label && hasClass(label.node, 'xfaLeft')) {
      return {
        height: baseBox.height,
        width: Math.max(0, baseBox.width - captionBox.width),
        x: baseBox.x + captionBox.width,
        y: baseBox.y,
      };
    }

    if (label && hasClass(label.node, 'xfaTop')) {
      return {
        height: Math.max(0, baseBox.height - captionBox.height),
        width: baseBox.width,
        x: baseBox.x,
        y: baseBox.y + captionBox.height,
      };
    }

    if (node.name === 'input' && this.getAttribute(node, 'type') === 'radio') {
      const controlBox = path.at(-1)?.box;

      if (controlBox?.width && controlBox.height) {
        return controlBox;
      }
    }

    return baseBox;
  }

  private resolveCaptionBox(node: PdfjsXfaNode, parentBox: XfaBox): XfaBox {
    const style = getStyle(node);

    return {
      height: parseCssLength(style.height, parentBox.height),
      width: parseCssLength(style.width, parentBox.width),
      x: parentBox.x,
      y: parentBox.y,
    };
  }

  private resolveBox(node: PdfjsXfaNode, parentBox: XfaBox): XfaBox {
    const style = getStyle(node);
    const left = parseCssLength(style.left, 0, parentBox.width);
    const top = parseCssLength(style.top, 0, parentBox.height);
    const width = parseCssLength(style.width, parentBox.width);
    const height = parseCssLength(style.height, parentBox.height);

    return {
      height,
      width,
      x: parentBox.x + left,
      y: parentBox.y + top,
    };
  }

  private toArea(
    box: XfaBox,
    page: PdfjsXfaPage,
    attachmentUuid: string,
  ): TemplateFieldArea | null {
    if (
      box.width < 2 ||
      box.height < 2 ||
      page.width <= 0 ||
      page.height <= 0
    ) {
      return null;
    }

    return {
      attachment_uuid: attachmentUuid,
      h: clamp(box.height / page.height),
      page: page.page,
      w: clamp(box.width / page.width),
      x: clamp(box.x / page.width),
      y: clamp(box.y / page.height),
    };
  }

  private resolveFieldName(
    node: PdfjsXfaNode,
    path: XfaPathItem[],
    type: string,
  ): string {
    const field = findLastPathItem(path, (item) =>
      hasClass(item.node, 'xfaField'),
    );
    const caption = field
      ? findDescendant(field.node, (child) => hasClass(child, 'xfaCaption'))
      : null;
    const captionText = caption ? getTextContent(caption) : '';
    const attributeName =
      this.getAttribute(field?.node ?? node, 'xfaName') ||
      this.getAttribute(node, 'name') ||
      this.getAttribute(node, 'dataId') ||
      this.getAttribute(node, 'fieldId');
    const candidate =
      normalizeText(captionText) || splitIdentifier(attributeName);

    if (this.isReadableName(candidate)) {
      return candidate;
    }

    return `${toTitle(type)} Field`;
  }

  private resolveFieldId(node: PdfjsXfaNode, path: XfaPathItem[]): string {
    const field = findLastPathItem(path, (item) =>
      hasClass(item.node, 'xfaField'),
    );

    return (
      this.getAttribute(node, 'name') ||
      this.getAttribute(field?.node ?? node, 'xfaName') ||
      this.getAttribute(node, 'fieldId') ||
      this.getAttribute(node, 'dataId') ||
      randomUUID()
    );
  }

  private resolveOptionValue(
    node: PdfjsXfaNode,
    path: XfaPathItem[],
  ): string | undefined {
    if (node.name === 'select') {
      const firstOption = findDescendant(
        node,
        (child) => child.name === 'option',
      );
      return firstOption
        ? normalizeText(getTextContent(firstOption))
        : undefined;
    }

    const label = findLastPathItem(path, (item) =>
      hasClass(item.node, 'xfaLabel'),
    );
    const caption = label
      ? findDescendant(label.node, (child) => hasClass(child, 'xfaCaption'))
      : null;

    return caption ? normalizeText(getTextContent(caption)) : undefined;
  }

  private getDefaultValue(node: PdfjsXfaNode): unknown {
    const value =
      node.value ??
      node.attributes?.value ??
      node.attributes?.textContent ??
      node.attributes?.checked;

    return value === '' ? undefined : value;
  }

  private hasDefaultValue(value: unknown): boolean {
    if (value === undefined || value === null || value === false) {
      return false;
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return typeof value === 'string' ? value.length > 0 : true;
  }

  private isControlNode(node: PdfjsXfaNode): boolean {
    return ['input', 'select', 'textarea'].includes(node.name);
  }

  private getAttribute(node: PdfjsXfaNode | undefined, name: string): string {
    const value = node?.attributes?.[name];

    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : '';
  }

  private getBooleanAttribute(node: PdfjsXfaNode, names: string[]): boolean {
    return names.some((name) => {
      const value = node.attributes?.[name];

      return value === true || value === 'true';
    });
  }

  private isReadableName(name: string): boolean {
    return /^(?=.*[\p{L}])[\p{L}\d\s/'’.,:()-]+$/u.test(name);
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function findDescendant(
  node: PdfjsXfaNode,
  predicate: (node: PdfjsXfaNode) => boolean,
): PdfjsXfaNode | null {
  if (predicate(node)) {
    return node;
  }

  for (const child of node.children ?? []) {
    if (!isXfaNode(child)) {
      continue;
    }

    const result = findDescendant(child, predicate);

    if (result) {
      return result;
    }
  }

  return null;
}

function findLastPathItem(
  path: XfaPathItem[],
  predicate: (item: XfaPathItem) => boolean,
): XfaPathItem | undefined {
  return [...path].reverse().find(predicate);
}

function getClassList(node: PdfjsXfaNode): string[] {
  const className = node.attributes?.class;

  if (Array.isArray(className)) {
    return className.filter((item): item is string => typeof item === 'string');
  }

  return typeof className === 'string' ? className.split(/\s+/) : [];
}

function getStyle(node: PdfjsXfaNode): Record<string, unknown> {
  const style = node.attributes?.style;

  return isRecord(style) ? style : {};
}

function getTextContent(node: PdfjsXfaNode): string {
  const ownText =
    typeof node.value === 'string'
      ? node.value
      : typeof node.attributes?.textContent === 'string'
        ? node.attributes.textContent
        : '';
  const childText = (node.children ?? [])
    .filter(isXfaNode)
    .map(getTextContent)
    .join(' ');

  return normalizeText(`${ownText} ${childText}`);
}

function hasClass(node: PdfjsXfaNode, className: string): boolean {
  return getClassList(node).includes(className);
}

function isXfaNode(value: unknown): value is PdfjsXfaNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeText(value: string): string {
  return value.replaceAll(/\s+/g, ' ').replaceAll(/\s+:/g, ':').trim();
}

function parseCssLength(
  value: unknown,
  fallback: number,
  percentageBase = fallback,
): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  if (value.endsWith('%')) {
    const percentage = Number.parseFloat(value);

    return Number.isFinite(percentage)
      ? (percentageBase * percentage) / 100
      : fallback;
  }

  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitIdentifier(value: string): string {
  return normalizeText(
    value
      .replaceAll(/[_-]+/g, ' ')
      .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
      .replaceAll(/\d+$/g, ''),
  );
}

function toTitle(value: string): string {
  return value
    .replaceAll(/[_-]+/g, ' ')
    .replaceAll(/\b\w/g, (character) => character.toUpperCase());
}
