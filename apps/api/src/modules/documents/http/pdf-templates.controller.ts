import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import {
  type DownloadUrlResponse,
  type Page,
  type PageQuery,
  pageQuerySchema,
  type PdfTemplateResponse,
  type PreviewRequest,
  previewRequestSchema,
  putTemplateMappingRequestSchema,
  type RegisterPdfTemplateRequest,
  registerPdfTemplateRequestSchema,
  type RequestUploadsRequest,
  requestTemplateUploadSchema,
  type StoredFileResponse,
  type TemplateMapping,
  type TemplateMappingResponse,
  type UpdatePdfTemplateRequest,
  updatePdfTemplateRequestSchema,
  type UploadsResponse,
} from '@procesabpm/shared';
import type { Response } from 'express';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { UploadConfirmationService } from '../../files/application/upload-confirmation.service.js';
import { UploadRequestService } from '../../files/application/upload-request.service.js';
import { PdfPreviewService } from '../application/pdf-preview.service.js';
import { PdfTemplatesService } from '../application/pdf-templates.service.js';
import { sendPdf } from './send-pdf.js';

const uuid = new ParseUUIDPipe();

@Controller()
export class PdfTemplatesController {
  constructor(
    @Inject(PdfTemplatesService) private readonly templates: PdfTemplatesService,
    @Inject(PdfPreviewService) private readonly previews: PdfPreviewService,
    @Inject(UploadRequestService) private readonly uploads: UploadRequestService,
    @Inject(UploadConfirmationService) private readonly confirmation: UploadConfirmationService,
  ) {}

  /** The template PDF travels like any upload (reserve, send to the storage, confirm), but asking for it needs the permission to manage PDF documents, not to handle tickets. */
  @RequirePermission('create', 'PdfDocument')
  @Post('pdf-templates/uploads')
  requestUpload(@Body(new ZodValidationPipe(requestTemplateUploadSchema)) body: RequestUploadsRequest): Promise<UploadsResponse> {
    return this.uploads.request(body);
  }

  @RequirePermission('create', 'PdfDocument')
  @Post('pdf-templates/uploads/:fileId/confirm')
  @HttpCode(HttpStatus.OK)
  confirmUpload(@Param('fileId', uuid) fileId: string): Promise<StoredFileResponse> {
    return this.confirmation.confirm(fileId);
  }

  @RequirePermission('read', 'PdfDocument')
  @Get('workflows/:workflowId/pdf-templates')
  list(@Param('workflowId', uuid) workflowId: string, @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery): Promise<Page<PdfTemplateResponse>> {
    return this.templates.list(workflowId, query);
  }

  @RequirePermission('read', 'PdfDocument')
  @Get('workflows/:workflowId/pdf-templates/:id')
  get(@Param('workflowId', uuid) workflowId: string, @Param('id', uuid) id: string): Promise<PdfTemplateResponse> {
    return this.templates.get(workflowId, id);
  }

  @RequirePermission('create', 'PdfDocument')
  @Post('workflows/:workflowId/pdf-templates')
  register(@Param('workflowId', uuid) workflowId: string, @Body(new ZodValidationPipe(registerPdfTemplateRequestSchema)) body: RegisterPdfTemplateRequest): Promise<PdfTemplateResponse> {
    return this.templates.register(workflowId, body);
  }

  @RequirePermission('update', 'PdfDocument')
  @Patch('workflows/:workflowId/pdf-templates/:id')
  update(@Param('workflowId', uuid) workflowId: string, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(updatePdfTemplateRequestSchema)) body: UpdatePdfTemplateRequest): Promise<PdfTemplateResponse> {
    return this.templates.update(workflowId, id, body);
  }

  @RequirePermission('delete', 'PdfDocument')
  @Delete('workflows/:workflowId/pdf-templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('workflowId', uuid) workflowId: string, @Param('id', uuid) id: string): Promise<void> {
    return this.templates.remove(workflowId, id);
  }

  @RequirePermission('read', 'PdfDocument')
  @Get('workflows/:workflowId/pdf-templates/:id/mapping')
  getMapping(@Param('workflowId', uuid) workflowId: string, @Param('id', uuid) id: string): Promise<TemplateMappingResponse> {
    return this.templates.getMapping(workflowId, id);
  }

  @RequirePermission('update', 'PdfDocument')
  @Put('workflows/:workflowId/pdf-templates/:id/mapping')
  putMapping(@Param('workflowId', uuid) workflowId: string, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(putTemplateMappingRequestSchema)) body: TemplateMapping): Promise<TemplateMappingResponse> {
    return this.templates.putMapping(workflowId, id, body);
  }

  @RequirePermission('read', 'PdfDocument')
  @Get('workflows/:workflowId/pdf-templates/:id/file/download-url')
  downloadUrl(@Param('workflowId', uuid) workflowId: string, @Param('id', uuid) id: string): Promise<DownloadUrlResponse> {
    return this.templates.downloadUrl(workflowId, id);
  }

  @RequirePermission('read', 'PdfDocument')
  @Post('workflows/:workflowId/pdf-templates/:id/preview')
  @HttpCode(HttpStatus.OK)
  async preview(@Param('workflowId', uuid) workflowId: string, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(previewRequestSchema)) body: PreviewRequest, @Res({ passthrough: true }) response: Response) {
    return sendPdf(response, await this.previews.previewTemplate(workflowId, id, body));
  }
}
