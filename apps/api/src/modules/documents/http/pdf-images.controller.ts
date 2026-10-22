import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  type PdfImageResponse,
  type RegisterPdfImageRequest,
  registerPdfImageRequestSchema,
  type RequestUploadsRequest,
  requestPdfImageUploadSchema,
  type StoredFileResponse,
  type UploadsResponse,
} from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { UploadConfirmationService } from '../../files/application/upload-confirmation.service.js';
import { UploadRequestService } from '../../files/application/upload-request.service.js';
import { PdfImagesService } from '../application/pdf-images.service.js';

const uuid = new ParseUUIDPipe();

@Controller()
export class PdfImagesController {
  constructor(
    @Inject(PdfImagesService) private readonly images: PdfImagesService,
    @Inject(UploadRequestService) private readonly uploads: UploadRequestService,
    @Inject(UploadConfirmationService) private readonly confirmation: UploadConfirmationService,
  ) {}

  /** The image travels like any upload (reserve, send to the storage, confirm), with the permission to manage PDF documents. */
  @RequirePermission('create', 'PdfDocument')
  @Post('pdf-images/uploads')
  requestUpload(@Body(new ZodValidationPipe(requestPdfImageUploadSchema)) body: RequestUploadsRequest): Promise<UploadsResponse> {
    return this.uploads.request(body);
  }

  @RequirePermission('create', 'PdfDocument')
  @Post('pdf-images/uploads/:fileId/confirm')
  @HttpCode(HttpStatus.OK)
  confirmUpload(@Param('fileId', uuid) fileId: string): Promise<StoredFileResponse> {
    return this.confirmation.confirm(fileId);
  }

  @RequirePermission('read', 'PdfDocument')
  @Get('workflows/:workflowId/pdf-images')
  list(@Param('workflowId', uuid) workflowId: string): Promise<PdfImageResponse[]> {
    return this.images.list(workflowId);
  }

  @RequirePermission('create', 'PdfDocument')
  @Post('workflows/:workflowId/pdf-images')
  register(@Param('workflowId', uuid) workflowId: string, @Body(new ZodValidationPipe(registerPdfImageRequestSchema)) body: RegisterPdfImageRequest): Promise<PdfImageResponse> {
    return this.images.register(workflowId, body);
  }

  @RequirePermission('delete', 'PdfDocument')
  @Delete('workflows/:workflowId/pdf-images/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('workflowId', uuid) workflowId: string, @Param('id', uuid) id: string): Promise<void> {
    return this.images.remove(workflowId, id);
  }
}
