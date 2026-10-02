import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import {
  type CreatePdfFormatRequest,
  createPdfFormatRequestSchema,
  type Page,
  type PageQuery,
  pageQuerySchema,
  type PdfFormatResponse,
  type PreviewRequest,
  previewRequestSchema,
  type UpdatePdfFormatRequest,
  updatePdfFormatRequestSchema,
} from '@procesabpm/shared';
import type { Response } from 'express';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { PdfFormatsService } from '../application/pdf-formats.service.js';
import { PdfPreviewService } from '../application/pdf-preview.service.js';
import { sendPdf } from './send-pdf.js';

const uuid = new ParseUUIDPipe();

@Controller('workflows/:workflowId/pdf-formats')
export class PdfFormatsController {
  constructor(
    @Inject(PdfFormatsService) private readonly formats: PdfFormatsService,
    @Inject(PdfPreviewService) private readonly previews: PdfPreviewService,
  ) {}

  @RequirePermission('read', 'PdfDocument')
  @Get()
  list(@Param('workflowId', uuid) workflowId: string, @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery): Promise<Page<PdfFormatResponse>> {
    return this.formats.list(workflowId, query);
  }

  @RequirePermission('read', 'PdfDocument')
  @Get(':id')
  get(@Param('workflowId', uuid) workflowId: string, @Param('id', uuid) id: string): Promise<PdfFormatResponse> {
    return this.formats.get(workflowId, id);
  }

  @RequirePermission('create', 'PdfDocument')
  @Post()
  create(@Param('workflowId', uuid) workflowId: string, @Body(new ZodValidationPipe(createPdfFormatRequestSchema)) body: CreatePdfFormatRequest): Promise<PdfFormatResponse> {
    return this.formats.create(workflowId, body);
  }

  @RequirePermission('update', 'PdfDocument')
  @Patch(':id')
  update(@Param('workflowId', uuid) workflowId: string, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(updatePdfFormatRequestSchema)) body: UpdatePdfFormatRequest): Promise<PdfFormatResponse> {
    return this.formats.update(workflowId, id, body);
  }

  @RequirePermission('delete', 'PdfDocument')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('workflowId', uuid) workflowId: string, @Param('id', uuid) id: string): Promise<void> {
    return this.formats.remove(workflowId, id);
  }

  @RequirePermission('read', 'PdfDocument')
  @Post(':id/preview')
  @HttpCode(HttpStatus.OK)
  async preview(@Param('workflowId', uuid) workflowId: string, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(previewRequestSchema)) body: PreviewRequest, @Res({ passthrough: true }) response: Response) {
    return sendPdf(response, await this.previews.previewFormat(workflowId, id, body));
  }
}
