import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { FilesModule } from '../files/files.module.js';
import { EngineModule } from '../engine/engine.module.js';
import { TicketDocumentsService } from './application/ticket-documents.service.js';
import { TicketQueriesService } from './application/ticket-queries.service.js';
import { TicketAccessModule } from './ticket-access.module.js';
import { TicketsController } from './http/tickets.controller.js';

/** What people do with tickets: create, advance, reassign, close, read (with per-record authorization) and the timeline. */
@Module({
  imports: [EngineModule, AuthorizationModule, FilesModule, TicketAccessModule],
  controllers: [TicketsController],
  providers: [TicketQueriesService, TicketDocumentsService],
})
export class TicketsModule {}
