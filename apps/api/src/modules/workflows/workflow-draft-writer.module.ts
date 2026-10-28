import { Module } from '@nestjs/common';
import { DraftDocumentImporter } from './application/draft-document-importer.js';
import { DraftLock } from './application/draft-lock.js';
import { DraftSpecReader } from './application/draft-spec-reader.js';
import { ReferenceValidator } from './application/reference-validator.js';
import { DraftCatalogRepository } from './data/draft-catalog.repository.js';
import { ReferenceCheckRepository } from './data/reference-check.repository.js';
import { VersionDocumentRepository } from './data/version-document.repository.js';
import { WorkflowRepository } from './data/workflow.repository.js';

/** What reads and writes a draft's content, shared by the API (the builder) and the worker (drafts made with AI). */
@Module({
  providers: [WorkflowRepository, VersionDocumentRepository, ReferenceCheckRepository, ReferenceValidator, DraftLock, DraftDocumentImporter, DraftCatalogRepository, DraftSpecReader],
  exports: [WorkflowRepository, VersionDocumentRepository, ReferenceCheckRepository, ReferenceValidator, DraftLock, DraftDocumentImporter, DraftCatalogRepository, DraftSpecReader],
})
export class WorkflowDraftWriterModule {}
