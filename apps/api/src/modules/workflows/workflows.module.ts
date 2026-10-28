import { Module } from '@nestjs/common';
import { DraftEditorService } from './application/draft-editor.service.js';
import { DraftSpecImportService } from './application/draft-spec-import.service.js';
import { PublishedVersionReader } from './application/published-version-reader.js';
import { WorkflowGraphService } from './application/workflow-graph.service.js';
import { WorkflowLinksService } from './application/workflow-links.service.js';
import { PublicationCheckRegistry } from './application/publication-check.registry.js';
import { WorkflowVersionQuery } from './application/workflow-version-query.js';
import { WorkflowPublicationService } from './application/workflow-publication.service.js';
import { WorkflowVersionsService } from './application/workflow-versions.service.js';
import { WorkflowsService } from './application/workflows.service.js';
import { DraftContentRepository } from './data/draft-content.repository.js';
import { WorkflowLinksRepository } from './data/workflow-links.repository.js';
import { DraftContentController } from './http/draft-content.controller.js';
import { WorkflowLinksController } from './http/workflow-links.controller.js';
import { WorkflowVersionsController } from './http/workflow-versions.controller.js';
import { WorkflowsController } from './http/workflows.controller.js';
import { WorkflowDraftWriterModule } from './workflow-draft-writer.module.js';

/** The workflow builder backend: workflows, their versions (draft, published, archived), the canvas and publication. */
@Module({
  imports: [WorkflowDraftWriterModule],
  controllers: [WorkflowsController, WorkflowVersionsController, DraftContentController, WorkflowLinksController],
  providers: [
    DraftContentRepository,
    WorkflowLinksRepository,
    WorkflowsService,
    WorkflowVersionsService,
    WorkflowGraphService,
    WorkflowPublicationService,
    DraftEditorService,
    DraftSpecImportService,
    WorkflowLinksService,
    PublishedVersionReader,
    WorkflowVersionQuery,
    PublicationCheckRegistry,
  ],
  exports: [PublishedVersionReader, WorkflowVersionQuery, PublicationCheckRegistry],
})
export class WorkflowsModule {}
