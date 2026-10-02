import { Module } from '@nestjs/common';
import { FileAttachmentService } from './application/file-attachment.service.js';
import { SystemFileService } from './application/system-file.service.js';
import { StorageUsageService } from './application/storage-usage.service.js';
import { TicketFileService } from './application/ticket-file.service.js';
import { UploadConfirmationService } from './application/upload-confirmation.service.js';
import { UploadRequestService } from './application/upload-request.service.js';
import { StoredFileRepository } from './data/stored-file.repository.js';
import { TenantUsageRepository } from './data/tenant-usage.repository.js';
import { TicketDocumentRepository } from './data/ticket-document.repository.js';
import { FilesController } from './http/files.controller.js';
import { StorageUsageController } from './http/storage-usage.controller.js';

/** Uploads (reserve, then confirm), the storage quota and the files attached to tickets. */
@Module({
  controllers: [FilesController, StorageUsageController],
  providers: [StoredFileRepository, TenantUsageRepository, TicketDocumentRepository, UploadRequestService, UploadConfirmationService, StorageUsageService, FileAttachmentService, TicketFileService, SystemFileService],
  exports: [FileAttachmentService, TicketFileService, SystemFileService, UploadRequestService, UploadConfirmationService],
})
export class FilesModule {}
