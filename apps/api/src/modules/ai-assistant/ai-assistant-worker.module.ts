import { Module } from '@nestjs/common';
import { WORKER_SETTINGS, type WorkerSettings } from '../../config/worker-settings.js';
import { LlmModule } from '../../infrastructure/llm/llm.module.js';
import { LlmProvider } from '../../infrastructure/llm/llm-provider.js';
import { DocumentSourceValidator } from '../documents/application/document-source.validator.js';
import { DocumentSourceRepository } from '../documents/data/document-source.repository.js';
import { PdfFormatRepository } from '../documents/data/pdf-format.repository.js';
import { PdfImageRepository } from '../documents/data/pdf-image.repository.js';
import { WorkflowVersionQuery } from '../workflows/application/workflow-version-query.js';
import { WorkflowDraftWriterModule } from '../workflows/workflow-draft-writer.module.js';
import { AiJobScheduler } from './application/ai-job.scheduler.js';
import { DraftDesigner } from './application/draft-designer.js';
import { DraftTaskReader } from './application/draft-task.reader.js';
import { FormatDesigner } from './application/format-designer.js';
import { FormatDraftJob } from './application/format-draft.job.js';
import { FormatTaskReader } from './application/format-task.reader.js';
import { WorkflowDraftJob } from './application/workflow-draft.job.js';
import { AiJobClaimsRepository } from './data/ai-job-claims.repository.js';
import { AiJobWorkRepository } from './data/ai-job-work.repository.js';

/** The worker's side of the AI assistant: talks to the provider, writes the workflow drafts and designs PDF formats. Worker only. */
@Module({
  imports: [LlmModule, WorkflowDraftWriterModule],
  providers: [
    AiJobClaimsRepository,
    AiJobWorkRepository,
    { provide: DraftDesigner, inject: [LlmProvider, WORKER_SETTINGS], useFactory: (provider: LlmProvider, settings: WorkerSettings) => new DraftDesigner(provider, settings.AI_MAX_ROUNDS) },
    DraftTaskReader,
    // Jiro in the format designer: the checks a format saved by hand goes through.
    WorkflowVersionQuery,
    PdfFormatRepository,
    PdfImageRepository,
    DocumentSourceRepository,
    DocumentSourceValidator,
    { provide: FormatDesigner, inject: [LlmProvider, WORKER_SETTINGS], useFactory: (provider: LlmProvider, settings: WorkerSettings) => new FormatDesigner(provider, settings.AI_MAX_ROUNDS) },
    FormatTaskReader,
    FormatDraftJob,
    WorkflowDraftJob,
    AiJobScheduler,
  ],
  exports: [WorkflowDraftJob],
})
export class AiAssistantWorkerModule {}
