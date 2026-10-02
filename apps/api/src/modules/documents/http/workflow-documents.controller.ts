import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type CreateWorkflowDocumentRequest,
  createWorkflowDocumentRequestSchema,
  type Page,
  type PageQuery,
  pageQuerySchema,
  type UpdateWorkflowDocumentRequest,
  updateWorkflowDocumentRequestSchema,
  type WorkflowDocumentResponse,
} from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { WorkflowDocumentsService } from '../application/workflow-documents.service.js';

const uuid = new ParseUUIDPipe();

@Controller('workflows/:workflowId/documents')
export class WorkflowDocumentsController {
  constructor(@Inject(WorkflowDocumentsService) private readonly documents: WorkflowDocumentsService) {}

  @RequirePermission('read', 'PdfDocument')
  @Get()
  list(@Param('workflowId', uuid) workflowId: string, @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery): Promise<Page<WorkflowDocumentResponse>> {
    return this.documents.list(workflowId, query);
  }

  @RequirePermission('read', 'PdfDocument')
  @Get(':id')
  get(@Param('workflowId', uuid) workflowId: string, @Param('id', uuid) id: string): Promise<WorkflowDocumentResponse> {
    return this.documents.get(workflowId, id);
  }

  @RequirePermission('create', 'PdfDocument')
  @Post()
  create(@Param('workflowId', uuid) workflowId: string, @Body(new ZodValidationPipe(createWorkflowDocumentRequestSchema)) body: CreateWorkflowDocumentRequest): Promise<WorkflowDocumentResponse> {
    return this.documents.create(workflowId, body);
  }

  @RequirePermission('update', 'PdfDocument')
  @Patch(':id')
  update(@Param('workflowId', uuid) workflowId: string, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(updateWorkflowDocumentRequestSchema)) body: UpdateWorkflowDocumentRequest): Promise<WorkflowDocumentResponse> {
    return this.documents.update(workflowId, id, body);
  }

  @RequirePermission('delete', 'PdfDocument')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('workflowId', uuid) workflowId: string, @Param('id', uuid) id: string): Promise<void> {
    return this.documents.remove(workflowId, id);
  }
}
