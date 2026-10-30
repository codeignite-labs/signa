import { Injectable } from '@nestjs/common';
import {
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFField,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFPage,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFString,
  PDFTextField,
  TextAlignment,
} from 'pdf-lib';
import { randomUUID } from 'node:crypto';
import { TemplateField, TemplateFieldArea } from '../types/template-json';

@Injectable()
export class PdfAcroFormService {
  async extractFields(
    buffer: Buffer,
    attachmentUuid: string,
  ): Promise<TemplateField[]> {
    try {
      const document = await PDFDocument.load(buffer);
      const pages = document.getPages();
      const pageIndex = this.buildPageIndex(pages);
      const form = document.getForm();

      return form
        .getFields()
        .flatMap((field) =>
          this.extractField(field, pages, pageIndex, attachmentUuid),
        );
    } catch {
      return [];
    }
  }

  private extractField(
    field: PDFField,
    pages: PDFPage[],
    pageIndex: Map<string, number>,
    attachmentUuid: string,
  ): TemplateField[] {
    const properties = this.buildFieldProperties(field);

    if (!properties || this.hasDefaultValue(properties)) {
      return [];
    }

    const widgets = field.acroField.getWidgets();
    const areas = widgets
      .map((widget, widgetIndex) => {
        const pageNumber =
          this.getWidgetPageNumber(widget.P(), pageIndex) ??
          this.findWidgetPageNumber(field.ref, pages, widgetIndex);

        if (pageNumber === undefined) {
          return null;
        }

        const page = pages[pageNumber];
        const { width: pageWidth, height: pageHeight } = page.getSize();
        const rectangle = widget.getRectangle();

        if (!rectangle.width || !rectangle.height) {
          return null;
        }

        const area: TemplateFieldArea = {
          page: pageNumber,
          x: rectangle.x / pageWidth,
          y: (pageHeight - rectangle.y - rectangle.height) / pageHeight,
          w: rectangle.width / pageWidth,
          h: rectangle.height / pageHeight,
          attachment_uuid: attachmentUuid,
        };

        return area;
      })
      .filter((area): area is TemplateFieldArea => !!area);

    if (!areas.length) {
      return [];
    }

    if (
      (properties.type === 'radio' || properties.type === 'multiple') &&
      Array.isArray(properties.options)
    ) {
      const options =
        properties.options.length === areas.length
          ? properties.options
          : this.buildOptions(
              Array.from({ length: areas.length }, () => ''),
              properties.type,
            );

      properties.options = options;
      areas.forEach((area, index) => {
        area.option_uuid = options[index]?.uuid;
      });
    }

    return [
      {
        uuid: randomUUID(),
        required: field.isRequired(),
        readonly: field.isReadOnly(),
        preferences: {},
        areas,
        ...properties,
      },
    ];
  }

  private buildPageIndex(pages: PDFPage[]): Map<string, number> {
    return new Map(pages.map((page, index) => [page.ref.toString(), index]));
  }

  private getWidgetPageNumber(
    pageRef: PDFRef | undefined,
    pageIndex: Map<string, number>,
  ): number | undefined {
    return pageRef ? pageIndex.get(pageRef.toString()) : undefined;
  }

  private findWidgetPageNumber(
    fieldRef: PDFRef,
    pages: PDFPage[],
    widgetIndex: number,
  ): number | undefined {
    let seenWidgets = 0;

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const annotations = pages[pageIndex].node.Annots();

      if (!annotations) {
        continue;
      }

      for (let index = 0; index < annotations.size(); index += 1) {
        const annotation = annotations.get(index);

        if (
          annotation instanceof PDFRef &&
          annotation.toString() === fieldRef.toString()
        ) {
          if (seenWidgets === widgetIndex) {
            return pageIndex;
          }

          seenWidgets += 1;
          continue;
        }

        const annotationDict =
          annotation instanceof PDFRef
            ? pages[pageIndex].doc.context.lookup(annotation, PDFDict)
            : annotation instanceof PDFDict
              ? annotation
              : null;

        const parent = annotationDict?.get(PDFName.of('Parent'));

        if (
          parent instanceof PDFRef &&
          parent.toString() === fieldRef.toString()
        ) {
          if (seenWidgets === widgetIndex) {
            return pageIndex;
          }

          seenWidgets += 1;
        }
      }
    }

    return undefined;
  }

  private buildFieldProperties(field: PDFField): AcroFieldProperties | null {
    const name = this.normalizeFieldName(field.getName());
    const base: Record<string, unknown> = { name };
    const description = this.getDescription(field);

    if (description) {
      base.description = description;
    }

    if (field instanceof PDFTextField) {
      const preferences = this.buildTextPreferences(field);
      const value = field.getText();

      return {
        ...base,
        type: this.isDateField(field) ? 'date' : 'text',
        ...(value ? { default_value: value } : {}),
        ...(Object.keys(preferences).length ? { preferences } : {}),
      };
    }

    if (field instanceof PDFCheckBox) {
      return {
        ...base,
        type: 'checkbox',
        default_value: field.isChecked(),
      };
    }

    if (field instanceof PDFDropdown) {
      const selected = field.getSelected();

      return {
        ...base,
        type: 'select',
        options: this.buildOptions(field.getOptions(), 'select'),
        ...(selected[0] ? { default_value: selected[0] } : {}),
      };
    }

    if (field instanceof PDFOptionList) {
      const selected = field.getSelected();

      return {
        ...base,
        type: 'multiple',
        options: this.buildOptions(field.getOptions(), 'multiple'),
        ...(selected.length ? { default_value: selected } : {}),
      };
    }

    if (field instanceof PDFRadioGroup) {
      const selected = field.getSelected();

      return {
        ...base,
        type: 'radio',
        options: this.buildOptions(field.getOptions(), 'radio'),
        ...(selected ? { default_value: selected } : {}),
      };
    }

    if (field instanceof PDFSignature) {
      return {
        ...base,
        type: field.getName().toLowerCase().includes('initial')
          ? 'initials'
          : 'signature',
      };
    }

    return null;
  }

  private normalizeFieldName(name: string): string {
    return /^(?=.*[\p{L}])[\p{L}\d\s-]+$/u.test(name) ? name : '';
  }

  private getDescription(field: PDFField): string | undefined {
    const description = field.acroField.dict
      .lookupMaybe(PDFName.of('TU'), PDFString, PDFHexString)
      ?.decodeText();

    if (!description || description === field.getName()) {
      return undefined;
    }

    return description;
  }

  private buildTextPreferences(field: PDFTextField): Record<string, unknown> {
    const preferences: Record<string, unknown> = {};

    switch (field.getAlignment()) {
      case TextAlignment.Center:
        preferences.align = 'center';
        break;
      case TextAlignment.Right:
        preferences.align = 'right';
        break;
      default:
        break;
    }

    const maxLength = field.getMaxLength();

    if (maxLength) {
      preferences.max_length = maxLength;
    }

    return preferences;
  }

  private isDateField(field: PDFTextField): boolean {
    const dictionary = field.acroField.dict;
    const action = dictionary.lookupMaybe(PDFName.of('AA'), PDFDict);
    const serializedAction = action?.toString() ?? '';

    return serializedAction.includes('AFDate_');
  }

  private buildOptions(
    values: string[],
    type: 'multiple' | 'radio' | 'select',
  ): { uuid: string; value: string }[] {
    const isSkipSingleValue =
      (type === 'multiple' || type === 'radio') && new Set(values).size === 1;

    return values
      .filter((value) => type !== 'select' || !this.isSelectPlaceholder(value))
      .map((value) => ({
        uuid: randomUUID(),
        value: isSkipSingleValue ? '' : value,
      }));
  }

  private isSelectPlaceholder(value: string): boolean {
    return /\b(Select|Choose|Wählen|Auswählen|Sélectionner|Choisir|Seleccionar|Elegir|Seleziona|Scegliere|Selecionar|Escolher)\b/i.test(
      value,
    );
  }

  private hasDefaultValue(properties: Record<string, unknown>): boolean {
    const value = properties.default_value;

    if (value === undefined || value === null || value === false) {
      return false;
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return typeof value === 'string' ? value.length > 0 : true;
  }
}

type AcroFieldProperties = Record<string, unknown> & {
  type: string;
  options?: { uuid: string; value: string }[];
};
