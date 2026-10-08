import { Module } from '@nestjs/common';
import { TicketAccessModule } from '../tickets/ticket-access.module.js';
import { TagsService } from './application/tags.service.js';
import { TicketTagsService } from './application/ticket-tags.service.js';
import { TagRepository } from './data/tag.repository.js';
import { TagsController } from './http/tags.controller.js';
import { TicketTagsController } from './http/ticket-tags.controller.js';

/** Personal tags (`tags`) and the tags a member puts on a ticket (`ticket_tags`). API only. */
@Module({
  imports: [TicketAccessModule],
  controllers: [TagsController, TicketTagsController],
  providers: [TagRepository, TagsService, TicketTagsService],
})
export class TagsModule {}
