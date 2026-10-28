import { Module } from '@nestjs/common';
import { RateLimitModule } from '../../infrastructure/security/rate-limit.module.js';
import { WorkflowDraftWriterModule } from '../workflows/workflow-draft-writer.module.js';
import { AiDraftRequestsService } from './application/ai-draft-requests.service.js';
import { AiSettingsService } from './application/ai-settings.service.js';
import { AiAssistantRepository } from './data/ai-assistant.repository.js';
import { AiAssistantSettingsController } from './http/ai-assistant-settings.controller.js';
import { AiDraftsController } from './http/ai-drafts.controller.js';

/** The AI assistant in the API: the organization's switch, its usage, and recording requests. The worker does the work. */
@Module({
  imports: [WorkflowDraftWriterModule, RateLimitModule],
  controllers: [AiAssistantSettingsController, AiDraftsController],
  providers: [AiAssistantRepository, AiSettingsService, AiDraftRequestsService],
})
export class AiAssistantModule {}
