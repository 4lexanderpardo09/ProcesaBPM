import { Module } from '@nestjs/common';
import { PdfModule } from '../../infrastructure/pdf/pdf.module.js';
import { FilesModule } from '../files/files.module.js';
import { TicketAccessModule } from '../tickets/ticket-access.module.js';
import { WorkflowsModule } from '../workflows/workflows.module.js';
import { DocumentSourcesPublicationCheck } from './application/document-sources.publication-check.js';
import { ImageLoader } from './application/image-loader.js';
import { DocumentSourceValidator } from './application/document-source.validator.js';
import { PdfImagesService } from './application/pdf-images.service.js';
import { PdfFormatsService } from './application/pdf-formats.service.js';
import { PdfPreviewService } from './application/pdf-preview.service.js';
import { PdfTemplatesService } from './application/pdf-templates.service.js';
import { TicketDocumentJobsService } from './application/ticket-document-jobs.service.js';
import { WorkflowDocumentsService } from './application/workflow-documents.service.js';
import { DocumentSourceRepository } from './data/document-source.repository.js';
import { PdfImageRepository } from './data/pdf-image.repository.js';
import { PdfFormatRepository } from './data/pdf-format.repository.js';
import { PdfTemplateRepository } from './data/pdf-template.repository.js';
import { RenderFactsRepository } from './data/render-facts.repository.js';
import { DocumentOutboxRepository } from './data/document-outbox.repository.js';
import { TicketDocumentJobsRepository } from './data/ticket-document-jobs.repository.js';
import { WorkflowDocumentRepository } from './data/workflow-document.repository.js';
import { PdfImagesController } from './http/pdf-images.controller.js';
import { PdfFormatsController } from './http/pdf-formats.controller.js';
import { PdfTemplatesController } from './http/pdf-templates.controller.js';
import { TicketDocumentJobsController } from './http/ticket-document-jobs.controller.js';
import { WorkflowDocumentsController } from './http/workflow-documents.controller.js';

/** The API of documents: designer formats, uploaded PDF templates with their field mapping, and which document a workflow produces. */
@Module({
  imports: [FilesModule, WorkflowsModule, PdfModule, TicketAccessModule],
  controllers: [PdfFormatsController, PdfImagesController, PdfTemplatesController, WorkflowDocumentsController, TicketDocumentJobsController],
  providers: [
    PdfFormatRepository,
    PdfTemplateRepository,
    PdfImageRepository,
    WorkflowDocumentRepository,
    DocumentSourceRepository,
    RenderFactsRepository,
    DocumentOutboxRepository,
    TicketDocumentJobsRepository,
    TicketDocumentJobsService,
    DocumentSourceValidator,
    ImageLoader,
    DocumentSourcesPublicationCheck,
    PdfFormatsService,
    PdfTemplatesService,
    PdfImagesService,
    WorkflowDocumentsService,
    PdfPreviewService,
  ],
})
export class DocumentsModule {}
