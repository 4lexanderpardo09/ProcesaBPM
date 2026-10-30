import { Module } from '@nestjs/common';
import { RateLimitModule } from '../../infrastructure/security/rate-limit.module.js';
import { WorkflowDraftWriterModule } from '../workflows/workflow-draft-writer.module.js';
import { PdfFormatRepository } from '../documents/data/pdf-format.repository.js';
import { AiDraftRequestsService } from './application/ai-draft-requests.service.js';
import { AiFormatRequestsService } from './application/ai-format-requests.service.js';
import { AiSettingsService } from './application/ai-settings.service.js';
import { AiAssistantRepository } from './data/ai-assistant.repository.js';
import { AiAssistantSettingsController } from './http/ai-assistant-settings.controller.js';
import { AiDraftsController } from './http/ai-drafts.controller.js';
import { AiFormatsController } from './http/ai-formats.controller.js';

/** The AI assistant in the API: the organization's switch, its usage, and recording requests (workflow drafts and PDF formats). The worker does the work. */
@Module({
  imports: [WorkflowDraftWriterModule, RateLimitModule],
  controllers: [AiAssistantSettingsController, AiDraftsController, AiFormatsController],
  providers: [AiAssistantRepository, AiSettingsService, AiDraftRequestsService, PdfFormatRepository, AiFormatRequestsService],
})
export class AiAssistantModule {}
