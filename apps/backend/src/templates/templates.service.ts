import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { Brackets, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service';
import { throwDatabaseErrors, throwIfNotFound } from '../common/utils/error';
import { downloadPublicDocument } from '../common/http/public-download';
import { runtimeEvents } from '../runtime/runtime-events';
import { StorageService } from '../storage/storage.service';
import { UploadedBufferFile } from '../storage/storage.types';
import { User } from '../users/entities/user.entity';
import { CloneTemplateDto } from './dto/clone-template.dto';
import { CreateTemplateDto } from './dto/create-template.dto';
import { CreateTemplateFolderDto } from './dto/create-template-folder.dto';
import { CreateTemplateFromDocxDto } from './dto/create-template-from-docx.dto';
import { CreateTemplateFromHtmlDto } from './dto/create-template-from-html.dto';
import { CreateTemplateFromPdfDto } from './dto/create-template-from-pdf.dto';
import { DeleteTemplateFolderQueryDto } from './dto/delete-template-folder-query.dto';
import { DeleteTemplateQueryDto } from './dto/delete-template-query.dto';
import { ImportGoogleDriveDocumentsDto } from './dto/google-drive-documents.dto';
import { ListTemplateFoldersQueryDto } from './dto/list-template-folders-query.dto';
import { ListTemplatesQueryDto } from './dto/list-templates-query.dto';
import { MergeTemplatesDto } from './dto/merge-templates.dto';
import { TemplateEventsListResponseDto } from './dto/template-event-response.dto';
import { TemplateFolderResponseDto } from './dto/template-folder-response.dto';
import { TemplateDeleteResponseDto } from './dto/template-delete-response.dto';
import { TemplateDocumentsUpdateResponseDto } from './dto/template-documents-update-response.dto';
import { TemplateResponseDto } from './dto/template-response.dto';
import { TemplateUpdateResponseDto } from './dto/template-update-response.dto';
import { TemplateVersionsListResponseDto } from './dto/template-version-response.dto';
import { TemplatesListResponseDto } from './dto/templates-list-response.dto';
import { UpdateTemplateFolderDto } from './dto/update-template-folder.dto';
import { UpdateTemplateDocumentsDto } from './dto/update-template-documents.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { DocumentConversionService } from './document-conversion.service';
import { DocxFieldTagService } from './docx-field-tag.service';
import { DocxVariableService } from './docx-variable.service';
import { DynamicDocumentVersion } from './entities/dynamic-document-version.entity';
import { DynamicDocument } from './entities/dynamic-document.entity';
import { TemplateEvent } from './entities/template-event.entity';
import { TemplateFolder } from './entities/template-folder.entity';
import { TemplateSharing } from './entities/template-sharing.entity';
import { Template } from './entities/template.entity';
import { TemplateVersion } from './entities/template-version.entity';
import { PdfAcroFormService } from './pdf-acro-form/pdf-acro-form.service';
import { PdfTextTagService } from './pdf-text-tag.service';
import { PdfXfaFormService } from './pdf-xfa-form/pdf-xfa-form.service';
import {
  TemplateDocumentResponse,
  TemplateField,
  TemplateSubmitter,
} from './types/template-json';

@Injectable()
export class TemplatesService {
  private readonly defaultLimit = 10;
  private readonly maxLimit = 100;

  constructor(
    @InjectRepository(Template)
    private readonly templates: Repository<Template>,
    @InjectRepository(TemplateFolder)
    private readonly folders: Repository<TemplateFolder>,
    @InjectRepository(TemplateEvent)
    private readonly templateEvents: Repository<TemplateEvent>,
    @InjectRepository(TemplateVersion)
    private readonly templateVersions: Repository<TemplateVersion>,
    @InjectRepository(TemplateSharing)
    private readonly templateSharings: Repository<TemplateSharing>,
    @InjectRepository(DynamicDocument)
    private readonly dynamicDocuments: Repository<DynamicDocument>,
    @InjectRepository(DynamicDocumentVersion)
    private readonly dynamicDocumentVersions: Repository<DynamicDocumentVersion>,
    private readonly storageService: StorageService,
    private readonly pdfAcroFormService: PdfAcroFormService,
    private readonly pdfXfaFormService: PdfXfaFormService,
    private readonly documentConversionService: DocumentConversionService,
    private readonly docxFieldTagService: DocxFieldTagService,
    private readonly docxVariableService: DocxVariableService,
    private readonly pdfTextTagService: PdfTextTagService,
    private readonly accountsService: AccountsService,
    private readonly events: EventEmitter2,
  ) {}

  async listTemplates(
    user: User,
    query: ListTemplatesQueryDto,
  ): Promise<TemplatesListResponseDto> {
    const builder = this.templates
      .createQueryBuilder('template')
      .leftJoinAndSelect('template.author', 'author')
      .leftJoinAndSelect('template.folder', 'folder')
      .leftJoinAndSelect('folder.parentFolder', 'parentFolder')
      .leftJoin(
        TemplateSharing,
        'testing_sharing',
        'testing_sharing.template_id = template.id AND testing_sharing.account_id = :accountId',
        { accountId: user.accountId },
      )
      .where(
        new Brackets((where) => {
          where
            .where('template.account_id = :accountId', {
              accountId: user.accountId,
            })
            .orWhere('testing_sharing.id IS NOT NULL');
        }),
      );

    if (query.archived) {
      builder.withDeleted();
    }

    this.applyFilters(builder, query);
    const accountContext = await this.accountsService.getTestingAccountContext(
      user.accountId,
    );
    const folderName =
      query.folder ??
      (query.archived ? undefined : TemplateFolder.DEFAULT_NAME);

    if (!accountContext.isTestMode || query.folder) {
      await this.applyFolderFilter(builder, user.accountId, folderName);
    }

    const templates = await builder
      .orderBy('template.id', 'DESC')
      .limit(Math.min(query.limit ?? this.defaultLimit, this.maxLimit))
      .getMany();

    return {
      data: await Promise.all(
        templates.map((template) => this.toTemplateResponse(template)),
      ),
      pagination: {
        count: templates.length,
        next: templates.at(-1)?.id ?? null,
        prev: templates[0]?.id ?? null,
      },
    };
  }

  async listFolders(
    user: User,
    query: ListTemplateFoldersQueryDto,
  ): Promise<TemplateFolderResponseDto[]> {
    const parent = query.parent
      ? await this.findFolderByFullNameOrFail(user, query.parent)
      : null;
    const folders = await this.folders
      .createQueryBuilder('folder')
      .leftJoinAndSelect('folder.parentFolder', 'parentFolder')
      .leftJoinAndSelect('parentFolder.parentFolder', 'grandParentFolder')
      .leftJoinAndSelect('grandParentFolder.parentFolder', 'rootParentFolder')
      .where('folder.account_id = :accountId', { accountId: user.accountId })
      .andWhere('folder.archived_at IS NULL')
      .andWhere(
        parent
          ? 'folder.parent_folder_id = :parentFolderId'
          : 'folder.parent_folder_id IS NULL',
        parent ? { parentFolderId: parent.id } : {},
      )
      .orderBy('folder.name', 'ASC')
      .getMany();
    const search = query.q?.trim().toLowerCase();
    const visibleFolders = folders.filter((folder) => {
      if (!parent && folder.name === TemplateFolder.DEFAULT_NAME) {
        return false;
      }

      return search ? folder.name.toLowerCase().includes(search) : true;
    });

    return Promise.all(
      visibleFolders.map((folder) => this.toFolderResponse(folder)),
    );
  }

  async createFolder(
    user: User,
    input: CreateTemplateFolderDto,
  ): Promise<TemplateFolderResponseDto> {
    const folderName = this.buildFolderPath(input.parent, input.name);
    const folder = await this.findOrCreateFolder(user, folderName);

    return this.toFolderResponse(
      await this.findFolderByFullNameOrFail(user, this.getFolderName(folder)),
    );
  }

  async updateFolder(
    user: User,
    folderId: string,
    input: UpdateTemplateFolderDto,
  ): Promise<TemplateFolderResponseDto> {
    const folder = await this.findAccountFolderOrFail(user, folderId);

    this.assertEditableFolder(folder);

    if (input.name !== undefined) {
      const name = input.name.trim();

      if (!name) {
        throw new UnprocessableEntityException({
          error: 'Folder name cannot be blank',
        });
      }

      folder.name = name;
    }

    if (input.parent !== undefined) {
      const parent = input.parent.trim()
        ? await this.findOrCreateFolder(user, input.parent)
        : null;
      await this.assertFolderParentAllowed(user, folder, parent);
      folder.parentFolder = parent;
      folder.parentFolderId = parent?.id ?? null;
    }

    try {
      const saved = await this.folders.save(folder);

      return this.toFolderResponse(
        await this.findAccountFolderOrFail(user, saved.id),
      );
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async deleteFolder(
    user: User,
    folderId: string,
    query: DeleteTemplateFolderQueryDto,
  ): Promise<null> {
    const folder = await this.findAccountFolderOrFail(user, folderId);

    this.assertEditableFolder(folder);

    if (query.mode === 'with_contents') {
      await this.deleteFolderWithContents(user, folder);
      return null;
    }

    await this.deleteFolderOnly(user, folder);

    return null;
  }

  async createTemplate(
    user: User,
    input: CreateTemplateDto,
  ): Promise<TemplateResponseDto> {
    const folder = await this.findOrCreateFolder(
      user,
      input.folder_name ?? TemplateFolder.DEFAULT_NAME,
    );
    const template = this.templates.create({
      accountId: user.accountId,
      authorId: user.id,
      externalId: input.external_id ?? null,
      fields: [],
      folder,
      folderId: folder.id,
      name: input.name?.trim() || 'Untitled Template',
      preferences: {},
      schema: [],
      sharedLink: input.shared_link ?? true,
      source: 'native',
      submitters: input.submitters?.length
        ? input.submitters
        : [{ name: 'First Party', uuid: randomUUID() }],
      variablesSchema: null,
    });

    try {
      const saved = await this.templates.save(template);
      await this.recordTemplateActivity({
        data: { source: saved.source },
        eventType: 'template.created',
        summary: 'Template created',
        template: saved,
        user,
      });
      this.events.emit(runtimeEvents.templateCreated, {
        accountId: saved.accountId,
        templateId: saved.id,
      });

      return this.toTemplateResponse(
        await this.findAccountTemplateOrFail(user, saved.id),
      );
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  private async deleteFolderOnly(user: User, folder: TemplateFolder) {
    const defaultFolder = await this.findOrCreateFolder(
      user,
      TemplateFolder.DEFAULT_NAME,
    );

    await Promise.all([
      this.templates.update(
        {
          accountId: user.accountId,
          folderId: folder.id,
        },
        {
          folderId: defaultFolder.id,
        },
      ),
      this.folders.update(
        {
          accountId: user.accountId,
          parentFolderId: folder.id,
        },
        {
          parentFolderId: null,
        },
      ),
    ]);

    await this.folders.softDelete({
      accountId: user.accountId,
      id: folder.id,
    });
  }

  private async deleteFolderWithContents(
    user: User,
    folder: TemplateFolder,
  ): Promise<void> {
    const folders = await this.findDescendantFolders(user.accountId, folder.id);
    const folderIds = [folder.id, ...folders.map((item) => item.id)];
    const archivedAt = new Date();

    await Promise.all([
      this.templates
        .createQueryBuilder()
        .update(Template)
        .set({ archivedAt })
        .where('account_id = :accountId', { accountId: user.accountId })
        .andWhere('folder_id IN (:...folderIds)', { folderIds })
        .execute(),
      this.folders
        .createQueryBuilder()
        .update(TemplateFolder)
        .set({ archivedAt })
        .where('account_id = :accountId', { accountId: user.accountId })
        .andWhere('id IN (:...folderIds)', { folderIds })
        .execute(),
    ]);
  }

  private async findDescendantFolders(
    accountId: string,
    folderId: string,
  ): Promise<TemplateFolder[]> {
    const children = await this.folders.find({
      where: {
        accountId,
        archivedAt: IsNull(),
        parentFolderId: folderId,
      },
    });
    const descendants = await Promise.all(
      children.map((child) => this.findDescendantFolders(accountId, child.id)),
    );

    return children.concat(descendants.flat());
  }

  async getTemplate(
    user: User,
    templateId: string,
  ): Promise<TemplateResponseDto> {
    return this.toTemplateResponse(
      await this.findAccountTemplateOrFail(user, templateId),
    );
  }

  async listTemplateEvents(
    user: User,
    templateId: string,
  ): Promise<TemplateEventsListResponseDto> {
    await this.findAccountTemplateOrFail(user, templateId);

    const events = await this.templateEvents.find({
      where: {
        accountId: user.accountId,
        templateId,
      },
      relations: {
        user: true,
      },
      order: {
        eventTimestamp: 'DESC',
        id: 'DESC',
      },
      take: 100,
    });

    return {
      data: events.map((event) => ({
        id: event.id,
        template_id: event.templateId,
        event_type: event.eventType,
        summary: event.summary,
        event_timestamp: event.eventTimestamp,
        data: event.data,
        user: event.user
          ? {
              id: event.user.id,
              email: event.user.email,
              first_name: event.user.firstName,
              last_name: event.user.lastName,
            }
          : null,
      })),
    };
  }

  async listTemplateVersions(
    user: User,
    templateId: string,
  ): Promise<TemplateVersionsListResponseDto> {
    await this.findAccountTemplateOrFail(user, templateId);

    const versions = await this.templateVersions.find({
      where: {
        accountId: user.accountId,
        templateId,
      },
      relations: {
        author: true,
      },
      order: {
        createdAt: 'DESC',
        id: 'DESC',
      },
      take: 50,
    });

    return {
      data: versions.map((version) => ({
        id: version.id,
        template_id: version.templateId,
        sha1: version.sha1,
        created_at: version.createdAt,
        data: version.data,
        author: version.author
          ? {
              id: version.author.id,
              email: version.author.email,
              first_name: version.author.firstName,
              last_name: version.author.lastName,
            }
          : null,
      })),
    };
  }

  async createBackingTemplateFromPdf(
    user: User,
    input: CreateTemplateFromPdfDto,
    multipartFiles?: Record<string, UploadedBufferFile[]>,
  ): Promise<Template> {
    const response = await this.createTemplateFromPdf(
      user,
      {
        ...input,
        shared_link: input.shared_link ?? false,
      },
      multipartFiles,
    );

    return this.findAccountTemplateOrFail(user, response.id);
  }

  async createBackingTemplateFromHtml(
    user: User,
    input: CreateTemplateFromHtmlDto,
  ): Promise<Template> {
    const response = await this.createTemplateFromHtml(user, {
      ...input,
      shared_link: input.shared_link ?? false,
    });

    return this.findAccountTemplateOrFail(user, response.id);
  }

  async createBackingTemplateFromDocx(
    user: User,
    input: CreateTemplateFromDocxDto,
  ): Promise<Template> {
    const response = await this.createTemplateFromDocx(user, {
      ...input,
      shared_link: input.shared_link ?? false,
    });

    return this.findAccountTemplateOrFail(user, response.id);
  }

  async createTemplateFromPdf(
    user: User,
    input: CreateTemplateFromPdfDto,
    multipartFiles?: Record<string, UploadedBufferFile[]>,
  ): Promise<TemplateResponseDto> {
    const documents = await this.resolvePdfDocuments(input, multipartFiles);

    return this.createTemplateFromResolvedDocuments(user, input, documents);
  }

  async createTemplateFromHtml(
    user: User,
    input: CreateTemplateFromHtmlDto,
  ): Promise<TemplateResponseDto> {
    const documents = await this.resolveHtmlDocuments(input);

    return this.createTemplateFromResolvedDocuments(user, input, documents);
  }

  async createTemplateFromDocx(
    user: User,
    input: CreateTemplateFromDocxDto,
    multipartFiles?: Record<string, UploadedBufferFile[]>,
  ): Promise<TemplateResponseDto> {
    const documents = await this.resolveDocxDocuments(input, multipartFiles);

    return this.createTemplateFromResolvedDocuments(user, input, documents);
  }

  private async createTemplateFromResolvedDocuments(
    user: User,
    input: Pick<
      CreateTemplateFromPdfDto,
      'external_id' | 'folder_name' | 'name' | 'shared_link'
    >,
    documents: ResolvedPdfDocument[],
  ): Promise<TemplateResponseDto> {
    const folder = await this.findOrCreateFolder(
      user,
      input.folder_name ?? TemplateFolder.DEFAULT_NAME,
    );
    const existingTemplate = input.external_id
      ? await this.templates.findOne({
          where: {
            accountId: user.accountId,
            externalId: input.external_id,
          },
          relations: {
            author: true,
            folder: {
              parentFolder: true,
            },
          },
        })
      : null;
    const template =
      existingTemplate ??
      this.templates.create({
        accountId: user.accountId,
        authorId: user.id,
        folderId: folder.id,
        fields: [],
        name: input.name ?? getBaseName(documents[0].filename),
        preferences: {},
        schema: [],
        sharedLink: input.shared_link ?? true,
        source: 'api',
        submitters: this.buildSubmitters(documents),
        variablesSchema: null,
      });

    template.folder = folder;
    template.folderId = folder.id;
    template.name = input.name ?? template.name;
    template.externalId = input.external_id ?? template.externalId;
    template.sharedLink = input.shared_link ?? template.sharedLink;
    template.source = 'api';
    template.submitters = this.mergeSubmitters(template.submitters, documents);

    const savedTemplate = await this.templates.save(template);
    const documentAttachments = await this.replaceTemplateDocuments(
      savedTemplate,
      documents,
      false,
    );
    savedTemplate.schema = documentAttachments.map(
      ({ attachment, document }) => ({
        attachment_uuid: attachment.uuid,
        name: getBaseName(document.filename),
        ...(document.dynamicSource ? { dynamic: true } : {}),
        ...(document.pendingFields ? { pending_fields: true } : {}),
      }),
    );
    savedTemplate.fields = this.normalizeDocumentFields(
      documents,
      documentAttachments,
      savedTemplate.submitters,
    );

    try {
      const saved = await this.templates.save(savedTemplate);
      await this.recordTemplateActivity({
        data: { source: saved.source },
        eventType: 'template.created',
        summary: 'Template created',
        template: saved,
        user,
      });
      this.events.emit(runtimeEvents.templateCreated, {
        accountId: saved.accountId,
        templateId: saved.id,
      });
      return this.toTemplateResponse(
        await this.findAccountTemplateOrFail(user, saved.id),
      );
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async cloneTemplate(
    user: User,
    templateId: string,
    input: CloneTemplateDto,
  ): Promise<TemplateResponseDto> {
    const originalTemplate = await this.findAccountTemplateOrFail(
      user,
      templateId,
    );
    const folder = input.folder_name
      ? await this.findOrCreateFolder(user, input.folder_name)
      : originalTemplate.folder;
    const clonedJson = this.cloneTemplateJson(originalTemplate);
    const clonedName = input.name?.trim() || `${originalTemplate.name} (Clone)`;
    const clonedPreferences = input.team_id
      ? {
          ...clonedJson.preferences,
          team_id: input.team_id,
        }
      : clonedJson.preferences;
    const clone = this.templates.create({
      accountId: user.accountId,
      authorId: user.id,
      externalId: input.external_id ?? input.application_key ?? null,
      fields: clonedJson.fields,
      folderId: folder.id,
      name: clonedName,
      preferences: clonedPreferences,
      schema: clonedJson.schema,
      sharedLink: originalTemplate.sharedLink,
      source: 'api',
      submitters: clonedJson.submitters,
      variablesSchema: deepClone(originalTemplate.variablesSchema),
    });

    clone.folder = folder;
    clone.author = user;

    if (
      input.name?.trim() &&
      clone.schema.length === 1 &&
      originalTemplate.schema[0]?.name === originalTemplate.name &&
      clonedName !== `${originalTemplate.name} (Clone)`
    ) {
      clone.schema[0] = {
        ...clone.schema[0],
        name: clonedName,
      };
    }

    try {
      const savedClone = await this.templates.save(clone);
      await this.cloneTemplateAttachments(originalTemplate, savedClone);
      await this.recordTemplateActivity({
        data: {
          source_template_id: originalTemplate.id,
          source_template_name: originalTemplate.name,
        },
        eventType: 'template.cloned',
        summary: `Template cloned from ${originalTemplate.name}`,
        template: savedClone,
        user,
      });
      this.events.emit(runtimeEvents.templateCreated, {
        accountId: savedClone.accountId,
        templateId: savedClone.id,
      });
      return this.toTemplateResponse(
        await this.findAccountTemplateOrFail(user, savedClone.id),
      );
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async mergeTemplates(
    user: User,
    input: MergeTemplatesDto,
  ): Promise<TemplateResponseDto> {
    const templateIds = normalizeIdList(input.template_ids);

    if (templateIds.length < 2) {
      throw new UnprocessableEntityException({
        error: 'At least 2 templates are required',
      });
    }

    const sourceTemplates = await Promise.all(
      templateIds.map((id) => this.findAccountTemplateOrFail(user, id)),
    );
    const folder = input.folder_name
      ? await this.findOrCreateFolder(user, input.folder_name)
      : sourceTemplates[0].folder;
    const mergedJson = this.mergeTemplateJson(sourceTemplates, input.roles);
    const mergedTemplate = this.templates.create({
      accountId: user.accountId,
      authorId: user.id,
      externalId: input.external_id ?? null,
      fields: mergedJson.fields,
      folderId: folder.id,
      name: input.name?.trim() || `${sourceTemplates[0].name} (Merged)`,
      preferences: deepClone(sourceTemplates[0].preferences),
      schema: mergedJson.schema,
      sharedLink: input.shared_link ?? true,
      source: 'api',
      submitters: mergedJson.submitters,
      variablesSchema: deepClone(sourceTemplates[0].variablesSchema),
    });

    mergedTemplate.folder = folder;
    mergedTemplate.author = user;

    try {
      const saved = await this.templates.save(mergedTemplate);

      for (const source of mergedJson.sources) {
        await this.cloneTemplateAttachments(
          source.template,
          saved,
          source.schema,
        );
      }

      await this.recordTemplateActivity({
        data: {
          source_template_ids: sourceTemplates.map((template) => template.id),
          source_template_names: sourceTemplates.map(
            (template) => template.name,
          ),
        },
        eventType: 'template.created',
        summary: 'Template created by merging templates',
        template: saved,
        user,
      });
      this.events.emit(runtimeEvents.templateCreated, {
        accountId: saved.accountId,
        templateId: saved.id,
      });

      return this.toTemplateResponse(
        await this.findAccountTemplateOrFail(user, saved.id),
      );
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async updateTemplate(
    user: User,
    templateId: string,
    input: UpdateTemplateDto,
  ): Promise<TemplateUpdateResponseDto> {
    const body = this.normalizeUpdateBody(input);
    const template = await this.findAccountTemplateOrFail(user, templateId, {
      withDeleted: body.archived === false,
    });
    const before = this.buildTemplateSnapshot(template);

    if (body.folder_name) {
      template.folder = await this.findOrCreateFolder(user, body.folder_name);
      template.folderId = template.folder.id;
    }

    if (body.roles?.length) {
      template.submitters = this.applyRoles(template.submitters, body.roles);
    }

    if (typeof body.archived === 'boolean') {
      template.archivedAt = body.archived ? new Date() : null;
    }

    if (body.name !== undefined) {
      template.name = body.name;
    }

    if (body.external_id !== undefined) {
      template.externalId = body.external_id;
    }

    if (body.shared_link !== undefined) {
      template.sharedLink = body.shared_link;
    }

    if (body.submitters !== undefined) {
      template.submitters = body.submitters;
    }

    if (body.fields !== undefined) {
      template.fields = body.fields;
    }

    if (body.schema !== undefined) {
      template.schema = body.schema;
    }

    if (body.preferences !== undefined) {
      template.preferences = mergeTemplatePreferences(
        template.preferences,
        body.preferences,
      );
    }

    try {
      const saved = await this.templates.save(template);
      const changedPaths = getChangedTemplatePaths(
        before,
        this.buildTemplateSnapshot(saved),
      );
      const eventType =
        body.archived === true
          ? 'template.archived'
          : body.archived === false
            ? 'template.restored'
            : changedPaths.includes('name')
              ? 'template.renamed'
              : 'template.updated';

      await this.recordTemplateActivity({
        data: { changed_paths: changedPaths },
        eventType,
        summary: summarizeTemplateChange(eventType, changedPaths),
        template: saved,
        user,
      });
      this.events.emit(runtimeEvents.templateUpdated, {
        accountId: saved.accountId,
        templateId: saved.id,
      });

      if (body.archived === true) {
        this.events.emit(runtimeEvents.templateArchived, {
          accountId: saved.accountId,
          templateId: saved.id,
        });
      }

      return {
        id: saved.id,
        updated_at: saved.updatedAt,
      };
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async updateTestingSharing(
    user: User,
    templateId: string,
    enabled: boolean,
  ): Promise<TemplateResponseDto> {
    const template = await this.findAccountTemplateOrFail(user, templateId);
    const testingContext = await this.accountsService.findOrCreateTestingUser({
      accountId: user.accountId,
      userId: user.id,
    });

    if (enabled) {
      const existing = await this.templateSharings.findOne({
        where: {
          accountId: testingContext.account.id,
          templateId: template.id,
        },
      });

      if (!existing) {
        await this.templateSharings.save(
          this.templateSharings.create({
            ability: 'manage',
            accountId: testingContext.account.id,
            templateId: template.id,
          }),
        );
      }
    } else {
      await this.templateSharings.delete({
        accountId: testingContext.account.id,
        templateId: template.id,
      });
    }

    await this.recordTemplateActivity({
      data: {
        shared_with_test_mode: enabled,
        testing_account_id: testingContext.account.id,
      },
      eventType: 'template.updated',
      summary: enabled
        ? 'Template shared with Test mode'
        : 'Template unshared from Test mode',
      template,
      user,
    });

    return this.toTemplateResponse(
      await this.findAccountTemplateOrFail(user, template.id),
    );
  }

  async getTemplateDocumentDownloadUrls(
    user: User,
    templateId: string,
  ): Promise<string[]> {
    const template = await this.findAccountTemplateOrFail(user, templateId);
    const documents = await this.serializeTemplateDocuments(template);

    return documents.map((document) => document.url);
  }

  async updateTemplateDocuments(
    user: User,
    templateId: string,
    input: UpdateTemplateDocumentsDto,
    multipartFiles?: Record<string, UploadedBufferFile[]>,
  ): Promise<TemplateDocumentsUpdateResponseDto> {
    const template = await this.findAccountTemplateOrFail(user, templateId);
    const operations = await this.resolveTemplateDocumentOperations(
      input,
      multipartFiles,
    );
    const before = this.buildTemplateSnapshot(template);
    const oldFields = JSON.stringify(template.fields);
    template.submitters = this.mergeSubmitters(
      template.submitters,
      operations
        .map((operation) => operation.document)
        .filter((document): document is ResolvedPdfDocument => !!document),
    );
    const result = await this.applyTemplateDocumentOperations(
      template,
      operations,
      Boolean(input.merge),
    );

    template.schema = result.schema;
    template.fields = result.fields;

    try {
      const saved = await this.templates.save(template);
      const changed = oldFields !== JSON.stringify(saved.fields);
      await this.recordTemplateActivity({
        data: {
          changed_paths: getChangedTemplatePaths(
            before,
            this.buildTemplateSnapshot(saved),
          ),
          merge: Boolean(input.merge),
        },
        eventType: 'template.documents.updated',
        summary: 'Template documents updated',
        template: saved,
        user,
      });

      return {
        schema: result.changedSchema,
        fields: changed ? saved.fields : null,
        submitters: changed ? saved.submitters : null,
        documents: await this.serializeTemplateDocuments(saved),
      };
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async importGoogleDriveDocuments(
    user: User,
    templateId: string,
    input: ImportGoogleDriveDocumentsDto,
  ): Promise<TemplateDocumentsUpdateResponseDto> {
    const template = await this.findAccountTemplateOrFail(user, templateId);
    const documents = await Promise.all(
      input.files.map((file) =>
        this.resolveGoogleDriveDocument(input.access_token, file),
      ),
    );
    const operations = (
      await this.extractNativePdfFieldsForDocuments(documents)
    ).map((document) => ({ document }));
    const before = this.buildTemplateSnapshot(template);
    const oldFields = JSON.stringify(template.fields);

    template.submitters = this.mergeSubmitters(template.submitters, documents);
    const result = await this.applyTemplateDocumentOperations(
      template,
      operations,
      input.merge ?? true,
    );

    template.schema = result.schema;
    template.fields = result.fields;

    try {
      const saved = await this.templates.save(template);
      const changed = oldFields !== JSON.stringify(saved.fields);

      await this.recordTemplateActivity({
        data: {
          changed_paths: getChangedTemplatePaths(
            before,
            this.buildTemplateSnapshot(saved),
          ),
          google_drive_file_ids: input.files.map((file) => file.id),
          merge: input.merge ?? true,
        },
        eventType: 'template.documents.updated',
        summary: 'Template documents imported from Google Drive',
        template: saved,
        user,
      });

      return {
        schema: result.changedSchema,
        fields: changed ? saved.fields : null,
        submitters: changed ? saved.submitters : null,
        documents: await this.serializeTemplateDocuments(saved),
      };
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async deleteTemplate(
    user: User,
    templateId: string,
    query: DeleteTemplateQueryDto,
  ): Promise<TemplateDeleteResponseDto> {
    const template = await this.findAccountTemplateOrFail(user, templateId, {
      withDeleted: query.permanently === true,
    });

    if (query.permanently) {
      try {
        await this.templates.remove(template);
        return {
          id: template.id,
          archived_at: template.archivedAt,
        };
      } catch (error) {
        throwDatabaseErrors(error);
      }
    }

    template.archivedAt = new Date();

    try {
      const saved = await this.templates.save(template);
      await this.recordTemplateActivity({
        data: { permanently: false },
        eventType: 'template.archived',
        summary: 'Template archived',
        template: saved,
        user,
        saveVersion: false,
      });
      this.events.emit(runtimeEvents.templateArchived, {
        accountId: saved.accountId,
        templateId: saved.id,
      });
      return {
        id: saved.id,
        archived_at: saved.archivedAt,
      };
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  private async replaceTemplateDocuments(
    template: Template,
    documents: ResolvedPdfDocument[],
    merge: boolean,
  ): Promise<DocumentAttachment[]> {
    if (!merge) {
      await this.storageService.deleteRecordAttachments({
        recordType: 'Template',
        recordId: template.id,
        name: 'documents',
      });
      await this.dynamicDocuments.delete({ templateId: template.id });
    }

    return Promise.all(
      documents.map(async (document) => {
        const attachment = await this.storageService.createPdfAttachment({
          buffer: document.buffer,
          filename: document.filename,
          name: 'documents',
          recordType: 'Template',
          recordId: template.id,
          metadata: {
            identified: true,
            analyzed: true,
            ...(document.dynamicSource
              ? {
                  dynamic: true,
                  dynamic_source_type: document.dynamicSource.type,
                }
              : {}),
          },
        });

        if (document.dynamicSource) {
          await this.createDynamicDocumentVersion(
            template,
            attachment.uuid,
            document,
          );
        }

        return {
          attachment,
          document,
        };
      }),
    );
  }

  private async applyTemplateDocumentOperations(
    template: Template,
    operations: TemplateDocumentOperation[],
    mergeDocuments: boolean,
  ): Promise<{
    changedSchema: Template['schema'];
    fields: TemplateField[];
    schema: Template['schema'];
  }> {
    if (mergeDocuments) {
      return this.appendTemplateDocuments(template, operations);
    }

    const schema = deepClone(template.schema);
    let fields = deepClone(template.fields);
    const changedSchema: Template['schema'] = [];

    for (const operation of operations) {
      if (operation.remove) {
        const index = this.findDocumentOperationIndex(schema, operation);
        if (index === -1) {
          throw new UnprocessableEntityException({
            error: 'Document not found',
          });
        }

        const [removed] = schema.splice(index, 1);
        fields = this.removeDocumentFieldAreas(
          fields,
          removed?.attachment_uuid,
        );
        continue;
      }

      if (!operation.document) {
        throw new UnprocessableEntityException({ error: 'File is missing' });
      }

      const [documentAttachment] = await this.replaceTemplateDocuments(
        template,
        [operation.document],
        true,
      );
      const nextSchema = this.buildSchemaItem(documentAttachment);
      const nextFields = this.normalizeDocumentFields(
        [operation.document],
        [documentAttachment],
        template.submitters,
      );
      const index = this.findDocumentOperationIndex(schema, operation);

      changedSchema.push(nextSchema);

      if (operation.replace) {
        if (index === -1) {
          throw new UnprocessableEntityException({
            error: 'Document not found',
          });
        }

        const previousAttachmentUuid = schema[index]?.attachment_uuid;
        schema[index] = nextSchema;
        fields = this.rewriteOrReplaceDocumentFields(
          fields,
          previousAttachmentUuid,
          nextSchema.attachment_uuid,
          nextFields,
        );
        continue;
      }

      const insertAt = clampInsertIndex(operation.position, schema.length);
      schema.splice(insertAt, 0, nextSchema);
      fields.push(...nextFields);
    }

    return { changedSchema, fields, schema };
  }

  private async appendTemplateDocuments(
    template: Template,
    operations: TemplateDocumentOperation[],
  ): Promise<{
    changedSchema: Template['schema'];
    fields: TemplateField[];
    schema: Template['schema'];
  }> {
    const documents = operations
      .map((operation) => operation.document)
      .filter((document): document is ResolvedPdfDocument => !!document);

    if (!documents.length) {
      throw new UnprocessableEntityException({ error: 'File is missing' });
    }

    const documentAttachments = await this.replaceTemplateDocuments(
      template,
      documents,
      true,
    );
    const changedSchema = documentAttachments.map((item) =>
      this.buildSchemaItem(item),
    );
    const newFields = this.normalizeDocumentFields(
      documents,
      documentAttachments,
      template.submitters,
    );

    return {
      changedSchema,
      fields: [...template.fields, ...newFields],
      schema: [...template.schema, ...changedSchema],
    };
  }

  private buildSchemaItem({
    attachment,
    document,
  }: DocumentAttachment): Template['schema'][number] {
    return {
      attachment_uuid: attachment.uuid,
      name: getBaseName(document.filename),
      ...(document.dynamicSource ? { dynamic: true } : {}),
      ...(document.pendingFields ? { pending_fields: true } : {}),
    };
  }

  private findDocumentOperationIndex(
    schema: Template['schema'],
    operation: TemplateDocumentOperation,
  ): number {
    if (typeof operation.position === 'number') {
      return operation.position >= 0 && operation.position < schema.length
        ? operation.position
        : -1;
    }

    if (operation.name) {
      const normalizedName = getBaseName(operation.name);

      return schema.findIndex((item) => item.name === normalizedName);
    }

    return -1;
  }

  private rewriteOrReplaceDocumentFields(
    fields: TemplateField[],
    previousAttachmentUuid: string | undefined,
    nextAttachmentUuid: string | undefined,
    fallbackFields: TemplateField[],
  ): TemplateField[] {
    if (!previousAttachmentUuid || !nextAttachmentUuid) {
      return [...fields, ...fallbackFields];
    }

    const previousFields = fields.filter((field) =>
      (field.areas ?? []).some(
        (area) => area.attachment_uuid === previousAttachmentUuid,
      ),
    );

    if (!previousFields.length) {
      return [
        ...fields.filter((field) =>
          (field.areas ?? []).every(
            (area) => area.attachment_uuid !== previousAttachmentUuid,
          ),
        ),
        ...fallbackFields,
      ];
    }

    return fields.map((field) => {
      const areas = field.areas;
      if (
        !areas?.some((area) => area.attachment_uuid === previousAttachmentUuid)
      ) {
        return field;
      }
      return {
        ...field,
        areas: areas.map((area) =>
          area.attachment_uuid === previousAttachmentUuid
            ? { ...area, attachment_uuid: nextAttachmentUuid }
            : area,
        ),
      };
    });
  }

  private removeDocumentFieldAreas(
    fields: TemplateField[],
    attachmentUuid: string | undefined,
  ): TemplateField[] {
    if (!attachmentUuid) return fields;
    return fields.flatMap((field) => {
      const remaining = field.areas?.filter(
        (area) => area.attachment_uuid !== attachmentUuid,
      );
      if (remaining?.length === field.areas?.length) return [field];
      return remaining?.length ? [{ ...field, areas: remaining }] : [];
    });
  }

  private async createDynamicDocumentVersion(
    template: Template,
    uuid: string,
    document: ResolvedPdfDocument,
  ): Promise<void> {
    if (!document.dynamicSource) {
      return;
    }

    const dynamicDocument = await this.dynamicDocuments.save(
      this.dynamicDocuments.create({
        body: document.dynamicSource.body,
        head: document.dynamicSource.head,
        templateId: template.id,
        uuid,
      }),
    );

    await this.dynamicDocumentVersions.save(
      this.dynamicDocumentVersions.create({
        areas: document.fields.flatMap((field) => field.areas ?? []),
        dynamicDocumentId: dynamicDocument.id,
        sha1: dynamicDocument.sha1,
      }),
    );
  }

  private async cloneTemplateAttachments(
    originalTemplate: Template,
    clonedTemplate: Template,
    clonedSchema = clonedTemplate.schema,
  ): Promise<void> {
    const originalAttachments = await this.storageService.findRecordAttachments(
      {
        recordType: 'Template',
        recordId: originalTemplate.id,
        name: 'documents',
      },
    );
    const originalAttachmentsByUuid = new Map(
      originalAttachments.map((attachment) => [attachment.uuid, attachment]),
    );

    for (const [
      index,
      originalSchemaItem,
    ] of originalTemplate.schema.entries()) {
      const originalAttachmentUuid = originalSchemaItem.attachment_uuid;
      const clonedAttachmentUuid = clonedSchema[index]?.attachment_uuid;

      if (!originalAttachmentUuid || !clonedAttachmentUuid) {
        continue;
      }

      const originalAttachment = originalAttachmentsByUuid.get(
        originalAttachmentUuid,
      );

      if (!originalAttachment) {
        continue;
      }

      const clonedAttachment = await this.storageService.cloneAttachment({
        sourceAttachment: originalAttachment,
        name: 'documents',
        recordType: 'Template',
        recordId: clonedTemplate.id,
        uuid: clonedAttachmentUuid,
      });
      const previews = await this.storageService.findPreviewAttachments(
        originalAttachment.id,
      );

      for (const preview of previews) {
        await this.storageService.cloneAttachment({
          sourceAttachment: preview,
          name: 'preview_images',
          recordType: 'ActiveStorage::Attachment',
          recordId: clonedAttachment.id,
        });
      }
    }
  }

  private async resolvePdfDocuments(
    input: Pick<CreateTemplateFromPdfDto, 'documents' | 'remove_tags'>,
    multipartFiles?: Record<string, UploadedBufferFile[]>,
  ): Promise<ResolvedPdfDocument[]> {
    const multipartDocuments = [
      ...(multipartFiles?.documents ?? []),
      ...(multipartFiles?.files ?? []),
      ...(multipartFiles?.file ?? []),
    ].map((file): ResolvedPdfDocument => {
      this.assertPdf(file.buffer, file.originalname, file.mimetype);
      return {
        filename: ensurePdfFilename(file.originalname),
        buffer: file.buffer,
        fields: [],
        pendingFields: false,
      };
    });

    if (multipartDocuments.length) {
      return this.extractPdfFieldsForDocuments(
        multipartDocuments,
        input.remove_tags ?? false,
      );
    }

    const documents = input.documents ?? [];

    if (!documents.length) {
      throw new UnprocessableEntityException({ error: 'File is missing' });
    }

    const resolvedDocuments = await Promise.all(
      documents.map(async (document) => {
        const buffer = await this.resolveDocumentFile(document);
        this.assertPdf(buffer, document.name, 'application/pdf');

        return {
          filename: ensurePdfFilename(document.name),
          buffer,
          fields: document.fields ?? [],
          pendingFields: false,
        };
      }),
    );

    return this.extractPdfFieldsForDocuments(
      resolvedDocuments,
      input.remove_tags ?? false,
    );
  }

  private async resolveTemplateDocumentOperations(
    input: UpdateTemplateDocumentsDto,
    multipartFiles?: Record<string, UploadedBufferFile[]>,
  ): Promise<TemplateDocumentOperation[]> {
    const multipartFilesList = [
      ...(multipartFiles?.documents ?? []),
      ...(multipartFiles?.files ?? []),
      ...(multipartFiles?.file ?? []),
    ];

    if (multipartFilesList.length) {
      const documents = await Promise.all(
        multipartFilesList.map((file) =>
          this.resolveUploadedTemplateDocument(file),
        ),
      );

      return (await this.extractNativePdfFieldsForDocuments(documents)).map(
        (document) => ({ document }),
      );
    }

    const documents = input.documents ?? [];

    if (!documents.length) {
      throw new UnprocessableEntityException({ error: 'File is missing' });
    }

    const operations = await Promise.all(
      documents.map(async (document) => {
        if (document.remove) {
          return {
            name: document.name,
            position: document.position,
            remove: true,
          } satisfies TemplateDocumentOperation;
        }

        if (document.type === 'blank') {
          return {
            document: await this.resolveBlankDocument({
              name: document.name,
              size: document.size,
            }),
            name: document.name,
            position: document.position,
            replace: document.replace,
          } satisfies TemplateDocumentOperation;
        }

        if (document.html) {
          return {
            document: await this.resolveHtmlUpdateDocument(document),
            name: document.name,
            position: document.position,
            replace: document.replace,
          } satisfies TemplateDocumentOperation;
        }

        const file = document.file;
        const name = document.name;

        if (!file || !name) {
          throw new UnprocessableEntityException({ error: 'File is missing' });
        }

        const buffer = await this.resolveDocumentFile({ file, name });

        if (isDocxFilename(name)) {
          return {
            document: await this.resolveDocxBufferDocument({
              buffer,
              fields: document.fields ?? [],
              name,
            }),
            name,
            position: document.position,
            replace: document.replace,
          } satisfies TemplateDocumentOperation;
        }

        this.assertPdf(buffer, name, 'application/pdf');

        return {
          document: {
            buffer,
            fields: document.fields ?? [],
            filename: ensurePdfFilename(name),
            pendingFields: false,
          },
          name,
          position: document.position,
          replace: document.replace,
        } satisfies TemplateDocumentOperation;
      }),
    );

    const documentsToExtract = operations
      .map((operation) => operation.document)
      .filter((document): document is ResolvedPdfDocument => !!document);
    const extractedDocuments =
      await this.extractNativePdfFieldsForDocuments(documentsToExtract);
    let documentIndex = 0;

    return operations.map((operation) => {
      if (!operation.document) {
        return operation;
      }

      return {
        ...operation,
        document: extractedDocuments[documentIndex++],
      };
    });
  }

  private async resolveHtmlUpdateDocument(document: {
    fields?: TemplateField[];
    html?: string;
    html_footer?: string;
    html_header?: string;
    name?: string;
    size?: string;
  }): Promise<ResolvedPdfDocument> {
    const rendered = await this.documentConversionService.renderHtmlDocument({
      html: document.html ?? '',
      htmlFooter: document.html_footer,
      htmlHeader: document.html_header,
      name: document.name ?? `document-${Date.now()}`,
      size: document.size,
    });

    return {
      buffer: rendered.buffer,
      dynamicSource: {
        body: rendered.body,
        head: rendered.head,
        type: 'html',
      },
      fields: [...rendered.fields, ...(document.fields ?? [])],
      filename: rendered.filename,
      pendingFields: false,
    };
  }

  private async resolveBlankDocument(input: {
    name?: string;
    size?: string;
  }): Promise<ResolvedPdfDocument> {
    const pageSize = getBlankPageSize(input.size);
    const document = await PDFDocument.create();

    document.addPage([pageSize.width, pageSize.height]);

    return {
      buffer: Buffer.from(await document.save()),
      fields: [],
      filename: ensurePdfFilename(input.name?.trim() || 'Blank Page'),
      pendingFields: false,
    };
  }

  private async resolveUploadedTemplateDocument(
    file: UploadedBufferFile,
  ): Promise<ResolvedPdfDocument> {
    if (isDocxFilename(file.originalname)) {
      return this.resolveDocxBufferDocument({
        buffer: file.buffer,
        fields: [],
        name: file.originalname,
      });
    }

    this.assertPdf(file.buffer, file.originalname, file.mimetype);

    return {
      buffer: file.buffer,
      fields: [],
      filename: ensurePdfFilename(file.originalname),
      pendingFields: false,
    };
  }

  private async resolveGoogleDriveDocument(
    accessToken: string,
    file: { id: string; mime_type?: string; name?: string },
  ): Promise<ResolvedPdfDocument> {
    const metadata = await this.fetchGoogleDriveFileMetadata(
      accessToken,
      file.id,
    );
    const name = file.name || metadata.name || 'Google Drive document';
    const mimeType = file.mime_type || metadata.mimeType || '';
    const isWorkspaceDocument = mimeType.startsWith(
      'application/vnd.google-apps.',
    );
    const downloaded = isWorkspaceDocument
      ? await this.exportGoogleDriveFile(accessToken, file.id)
      : await this.downloadGoogleDriveFile(accessToken, file.id);
    const contentType = downloaded.contentType || mimeType;

    if (isImageMimeType(contentType)) {
      return this.resolveImageBufferDocument(
        downloaded.buffer,
        downloaded.filename || name,
      );
    }

    const filename = ensurePdfFilename(
      isWorkspaceDocument ? name : downloaded.filename || name,
    );

    this.assertPdf(downloaded.buffer, filename, downloaded.contentType);

    return {
      buffer: downloaded.buffer,
      fields: [],
      filename,
      pendingFields: false,
    };
  }

  private async fetchGoogleDriveFileMetadata(
    accessToken: string,
    fileId: string,
  ): Promise<{ mimeType?: string; name?: string }> {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId,
      )}?fields=id,name,mimeType`,
      { headers: this.getGoogleDriveHeaders(accessToken) },
    );

    if (!response.ok) {
      throw new UnprocessableEntityException({
        error: 'Unable to read Google Drive file metadata',
      });
    }

    return (await response.json()) as { mimeType?: string; name?: string };
  }

  private async downloadGoogleDriveFile(
    accessToken: string,
    fileId: string,
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId,
      )}?alt=media`,
      { headers: this.getGoogleDriveHeaders(accessToken) },
    );

    if (!response.ok) {
      throw new UnprocessableEntityException({
        error: 'Unable to download Google Drive file',
      });
    }

    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/pdf',
      filename: parseContentDispositionFilename(
        response.headers.get('content-disposition'),
      ),
    };
  }

  private async exportGoogleDriveFile(
    accessToken: string,
    fileId: string,
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId,
      )}/export?mimeType=application/pdf`,
      { headers: this.getGoogleDriveHeaders(accessToken) },
    );

    if (!response.ok) {
      throw new UnprocessableEntityException({
        error: 'Unable to export Google Drive file as PDF',
      });
    }

    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: 'application/pdf',
      filename: parseContentDispositionFilename(
        response.headers.get('content-disposition'),
      ),
    };
  }

  private getGoogleDriveHeaders(accessToken: string): HeadersInit {
    return { Authorization: `Bearer ${accessToken}` };
  }

  private async resolveImageBufferDocument(
    buffer: Buffer,
    filename: string,
  ): Promise<ResolvedPdfDocument> {
    const png = await sharp(buffer, { animated: false, failOn: 'none' })
      .rotate()
      .png()
      .toBuffer();
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(png);
    const page = pdf.addPage([image.width, image.height]);

    page.drawImage(image, {
      height: image.height,
      width: image.width,
      x: 0,
      y: 0,
    });

    return {
      buffer: Buffer.from(await pdf.save()),
      fields: [],
      filename: ensurePdfFilename(getBaseName(filename)),
      pendingFields: false,
    };
  }

  private async resolveHtmlDocuments(
    input: CreateTemplateFromHtmlDto,
  ): Promise<ResolvedPdfDocument[]> {
    const documents = input.documents?.length
      ? input.documents
      : input.html
        ? [
            {
              html: input.html,
              html_footer: input.html_footer,
              html_header: input.html_header,
              name: input.name,
              size: input.size,
            },
          ]
        : [];

    if (!documents.length) {
      throw new UnprocessableEntityException({ error: 'HTML is missing' });
    }

    return Promise.all(
      documents.map(async (document, index) => {
        const rendered =
          await this.documentConversionService.renderHtmlDocument({
            html: document.html,
            htmlFooter: document.html_footer ?? input.html_footer,
            htmlHeader: document.html_header ?? input.html_header,
            name: document.name ?? input.name ?? `document-${index + 1}`,
            size: document.size ?? input.size,
          });

        return {
          buffer: rendered.buffer,
          dynamicSource: {
            body: rendered.body,
            head: rendered.head,
            type: 'html',
          },
          fields: rendered.fields,
          filename: rendered.filename,
          pendingFields: false,
        };
      }),
    );
  }

  private async resolveDocxDocuments(
    input: CreateTemplateFromDocxDto,
    multipartFiles?: Record<string, UploadedBufferFile[]>,
  ): Promise<ResolvedPdfDocument[]> {
    const multipartDocuments = [
      ...(multipartFiles?.documents ?? []),
      ...(multipartFiles?.files ?? []),
      ...(multipartFiles?.file ?? []),
    ];

    if (multipartDocuments.length) {
      return Promise.all(
        multipartDocuments.map((file) =>
          this.resolveDocxBufferDocument({
            buffer: file.buffer,
            fields: [],
            name: file.originalname,
            variables: input.variables,
          }),
        ),
      );
    }

    const documents = input.documents ?? [];

    if (!documents.length) {
      throw new UnprocessableEntityException({ error: 'File is missing' });
    }

    return Promise.all(
      documents.map(async (document) => {
        const buffer = await this.resolveDocumentFile(document);
        return this.resolveDocxBufferDocument({
          buffer,
          fields: document.fields ?? [],
          name: document.name,
          variables: document.variables ?? input.variables,
        });
      }),
    );
  }

  private async resolveDocxBufferDocument(input: {
    buffer: Buffer;
    fields: TemplateField[];
    name: string;
    variables?: Record<string, unknown>;
  }): Promise<ResolvedPdfDocument> {
    this.assertDocx(input.buffer, input.name);
    const sourceBuffer = this.docxVariableService.expandVariables(
      input.buffer,
      input.variables,
    );
    const prepared = this.docxFieldTagService.prepareDocument(sourceBuffer);
    const pdfBuffer = await this.documentConversionService.convertDocxToPdf({
      buffer: prepared.buffer,
      name: input.name,
    });
    const extractedFields = await this.docxFieldTagService.extractMarkerFields({
      markers: prepared.markers,
      pdf: pdfBuffer,
    });

    return {
      buffer: pdfBuffer,
      dynamicSource: {
        body: sourceBuffer.toString('base64'),
        head: `docx:${input.name}:${this.documentConversionService.hashSource(sourceBuffer)}`,
        type: 'docx',
      },
      fields: [...extractedFields, ...input.fields],
      filename: ensurePdfFilename(getBaseName(input.name)),
      pendingFields: false,
    };
  }

  private async extractPdfFieldsForDocuments(
    documents: ResolvedPdfDocument[],
    removeTags: boolean,
  ): Promise<ResolvedPdfDocument[]> {
    const acroDocuments =
      await this.extractNativePdfFieldsForDocuments(documents);

    return Promise.all(
      acroDocuments.map(async (document) => {
        const tagged = await this.pdfTextTagService.extractAndMaybeRemoveTags({
          pdf: document.buffer,
          removeTags,
        });

        return {
          ...document,
          buffer: tagged.pdf,
          fields: [...document.fields, ...tagged.fields],
          pendingFields: document.pendingFields || tagged.fields.length > 0,
        };
      }),
    );
  }

  private async extractNativePdfFieldsForDocuments(
    documents: ResolvedPdfDocument[],
  ): Promise<ResolvedPdfDocument[]> {
    return Promise.all(
      documents.map(async (document) => {
        if (document.fields.length) {
          return document;
        }

        const acroFields = await this.pdfAcroFormService.extractFields(
          document.buffer,
          '',
        );
        const extractedFields = acroFields.length
          ? acroFields
          : await this.pdfXfaFormService.extractFields(document.buffer, '');

        return {
          ...document,
          fields: extractedFields,
          pendingFields: extractedFields.length > 0,
        };
      }),
    );
  }

  private async resolveDocumentFile(document: {
    file: string;
    name: string;
  }): Promise<Buffer> {
    if (isUrl(document.file)) {
      const maxBytes = 50 * 1024 * 1024;
      const stored = await this.storageService.readSignedBlobUrl(
        document.file,
        maxBytes,
      );
      if (stored) return stored.buffer;
      const response = await downloadPublicDocument(document.file, maxBytes);

      return Buffer.from(await response.arrayBuffer());
    }

    return Buffer.from(stripDataUrlPrefix(document.file), 'base64');
  }

  private assertPdf(
    buffer: Buffer,
    filename: string,
    contentType?: string,
  ): void {
    const isPdf =
      contentType === 'application/pdf' ||
      filename.toLowerCase().endsWith('.pdf') ||
      buffer.subarray(0, 5).toString('utf8') === '%PDF-';

    if (!isPdf) {
      throw new UnprocessableEntityException({ error: 'Invalid file type' });
    }
  }

  private assertDocx(buffer: Buffer, filename: string): void {
    const lowerName = filename.toLowerCase();
    const isZipContainer = buffer.subarray(0, 2).toString('utf8') === 'PK';

    if (!lowerName.endsWith('.docx') || !isZipContainer) {
      throw new UnprocessableEntityException({ error: 'Invalid file type' });
    }
  }

  private buildSubmitters(
    documents: ResolvedPdfDocument[],
  ): TemplateSubmitter[] {
    const roles = this.extractDocumentRoles(documents);

    if (!roles.length) {
      return [{ name: 'First Party', uuid: randomUUID() }];
    }

    return roles.map((role) => ({ name: role, uuid: randomUUID() }));
  }

  private mergeSubmitters(
    existingSubmitters: TemplateSubmitter[],
    documents: ResolvedPdfDocument[],
  ): TemplateSubmitter[] {
    const submitters = existingSubmitters.length
      ? [...existingSubmitters]
      : [{ name: 'First Party', uuid: randomUUID() }];

    for (const role of this.extractDocumentRoles(documents)) {
      if (!submitters.some((submitter) => submitter.name === role)) {
        submitters.push({ name: role, uuid: randomUUID() });
      }
    }

    return submitters;
  }

  private extractDocumentRoles(documents: ResolvedPdfDocument[]): string[] {
    return Array.from(
      new Set(
        documents
          .flatMap((document) => document.fields)
          .map((field) => (typeof field.role === 'string' ? field.role : null))
          .filter((role): role is string => !!role),
      ),
    );
  }

  private normalizeDocumentFields(
    documents: ResolvedPdfDocument[],
    attachments: DocumentAttachment[],
    submitters: TemplateSubmitter[],
  ): TemplateField[] {
    return attachments.flatMap(({ attachment, document }) =>
      document.fields.map((field) => {
        const role = typeof field.role === 'string' ? field.role : undefined;
        const submitter =
          submitters.find((item) => item.name === role) ?? submitters[0];

        return {
          ...field,
          uuid: field.uuid ?? randomUUID(),
          submitter_uuid: field.submitter_uuid ?? submitter.uuid,
          required: field.required ?? false,
          preferences: field.preferences ?? {},
          areas: (field.areas ?? []).map((area) => ({
            ...area,
            page:
              typeof area.page === 'number' && area.page > 0
                ? area.page - 1
                : area.page,
            attachment_uuid: attachment.uuid,
          })),
        };
      }),
    );
  }

  private applyFilters(
    builder: SelectQueryBuilder<Template>,
    query: ListTemplatesQueryDto,
  ): void {
    if (query.archived) {
      builder.andWhere('template.archivedAt IS NOT NULL');
    } else {
      builder.andWhere('template.archivedAt IS NULL');
    }

    if (query.q) {
      builder.andWhere(
        new Brackets((where) => {
          where
            .where('template.name ILIKE :q', { q: `%${query.q}%` })
            .orWhere('template.external_id ILIKE :q', { q: `%${query.q}%` });
        }),
      );
    }

    if (query.slug) {
      builder.andWhere('template.slug = :slug', { slug: query.slug });
    }

    const externalId = query.external_id ?? query.application_key;
    if (externalId) {
      builder.andWhere('template.external_id = :externalId', { externalId });
    }

    if (query.after) {
      builder.andWhere('template.id < :after', { after: query.after });
    }

    if (query.before) {
      builder.andWhere('template.id >= :before', {
        before: String(Number(query.before) + 1),
      });
    }
  }

  private async applyFolderFilter(
    builder: SelectQueryBuilder<Template>,
    accountId: string,
    folderName?: string,
  ): Promise<void> {
    if (!folderName) {
      return;
    }

    const folder = await this.findFolderByFullName(accountId, folderName);

    if (!folder) {
      builder.andWhere('1 = 0');
      return;
    }

    builder.andWhere('template.folder_id = :folderId', {
      folderId: folder.id,
    });
  }

  private async findAccountTemplateOrFail(
    user: User,
    templateId: string,
    options: { withDeleted?: boolean } = {},
  ): Promise<Template> {
    const template = await this.templates.findOne({
      withDeleted: options.withDeleted,
      where: {
        id: templateId,
        accountId: user.accountId,
      },
      relations: {
        author: true,
        folder: {
          parentFolder: true,
        },
      },
    });

    if (template) {
      return template;
    }

    const accountContext = await this.accountsService.getTestingAccountContext(
      user.accountId,
    );

    if (accountContext.isTestMode) {
      const sharedTemplate = await this.templates
        .createQueryBuilder('template')
        .leftJoinAndSelect('template.author', 'author')
        .leftJoinAndSelect('template.folder', 'folder')
        .leftJoinAndSelect('folder.parentFolder', 'parentFolder')
        .innerJoin(
          TemplateSharing,
          'testing_sharing',
          'testing_sharing.template_id = template.id AND testing_sharing.account_id = :accountId',
          { accountId: user.accountId },
        )
        .where('template.id = :templateId', { templateId })
        .withDeleted()
        .getOne();

      if (
        sharedTemplate &&
        (options.withDeleted || !sharedTemplate.archivedAt)
      ) {
        return sharedTemplate;
      }

      if (accountContext.productionAccountId) {
        const productionTemplate = await this.templates.findOne({
          where: {
            accountId: accountContext.productionAccountId,
            id: templateId,
          },
          withDeleted: options.withDeleted,
        });

        if (productionTemplate) {
          throw new NotFoundException({
            error:
              'Template not found using testing API key; Use production API key to access production data.',
          });
        }
      }
    } else if (accountContext.testingAccountId) {
      const testingTemplate = await this.templates.findOne({
        where: {
          accountId: accountContext.testingAccountId,
          id: templateId,
        },
        withDeleted: options.withDeleted,
      });

      if (testingTemplate) {
        throw new NotFoundException({
          error:
            'Template not found using production API key; Use testing API key to access test mode data.',
        });
      }
    }

    throw new NotFoundException({ error: 'Template not found' });
  }

  private async findOrCreateFolder(
    user: User,
    folderName: string,
  ): Promise<TemplateFolder> {
    const normalizedName = this.normalizeFolderPath(folderName);
    const [parentName, name] = this.splitFolderPath(normalizedName);
    const parentFolder = parentName
      ? await this.findOrCreateFolder(user, parentName)
      : null;
    const existing = await this.folders.findOne({
      where: {
        accountId: user.accountId,
        name,
        parentFolderId: parentFolder?.id ?? IsNull(),
        archivedAt: IsNull(),
      },
      relations: {
        parentFolder: {
          parentFolder: {
            parentFolder: true,
          },
        },
      },
    });

    if (existing) {
      return existing;
    }

    try {
      return await this.folders.save(
        this.folders.create({
          accountId: user.accountId,
          authorId: user.id,
          name,
          parentFolder,
          parentFolderId: parentFolder?.id ?? null,
        }),
      );
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  private async findAccountFolderOrFail(
    user: User,
    folderId: string,
  ): Promise<TemplateFolder> {
    try {
      return await this.folders.findOneOrFail({
        where: {
          accountId: user.accountId,
          id: folderId,
          archivedAt: IsNull(),
        },
        relations: {
          parentFolder: {
            parentFolder: {
              parentFolder: true,
            },
          },
        },
      });
    } catch (error) {
      throwIfNotFound(error, 'Folder not found');
    }
  }

  private async findFolderByFullNameOrFail(
    user: User,
    folderName: string,
  ): Promise<TemplateFolder> {
    const folder = await this.findFolderByFullName(user.accountId, folderName);

    if (!folder) {
      throw new NotFoundException({ error: 'Folder not found' });
    }

    return folder;
  }

  private async findFolderByFullName(
    accountId: string,
    folderName: string,
  ): Promise<TemplateFolder | null> {
    const normalizedName = this.normalizeFolderPath(folderName);
    const folders = await this.folders.find({
      where: {
        accountId,
        archivedAt: IsNull(),
      },
      relations: {
        parentFolder: {
          parentFolder: {
            parentFolder: true,
          },
        },
      },
    });

    return (
      folders.find((folder) => this.getFolderName(folder) === normalizedName) ??
      null
    );
  }

  private async toFolderResponse(
    folder: TemplateFolder,
  ): Promise<TemplateFolderResponseDto> {
    const [templatesCount, subfoldersCount] = await Promise.all([
      this.templates.count({
        where: {
          accountId: folder.accountId,
          archivedAt: IsNull(),
          folderId: folder.id,
        },
      }),
      this.folders.count({
        where: {
          accountId: folder.accountId,
          archivedAt: IsNull(),
          parentFolderId: folder.id,
        },
      }),
    ]);

    return {
      id: folder.id,
      name: folder.name,
      full_name: this.getFolderName(folder),
      parent_folder_id: folder.parentFolderId,
      templates_count: templatesCount,
      subfolders_count: subfoldersCount,
      created_at: folder.createdAt,
      updated_at: folder.updatedAt,
    };
  }

  private async assertFolderParentAllowed(
    user: User,
    folder: TemplateFolder,
    parent: TemplateFolder | null,
  ): Promise<void> {
    if (!parent) return;
    if (parent.id === folder.id) {
      throw new UnprocessableEntityException({
        error: 'Folder cannot be moved inside itself',
      });
    }
    const descendants = await this.findDescendantFolders(
      user.accountId,
      folder.id,
    );
    if (descendants.some((descendant) => descendant.id === parent.id)) {
      throw new UnprocessableEntityException({
        error: 'Folder cannot be moved inside one of its subfolders',
      });
    }
  }

  private assertEditableFolder(folder: TemplateFolder): void {
    if (!folder.parentFolderId && folder.name === TemplateFolder.DEFAULT_NAME) {
      throw new UnprocessableEntityException({
        error: 'Default folder cannot be modified',
      });
    }
  }

  private buildFolderPath(parent: string | undefined, name: string): string {
    return [parent, name].filter(Boolean).join(' / ');
  }

  private normalizeFolderPath(folderName: string): string {
    const normalizedName = folderName
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' / ');

    return normalizedName || TemplateFolder.DEFAULT_NAME;
  }

  private splitFolderPath(folderName: string): [string | null, string] {
    const parts = this.normalizeFolderPath(folderName).split(' / ');
    const name = parts.pop() ?? TemplateFolder.DEFAULT_NAME;

    return [parts.length ? parts.join(' / ') : null, name];
  }

  private normalizeUpdateBody(input: UpdateTemplateDto): UpdateTemplateDto {
    return {
      ...input,
      ...(input.template ?? {}),
    };
  }

  private applyRoles(
    submitters: TemplateSubmitter[],
    roles: string[],
  ): TemplateSubmitter[] {
    const nextSubmitters = [...submitters];

    roles.forEach((role, index) => {
      const submitter = nextSubmitters[index];

      if (submitter) {
        nextSubmitters[index] = {
          ...submitter,
          name: role,
        };
        return;
      }

      nextSubmitters.push({
        name: role,
        uuid: randomUUID(),
      });
    });

    return nextSubmitters;
  }

  private cloneTemplateJson(
    template: Template,
  ): Pick<Template, 'fields' | 'preferences' | 'schema' | 'submitters'> {
    const submitters = deepClone(template.submitters);
    const fields = deepClone(template.fields);
    const schema = deepClone(template.schema);
    const preferences = deepClone(template.preferences);
    const submitterUuidMap = new Map<string, string>();
    const fieldUuidMap = new Map<string, string>();
    const attachmentUuidMap = new Map<string, string>();

    for (const submitter of submitters) {
      if (!submitter.uuid) {
        submitter.uuid = randomUUID();
        continue;
      }

      const nextUuid = randomUUID();
      submitterUuidMap.set(submitter.uuid, nextUuid);
      submitter.uuid = nextUuid;
    }

    const preferenceSubmitters = Array.isArray(preferences.submitters)
      ? preferences.submitters
      : [];

    for (const submitter of preferenceSubmitters) {
      if (!isJsonObject(submitter) || typeof submitter.uuid !== 'string') {
        continue;
      }

      submitter.uuid = submitterUuidMap.get(submitter.uuid) ?? submitter.uuid;
    }

    for (const item of schema) {
      if (typeof item.attachment_uuid !== 'string') {
        continue;
      }

      const nextUuid = randomUUID();
      attachmentUuidMap.set(item.attachment_uuid, nextUuid);
      item.attachment_uuid = nextUuid;
    }

    for (const field of fields) {
      if (field.uuid) {
        const nextUuid = randomUUID();
        fieldUuidMap.set(field.uuid, nextUuid);
        field.uuid = nextUuid;
      } else {
        field.uuid = randomUUID();
      }

      if (field.submitter_uuid) {
        field.submitter_uuid =
          submitterUuidMap.get(field.submitter_uuid) ?? field.submitter_uuid;
      }

      if (Array.isArray(field.areas)) {
        field.areas = field.areas.map((area) => ({
          ...area,
          attachment_uuid:
            typeof area.attachment_uuid === 'string'
              ? (attachmentUuidMap.get(area.attachment_uuid) ??
                area.attachment_uuid)
              : area.attachment_uuid,
        }));
      }
    }

    for (const field of fields) {
      this.rewriteFieldReferences(field, fieldUuidMap);
    }

    for (const item of schema) {
      rewriteConditions(item.conditions, fieldUuidMap);
    }

    for (const submitter of submitters) {
      rewriteSubmitterReference(
        submitter,
        'optional_invite_by_uuid',
        submitterUuidMap,
      );
      rewriteSubmitterReference(submitter, 'invite_by_uuid', submitterUuidMap);
      rewriteSubmitterReference(submitter, 'linked_to_uuid', submitterUuidMap);
      rewriteSubmitterReference(
        submitter,
        'invite_via_field_uuid',
        fieldUuidMap,
      );
    }

    return { fields, preferences, schema, submitters };
  }

  private mergeTemplateJson(
    templates: Template[],
    roles?: string[],
  ): Pick<Template, 'fields' | 'schema' | 'submitters'> & {
    sources: { schema: Template['schema']; template: Template }[];
  } {
    const fields: TemplateField[] = [];
    const schema: Template['schema'] = [];
    const submitters: TemplateSubmitter[] = [];
    const sources: { schema: Template['schema']; template: Template }[] = [];

    for (const template of templates) {
      const cloned = this.cloneTemplateJson(template);
      const schemaOffset = schema.length;

      schema.push(...cloned.schema);
      fields.push(...cloned.fields);
      submitters.push(...cloned.submitters);
      sources.push({
        template,
        schema: schema.slice(schemaOffset, schemaOffset + cloned.schema.length),
      });
    }

    if (roles?.length) {
      roles.forEach((role, index) => {
        const submitter = submitters[index];

        if (submitter) {
          submitters[index] = { ...submitter, name: role };
          return;
        }

        submitters.push({ name: role, uuid: randomUUID() });
      });
    }

    return { fields, schema, sources, submitters };
  }

  private rewriteFieldReferences(
    field: TemplateField,
    fieldUuidMap: Map<string, string>,
  ): void {
    rewriteConditions(field.conditions, fieldUuidMap);

    const formula = field.preferences?.formula;

    if (typeof formula !== 'string' || fieldUuidMap.size === 0) {
      return;
    }

    field.preferences = {
      ...field.preferences,
      formula: Array.from(fieldUuidMap.entries()).reduce(
        (nextFormula, [oldUuid, newUuid]) =>
          nextFormula.replaceAll(oldUuid, newUuid),
        formula,
      ),
    };
  }

  async getTemplateWebhookPayload(
    templateId: string,
  ): Promise<Record<string, unknown>> {
    const template = await this.templates.findOne({
      where: { id: templateId },
      relations: {
        author: true,
        folder: {
          parentFolder: true,
        },
      },
    });

    if (!template) {
      throw new NotFoundException({ error: 'Template not found' });
    }

    return (await this.toTemplateResponse(template)) as unknown as Record<
      string,
      unknown
    >;
  }

  async getTemplateArchiveWebhookPayload(
    templateId: string,
  ): Promise<Record<string, unknown>> {
    const template = await this.templates.findOne({
      where: { id: templateId },
      withDeleted: true,
    });

    if (!template) {
      throw new NotFoundException({ error: 'Template not found' });
    }

    return {
      id: template.id,
      archived_at: template.archivedAt,
    };
  }

  private async recordTemplateActivity(input: {
    data?: Record<string, unknown>;
    eventType: string;
    saveVersion?: boolean;
    summary: string;
    template: Template;
    user: User;
  }): Promise<void> {
    const event = await this.templateEvents.save(
      this.templateEvents.create({
        accountId: input.template.accountId,
        templateId: input.template.id,
        userId: input.user.id,
        eventType: input.eventType,
        summary: input.summary,
        eventTimestamp: new Date(),
        data: input.data ?? {},
      }),
    );

    if (input.saveVersion === false) {
      return;
    }

    await this.saveTemplateVersion(input.template, input.user, {
      event_id: event.id,
      event_type: input.eventType,
      summary: input.summary,
      ...(input.data ?? {}),
    });
  }

  private async saveTemplateVersion(
    template: Template,
    user: User,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const snapshot = {
      ...this.buildTemplateSnapshot(template),
      metadata,
    };
    const sha1 = createHash('sha1')
      .update(JSON.stringify(snapshot))
      .digest('hex');
    const existing = await this.templateVersions.findOne({
      where: {
        templateId: template.id,
        sha1,
      },
    });

    if (existing) {
      return;
    }

    await this.templateVersions.save(
      this.templateVersions.create({
        accountId: template.accountId,
        authorId: user.id,
        templateId: template.id,
        data: snapshot,
        sha1,
      }),
    );
  }

  private buildTemplateSnapshot(template: Template): Record<string, unknown> {
    return {
      archived_at: template.archivedAt?.toISOString() ?? null,
      external_id: template.externalId,
      fields: deepClone(template.fields),
      folder_id: template.folderId,
      name: template.name,
      preferences: deepClone(template.preferences),
      schema: deepClone(template.schema),
      shared_link: template.sharedLink,
      source: template.source,
      submitters: deepClone(template.submitters),
      variables_schema: deepClone(template.variablesSchema),
    };
  }

  private async toTemplateResponse(
    template: Template,
  ): Promise<TemplateResponseDto> {
    const accountContext = await this.accountsService.getTestingAccountContext(
      template.accountId,
    );
    const sharedWithTestMode = accountContext.testingAccountId
      ? Boolean(
          await this.templateSharings.findOne({
            where: {
              accountId: accountContext.testingAccountId,
              templateId: template.id,
            },
          }),
        )
      : false;

    return {
      id: template.id,
      archived_at: template.archivedAt,
      fields: template.fields,
      name: template.name,
      preferences: template.preferences,
      schema: template.schema,
      slug: template.slug,
      source: template.source,
      submitters: template.submitters,
      created_at: template.createdAt,
      updated_at: template.updatedAt,
      author_id: template.authorId,
      external_id: template.externalId,
      folder_id: template.folderId,
      shared_link: template.sharedLink,
      shared_with_test_mode: sharedWithTestMode,
      application_key: template.externalId,
      folder_name: this.getFolderName(template.folder),
      variables_schema: template.variablesSchema,
      author: {
        id: template.author.id,
        email: template.author.email,
        first_name: template.author.firstName,
        last_name: template.author.lastName,
      },
      documents: await this.serializeTemplateDocuments(template),
    };
  }

  private async serializeTemplateDocuments(
    template: Template,
  ): Promise<TemplateDocumentResponse[]> {
    const previewUrlTtlSeconds = 3600;
    const attachments = await this.storageService.findRecordAttachments({
      recordType: 'Template',
      recordId: template.id,
      name: 'documents',
    });
    const attachmentsByUuid = new Map(
      attachments.map((attachment) => [attachment.uuid, attachment]),
    );
    const schemaAttachmentUuids = template.schema
      .map((item) => item.attachment_uuid)
      .filter((uuid): uuid is string => typeof uuid === 'string');
    const orderedAttachments = schemaAttachmentUuids
      .map((uuid) => attachmentsByUuid.get(uuid))
      .filter((attachment) => attachment !== undefined);
    const previewsByAttachmentId =
      await this.storageService.findPreviewAttachmentsByRecordIds(
        orderedAttachments.map((attachment) => attachment.id),
      );

    return orderedAttachments.map((attachment) => {
      const previews = previewsByAttachmentId.get(String(attachment.id)) ?? [];
      const firstPreview = previews[0] ?? null;

      return {
        id: attachment.id,
        uuid: attachment.uuid,
        url: this.storageService.createBlobProxyUrl(
          attachment.blob,
          previewUrlTtlSeconds,
        ),
        preview_image_url: firstPreview
          ? this.storageService.createBlobProxyUrl(
              firstPreview.blob,
              previewUrlTtlSeconds,
            )
          : null,
        preview_images: previews.map((preview) => ({
          id: preview.id,
          url: this.storageService.createBlobProxyUrl(
            preview.blob,
            previewUrlTtlSeconds,
          ),
          filename: preview.blob.filename,
          metadata: preview.blob.metadata ?? {},
        })),
        filename: attachment.blob.filename,
      };
    });
  }

  private getFolderName(folder: TemplateFolder): string {
    if (folder.parentFolder) {
      return `${this.getFolderName(folder.parentFolder)} / ${folder.name}`;
    }

    return folder.name;
  }
}

type ResolvedPdfDocument = {
  filename: string;
  buffer: Buffer;
  fields: TemplateField[];
  pendingFields: boolean;
  dynamicSource?: {
    body: string;
    head: string | null;
    type: 'docx' | 'html';
  };
};

type TemplateDocumentOperation = {
  document?: ResolvedPdfDocument;
  name?: string;
  position?: number;
  remove?: boolean;
  replace?: boolean;
};

type DocumentAttachment = {
  attachment: Awaited<ReturnType<StorageService['createPdfAttachment']>>;
  document: ResolvedPdfDocument;
};

const blankPageSizes: Record<string, { height: number; width: number }> = {
  a4: { width: 595.28, height: 841.89 },
  legal: { width: 612, height: 1008 },
  letter: { width: 612, height: 792 },
};

function getBlankPageSize(size?: string): { height: number; width: number } {
  const normalizedSize = size?.trim().toLowerCase() || 'letter';

  return blankPageSizes[normalizedSize] ?? blankPageSizes.letter;
}

function getBaseName(filename: string): string {
  return basename(filename, extname(filename));
}

function ensurePdfFilename(filename: string): string {
  return filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
}

function stripDataUrlPrefix(value: string): string {
  const [, base64] = value.match(/^data:[^;]+;base64,(.*)$/) ?? [];

  return base64 ?? value;
}

function isUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function isDocxFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith('.docx');
}

function isImageMimeType(value: string): boolean {
  return value.toLowerCase().startsWith('image/');
}

function clampInsertIndex(
  position: number | undefined,
  length: number,
): number {
  if (typeof position !== 'number' || Number.isNaN(position)) {
    return length;
  }

  return Math.max(0, Math.min(position, length));
}

function normalizeIdList(ids: unknown[]): string[] {
  return ids
    .map((id) => String(id).trim())
    .filter((id, index, list) => id && list.indexOf(id) === index);
}

function deepClone<T>(value: T): T {
  return value == null ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function getChangedTemplatePaths(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  return Array.from(keys).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}

function summarizeTemplateChange(
  eventType: string,
  changedPaths: string[],
): string {
  if (eventType === 'template.archived') {
    return 'Template archived';
  }

  if (eventType === 'template.restored') {
    return 'Template restored';
  }

  if (eventType === 'template.renamed') {
    return 'Template renamed';
  }

  if (changedPaths.includes('fields')) {
    return 'Template fields updated';
  }

  if (changedPaths.includes('preferences')) {
    return 'Template preferences updated';
  }

  if (changedPaths.includes('schema')) {
    return 'Template documents updated';
  }

  if (changedPaths.includes('submitters')) {
    return 'Template recipients updated';
  }

  if (changedPaths.includes('shared_link')) {
    return 'Template sharing updated';
  }

  if (changedPaths.includes('folder_id')) {
    return 'Template moved to another folder';
  }

  return 'Template updated';
}

function mergeTemplatePreferences(
  currentPreferences: Record<string, unknown>,
  nextPreferences: Record<string, unknown>,
): Record<string, unknown> {
  return removeBlankPreferenceValues({
    ...currentPreferences,
    ...nextPreferences,
  });
}

function removeBlankPreferenceValues(
  preferences: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(preferences).filter(
      ([, value]) => !isBlankPreferenceValue(value),
    ),
  );
}

function isBlankPreferenceValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim() === '';
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (isJsonObject(value)) {
    return Object.keys(value).length === 0;
  }

  return value === undefined || value === null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rewriteConditions(
  conditions: unknown,
  fieldUuidMap: Map<string, string>,
): void {
  if (!Array.isArray(conditions)) {
    return;
  }

  for (const condition of conditions) {
    if (!isJsonObject(condition) || typeof condition.field_uuid !== 'string') {
      continue;
    }

    condition.field_uuid =
      fieldUuidMap.get(condition.field_uuid) ?? condition.field_uuid;
  }
}

function rewriteSubmitterReference(
  submitter: TemplateSubmitter,
  key: keyof TemplateSubmitter,
  uuidMap: Map<string, string>,
): void {
  const value = submitter[key];

  if (typeof value !== 'string') {
    return;
  }

  (submitter as Record<string, unknown>)[key] = uuidMap.get(value) ?? value;
}

function parseContentDispositionFilename(value: string | null): string {
  if (!value) return '';
  const extended = value.match(/filename\*\s*=\s*UTF-8'[^']*'([^;]+)/i);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // RFC 6266 permits recovering a usable legacy filename from an invalid header.
    }
  }
  const quoted = value.match(/filename\s*=\s*"([^"]+)"/i);
  const plain = value.match(/filename\s*=\s*([^;]+)/i);
  return (quoted?.[1] ?? plain?.[1] ?? '').trim();
}
