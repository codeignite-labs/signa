import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  getSchemaPath,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiOrJwtGuard } from '../auth/guards/api-or-jwt/api-or-jwt.guard';
import { UserHydrationGuard } from '../auth/guards/user-hydration/user-hydration.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { UploadedBufferFile } from '../storage/storage.types';
import type { SubmissionRequestMetadata } from './submission-event-data';
import { User } from '../users/entities/user.entity';
import { CreateSubmissionFromDocxDto } from './dto/create-submission-from-docx.dto';
import { CreateSubmissionFromHtmlDto } from './dto/create-submission-from-html.dto';
import { CreateSubmissionFromPdfDto } from './dto/create-submission-from-pdf.dto';
import {
  CreateSubmissionBatchDto,
  CreateSubmissionAliasDto,
  CreateSubmissionDto,
} from './dto/create-submission.dto';
import { DeleteSubmissionQueryDto } from './dto/delete-submission-query.dto';
import { EventFeedResponseDto } from './dto/event-feed-response.dto';
import { ListSubmissionsQueryDto } from './dto/list-submissions-query.dto';
import { SendEmailResponseDto } from './dto/send-email-response.dto';
import { SubmissionMailEventsResponseDto } from './dto/submission-mail-event-response.dto';
import { SubmissionInitResponseDto } from './dto/submission-init-response.dto';
import {
  SubmissionDeleteResponseDto,
  SubmissionDocumentsResponseDto,
  SubmissionResponseDto,
  SubmissionSubmitterResponseDto,
  SubmissionsListResponseDto,
} from './dto/submission-response.dto';
import { SubmissionEventLogResponseDto } from './dto/submission-event-log-response.dto';
import { SubmissionExportService } from './submission-export.service';
import { SubmissionsService } from './submissions.service';
import { CreateSubmissionBodyPipe } from './pipes/create-submission-body/create-submission-body.pipe';

@Controller('submissions')
@UseGuards(ApiOrJwtGuard, UserHydrationGuard)
@ApiTags('Submissions')
@ApiExtraModels(CreateSubmissionDto, CreateSubmissionBatchDto)
@ApiBearerAuth()
@ApiSecurity('X-Auth-Token')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Get()
  @ApiQuery({ name: 'template_id', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'completed', 'declined', 'expired'],
  })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'slug', required: false })
  @ApiQuery({ name: 'template_folder', required: false })
  @ApiQuery({ name: 'archived', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'after', required: false })
  @ApiQuery({ name: 'before', required: false })
  @ApiQuery({ name: 'include', required: false })
  @ApiOperation({
    description:
      'Returns account-scoped signature requests using DocuSeal cursor pagination. Use status, template_id, q, slug, folder, and archived filters to build dashboard or API workflows.',
    summary: 'List submissions',
  })
  @ApiOkResponse({ type: SubmissionsListResponseDto })
  listSubmissions(
    @CurrentUser() user: User,
    @Query() query: ListSubmissionsQueryDto,
  ): Promise<SubmissionsListResponseDto> {
    return this.submissionsService.listSubmissions(user, query);
  }

  @Get(':id')
  @ApiQuery({ name: 'include', required: false })
  @ApiParam({
    description: 'Submission id returned by a create/list submissions call.',
    name: 'id',
  })
  @ApiOperation({
    description:
      'Returns one submission with submitters, generated document URLs, audit URL, and optional included fields.',
    summary: 'Get a submission',
  })
  @ApiOkResponse({ type: SubmissionResponseDto })
  getSubmission(
    @CurrentUser() user: User,
    @Param('id') submissionId: string,
    @Query('include') include?: string,
  ): Promise<SubmissionResponseDto> {
    return this.submissionsService.getSubmission(user, submissionId, include);
  }

  @Get(':id/events')
  @ApiParam({ description: 'Submission id.', name: 'id' })
  @ApiOperation({
    description:
      'Returns Signa activity, signing, mail, and webhook events recorded for a submission. This is a Signa extension for traceability.',
    summary: 'List submission event log',
  })
  @ApiOkResponse({ type: SubmissionEventLogResponseDto })
  getSubmissionEvents(
    @CurrentUser() user: User,
    @Param('id') submissionId: string,
  ): Promise<SubmissionEventLogResponseDto> {
    return this.submissionsService.getSubmissionEvents(user, submissionId);
  }

  @Get(':id/documents')
  @ApiParam({ description: 'Submission id.', name: 'id' })
  @ApiQuery({
    description:
      'When true, returns the combined signed document/audit bundle where available.',
    name: 'merge',
    required: false,
    type: Boolean,
  })
  @ApiOperation({
    description:
      'Returns completed/pending document download URLs for a submission. Mirrors DocuSeal document URL retrieval and supports Signa combined-document generation.',
    summary: 'Get submission documents',
  })
  @ApiOkResponse({ type: SubmissionDocumentsResponseDto })
  getSubmissionDocuments(
    @CurrentUser() user: User,
    @Param('id') submissionId: string,
    @Query('merge') merge?: string,
  ): Promise<SubmissionDocumentsResponseDto> {
    return this.submissionsService.getSubmissionDocuments(user, submissionId, {
      merge: merge === 'true',
    });
  }

  @Post()
  @ApiBody({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(CreateSubmissionDto) },
        { $ref: getSchemaPath(CreateSubmissionBatchDto) },
        { type: 'array', items: { $ref: getSchemaPath(CreateSubmissionDto) } },
      ],
    },
  })
  @ApiOperation({
    description:
      'Creates one or more submitters from an existing template. Accepts DocuSeal-compatible submitter role/email/phone/value payloads, optional message overrides, ordering, expiry, and send flags.',
    summary: 'Create a submission from a template',
  })
  @ApiOkResponse({ type: [SubmissionSubmitterResponseDto] })
  createSubmission(
    @CurrentUser() user: User,
    @Body(CreateSubmissionBodyPipe)
    body:
      | CreateSubmissionDto
      | CreateSubmissionBatchDto
      | CreateSubmissionDto[],
    @Req() request: Request,
  ): Promise<SubmissionSubmitterResponseDto[]> {
    return this.submissionsService.createSubmission(
      user,
      body,
      getSubmissionRequestMetadata(request),
    );
  }

  @Post('emails')
  @ApiOperation({
    description:
      'DocuSeal-compatible shortcut for creating submissions from an email list or submitter list against a template.',
    summary: 'Create submissions from emails',
  })
  @ApiOkResponse({ type: [SubmissionSubmitterResponseDto] })
  createSubmissionFromEmails(
    @CurrentUser() user: User,
    @Body() body: CreateSubmissionAliasDto,
    @Req() request: Request,
  ): Promise<SubmissionSubmitterResponseDto[]> {
    return this.submissionsService.createSubmissionFromAlias(
      user,
      body,
      getSubmissionRequestMetadata(request),
    );
  }

  @Post('init')
  @ApiOperation({
    description:
      'Initializes a submission request without immediately sending it. This is used by dashboard send flows that need a draft-like submitter payload before delivery.',
    summary: 'Initialize a submission request',
  })
  @ApiOkResponse({ type: SubmissionInitResponseDto })
  initSubmission(
    @CurrentUser() user: User,
    @Body() body: CreateSubmissionAliasDto,
    @Req() request: Request,
  ): Promise<SubmissionInitResponseDto> {
    return this.submissionsService.createSubmissionInit(
      user,
      body,
      getSubmissionRequestMetadata(request),
    );
  }

  @Post('pdf')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'documents' },
      { name: 'files' },
      { name: 'file', maxCount: 1 },
    ]),
  )
  @ApiOperation({
    description:
      'Creates a temporary backing template from uploaded/base64/remote PDF documents, then creates submitters from it. Supports multipart files and DocuSeal JSON file inputs.',
    summary: 'Create a submission from PDF documents',
  })
  @ApiOkResponse({ type: [SubmissionSubmitterResponseDto] })
  createSubmissionFromPdf(
    @CurrentUser() user: User,
    @Body() body: CreateSubmissionFromPdfDto,
    @UploadedFiles()
    files?: Record<string, UploadedBufferFile[]>,
    @Req() request?: Request,
  ): Promise<SubmissionSubmitterResponseDto[]> {
    return this.submissionsService.createSubmissionFromPdf(
      user,
      body,
      files,
      getSubmissionRequestMetadata(request),
    );
  }

  @Post('html')
  @ApiOperation({
    description:
      'Creates a submission from HTML documents with DocuSeal field tags. HTML is rendered to PDF before the signing request is created.',
    summary: 'Create a submission from HTML',
  })
  @ApiOkResponse({ type: [SubmissionSubmitterResponseDto] })
  createSubmissionFromHtml(
    @CurrentUser() user: User,
    @Body() body: CreateSubmissionFromHtmlDto,
    @Req() request: Request,
  ): Promise<SubmissionSubmitterResponseDto[]> {
    return this.submissionsService.createSubmissionFromHtml(
      user,
      body,
      getSubmissionRequestMetadata(request),
    );
  }

  @Post('docx')
  @ApiOperation({
    description:
      'Creates a submission from DOCX documents. DOCX variables are expanded, rendered to PDF, and used as the backing signing documents.',
    summary: 'Create a submission from DOCX documents',
  })
  @ApiOkResponse({ type: [SubmissionSubmitterResponseDto] })
  createSubmissionFromDocx(
    @CurrentUser() user: User,
    @Body() body: CreateSubmissionFromDocxDto,
    @Req() request: Request,
  ): Promise<SubmissionSubmitterResponseDto[]> {
    return this.submissionsService.createSubmissionFromDocx(
      user,
      body,
      getSubmissionRequestMetadata(request),
    );
  }

  @Delete(':id')
  @ApiParam({ description: 'Submission id.', name: 'id' })
  @ApiOperation({
    description:
      'Archives a submission by default. Pass permanently=true to hard-delete it when allowed.',
    summary: 'Archive or delete a submission',
  })
  @ApiOkResponse({ type: SubmissionDeleteResponseDto })
  deleteSubmission(
    @CurrentUser() user: User,
    @Param('id') submissionId: string,
    @Query() query: DeleteSubmissionQueryDto,
  ): Promise<SubmissionDeleteResponseDto> {
    return this.submissionsService.deleteSubmission(user, submissionId, query);
  }
}

@Controller('templates/:templateId/submissions')
@UseGuards(ApiOrJwtGuard, UserHydrationGuard)
@ApiTags('Template Submissions')
@ApiBearerAuth()
@ApiSecurity('X-Auth-Token')
export class TemplateSubmissionsController {
  constructor(
    private readonly submissionsService: SubmissionsService,
    private readonly submissionExportService: SubmissionExportService,
  ) {}

  @Get('export')
  @ApiOperation({
    description:
      'Exports a template submission table as CSV or XLSX using the same filters as submission listing.',
    summary: 'Export template submissions',
  })
  async exportTemplateSubmissions(
    @CurrentUser() user: User,
    @Param('templateId') templateId: string,
    @Query() query: ListSubmissionsQueryDto & { format?: string },
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.submissionExportService.exportTemplateSubmissions(
      user.accountId,
      templateId,
      query,
    );

    response.setHeader('Content-Type', file.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    response.send(file.content);
  }

  @Get()
  @ApiParam({ description: 'Template id.', name: 'templateId' })
  @ApiOperation({
    description:
      'Lists submissions scoped to one template. Equivalent to GET /submissions?template_id={id}.',
    summary: 'List template submissions',
  })
  @ApiOkResponse({ type: SubmissionsListResponseDto })
  listTemplateSubmissions(
    @CurrentUser() user: User,
    @Param('templateId') templateId: string,
    @Query() query: ListSubmissionsQueryDto,
  ): Promise<SubmissionsListResponseDto> {
    return this.submissionsService.listSubmissions(user, {
      ...query,
      template_id: templateId,
    });
  }

  @Post()
  @ApiParam({ description: 'Template id.', name: 'templateId' })
  @ApiOperation({
    description:
      'Creates submitters for a specific template using the same body as POST /submissions/emails.',
    summary: 'Create template submissions',
  })
  @ApiOkResponse({ type: [SubmissionSubmitterResponseDto] })
  createTemplateSubmission(
    @CurrentUser() user: User,
    @Param('templateId') templateId: string,
    @Body() body: CreateSubmissionAliasDto,
    @Req() request: Request,
  ): Promise<SubmissionSubmitterResponseDto[]> {
    return this.submissionsService.createSubmissionFromAlias(
      user,
      {
        ...body,
        template_id: templateId,
      },
      getSubmissionRequestMetadata(request),
    );
  }
}

@Controller('events')
@UseGuards(ApiOrJwtGuard, UserHydrationGuard)
@ApiTags('Events')
@ApiBearerAuth()
@ApiSecurity('X-Auth-Token')
export class EventsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Get('form/:type')
  @ApiOperation({
    description:
      'Lists form/submitter webhook-style events by type with cursor pagination. This closes DocuSeal event-feed compatibility for form lifecycle integrations.',
    summary: 'List form events by type',
  })
  @ApiOkResponse({ type: EventFeedResponseDto })
  listFormEvents(
    @CurrentUser() user: User,
    @Param('type') type: string,
    @Query('limit') limit?: string,
    @Query('after') after?: string,
    @Query('before') before?: string,
  ): Promise<EventFeedResponseDto> {
    return this.submissionsService.listFormEvents(user, type, {
      after,
      before,
      limit,
    });
  }

  @Get('submission/:type')
  @ApiOperation({
    description:
      'Lists submission webhook-style events by type with cursor pagination for integration dashboards and diagnostics.',
    summary: 'List submission events by type',
  })
  @ApiOkResponse({ type: EventFeedResponseDto })
  listSubmissionEvents(
    @CurrentUser() user: User,
    @Param('type') type: string,
    @Query('limit') limit?: string,
    @Query('after') after?: string,
    @Query('before') before?: string,
  ): Promise<EventFeedResponseDto> {
    return this.submissionsService.listSubmissionEvents(user, type, {
      after,
      before,
      limit,
    });
  }
}

@Controller()
export class SubmissionMailController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post('submissions/:id/resend_email')
  @UseGuards(ApiOrJwtGuard, UserHydrationGuard)
  @ApiTags('Submission Mail')
  @ApiBearerAuth()
  @ApiSecurity('X-Auth-Token')
  @ApiOperation({
    description:
      'Queues signature request emails for the pending submitters in a submission.',
    summary: 'Resend submission signature emails',
  })
  @ApiOkResponse({ type: SendEmailResponseDto })
  resendSubmissionEmail(
    @CurrentUser() user: User,
    @Param('id') submissionId: string,
  ): Promise<SendEmailResponseDto> {
    return this.submissionsService.resendSubmissionEmail(user, submissionId);
  }

  @Post('submitters/:id/send_email')
  @UseGuards(ApiOrJwtGuard, UserHydrationGuard)
  @ApiTags('Submission Mail')
  @ApiBearerAuth()
  @ApiSecurity('X-Auth-Token')
  @ApiOperation({
    description: 'Queues a signature request email for one submitter.',
    summary: 'Send submitter signature email',
  })
  @ApiOkResponse({ type: SendEmailResponseDto })
  sendSubmitterEmail(
    @CurrentUser() user: User,
    @Param('id') submitterId: string,
  ): Promise<SendEmailResponseDto> {
    return this.submissionsService.sendSubmitterEmail(user, submitterId);
  }

  @Get('submissions/:id/mail-events')
  @UseGuards(ApiOrJwtGuard, UserHydrationGuard)
  @ApiTags('Submission Mail')
  @ApiBearerAuth()
  @ApiSecurity('X-Auth-Token')
  @ApiOperation({
    description:
      'Returns queued/sent/failed mail delivery records and provider error details for a submission.',
    summary: 'List submission mail events',
  })
  @ApiOkResponse({ type: SubmissionMailEventsResponseDto })
  listSubmissionMailEvents(
    @CurrentUser() user: User,
    @Param('id') submissionId: string,
  ): Promise<SubmissionMailEventsResponseDto> {
    return this.submissionsService.listSubmissionMailEvents(user, submissionId);
  }

  @Post('send_submission_email')
  @ApiTags('Submission Mail')
  @ApiOperation({
    description:
      'Public completed-document email endpoint used by signing completion screens. Accepts submitter_slug, submission_slug, or template_slug plus an optional target email.',
    summary: 'Send completed submission copy',
  })
  @ApiOkResponse({ type: SendEmailResponseDto })
  sendCompletedSubmissionEmail(
    @Body('submitter_slug') submitterSlug?: string,
    @Body('submission_slug') submissionSlug?: string,
    @Body('template_slug') templateSlug?: string,
    @Body('email') email?: string,
  ): Promise<SendEmailResponseDto> {
    return this.submissionsService.sendCompletedSubmissionEmail({
      email,
      submissionSlug,
      submitterSlug,
      templateSlug,
    });
  }
}

function getSubmissionRequestMetadata(
  request: Request | undefined,
): SubmissionRequestMetadata {
  return {
    ip: request?.ip,
    ua: request?.get('user-agent'),
  };
}
