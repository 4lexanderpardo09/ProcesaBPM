import { Module } from '@nestjs/common';
import { DraftEditorService } from './application/draft-editor.service.js';
import { DraftLock } from './application/draft-lock.js';
import { WorkflowGraphService } from './application/workflow-graph.service.js';
import { WorkflowLinksService } from './application/workflow-links.service.js';
import { WorkflowPublicationService } from './application/workflow-publication.service.js';
import { WorkflowVersionsService } from './application/workflow-versions.service.js';
import { WorkflowsService } from './application/workflows.service.js';
import { DraftContentRepository } from './data/draft-content.repository.js';
import { VersionDocumentRepository } from './data/version-document.repository.js';
import { WorkflowLinksRepository } from './data/workflow-links.repository.js';
import { WorkflowRepository } from './data/workflow.repository.js';
import { DraftContentController } from './http/draft-content.controller.js';
import { WorkflowLinksController } from './http/workflow-links.controller.js';
import { WorkflowVersionsController } from './http/workflow-versions.controller.js';
import { WorkflowsController } from './http/workflows.controller.js';

/** The workflow builder backend: workflows, their versions (draft, published, archived), the canvas and publication. */
@Module({
  controllers: [WorkflowsController, WorkflowVersionsController, DraftContentController, WorkflowLinksController],
  providers: [
    WorkflowRepository,
    VersionDocumentRepository,
    DraftContentRepository,
    WorkflowLinksRepository,
    DraftLock,
    WorkflowsService,
    WorkflowVersionsService,
    WorkflowGraphService,
    WorkflowPublicationService,
    DraftEditorService,
    WorkflowLinksService,
  ],
})
export class WorkflowsModule {}
