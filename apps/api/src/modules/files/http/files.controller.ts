import { Body, Controller, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type RequestUploadsRequest, requestUploadsSchema, type StoredFileResponse, type UploadsResponse } from '@procesabpm/shared';
import { RequireAnyPermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { TICKET_SUBJECT } from '../../tickets/domain/ticket-subject.js';
import { UploadConfirmationService } from '../application/upload-confirmation.service.js';
import { UploadRequestService } from '../application/upload-request.service.js';

/** Whoever can put something on a ticket (create it, comment, advance or close it) may upload what they will attach. */
export const UPLOAD_ACTIONS = ['create', 'create_for_others', 'comment', 'transition', 'close'] as const;

@Controller('files')
export class FilesController {
  constructor(
    @Inject(UploadRequestService) private readonly requests: UploadRequestService,
    @Inject(UploadConfirmationService) private readonly confirmation: UploadConfirmationService,
  ) {}

  @RequireAnyPermission(UPLOAD_ACTIONS, TICKET_SUBJECT)
  @Post('uploads')
  requestUploads(@Body(new ZodValidationPipe(requestUploadsSchema)) body: RequestUploadsRequest): Promise<UploadsResponse> {
    return this.requests.request(body);
  }

  @RequireAnyPermission(UPLOAD_ACTIONS, TICKET_SUBJECT)
  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@Param('id', ParseUUIDPipe) id: string): Promise<StoredFileResponse> {
    return this.confirmation.confirm(id);
  }
}
