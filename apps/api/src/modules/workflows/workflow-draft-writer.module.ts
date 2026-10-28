import { Module } from '@nestjs/common';
import { DraftDocumentImporter } from './application/draft-document-importer.js';
import { DraftLock } from './application/draft-lock.js';
import { ReferenceValidator } from './application/reference-validator.js';
import { ReferenceCheckRepository } from './data/reference-check.repository.js';
import { VersionDocumentRepository } from './data/version-document.repository.js';
import { WorkflowRepository } from './data/workflow.repository.js';

/** What writes a draft's content, shared by the API (the builder) and the worker (drafts made with AI). */
@Module({
  providers: [WorkflowRepository, VersionDocumentRepository, ReferenceCheckRepository, ReferenceValidator, DraftLock, DraftDocumentImporter],
  exports: [WorkflowRepository, VersionDocumentRepository, ReferenceCheckRepository, ReferenceValidator, DraftLock, DraftDocumentImporter],
})
export class WorkflowDraftWriterModule {}
