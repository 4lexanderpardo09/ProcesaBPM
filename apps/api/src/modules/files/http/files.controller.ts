import { Body, Controller, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { type RequestUploadsRequest, requestUploadsSchema, type StoredFileResponse, type UploadsResponse } from '@procesabpm/shared';
import { RequireAnyPermission } from '../../../common/auth/route-access.js';
import { RateLimit, RateLimitGuard, type RateLimitPolicy } from '../../../common/auth/rate-limit.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { TICKET_SUBJECT } from '../../tickets/domain/ticket-subject.js';
import { UploadConfirmationService } from '../application/upload-confirmation.service.js';
import { UploadRequestService } from '../application/upload-request.service.js';

/** Whoever can put something on a ticket (create it, comment, advance or close it) may upload what they will attach. */
export const UPLOAD_ACTIONS = ['create', 'create_for_others', 'comment', 'transition', 'close'] as const;

const MINUTE = 60_000;
/** The quota already bounds storage; this bounds the request rate (a flood of signed-URL requests). */
const UPLOADS_RATE_LIMIT: RateLimitPolicy = { name: 'files-uploads', perIp: { limit: 60, windowMs: 5 * MINUTE }, perIdentifier: { limit: 30, windowMs: 5 * MINUTE } };
const CONFIRM_RATE_LIMIT: RateLimitPolicy = { name: 'files-confirm', perIp: { limit: 120, windowMs: 5 * MINUTE }, perIdentifier: { limit: 60, windowMs: 5 * MINUTE } };

@Controller('files')
export class FilesController {
  constructor(
    @Inject(UploadRequestService) private readonly requests: UploadRequestService,
    @Inject(UploadConfirmationService) private readonly confirmation: UploadConfirmationService,
  ) {}

  @RequireAnyPermission(UPLOAD_ACTIONS, TICKET_SUBJECT)
  @RateLimit(UPLOADS_RATE_LIMIT)
  @UseGuards(RateLimitGuard)
  @Post('uploads')
  requestUploads(@Body(new ZodValidationPipe(requestUploadsSchema)) body: RequestUploadsRequest): Promise<UploadsResponse> {
    return this.requests.request(body);
  }

  @RequireAnyPermission(UPLOAD_ACTIONS, TICKET_SUBJECT)
  @RateLimit(CONFIRM_RATE_LIMIT)
  @UseGuards(RateLimitGuard)
  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@Param('id', ParseUUIDPipe) id: string): Promise<StoredFileResponse> {
    return this.confirmation.confirm(id);
  }
}
