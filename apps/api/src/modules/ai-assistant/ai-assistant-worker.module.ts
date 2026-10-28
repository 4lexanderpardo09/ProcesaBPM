import { Module } from '@nestjs/common';
import { WORKER_SETTINGS, type WorkerSettings } from '../../config/worker-settings.js';
import { LlmModule } from '../../infrastructure/llm/llm.module.js';
import { LlmProvider } from '../../infrastructure/llm/llm-provider.js';
import { WorkflowDraftWriterModule } from '../workflows/workflow-draft-writer.module.js';
import { AiJobScheduler } from './application/ai-job.scheduler.js';
import { DraftDesigner } from './application/draft-designer.js';
import { DraftTaskReader } from './application/draft-task.reader.js';
import { WorkflowDraftJob } from './application/workflow-draft.job.js';
import { AiJobClaimsRepository } from './data/ai-job-claims.repository.js';
import { AiJobWorkRepository } from './data/ai-job-work.repository.js';

/** The worker's side of the AI assistant: talks to the provider and writes the drafts. Worker only. */
@Module({
  imports: [LlmModule, WorkflowDraftWriterModule],
  providers: [
    AiJobClaimsRepository,
    AiJobWorkRepository,
    { provide: DraftDesigner, inject: [LlmProvider, WORKER_SETTINGS], useFactory: (provider: LlmProvider, settings: WorkerSettings) => new DraftDesigner(provider, settings.AI_MAX_ROUNDS) },
    DraftTaskReader,
    WorkflowDraftJob,
    AiJobScheduler,
  ],
  exports: [WorkflowDraftJob],
})
export class AiAssistantWorkerModule {}
