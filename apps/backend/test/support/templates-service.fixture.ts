import { EventEmitter2 } from '@nestjs/event-emitter';
import { PDFDocument } from 'pdf-lib';
import { Repository } from 'typeorm';
import { AccountsService } from '../../src/accounts/accounts.service';
import { StorageAttachment } from '../../src/storage/entities/storage-attachment.entity';
import { StorageBlob } from '../../src/storage/entities/storage-blob.entity';
import { StorageService } from '../../src/storage/storage.service';
import { DocumentConversionService } from '../../src/templates/document-conversion.service';
import { DocxFieldTagService } from '../../src/templates/docx-field-tag.service';
import { DynamicDocumentVersion } from '../../src/templates/entities/dynamic-document-version.entity';
import { DynamicDocument } from '../../src/templates/entities/dynamic-document.entity';
import { TemplateEvent } from '../../src/templates/entities/template-event.entity';
import { TemplateFolder } from '../../src/templates/entities/template-folder.entity';
import { TemplateSharing } from '../../src/templates/entities/template-sharing.entity';
import { TemplateVersion } from '../../src/templates/entities/template-version.entity';
import { Template } from '../../src/templates/entities/template.entity';
import { PdfAcroFormService } from '../../src/templates/pdf-acro-form/pdf-acro-form.service';
import { PdfTextTagService } from '../../src/templates/pdf-text-tag.service';
import { PdfXfaFormService } from '../../src/templates/pdf-xfa-form/pdf-xfa-form.service';
import { TemplatesService } from '../../src/templates/templates.service';
import { User } from '../../src/users/entities/user.entity';
import { createQueryBuilderFixture } from './query-builder.fixture';
function repository<T>(create: (input: Partial<T>) => T) {
  const query = createQueryBuilderFixture<T>();
  return {
    query,
    createQueryBuilder: jest.fn().mockReturnValue(query),
    create: jest.fn(create),
    save: jest.fn((value: T) => Promise.resolve(value)),
    remove: jest.fn((value: T) => Promise.resolve(value)),
    find: jest.fn<Promise<T[]>, [unknown]>().mockResolvedValue([]),
    findOne: jest.fn<Promise<T | null>, [unknown]>().mockResolvedValue(null),
    findOneOrFail: jest.fn<Promise<T>, [unknown]>(),
    count: jest.fn().mockResolvedValue(0),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
}
export async function createTemplatesServiceFixture() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const pdfBuffer = Buffer.from(await pdf.save());
  const user: User = Object.assign(new User(), {
    id: 'owner',
    accountId: 'tenant',
    email: 'owner@example.test',
    firstName: 'First',
    lastName: 'Last',
  });
  const defaultFolder: TemplateFolder = Object.assign(new TemplateFolder(), {
    id: 'default',
    accountId: 'tenant',
    name: 'Default',
    parentFolder: null,
    parentFolderId: null,
  });
  const folderRows = new Map<string, TemplateFolder>([
    ['default', defaultFolder],
  ]);
  const template: Template = Object.assign(new Template(), {
    id: 'template',
    accountId: 'tenant',
    authorId: 'owner',
    author: user,
    folderId: 'default',
    folder: defaultFolder,
    name: 'Agreement',
    source: 'native',
    fields: [
      {
        uuid: 'field',
        submitter_uuid: 'party',
        type: 'text',
        name: 'Full name',
      },
    ],
    submitters: [{ uuid: 'party', name: 'Signer' }],
    schema: [],
    preferences: {},
    sharedLink: true,
    externalId: null,
    variablesSchema: null,
    archivedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  });
  const templateRows = new Map<string, Template>([['template', template]]);
  const templates = repository<Template>((input) =>
    Object.assign(new Template(), template, { id: 'created-template' }, input),
  );
  templates.save.mockImplementation((value) => {
    templateRows.set(value.id, value);
    return Promise.resolve(value);
  });
  templates.findOne.mockImplementation((options) => {
    const where = (
      options as {
        where: { id?: string; accountId?: string; externalId?: string };
      }
    ).where;
    const found = [...templateRows.values()].find(
      (value) =>
        (!where.id || value.id === where.id) &&
        (!where.accountId || value.accountId === where.accountId) &&
        (!where.externalId || value.externalId === where.externalId),
    );
    return Promise.resolve(found ?? null);
  });
  let folderCounter = 0;
  const folders = repository<TemplateFolder>((input) =>
    Object.assign(
      new TemplateFolder(),
      { id: `folder-${++folderCounter}` },
      input,
    ),
  );
  folders.save.mockImplementation((value) => {
    folderRows.set(value.id, value);
    return Promise.resolve(value);
  });
  folders.find.mockImplementation((options) => {
    const where = (options as { where?: { parentFolderId?: string } }).where;
    return Promise.resolve(
      [...folderRows.values()].filter(
        (folder) =>
          !where?.parentFolderId ||
          folder.parentFolderId === where.parentFolderId,
      ),
    );
  });
  folders.findOne.mockImplementation((options) => {
    const where = (
      options as { where: { name: string; parentFolderId?: string } }
    ).where;
    return Promise.resolve(
      [...folderRows.values()].find(
        (folder) =>
          folder.name === where.name &&
          folder.parentFolderId ===
            (typeof where.parentFolderId === 'string'
              ? where.parentFolderId
              : null),
      ) ?? null,
    );
  });
  folders.findOneOrFail.mockImplementation((options) =>
    Promise.resolve(
      folderRows.get((options as { where: { id: string } }).where.id)!,
    ),
  );
  const templateEvents = repository<TemplateEvent>((input) =>
    Object.assign(new TemplateEvent(), { id: 'event' }, input),
  );
  const templateVersions = repository<TemplateVersion>((input) =>
    Object.assign(new TemplateVersion(), input),
  );
  const templateSharings = repository<TemplateSharing>((input) =>
    Object.assign(new TemplateSharing(), input),
  );
  const dynamicDocuments = repository<DynamicDocument>((input) =>
    Object.assign(new DynamicDocument(), { id: 'dynamic' }, input),
  );
  const dynamicVersions = repository<DynamicDocumentVersion>((input) =>
    Object.assign(new DynamicDocumentVersion(), input),
  );
  let attachmentCounter = 0;
  const attachmentRows: StorageAttachment[] = [];
  const storedBuffers: Buffer[] = [];
  const storage = {
    readSignedBlobUrl: jest
      .fn<
        ReturnType<StorageService['readSignedBlobUrl']>,
        Parameters<StorageService['readSignedBlobUrl']>
      >()
      .mockResolvedValue(null),
    createPdfAttachment: jest.fn(
      (input: Parameters<StorageService['createPdfAttachment']>[0]) => {
        storedBuffers.push(input.buffer);
        const index = ++attachmentCounter;
        const attachment = Object.assign(new StorageAttachment(), {
          id: String(index),
          uuid: `document-${index}`,
          recordType: input.recordType,
          recordId: input.recordId,
          name: input.name,
          blob: Object.assign(new StorageBlob(), {
            filename: input.filename,
            metadata: input.metadata ?? {},
            contentType: 'application/pdf',
          }),
        });
        attachmentRows.push(attachment);
        return Promise.resolve(attachment);
      },
    ),
    cloneAttachment: jest.fn(
      (input: Parameters<StorageService['cloneAttachment']>[0]) => {
        const attachment = Object.assign(
          new StorageAttachment(),
          input.sourceAttachment,
          {
            id: String(++attachmentCounter),
            recordType: input.recordType,
            recordId: input.recordId,
            name: input.name,
            uuid: input.uuid ?? `clone-${attachmentCounter}`,
          },
        );
        attachmentRows.push(attachment);
        return Promise.resolve(attachment);
      },
    ),
    findRecordAttachments: jest.fn(
      (options: Parameters<StorageService['findRecordAttachments']>[0]) =>
        Promise.resolve(
          attachmentRows.filter(
            (attachment) =>
              attachment.recordId === options.recordId &&
              attachment.recordType === options.recordType &&
              attachment.name === options.name,
          ),
        ),
    ),
    findPreviewAttachments: jest
      .fn<Promise<StorageAttachment[]>, [string]>()
      .mockResolvedValue([]),
    findPreviewAttachment: jest.fn().mockResolvedValue(null),
    findPreviewAttachmentsByRecordIds: jest
      .fn<Promise<Map<string, StorageAttachment[]>>, [string[]]>()
      .mockResolvedValue(new Map()),
    createBlobProxyUrl: jest.fn(
      (blob: StorageBlob) => `https://files.example.test/${blob.filename}`,
    ),
    deleteRecordAttachments: jest.fn().mockResolvedValue(undefined),
  };
  const acro = { extractFields: jest.fn().mockResolvedValue([]) };
  const xfa = { extractFields: jest.fn().mockResolvedValue([]) };
  const conversion = {
    hashSource: jest.fn().mockReturnValue('source-hash'),
    renderHtmlDocument: jest.fn().mockResolvedValue({
      buffer: pdfBuffer,
      fields: [],
      body: '<p>Body</p>',
      head: '<style></style>',
      filename: 'rendered.pdf',
    }),
    convertDocxToPdf: jest.fn().mockResolvedValue(pdfBuffer),
  };
  const docxTags = {
    prepareDocument: jest.fn((buffer: Buffer) => ({ buffer, markers: [] })),
    extractMarkerFields: jest.fn().mockResolvedValue([]),
  };
  const docxVariables = {
    extractVariables: jest.fn().mockReturnValue([]),
    expandVariables: jest.fn((buffer: Buffer) => buffer),
  };
  const textTags = {
    extractAndMaybeRemoveTags: jest.fn(({ pdf }: { pdf: Buffer }) =>
      Promise.resolve({ pdf, fields: [] }),
    ),
  };
  const accounts = {
    getTestingAccountContext: jest
      .fn<
        Promise<{
          isTestMode: boolean;
          productionAccountId: string | null;
          testingAccountId: string | null;
        }>,
        [string]
      >()
      .mockResolvedValue({
        isTestMode: false,
        productionAccountId: 'tenant',
        testingAccountId: null,
      }),
    findOrCreateTestingUser: jest
      .fn()
      .mockResolvedValue({ account: { id: 'testing' } }),
  };
  const events = { emit: jest.fn() };
  const service = new TemplatesService(
    templates as unknown as Repository<Template>,
    folders as unknown as Repository<TemplateFolder>,
    templateEvents as unknown as Repository<TemplateEvent>,
    templateVersions as unknown as Repository<TemplateVersion>,
    templateSharings as unknown as Repository<TemplateSharing>,
    dynamicDocuments as unknown as Repository<DynamicDocument>,
    dynamicVersions as unknown as Repository<DynamicDocumentVersion>,
    storage as unknown as StorageService,
    acro as unknown as PdfAcroFormService,
    xfa as unknown as PdfXfaFormService,
    conversion as unknown as DocumentConversionService,
    docxTags as unknown as DocxFieldTagService,
    docxVariables,
    textTags as unknown as PdfTextTagService,
    accounts as unknown as AccountsService,
    events as unknown as EventEmitter2,
  );
  return {
    service,
    user,
    template,
    templateRows,
    templates,
    defaultFolder,
    folderRows,
    folders,
    templateEvents,
    templateVersions,
    templateSharings,
    dynamicDocuments,
    dynamicVersions,
    attachmentRows,
    storedBuffers,
    storage,
    acro,
    xfa,
    conversion,
    docxTags,
    docxVariables,
    textTags,
    accounts,
    events,
    pdfBuffer,
  };
}
