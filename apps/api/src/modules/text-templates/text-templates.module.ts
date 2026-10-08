import { Module } from '@nestjs/common';
import { TextTemplatesService } from './application/text-templates.service.js';
import { TextTemplateRepository } from './data/text-template.repository.js';
import { TextTemplatesController } from './http/text-templates.controller.js';

/** Personal text templates (snippets) and the read-only shares. API only. */
@Module({
  controllers: [TextTemplatesController],
  providers: [TextTemplateRepository, TextTemplatesService],
})
export class TextTemplatesModule {}
