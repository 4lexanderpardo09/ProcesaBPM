import { Module } from '@nestjs/common';
import { OutboxDispatcherModule } from '../../infrastructure/outbox/outbox-dispatcher.module.js';
import { PdfModule } from '../../infrastructure/pdf/pdf.module.js';
import { TicketDocumentRepository } from '../files/data/ticket-document.repository.js';
import { SystemFilesModule } from '../files/system-files.module.js';
import { DocumentFanoutHandlers } from './application/document-fanout.handlers.js';
import { DocumentGenerationHandler } from './application/document-generation.handler.js';
import { RenderFactsLoader } from './application/render-facts.loader.js';
import { DocumentFanoutRepository } from './data/document-fanout.repository.js';
import { DocumentOutboxRepository } from './data/document-outbox.repository.js';
import { DocumentSourceRepository } from './data/document-source.repository.js';
import { RenderFactsRepository } from './data/render-facts.repository.js';

/** The worker's side of documents: queues the PDFs a ticket's events ask for and draws them. Imported by the worker only. */
@Module({
  imports: [OutboxDispatcherModule, PdfModule, SystemFilesModule],
  providers: [DocumentSourceRepository, DocumentFanoutRepository, DocumentOutboxRepository, RenderFactsRepository, RenderFactsLoader, TicketDocumentRepository, DocumentFanoutHandlers, DocumentGenerationHandler],
})
export class DocumentsWorkerModule {}
