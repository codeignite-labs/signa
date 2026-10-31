import { UnprocessableEntityException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';
import { Submitter } from '../submitters/entities/submitter.entity';
import { CreateSubmissionSubmitterDto } from './dto/create-submission.dto';
import { UpdateSubmitterDto } from '../submitters/dto/update-submitter.dto';
import { TemplateField } from '../templates/types/template-json';
import {
  buildAttachmentFromRawValue,
  buildPendingAttachment,
  PendingSubmitterAttachment,
} from './submitter-attachment-ingestion';

const attachmentFieldTypes = new Set([
  'file',
  'image',
  'initials',
  'signature',
  'stamp',
]);

export type NormalizedSubmitterValues = {
  input: CreateSubmissionSubmitterDto;
  pendingAttachments: PendingSubmitterAttachment[];
};

@Injectable()
export class SubmitterValueNormalizer {
  constructor(
    private readonly storageService: StorageService,
    private readonly config: ConfigService,
  ) {}

  async normalizeCreateInput(options: {
    templateFields: TemplateField[];
    submitterInput: CreateSubmissionSubmitterDto;
    submitterUuid: string;
  }): Promise<NormalizedSubmitterValues> {
    const input = structuredClone(options.submitterInput);
    const values = this.collectDefaultValues(input);

    if (!Object.keys(values).length) {
      return { input, pendingAttachments: [] };
    }

    const normalized = await this.normalizeValues({
      values,
      fields: this.selectSubmitterFields(
        options.templateFields,
        options.submitterUuid,
      ),
    });

    input.values = normalized.values;
    this.replaceFieldConfigValues(input.fields, normalized.values);

    return { input, pendingAttachments: normalized.pendingAttachments };
  }

  async normalizeUpdateInput(
    submitter: Submitter,
    input: UpdateSubmitterDto,
  ): Promise<{
    input: UpdateSubmitterDto;
    pendingAttachments: PendingSubmitterAttachment[];
  }> {
    const nextInput = structuredClone(input);
    const values = this.collectDefaultValues(nextInput);

    if (!Object.keys(values).length) {
      return { input: nextInput, pendingAttachments: [] };
    }

    const fields = this.selectSubmitterFields(
      submitter.submission.templateFields ??
        submitter.submission.template?.fields ??
        [],
      submitter.uuid,
    );
    const normalized = await this.normalizeValues({
      values,
      fields,
      existingAttachmentUuids: await this.getSubmitterAttachmentUuids(
        submitter.id,
      ),
    });

    nextInput.values = normalized.values;
    this.replaceFieldConfigValues(nextInput.fields, normalized.values);

    return {
      input: nextInput,
      pendingAttachments: normalized.pendingAttachments,
    };
  }

  async persistPendingAttachments(
    submitter: Submitter,
    pendingAttachments: PendingSubmitterAttachment[],
  ): Promise<void> {
    for (const attachment of pendingAttachments) {
      await this.storageService.createAttachment({
        buffer: attachment.buffer,
        filename: attachment.filename,
        contentType: attachment.contentType,
        name: 'attachments',
        recordType: 'Submitter',
        recordId: submitter.id,
        uuid: attachment.uuid,
        metadata: attachment.metadata,
      });
    }
  }

  private async normalizeValues(options: {
    values: Record<string, unknown>;
    fields: TemplateField[];
    existingAttachmentUuids?: Set<string>;
  }): Promise<{
    values: Record<string, unknown>;
    pendingAttachments: PendingSubmitterAttachment[];
  }> {
    const fieldsByKey = buildFieldsByKey(options.fields);
    const pendingAttachments: PendingSubmitterAttachment[] = [];
    const values: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(options.values)) {
      const matchedFields = fieldsByKey.get(normalizeFieldKey(key)) ?? [];

      for (const field of matchedFields) {
        if (!field.uuid) {
          continue;
        }

        values[field.uuid] = await this.normalizeFieldValue({
          value,
          field,
          existingAttachmentUuids: options.existingAttachmentUuids,
          pendingAttachments,
        });
      }
    }

    return { values, pendingAttachments };
  }

  private async normalizeFieldValue(options: {
    value: unknown;
    field: TemplateField;
    existingAttachmentUuids?: Set<string>;
    pendingAttachments: PendingSubmitterAttachment[];
  }): Promise<unknown> {
    if (
      !attachmentFieldTypes.has(String(options.field.type)) ||
      isBlank(options.value)
    ) {
      return normalizePrimitiveValue(options.field, options.value);
    }

    if (Array.isArray(options.value)) {
      const attachments = await Promise.all(
        options.value.map((value) =>
          this.normalizeAttachmentValue({ ...options, value }),
        ),
      );

      return attachments.map((attachment) => attachment.uuid);
    }

    const attachment = await this.normalizeAttachmentValue(options);

    return attachment.uuid;
  }

  private async normalizeAttachmentValue(options: {
    value: unknown;
    field: TemplateField;
    existingAttachmentUuids?: Set<string>;
    pendingAttachments: PendingSubmitterAttachment[];
  }): Promise<PendingSubmitterAttachment> {
    const rawValue = stringValue(options.value);
    const existingUuid = options.existingAttachmentUuids?.has(rawValue);

    if (existingUuid) {
      return {
        uuid: rawValue,
        buffer: Buffer.alloc(0),
        filename: 'existing',
        contentType: 'application/octet-stream',
        metadata: { existing: true },
      };
    }

    const existingPending = options.pendingAttachments.find(
      (attachment) => attachment.uuid === rawValue,
    );

    if (existingPending) {
      return existingPending;
    }

    const attachment = await this.buildAttachmentFromValue(options);
    options.pendingAttachments.push(attachment);

    return attachment;
  }

  private async buildAttachmentFromValue(options: {
    value: unknown;
    field: TemplateField;
  }): Promise<PendingSubmitterAttachment> {
    const value = stringValue(options.value);
    const type = String(options.field.type);
    const maxDownloadBytes = this.config.get<number>(
      'ATTACHMENT_INGEST_MAX_BYTES',
      10 * 1024 * 1024,
    );
    if (/^https?:\/\//i.test(value)) {
      const stored = await this.storageService.readSignedBlobUrl(
        value,
        maxDownloadBytes,
      );
      if (stored) return buildPendingAttachment({ ...stored, type });
    }
    return buildAttachmentFromRawValue({ value, type, maxDownloadBytes });
  }

  private collectDefaultValues(
    input: Pick<CreateSubmissionSubmitterDto, 'values' | 'fields'>,
  ): Record<string, unknown> {
    const values = { ...(input.values ?? {}) };

    for (const field of input.fields ?? []) {
      const key = field.name ?? field.uuid;

      if (!key) {
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(field, 'default_value')) {
        values[key] = field.default_value;
      }

      if (Object.prototype.hasOwnProperty.call(field, 'value')) {
        values[key] = field.value;
      }
    }

    return values;
  }

  private replaceFieldConfigValues(
    fields: TemplateField[] | undefined,
    normalizedValues: Record<string, unknown>,
  ): void {
    if (!fields?.length) {
      return;
    }

    for (const field of fields) {
      if (
        !field.uuid ||
        !Object.prototype.hasOwnProperty.call(normalizedValues, field.uuid)
      ) {
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(field, 'default_value')) {
        field.default_value = normalizedValues[field.uuid];
      }

      if (Object.prototype.hasOwnProperty.call(field, 'value')) {
        field.value = normalizedValues[field.uuid];
      }
    }
  }

  private selectSubmitterFields(
    fields: TemplateField[],
    submitterUuid: string,
  ): TemplateField[] {
    return fields.filter((field) => field.submitter_uuid === submitterUuid);
  }

  private async getSubmitterAttachmentUuids(
    submitterId: string,
  ): Promise<Set<string>> {
    const attachments = await this.storageService.findRecordAttachments({
      recordType: 'Submitter',
      recordId: submitterId,
      name: 'attachments',
    });

    return new Set(attachments.map((attachment) => attachment.uuid));
  }
}

function buildFieldsByKey(
  fields: TemplateField[],
): Map<string, TemplateField[]> {
  const fieldsByKey = new Map<string, TemplateField[]>();

  for (const field of fields) {
    for (const key of [
      field.uuid,
      field.name,
      parameterizeFieldName(field.name),
    ]) {
      if (!key) {
        continue;
      }

      const normalizedKey = normalizeFieldKey(key);
      const existingFields = fieldsByKey.get(normalizedKey) ?? [];

      if (!existingFields.includes(field)) {
        fieldsByKey.set(normalizedKey, [...existingFields, field]);
      }
    }
  }

  return fieldsByKey;
}

function normalizePrimitiveValue(
  field: TemplateField,
  value: unknown,
): unknown {
  if (field.type === 'checkbox') {
    if (
      ['1', 'true', true, 'TRUE', 'True', 'yes', 'YES', 'Yes'].includes(
        value as never,
      )
    ) {
      return true;
    }

    if (
      ['0', 'false', false, 'FALSE', 'False', 'no', 'NO', 'No'].includes(
        value as never,
      )
    ) {
      return false;
    }
  }

  if (isBlank(value)) {
    return null;
  }

  if (field.type === 'number') {
    const numeric = Number(value);
    return Number.isInteger(numeric) ? numeric : Number(value);
  }

  return value;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function stringValue(value: unknown): string {
  if (typeof value !== 'string') {
    throw new UnprocessableEntityException({
      error: `Invalid attachment value`,
    });
  }

  return value;
}

function normalizeFieldKey(value: string): string {
  return value.toLowerCase();
}

function parameterizeFieldName(value: string | undefined): string | undefined {
  return value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
