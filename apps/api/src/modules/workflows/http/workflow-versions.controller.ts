import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  type CreateVersionRequest,
  createVersionRequestSchema,
  type PublishVersionRequest,
  type PublishVersionResponse,
  publishVersionRequestSchema,
  type SaveGraphRequest,
  type SaveGraphResponse,
  saveGraphRequestSchema,
  type VersionDetailResponse,
  type VersionSummary,
  type WorkflowValidation,
} from '@procesabpm/shared';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { WorkflowGraphService } from '../application/workflow-graph.service.js';
import { WorkflowPublicationService } from '../application/workflow-publication.service.js';
import { WorkflowVersionsService } from '../application/workflow-versions.service.js';

@Controller('workflows/:workflowId/versions')
export class WorkflowVersionsController {
  constructor(
    @Inject(WorkflowVersionsService) private readonly versions: WorkflowVersionsService,
    @Inject(WorkflowGraphService) private readonly graph: WorkflowGraphService,
    @Inject(WorkflowPublicationService) private readonly publication: WorkflowPublicationService,
  ) {}

  /** A new draft: empty, or a copy of `fromVersionId`. */
  @RequirePermission('update', 'Workflow')
  @Post()
  create(@Param('workflowId', ParseUUIDPipe) workflowId: string, @Body(new ZodValidationPipe(createVersionRequestSchema)) body: CreateVersionRequest): Promise<VersionSummary> {
    return this.versions.create(workflowId, body);
  }

  @RequirePermission('read', 'Workflow')
  @Get(':versionId')
  get(@Param('workflowId', ParseUUIDPipe) workflowId: string, @Param('versionId', ParseUUIDPipe) versionId: string): Promise<VersionDetailResponse> {
    return this.versions.get(workflowId, versionId);
  }

  @RequirePermission('update', 'Workflow')
  @Delete(':versionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDraft(@Param('workflowId', ParseUUIDPipe) workflowId: string, @Param('versionId', ParseUUIDPipe) versionId: string): Promise<void> {
    return this.versions.deleteDraft(workflowId, versionId);
  }

  /** The whole canvas (blocks, transitions, positions) replaces the draft's in one transaction. */
  @RequirePermission('update', 'Workflow')
  @Put(':versionId/graph')
  saveGraph(
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body(new ZodValidationPipe(saveGraphRequestSchema)) body: SaveGraphRequest,
  ): Promise<SaveGraphResponse> {
    return this.graph.save(workflowId, versionId, body);
  }

  /** Read-only: the same list publishing would act on. */
  @RequirePermission('read', 'Workflow')
  @Get(':versionId/validation')
  validate(@Param('workflowId', ParseUUIDPipe) workflowId: string, @Param('versionId', ParseUUIDPipe) versionId: string): Promise<WorkflowValidation> {
    return this.graph.validate(workflowId, versionId);
  }

  @RequirePermission('publish', 'Workflow')
  @Post(':versionId/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentPrincipal() principal: Principal,
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body(new ZodValidationPipe(publishVersionRequestSchema)) body: PublishVersionRequest,
  ): Promise<PublishVersionResponse> {
    return this.publication.publish(workflowId, versionId, principal.userId, body);
  }
}
