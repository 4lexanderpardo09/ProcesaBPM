import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  type AddObserverRequest,
  addObserverRequestSchema,
  type CreateCutoffRequest,
  createCutoffRequestSchema,
  type CutoffResponse,
  type ObserverResponse,
  type UpdateCutoffRequest,
  updateCutoffRequestSchema,
} from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { WorkflowLinksService } from '../application/workflow-links.service.js';

const uuid = new ParseUUIDPipe();

@Controller('workflows/:workflowId')
export class WorkflowLinksController {
  constructor(@Inject(WorkflowLinksService) private readonly links: WorkflowLinksService) {}

  @RequirePermission('read', 'Workflow')
  @Get('observers')
  observers(@Param('workflowId', uuid) workflowId: string): Promise<ObserverResponse[]> {
    return this.links.listObservers(workflowId);
  }

  @RequirePermission('update', 'Workflow')
  @Post('observers')
  addObserver(@Param('workflowId', uuid) workflowId: string, @Body(new ZodValidationPipe(addObserverRequestSchema)) body: AddObserverRequest): Promise<ObserverResponse> {
    return this.links.addObserver(workflowId, body);
  }

  @RequirePermission('update', 'Workflow')
  @Delete('observers/:observerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeObserver(@Param('workflowId', uuid) workflowId: string, @Param('observerId', uuid) observerId: string): Promise<void> {
    return this.links.removeObserver(workflowId, observerId);
  }

  @RequirePermission('read', 'Workflow')
  @Get('cutoffs')
  cutoffs(@Param('workflowId', uuid) workflowId: string): Promise<CutoffResponse[]> {
    return this.links.listCutoffs(workflowId);
  }

  @RequirePermission('update', 'Workflow')
  @Post('cutoffs')
  createCutoff(@Param('workflowId', uuid) workflowId: string, @Body(new ZodValidationPipe(createCutoffRequestSchema)) body: CreateCutoffRequest): Promise<CutoffResponse> {
    return this.links.createCutoff(workflowId, body);
  }

  @RequirePermission('update', 'Workflow')
  @Patch('cutoffs/:cutoffId')
  updateCutoff(@Param('workflowId', uuid) workflowId: string, @Param('cutoffId', uuid) cutoffId: string, @Body(new ZodValidationPipe(updateCutoffRequestSchema)) body: UpdateCutoffRequest): Promise<CutoffResponse> {
    return this.links.updateCutoff(workflowId, cutoffId, body);
  }

  @RequirePermission('update', 'Workflow')
  @Delete('cutoffs/:cutoffId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCutoff(@Param('workflowId', uuid) workflowId: string, @Param('cutoffId', uuid) cutoffId: string): Promise<void> {
    return this.links.removeCutoff(workflowId, cutoffId);
  }
}
