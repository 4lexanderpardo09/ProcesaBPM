import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type CreateWorkflowRequest,
  createWorkflowRequestSchema,
  type Page,
  type UpdateWorkflowRequest,
  updateWorkflowRequestSchema,
  type WorkflowDetailResponse,
  type WorkflowResponse,
  type WorkflowsQuery,
  workflowsQuerySchema,
} from '@procesabpm/shared';
import { Audited } from '../../../common/audit/audited.decorator.js';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { WorkflowsService } from '../application/workflows.service.js';

@Controller('workflows')
export class WorkflowsController {
  constructor(@Inject(WorkflowsService) private readonly workflows: WorkflowsService) {}

  @RequirePermission('read', 'Workflow')
  @Get()
  list(@Query(new ZodValidationPipe(workflowsQuerySchema)) query: WorkflowsQuery): Promise<Page<WorkflowResponse>> {
    return this.workflows.list(query);
  }

  @RequirePermission('read', 'Workflow')
  @Get(':workflowId')
  get(@Param('workflowId', ParseUUIDPipe) workflowId: string): Promise<WorkflowDetailResponse> {
    return this.workflows.get(workflowId);
  }

  /** Creating and editing workflows is `update Workflow` (the catalog has no create/delete for them). */
  @RequirePermission('update', 'Workflow')
  @Post()
  @Audited('workflow.created')
  create(@Body(new ZodValidationPipe(createWorkflowRequestSchema)) body: CreateWorkflowRequest): Promise<WorkflowDetailResponse> {
    return this.workflows.create(body);
  }

  @RequirePermission('update', 'Workflow')
  @Patch(':workflowId')
  @Audited('workflow.updated')
  update(@Param('workflowId', ParseUUIDPipe) workflowId: string, @Body(new ZodValidationPipe(updateWorkflowRequestSchema)) body: UpdateWorkflowRequest): Promise<WorkflowDetailResponse> {
    return this.workflows.update(workflowId, body);
  }
}
